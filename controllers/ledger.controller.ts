import { Hono } from "hono";
import type { D1Database } from "@cloudflare/workers-types";
import { z } from "zod";
import { requireUser, checkCompanyPermission } from "./admin-access";
import { appendAuditEvent, auditRequestMetadata } from "../services/audit";

type Bindings = { DB: D1Database };
const ledgerController = new Hono<{ Bindings: Bindings }>();

const accountSchema = z.object({
  code: z.string().trim().min(1).max(32),
  name: z.string().trim().min(1).max(160),
  type: z.enum(["asset", "liability", "equity", "revenue", "expense"]),
  normalBalance: z.enum(["debit", "credit"]),
  isHeader: z.boolean().default(false),
  isPostable: z.boolean().default(true),
  isActive: z.boolean().default(true),
  parentId: z.string().trim().max(128).nullable().optional(),
}).strict();

const lineSchema = z.object({
  accountId: z.string().trim().min(1),
  description: z.string().trim().max(255).nullable().optional(),
  debitMinor: z.number().int().nonnegative(),
  creditMinor: z.number().int().nonnegative(),
}).strict().refine(
  (line) => (line.debitMinor === 0) !== (line.creditMinor === 0),
  { message: "Each line must have exactly one debit or credit amount" },
);

const entrySchema = z.object({
  companyId: z.string().trim().min(1),
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  currency: z.string().trim().length(3).default("PHP"),
  reference: z.string().trim().max(128).nullable().optional(),
  description: z.string().trim().max(500).nullable().optional(),
  lines: z.array(lineSchema).min(2).max(200),
  attachments: z.array(z.object({
    fileName: z.string().trim().min(1).max(255),
    mimeType: z.string().trim().min(1).max(128),
    dataBase64: z.string().max(1_500_000),
  }).strict()).max(10).optional(),
}).strict();

async function permission(c: any, companyId: string, key: string) {
  const access = await requireUser(c);
  if ("response" in access) return access;
  const result = await checkCompanyPermission(c.env.DB, access.userId, companyId, key);
  if (!result.member) return { response: c.json({ error: "Company not found" }, 404) };
  if (!result.allowed) return { response: c.json({ error: "Permission denied" }, 403) };
  return access;
}

function validDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

ledgerController.get("/accounts", async (c) => {
  const companyId = c.req.query("companyId") ?? "";
  const access = await permission(c, companyId, "ledger.view");
  if ("response" in access) return access.response;
  const rows = await c.env.DB.prepare(
    `SELECT id, code, name, type, normal_balance AS normalBalance,
            is_header AS isHeader, is_postable AS isPostable,
            is_active AS isActive, parent_id AS parentId
     FROM accounts WHERE company_id = ? ORDER BY code`,
  ).bind(companyId).all();
  return c.json({ data: rows.results });
});

ledgerController.post("/accounts", async (c) => {
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: "Request body must be valid JSON" }, 400); }
  const companyId = (body as any)?.companyId;
  if (typeof companyId !== "string") return c.json({ error: "Company ID is required" }, 400);
  const access = await permission(c, companyId, "ledger.create");
  if ("response" in access) return access.response;
  const parsed = accountSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "Invalid account", details: parsed.error.flatten() }, 400);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const result = await c.env.DB.prepare(
    `INSERT INTO accounts (
       company_id, id, code, name, type, normal_balance, is_header,
       is_postable, is_active, parent_id, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    companyId, id, parsed.data.code, parsed.data.name, parsed.data.type,
    parsed.data.normalBalance, parsed.data.isHeader ? 1 : 0,
    parsed.data.isPostable ? 1 : 0, parsed.data.isActive ? 1 : 0,
    parsed.data.parentId ?? null, now,
  ).run();
  if ((result.meta.changes ?? 0) !== 1) return c.json({ error: "Could not create account" }, 409);
  await appendAuditEvent(c.env.DB, {
    companyId, actorId: access.userId,
    ...auditRequestMetadata(c.req.raw.headers),
    action: "ledger.account.create", resourceType: "account", resourceId: id,
    after: parsed.data,
  });
  return c.json({ success: true, data: { id, ...parsed.data } }, 201);
});

ledgerController.put("/accounts/:id", async (c) => {
  const companyId = c.req.query("companyId") ?? "";
  const access = await permission(c, companyId, "ledger.create");
  if ("response" in access) return access.response;
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: "Request body must be valid JSON" }, 400); }
  const parsed = accountSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "Invalid account", details: parsed.error.flatten() }, 400);
  const id = c.req.param("id");
  const before = await c.env.DB.prepare(
    `SELECT id, code, name, type, normal_balance AS normalBalance,
            is_header AS isHeader, is_postable AS isPostable,
            is_active AS isActive, parent_id AS parentId
     FROM accounts WHERE company_id = ? AND id = ? LIMIT 1`,
  ).bind(companyId, id).first();
  if (!before) return c.json({ error: "Account not found" }, 404);
  const posted = await c.env.DB.prepare(
    `SELECT 1 AS found FROM journal_lines l JOIN journal_entries e
       ON e.company_id = l.company_id AND e.id = l.entry_id
     WHERE l.company_id = ? AND l.account_id = ? AND e.status = 'posted' LIMIT 1`,
  ).bind(companyId, id).first();
  if (posted && parsed.data.code !== (before as any).code) {
    return c.json({ error: "Posted accounts cannot change code; deactivate instead" }, 409);
  }
  const update = await c.env.DB.prepare(
    `UPDATE accounts SET code = ?, name = ?, type = ?, normal_balance = ?,
                        is_header = ?, is_postable = ?, is_active = ?, parent_id = ?
     WHERE company_id = ? AND id = ?`,
  ).bind(
    parsed.data.code, parsed.data.name, parsed.data.type, parsed.data.normalBalance,
    parsed.data.isHeader ? 1 : 0, parsed.data.isPostable ? 1 : 0,
    parsed.data.isActive ? 1 : 0, parsed.data.parentId ?? null, companyId, id,
  ).run();
  if ((update.meta.changes ?? 0) !== 1) return c.json({ error: "Account not found" }, 404);
  await appendAuditEvent(c.env.DB, {
    companyId, actorId: access.userId, ...auditRequestMetadata(c.req.raw.headers),
    action: "ledger.account.update", resourceType: "account", resourceId: id,
    before, after: parsed.data,
  });
  return c.json({ success: true });
});

ledgerController.delete("/accounts/:id", async (c) => {
  const companyId = c.req.query("companyId") ?? "";
  const access = await permission(c, companyId, "ledger.create");
  if ("response" in access) return access.response;
  const id = c.req.param("id");
  const before = await c.env.DB.prepare(
    `SELECT id, code, name FROM accounts WHERE company_id = ? AND id = ? LIMIT 1`,
  ).bind(companyId, id).first();
  if (!before) return c.json({ error: "Account not found" }, 404);
  try {
    await c.env.DB.prepare(
      `DELETE FROM accounts WHERE company_id = ? AND id = ?`,
    ).bind(companyId, id).run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("postings") || message.includes("FOREIGN KEY")) {
      return c.json({ error: "Deactivate accounts that have postings instead of deleting" }, 409);
    }
    throw error;
  }
  await appendAuditEvent(c.env.DB, {
    companyId, actorId: access.userId, ...auditRequestMetadata(c.req.raw.headers),
    action: "ledger.account.delete", resourceType: "account", resourceId: id,
    before,
  });
  return c.json({ success: true });
});

ledgerController.get("/entries", async (c) => {
  const companyId = c.req.query("companyId") ?? "";
  const access = await permission(c, companyId, "ledger.view");
  if ("response" in access) return access.response;
  const status = c.req.query("status") ?? "";
  const entryDate = c.req.query("from") ?? "";
  const to = c.req.query("to") ?? "";
  const clauses = ["e.company_id = ?"];
  const values: (string | number)[] = [companyId];
  if (["draft", "posted", "voided", "pending approval"].includes(status)) {
    clauses.push("e.status = ?"); values.push(status);
  }
  if (validDate(entryDate)) { clauses.push("e.entry_date >= ?"); values.push(entryDate); }
  if (validDate(to)) { clauses.push("e.entry_date <= ?"); values.push(to); }
  const entries = await c.env.DB.prepare(
    `SELECT e.id, e.voucher_number AS voucherNumber, e.entry_date AS entryDate,
            e.currency, e.reference, e.description, e.status,
            e.source_type AS sourceType, e.source_id AS sourceId,
            e.posted_at AS postedAt, e.reversed_entry_id AS reversedEntryId,
            COALESCE((SELECT SUM(l.debit_minor) FROM journal_lines l WHERE l.company_id=e.company_id AND l.entry_id=e.id),0) AS totalDebitMinor,
            COALESCE((SELECT SUM(l.credit_minor) FROM journal_lines l WHERE l.company_id=e.company_id AND l.entry_id=e.id),0) AS totalCreditMinor
     FROM journal_entries e WHERE ${clauses.join(" AND ")}
     ORDER BY e.entry_date DESC, e.created_at DESC LIMIT 200`,
  ).bind(...values).all();
  return c.json({ data: entries.results });
});

ledgerController.get("/entries/:id", async (c) => {
  const companyId = c.req.query("companyId") ?? "";
  const access = await permission(c, companyId, "ledger.view");
  if ("response" in access) return access.response;
  const id = c.req.param("id");
  const entry = await c.env.DB.prepare(
    `SELECT id, voucher_number AS voucherNumber, entry_date AS entryDate, currency,
            reference, description, status, source_type AS sourceType,
            source_id AS sourceId, posted_at AS postedAt,
            reversed_entry_id AS reversedEntryId
     FROM journal_entries WHERE company_id = ? AND id = ? LIMIT 1`,
  ).bind(companyId, id).first();
  if (!entry) return c.json({ error: "Journal entry not found" }, 404);
  const [lines, attachments] = await Promise.all([
    c.env.DB.prepare(
      `SELECT l.id, l.account_id AS accountId, a.code AS accountCode,
              a.name AS accountName, l.description,
              l.debit_minor AS debitMinor, l.credit_minor AS creditMinor
       FROM journal_lines l JOIN accounts a
         ON a.company_id=l.company_id AND a.id=l.account_id
       WHERE l.company_id=? AND l.entry_id=? ORDER BY l.id`,
    ).bind(companyId, id).all(),
    c.env.DB.prepare(
      `SELECT id, file_name AS fileName, mime_type AS mimeType,
              size_bytes AS sizeBytes, created_at AS createdAt
       FROM journal_attachments WHERE company_id=? AND entry_id=? ORDER BY created_at`,
    ).bind(companyId, id).all(),
  ]);
  return c.json({ data: { entry, lines: lines.results, attachments: attachments.results } });
});

ledgerController.post("/entries", async (c) => {
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: "Request body must be valid JSON" }, 400); }
  const preliminary = body as any;
  const access = await permission(c, preliminary?.companyId ?? "", "ledger.create");
  if ("response" in access) return access.response;
  const parsed = entrySchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "Invalid journal entry", details: parsed.error.flatten() }, 400);
  const data = parsed.data;
  if (!validDate(data.entryDate)) return c.json({ error: "Entry date must be a real YYYY-MM-DD date" }, 400);
  const debit = data.lines.reduce((sum, line) => sum + line.debitMinor, 0);
  const credit = data.lines.reduce((sum, line) => sum + line.creditMinor, 0);
  if (debit !== credit) return c.json({ error: "Journal entry is unbalanced", differenceMinor: debit - credit }, 400);
  if (debit <= 0) return c.json({ error: "Journal entry must contain positive amounts" }, 400);
  const accountIds = [...new Set(data.lines.map((line) => line.accountId))];
  const placeholders = accountIds.map(() => "?").join(",");
  const accounts = await c.env.DB.prepare(
    `SELECT id FROM accounts WHERE company_id=? AND is_active=1 AND is_postable=1 AND id IN (${placeholders})`,
  ).bind(data.companyId, ...accountIds).all<{ id: string }>();
  if (accounts.results.length !== accountIds.length) return c.json({ error: "One or more accounts are missing, inactive, or header-only" }, 400);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const entryStatement = c.env.DB.prepare(
    `INSERT INTO journal_entries (
       company_id, id, entry_date, currency, reference, description,
       status, source_type, source_id, created_by, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, 'draft', NULL, NULL, ?, ?, ?)`,
  ).bind(data.companyId, id, data.entryDate, data.currency, data.reference ?? null, data.description ?? null, access.userId, now, now);
  const statements: any[] = [entryStatement];
  for (const line of data.lines) {
    statements.push(c.env.DB.prepare(
      `INSERT INTO journal_lines (company_id,id,entry_id,account_id,description,debit_minor,credit_minor)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(data.companyId, crypto.randomUUID(), id, line.accountId, line.description ?? null, line.debitMinor, line.creditMinor));
  }
  for (const attachment of data.attachments ?? []) {
    const bytes = new TextEncoder().encode(attachment.dataBase64).length;
    statements.push(c.env.DB.prepare(
      `INSERT INTO journal_attachments (company_id,id,entry_id,file_name,mime_type,size_bytes,data_base64,uploaded_by,created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(data.companyId, crypto.randomUUID(), id, attachment.fileName, attachment.mimeType, bytes, attachment.dataBase64, access.userId, now));
  }
  await c.env.DB.batch(statements);
  await appendAuditEvent(c.env.DB, {
    companyId: data.companyId, actorId: access.userId,
    ...auditRequestMetadata(c.req.raw.headers),
    action: "ledger.entry.save_draft", resourceType: "journal_entry", resourceId: id,
    after: { id, entryDate: data.entryDate, currency: data.currency, totalDebitMinor: debit, totalCreditMinor: credit },
  });
  return c.json({ success: true, data: { id, status: "draft", totalDebitMinor: debit, totalCreditMinor: credit } }, 201);
});

ledgerController.post("/entries/:id/post", async (c) => {
  let body: Record<string, unknown> = {};
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    body = {};
  }
  const companyId =
    (typeof body.companyId === "string" ? body.companyId : null) ??
    c.req.query("companyId") ??
    "";
  const access = await permission(c, companyId, "ledger.post");
  if ("response" in access) return access.response;
  const id = c.req.param("id");
  const entry = await c.env.DB.prepare(
    `SELECT id, entry_date AS entryDate, status, currency, voucher_number AS voucherNumber
     FROM journal_entries WHERE company_id=? AND id=? LIMIT 1`,
  ).bind(companyId, id).first<any>();
  if (!entry) return c.json({ error: "Journal entry not found" }, 404);
  if (entry.status === "posted") return c.json({ error: "Journal entry is already posted" }, 409);
  if (entry.status === "voided") return c.json({ error: "Voided entries cannot be posted" }, 409);
  const period = await c.env.DB.prepare(
    `SELECT id FROM accounting_periods
     WHERE company_id=? AND period_start<=? AND period_end>=? AND status='closed' LIMIT 1`,
  ).bind(companyId, entry.entryDate, entry.entryDate).first();
  if (period) return c.json({ error: "Cannot post into a closed accounting period" }, 409);
  const totals = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(debit_minor),0) AS debit,
            COALESCE(SUM(credit_minor),0) AS credit
     FROM journal_lines WHERE company_id=? AND entry_id=?`,
  ).bind(companyId, id).first<{ debit: number; credit: number }>();
  if (!totals || totals.debit !== totals.credit || totals.debit <= 0) {
    return c.json({ error: "Journal entry is unbalanced", debitMinor: totals?.debit ?? 0, creditMinor: totals?.credit ?? 0 }, 400);
  }
  const series = await c.env.DB.prepare(
    `SELECT id, prefix, next_number AS nextNumber, padding
     FROM voucher_series WHERE company_id=? ORDER BY prefix LIMIT 1`,
  ).bind(companyId).first<any>();
  if (!series) return c.json({ error: "No voucher series configured" }, 409);
  const voucherNumber = `${series.prefix}${String(series.nextNumber).padStart(series.padding, "0")}`;
  const now = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE voucher_series SET next_number=next_number+1
       WHERE company_id=? AND id=? AND next_number=?`,
    ).bind(companyId, series.id, series.nextNumber),
    c.env.DB.prepare(
      `UPDATE journal_entries
       SET status='posted', voucher_number=?, series_id=?, posted_by=?, posted_at=?, updated_at=?
       WHERE company_id=? AND id=? AND status IN ('draft','pending approval')`,
    ).bind(voucherNumber, series.id, access.userId, now, now, companyId, id),
  ]);
  await appendAuditEvent(c.env.DB, {
    companyId, actorId: access.userId, ...auditRequestMetadata(c.req.raw.headers),
    action: "ledger.entry.post", resourceType: "journal_entry", resourceId: id,
    before: { status: entry.status },
    after: { status: "posted", voucherNumber, totalDebitMinor: totals.debit, totalCreditMinor: totals.credit },
  });
  return c.json({ success: true, data: { id, voucherNumber, status: "posted" } });
});

ledgerController.post("/entries/:id/reverse", async (c) => {
  let body: { companyId?: string; reason?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: "Request body must be valid JSON" }, 400); }
  const companyId = body.companyId ?? "";
  const access = await permission(c, companyId, "ledger.reverse");
  if ("response" in access) return access.response;
  if (!body.reason?.trim()) return c.json({ error: "A reversal reason is required" }, 400);
  const id = c.req.param("id");
  const original = await c.env.DB.prepare(
    `SELECT id, entry_date AS entryDate, currency, status, reference, description
     FROM journal_entries WHERE company_id=? AND id=? LIMIT 1`,
  ).bind(companyId, id).first<any>();
  if (!original) return c.json({ error: "Journal entry not found" }, 404);
  if (original.status !== "posted") return c.json({ error: "Only posted entries can be reversed" }, 409);
  const lines = await c.env.DB.prepare(
    `SELECT account_id AS accountId, description, debit_minor AS debitMinor,
            credit_minor AS creditMinor
     FROM journal_lines WHERE company_id=? AND entry_id=?`,
  ).bind(companyId, id).all();
  const now = new Date().toISOString();
  const reversalId = crypto.randomUUID();
  const series = await c.env.DB.prepare(
    `SELECT id,prefix,next_number AS nextNumber,padding
     FROM voucher_series WHERE company_id=? ORDER BY prefix LIMIT 1`,
  ).bind(companyId).first<any>();
  if (!series) return c.json({ error: "No voucher series configured" }, 409);
  const voucherNumber = `${series.prefix}${String(series.nextNumber).padStart(series.padding, "0")}`;
  const statements: any[] = [
    c.env.DB.prepare(
      `UPDATE voucher_series SET next_number=next_number+1
       WHERE company_id=? AND id=? AND next_number=?`,
    ).bind(companyId, series.id, series.nextNumber),
    c.env.DB.prepare(
      `INSERT INTO journal_entries (
         company_id,id,voucher_number,series_id,entry_date,currency,reference,description,status,
         source_type,source_id,created_by,posted_by,posted_at,created_at,updated_at,reversed_entry_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'posted', 'reversal', ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(companyId, reversalId, voucherNumber, series.id, original.entryDate, original.currency,
      `REV-${original.reference ?? original.id}`,
      `Reversal: ${body.reason.trim()}`, id, access.userId, access.userId, now, now, now, id),
  ];
  for (const line of lines.results as any[]) {
    statements.push(c.env.DB.prepare(
      `INSERT INTO journal_lines (company_id,id,entry_id,account_id,description,debit_minor,credit_minor)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(companyId, crypto.randomUUID(), reversalId, line.accountId,
      line.description, line.creditMinor, line.debitMinor));
  }
  await c.env.DB.batch(statements);
  await appendAuditEvent(c.env.DB, {
    companyId, actorId: access.userId, ...auditRequestMetadata(c.req.raw.headers),
    action: "ledger.entry.reverse", resourceType: "journal_entry", resourceId: id,
    before: { status: "posted" }, after: { status: "voided", reversalEntryId: reversalId, reason: body.reason.trim() },
  });
  return c.json({ success: true, data: { originalEntryId: id, reversalEntryId: reversalId } });
});

export default ledgerController;
