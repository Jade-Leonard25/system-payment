import { Hono } from "hono";
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { z } from "zod";
import { checkCompanyPermission, requireUser } from "./admin-access";
import { appendAuditEvent, auditRequestMetadata } from "../services/audit";

type Bindings = { DB: D1Database };
type Access = { userId: string };
type SalesEnv = { Bindings: Bindings };
type InvoiceLineInput = { description: string; quantityMilli: number; unitPriceMinor: number };

const salesController = new Hono<SalesEnv>();
const defaultVisibility = {
  logo: true,
  customerEmail: true,
  reference: true,
  discount: true,
  tax: true,
  paymentNotes: true,
  preparedBy: false,
};
const defaultTemplate = {
  title: "INVOICE",
  accentColor: "#111827",
  layout: "clean" as const,
  logoSize: "medium" as const,
  logoAlignment: "left" as const,
  visibility: defaultVisibility,
  paymentInstructions: "",
  terms: "",
  preparedBy: "",
};
const issuerProfileSchema = z.object({
  name: z.string().trim().max(160).default(""),
  legalName: z.string().trim().max(160).nullable().default(null),
  address: z.string().trim().max(1000).nullable().default(null),
  email: z.string().trim().email().max(254).nullable().default(null),
  phone: z.string().trim().max(64).nullable().default(null),
  logo: z.string().max(600000).refine(
    (value) => value === ""
      || /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
      || /^https:\/\/[^\s]+$/i.test(value),
    "Logo must be a PNG, JPEG, or WebP data image or an HTTPS URL",
  ).default(""),
}).strict();
const templateSchema = z.object({
  title: z.string().trim().min(1).max(40).default("INVOICE"),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#111827"),
  layout: z.enum(["clean", "compact"]).default("clean"),
  logoSize: z.enum(["small", "medium", "large"]).default("medium"),
  logoAlignment: z.enum(["left", "right"]).default("left"),
  visibility: z.object({
    logo: z.boolean().default(true),
    customerEmail: z.boolean().default(true),
    reference: z.boolean().default(true),
    discount: z.boolean().default(true),
    tax: z.boolean().default(true),
    paymentNotes: z.boolean().default(true),
    preparedBy: z.boolean().default(false),
  }).strict().default(() => defaultVisibility),
  paymentInstructions: z.string().trim().max(1000).default(""),
  terms: z.string().trim().max(1000).default(""),
  preparedBy: z.string().trim().max(160).default(""),
}).strict().default(() => defaultTemplate);

const customerSchema = z.object({
  companyId: z.string().trim().min(1),
  name: z.string().trim().min(1).max(160),
  email: z.string().trim().email().max(254).nullable().optional(),
  phone: z.string().trim().max(64).nullable().optional(),
  billingAddress: z.string().trim().max(1000).nullable().optional(),
}).strict();

const invoiceSchema = z.object({
  companyId: z.string().trim().min(1),
  customerId: z.string().trim().min(1),
  invoiceNumber: z.string().trim().max(64).nullable().optional(),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  currency: z.string().trim().length(3).default("PHP"),
  reference: z.string().trim().max(128).nullable().optional(),
  description: z.string().trim().max(500).nullable().optional(),
  issuerProfile: issuerProfileSchema.default(() => ({
    name: "", legalName: null, address: null, email: null, phone: null, logo: "",
  })),
  template: templateSchema,
  discountType: z.enum(["fixed", "percent"]).nullable().default(null),
  discountValue: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0),
  taxInclusive: z.boolean().default(false),
  taxRateBps: z.number().int().min(0).max(10000).default(0),
  lines: z.array(z.object({
    description: z.string().trim().min(1).max(255),
    quantityMilli: z.number().int().min(1).max(100000000),
    unitPriceMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  }).strict()).min(1).max(100),
}).strict();
const invoiceBatchSchema = invoiceSchema.omit({ customerId: true }).extend({
  customerIds: z.array(z.string().trim().min(1)).max(100).default([]),
  applyToAllActive: z.boolean().default(false),
  issue: z.boolean().default(false),
}).strict();
const invoiceTemplateUpdateSchema = z.object({
  companyId: z.string().trim().min(1),
  issuerProfile: issuerProfileSchema,
  template: templateSchema,
}).strict();

const paymentSchema = z.object({
  companyId: z.string().trim().min(1),
  customerId: z.string().trim().min(1),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  currency: z.string().trim().length(3).default("PHP"),
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  reference: z.string().trim().max(128).nullable().optional(),
  allocations: z.array(z.object({
    invoiceId: z.string().trim().min(1),
    amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  }).strict()).max(100).default([]),
  creditOnAccount: z.boolean().default(false),
}).strict();

const creditNoteSchema = z.object({
  companyId: z.string().trim().min(1),
  creditDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  creditNumber: z.string().trim().min(1).max(64).optional(),
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  reason: z.string().trim().min(1).max(500),
}).strict();

const validDate = (value: string) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

function roundedProduct(quantityMilli: number, unitPriceMinor: number) {
  return (BigInt(quantityMilli) * BigInt(unitPriceMinor) + 500n) / 1000n;
}

function invoiceAmounts(
  lines: InvoiceLineInput[],
  taxRateBps: number,
  discountType: "fixed" | "percent" | null = null,
  discountValue = 0,
  taxInclusive = false,
) {
  const grossSubtotal = lines.reduce((sum, line) => sum + roundedProduct(line.quantityMilli, line.unitPriceMinor), 0n);
  const discount = discountType === "percent"
    ? (grossSubtotal * BigInt(discountValue) + 5000n) / 10000n
    : discountType === "fixed" ? BigInt(discountValue) : 0n;
  if (discount > grossSubtotal) return null;
  const discountedGross = grossSubtotal - discount;
  const subtotal = taxInclusive
    ? (discountedGross * 10000n + BigInt(10000 + taxRateBps) / 2n) / BigInt(10000 + taxRateBps)
    : discountedGross;
  const tax = (subtotal * BigInt(taxRateBps) + 5000n) / 10000n;
  if (taxInclusive && subtotal + tax !== discountedGross) return null;
  const total = subtotal + tax;
  if ([grossSubtotal, discount, subtotal, tax, total].some((value) => value > BigInt(Number.MAX_SAFE_INTEGER))) {
    return null;
  }
  return {
    grossSubtotal: Number(grossSubtotal),
    discount: Number(discount),
    subtotal: Number(subtotal),
    tax: Number(tax),
    total: Number(total),
  };
}

function safeIssuerProfileForAudit(profile: z.infer<typeof issuerProfileSchema>) {
  return { ...profile, logo: profile.logo ? "[logo omitted]" : "" };
}

async function getInvoiceSeries(database: D1Database, companyId: string) {
  return database.prepare(
    `SELECT id, prefix, next_number AS nextNumber, padding
     FROM sales_invoice_series WHERE company_id = ? ORDER BY prefix LIMIT 1`,
  ).bind(companyId).first<{ id: string; prefix: string; nextNumber: number; padding: number }>();
}

function formatInvoiceNumber(series: { prefix: string; padding: number }, number: number) {
  return `${series.prefix}${String(number).padStart(series.padding, "0")}`;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

async function payloadHash(value: unknown) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stableJson(value)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function permission(c: Parameters<typeof requireUser>[0], companyId: string, key: string) {
  if (!companyId) return { response: c.json({ error: "Company ID is required" }, 400) };
  const access = await requireUser(c);
  if ("response" in access) return access;
  const grant = await checkCompanyPermission(c.env.DB, access.userId, companyId, key);
  if (!grant.member) return { response: c.json({ error: "Company not found" }, 404) };
  if (!grant.allowed) return { response: c.json({ error: "Permission denied" }, 403) };
  return { userId: access.userId } satisfies Access;
}

async function activeAccountIds(database: D1Database, companyId: string, codes: string[]) {
  const placeholders = codes.map(() => "?").join(",");
  const accounts = await database.prepare(
    `SELECT code, id FROM accounts
     WHERE company_id = ? AND is_active = 1 AND is_postable = 1 AND code IN (${placeholders})`,
  ).bind(companyId, ...codes).all<{ code: string; id: string }>();
  return new Map(accounts.results.map((account) => [account.code, account.id]));
}

async function periodClosed(database: D1Database, companyId: string, date: string) {
  return database.prepare(
    `SELECT 1 AS found FROM accounting_periods
     WHERE company_id = ? AND period_start <= ? AND period_end >= ? AND status = 'closed'
     LIMIT 1`,
  ).bind(companyId, date, date).first();
}

function addPostedEntryStatements(
  database: D1Database,
  args: {
    companyId: string;
    entryId: string;
    date: string;
    currency: string;
    reference: string;
    description: string;
    sourceType: string;
    sourceId: string;
    actorId: string;
    lines: { accountId: string; description: string; debitMinor: number; creditMinor: number }[];
    now: string;
  },
) {
  return database.prepare(
    `INSERT INTO journal_entries (
       company_id, id, entry_date, currency, reference, description, status,
       source_type, source_id, created_by, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)`,
  ).bind(
    args.companyId, args.entryId, args.date, args.currency, args.reference,
    args.description, args.sourceType, args.sourceId, args.actorId, args.now, args.now,
  );
}

function addEntryLines(
  database: D1Database,
  companyId: string,
  entryId: string,
  lines: { accountId: string; description: string; debitMinor: number; creditMinor: number }[],
) {
  return lines.map((line) => database.prepare(
    `INSERT INTO journal_lines
       (company_id, id, entry_id, account_id, description, debit_minor, credit_minor)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(companyId, crypto.randomUUID(), entryId, line.accountId, line.description, line.debitMinor, line.creditMinor));
}

function addPostUpdate(
  database: D1Database,
  companyId: string,
  entryId: string,
  actorId: string,
  voucher: { id: string; prefix: string; nextNumber: number; padding: number },
  now: string,
) {
  const voucherNumber = `${voucher.prefix}${String(voucher.nextNumber).padStart(voucher.padding, "0")}`;
  return {
    voucherNumber,
    statements: [
      database.prepare(
        `UPDATE voucher_series SET next_number = next_number + 1
         WHERE company_id = ? AND id = ? AND next_number = ?`,
      ).bind(companyId, voucher.id, voucher.nextNumber),
      database.prepare(
        `UPDATE journal_entries
         SET status = 'posted', voucher_number = ?, series_id = ?, posted_by = ?, posted_at = ?, updated_at = ?
         WHERE company_id = ? AND id = ? AND status = 'draft'`,
      ).bind(voucherNumber, voucher.id, actorId, now, now, companyId, entryId),
    ],
  };
}

async function getVoucherSeries(database: D1Database, companyId: string) {
  return database.prepare(
    `SELECT id, prefix, next_number AS nextNumber, padding
     FROM voucher_series WHERE company_id = ? ORDER BY prefix LIMIT 1`,
  ).bind(companyId).first<{ id: string; prefix: string; nextNumber: number; padding: number }>();
}

async function postPermissionError(database: D1Database, companyId: string, date: string) {
  if (await periodClosed(database, companyId, date)) return "Cannot post into a closed accounting period";
  return null;
}

function toComputedInvoice(row: Record<string, unknown>, today: string) {
  const total = Number(row.totalMinor);
  const applied = Number(row.appliedMinor ?? 0);
  const credits = Number(row.creditMinor ?? 0);
  const remaining = Math.max(0, total - applied - credits);
  let status = String(row.status);
  if (status === "issued") {
    status = applied >= total ? "paid"
      : applied > 0 ? "partially paid"
        : String(row.dueDate) < today ? "overdue" : "sent";
  }
  const { issuerProfileJson, invoiceTemplateJson, ...invoice } = row;
  const issuerProfile = typeof issuerProfileJson === "string"
    ? JSON.parse(issuerProfileJson)
    : {};
  const template = typeof invoiceTemplateJson === "string"
    ? JSON.parse(invoiceTemplateJson)
    : defaultTemplate;
  return { ...invoice, issuerProfile, template, status, appliedMinor: applied, creditMinor: credits, remainingMinor: remaining };
}

const invoiceSelect = `SELECT i.id, i.customer_id AS customerId, c.name AS customerName,
  c.email AS customerEmail, c.phone AS customerPhone, c.billing_address AS customerBillingAddress,
  i.invoice_number AS invoiceNumber, i.invoice_date AS invoiceDate, i.due_date AS dueDate,
  i.currency, i.reference, i.description, i.tax_rate_bps AS taxRateBps,
  i.discount_minor AS discountMinor, i.tax_inclusive AS taxInclusive,
  i.discount_type AS discountType, i.discount_value AS discountValue,
  i.batch_id AS batchId, i.invoice_template_json AS invoiceTemplateJson,
  i.subtotal_minor AS subtotalMinor, i.tax_minor AS taxMinor, i.total_minor AS totalMinor,
  i.issuer_profile_json AS issuerProfileJson,
  i.status, i.journal_entry_id AS journalEntryId, i.created_at AS createdAt,
  COALESCE((SELECT SUM(a.amount_minor) FROM sales_invoice_allocations a
    WHERE a.company_id = i.company_id AND a.invoice_id = i.id), 0) AS appliedMinor,
  COALESCE((SELECT SUM(n.amount_minor) FROM sales_credit_notes n
    WHERE n.company_id = i.company_id AND n.invoice_id = i.id), 0) AS creditMinor
  FROM sales_invoices i JOIN sales_customers c
    ON c.company_id = i.company_id AND c.id = i.customer_id`;

salesController.get("/access", async (c) => {
  const companyId = c.req.query("companyId") ?? "";
  if (!companyId) return c.json({ error: "Company ID is required" }, 400);
  const user = await requireUser(c);
  if ("response" in user) return user.response;
  const access = await checkCompanyPermission(c.env.DB, user.userId, companyId, "sales.view");
  if (!access.member) return c.json({ error: "Company not found" }, 404);
  const [createAccess, issueAccess, paymentAccess] = await Promise.all([
    checkCompanyPermission(c.env.DB, user.userId, companyId, "sales.create"),
    checkCompanyPermission(c.env.DB, user.userId, companyId, "sales.issue"),
    checkCompanyPermission(c.env.DB, user.userId, companyId, "sales.payment"),
  ]);
  return c.json({
    allowed: access.allowed,
    canCreate: createAccess.allowed,
    canIssue: issueAccess.allowed,
    canRecordPayment: paymentAccess.allowed,
  });
});

salesController.get("/invoice-template", async (c) => {
  const companyId = c.req.query("companyId") ?? "";
  const access = await permission(c, companyId, "sales.view");
  if ("response" in access) return access.response;
  const row = await c.env.DB.prepare(
    `SELECT issuer_profile_json AS issuerProfileJson, template_json AS templateJson
     FROM sales_invoice_templates WHERE company_id=?`,
  ).bind(companyId).first<{ issuerProfileJson: string; templateJson: string }>();
  if (!row) return c.json({ error: "Invoice template is not configured for this company" }, 404);
  return c.json({ data: { issuerProfile: JSON.parse(row.issuerProfileJson), template: JSON.parse(row.templateJson) } });
});

salesController.put("/invoice-template", async (c) => {
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: "Request body must be valid JSON" }, 400); }
  const parsed = invoiceTemplateUpdateSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "Invalid invoice template", details: parsed.error.flatten() }, 400);
  const data = parsed.data;
  const access = await permission(c, data.companyId, "sales.create");
  if ("response" in access) return access.response;
  const current = await c.env.DB.prepare(
    `SELECT issuer_profile_json AS issuerProfileJson, template_json AS templateJson
     FROM sales_invoice_templates WHERE company_id=?`,
  ).bind(data.companyId).first<{ issuerProfileJson: string; templateJson: string }>();
  if (!current) return c.json({ error: "Invoice template is not configured for this company" }, 404);
  const now = new Date().toISOString();
  await appendAuditEvent(c.env.DB, {
    companyId: data.companyId, actorId: access.userId, ...auditRequestMetadata(c.req.raw.headers),
    action: "sales.invoice_template.update", resourceType: "sales_invoice_template", resourceId: data.companyId,
    before: {
      issuerProfile: safeIssuerProfileForAudit(JSON.parse(current.issuerProfileJson)),
      template: JSON.parse(current.templateJson),
    },
    after: { issuerProfile: safeIssuerProfileForAudit(data.issuerProfile), template: data.template },
  }, [{
    companyId: data.companyId,
    statement: c.env.DB.prepare(
      `UPDATE sales_invoice_templates SET issuer_profile_json=?, template_json=?, updated_by=?, updated_at=?
       WHERE company_id=?`,
    ).bind(JSON.stringify(data.issuerProfile), JSON.stringify(data.template), access.userId, now, data.companyId),
    expectedChanges: 1,
  }]);
  return c.json({ success: true, data: { issuerProfile: data.issuerProfile, template: data.template } });
});

salesController.get("/customers", async (c) => {
  const companyId = c.req.query("companyId") ?? "";
  const access = await permission(c, companyId, "sales.view");
  if ("response" in access) return access.response;
  const rows = await c.env.DB.prepare(
    `SELECT id, name, email, phone, billing_address AS billingAddress,
            is_active AS isActive, created_at AS createdAt
     FROM sales_customers WHERE company_id = ? ORDER BY name`,
  ).bind(companyId).all();
  return c.json({ data: rows.results });
});

salesController.post("/customers", async (c) => {
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: "Request body must be valid JSON" }, 400); }
  const parsed = customerSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "Invalid customer", details: parsed.error.flatten() }, 400);
  const access = await permission(c, parsed.data.companyId, "sales.create");
  if ("response" in access) return access.response;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const data = parsed.data;
  await appendAuditEvent(c.env.DB, {
    companyId: data.companyId, actorId: access.userId, ...auditRequestMetadata(c.req.raw.headers),
    action: "sales.customer.create", resourceType: "sales_customer", resourceId: id,
    after: data,
  }, [{
    companyId: data.companyId,
    statement: c.env.DB.prepare(
      `INSERT INTO sales_customers
         (company_id, id, name, email, phone, billing_address, is_active, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      ).bind(data.companyId, id, data.name, data.email ?? null, data.phone ?? null, data.billingAddress ?? null, access.userId, now, now),
    expectedChanges: 1,
  }]);
  return c.json({ success: true, data: { id, ...data, isActive: true } }, 201);
});

salesController.get("/invoices", async (c) => {
  const companyId = c.req.query("companyId") ?? "";
  const access = await permission(c, companyId, "sales.view");
  if ("response" in access) return access.response;
  const rows = await c.env.DB.prepare(
    `${invoiceSelect} WHERE i.company_id = ? ORDER BY i.invoice_date DESC, i.created_at DESC LIMIT 500`,
  ).bind(companyId).all<Record<string, unknown>>();
  const today = new Date().toISOString().slice(0, 10);
  let invoices = rows.results.map((row) => toComputedInvoice(row, today));
  const filter = c.req.query("status");
  if (filter && filter !== "all") invoices = invoices.filter((invoice) => invoice.status === filter);
  return c.json({ data: invoices });
});

salesController.get("/invoices/:id", async (c) => {
  const companyId = c.req.query("companyId") ?? "";
  const access = await permission(c, companyId, "sales.view");
  if ("response" in access) return access.response;
  const id = c.req.param("id");
  const invoice = await c.env.DB.prepare(
    `${invoiceSelect} WHERE i.company_id = ? AND i.id = ? LIMIT 1`,
  ).bind(companyId, id).first<Record<string, unknown>>();
  if (!invoice) return c.json({ error: "Invoice not found" }, 404);
  const [lines, notes] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, description, quantity_milli AS quantityMilli,
              unit_price_minor AS unitPriceMinor, amount_minor AS amountMinor
       FROM sales_invoice_lines WHERE company_id = ? AND invoice_id = ? ORDER BY id`,
    ).bind(companyId, id).all(),
    c.env.DB.prepare(
      `SELECT id, credit_number AS creditNumber, credit_date AS creditDate,
              amount_minor AS amountMinor, reason, journal_entry_id AS journalEntryId
       FROM sales_credit_notes WHERE company_id = ? AND invoice_id = ? ORDER BY credit_date`,
    ).bind(companyId, id).all(),
  ]);
  return c.json({
    data: {
      invoice: toComputedInvoice(invoice, new Date().toISOString().slice(0, 10)),
      lines: lines.results,
      creditNotes: notes.results,
    },
  });
});

salesController.post("/invoices", async (c) => {
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: "Request body must be valid JSON" }, 400); }
  const parsed = invoiceSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "Invalid invoice", details: parsed.error.flatten() }, 400);
  const data = parsed.data;
  const access = await permission(c, data.companyId, "sales.create");
  if ("response" in access) return access.response;
  if (!validDate(data.invoiceDate) || !validDate(data.dueDate) || data.dueDate < data.invoiceDate) {
    return c.json({ error: "Enter valid invoice and due dates; due date cannot be before invoice date" }, 400);
  }
  const customer = await c.env.DB.prepare(
    `SELECT id FROM sales_customers WHERE company_id = ? AND id = ? AND is_active = 1`,
  ).bind(data.companyId, data.customerId).first();
  if (!customer) return c.json({ error: "Customer not found or inactive" }, 404);
  const lines: InvoiceLineInput[] = data.lines;
  if (data.discountType === "percent" && data.discountValue > 10000) return c.json({ error: "Percentage discount cannot exceed 100%" }, 400);
  const amounts = invoiceAmounts(lines, data.taxRateBps, data.discountType, data.discountValue, data.taxInclusive);
  if (!amounts || amounts.subtotal <= 0) return c.json({ error: "Invoice amounts exceed supported limits, discount, or total zero" }, 400);
  const id = crypto.randomUUID();
  const series = data.invoiceNumber?.trim() ? null : await getInvoiceSeries(c.env.DB, data.companyId);
  if (!data.invoiceNumber?.trim() && !series) return c.json({ error: "No sales invoice number series is configured" }, 409);
  const invoiceNumber = data.invoiceNumber?.trim() || (series ? formatInvoiceNumber(series, series.nextNumber) : "");
  const duplicateNumber = await c.env.DB.prepare(
    `SELECT 1 AS found FROM sales_invoices WHERE company_id=? AND invoice_number=? LIMIT 1`,
  ).bind(data.companyId, invoiceNumber).first();
  if (duplicateNumber) return c.json({ error: "Invoice number already exists in this company" }, 409);
  const now = new Date().toISOString();
  const statements: { companyId: string; statement: D1PreparedStatement; expectedChanges: number }[] = [];
  if (series) statements.push({
    companyId: data.companyId,
    statement: c.env.DB.prepare(
      `UPDATE sales_invoice_series SET next_number=next_number+1
       WHERE company_id=? AND id=? AND next_number=?`,
    ).bind(data.companyId, series.id, series.nextNumber),
    expectedChanges: 1,
  });
  statements.push({
    companyId: data.companyId,
    statement: c.env.DB.prepare(
      `INSERT INTO sales_invoices (
        company_id, id, customer_id, invoice_number, invoice_date, due_date, currency,
        reference, description, issuer_profile_json, invoice_template_json, discount_minor,
        tax_inclusive, discount_type, discount_value, tax_rate_bps, subtotal_minor, tax_minor, total_minor, batch_id,
        status, journal_entry_id, created_by, issued_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'draft', NULL, ?, NULL, ?, ?)`,
    ).bind(data.companyId, id, data.customerId, invoiceNumber, data.invoiceDate, data.dueDate, data.currency.toUpperCase(),
      data.reference ?? null, data.description ?? null, JSON.stringify(data.issuerProfile), JSON.stringify(data.template),
      amounts.discount, data.taxInclusive ? 1 : 0, data.discountType, data.discountValue, data.taxRateBps,
      amounts.subtotal, amounts.tax, amounts.total,
      access.userId, now, now),
    expectedChanges: 1,
  });
  const lineRows = lines.map((line) => ({
    ...line,
    amountMinor: Number(roundedProduct(line.quantityMilli, line.unitPriceMinor)),
  }));
  for (const line of lineRows) {
    statements.push({
      companyId: data.companyId,
      statement: c.env.DB.prepare(
        `INSERT INTO sales_invoice_lines
         (company_id, id, invoice_id, description, quantity_milli, unit_price_minor, amount_minor)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(data.companyId, crypto.randomUUID(), id, line.description, line.quantityMilli, line.unitPriceMinor, line.amountMinor),
      expectedChanges: 1,
    });
  }
  await appendAuditEvent(c.env.DB, {
    companyId: data.companyId, actorId: access.userId, ...auditRequestMetadata(c.req.raw.headers),
    action: "sales.invoice.create", resourceType: "sales_invoice", resourceId: id,
    after: { id, invoiceNumber, customerId: data.customerId, issuerProfile: safeIssuerProfileForAudit(data.issuerProfile), template: data.template, ...amounts, currency: data.currency.toUpperCase() },
  }, statements);
  return c.json({ success: true, data: { id, invoiceNumber, status: "draft", ...amounts } }, 201);
});

salesController.post("/invoices/batch", async (c) => {
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: "Request body must be valid JSON" }, 400); }
  const parsed = invoiceBatchSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "Invalid invoice batch", details: parsed.error.flatten() }, 400);
  const data = parsed.data;
  const access = await permission(c, data.companyId, "sales.create");
  if ("response" in access) return access.response;
  if (data.issue) {
    const issueGrant = await checkCompanyPermission(c.env.DB, access.userId, data.companyId, "sales.issue");
    if (!issueGrant.allowed) return c.json({ error: "Permission denied to issue invoices" }, 403);
  }
  const idempotencyKey = c.req.header("Idempotency-Key")?.trim() ?? "";
  if (idempotencyKey.length < 8 || idempotencyKey.length > 128) {
    return c.json({ error: "A valid Idempotency-Key header is required for batch invoice creation" }, 400);
  }
  const hash = await payloadHash(data);
  const previous = await c.env.DB.prepare(
    `SELECT payload_hash AS payloadHash, response_json AS responseJson
     FROM sales_idempotency WHERE company_id=? AND idempotency_key=? LIMIT 1`,
  ).bind(data.companyId, idempotencyKey).first<{ payloadHash: string; responseJson: string }>();
  if (previous) {
    if (previous.payloadHash !== hash) return c.json({ error: "Idempotency key was already used with a different payload" }, 409);
    return c.json(JSON.parse(previous.responseJson));
  }
  if (!validDate(data.invoiceDate) || !validDate(data.dueDate) || data.dueDate < data.invoiceDate) {
    return c.json({ error: "Enter valid invoice and due dates; due date cannot be before invoice date" }, 400);
  }
  if (data.lines.length > 20) return c.json({ error: "Batch invoices are limited to 20 shared line items" }, 400);
  if (!data.applyToAllActive && (data.customerIds.length === 0 || data.customerIds.length > 20)) {
    return c.json({ error: "Select between 1 and 20 customers, or choose all active customers" }, 400);
  }
  if (data.discountType === "percent" && data.discountValue > 10000) {
    return c.json({ error: "Percentage discount cannot exceed 100%" }, 400);
  }
  const amounts = invoiceAmounts(data.lines, data.taxRateBps, data.discountType, data.discountValue, data.taxInclusive);
  if (!amounts || amounts.subtotal <= 0) {
    return c.json({ error: "Invoice amounts exceed supported limits, discount, or total zero" }, 400);
  }
  const customerRows = data.applyToAllActive
    ? await c.env.DB.prepare(
      `SELECT id, name FROM sales_customers WHERE company_id=? AND is_active=1 ORDER BY name LIMIT 21`,
    ).bind(data.companyId).all<{ id: string; name: string }>()
    : await c.env.DB.prepare(
      `SELECT id, name FROM sales_customers
       WHERE company_id=? AND is_active=1 AND id IN (${data.customerIds.map(() => "?").join(",")})
       ORDER BY name`,
    ).bind(data.companyId, ...data.customerIds).all<{ id: string; name: string }>();
  const customers = customerRows.results;
  if (customers.length === 0) return c.json({ error: "No active customers match this batch" }, 400);
  if (customers.length > 20) return c.json({ error: "A batch can include at most 20 active customers" }, 400);
  if (!data.applyToAllActive && new Set(data.customerIds).size !== data.customerIds.length) {
    return c.json({ error: "Customer selection contains duplicates" }, 400);
  }
  if (!data.applyToAllActive && customers.length !== data.customerIds.length) {
    return c.json({ error: "One or more selected customers are inactive or outside this company" }, 404);
  }
  const invoiceSeries = await getInvoiceSeries(c.env.DB, data.companyId);
  if (!invoiceSeries) return c.json({ error: "No sales invoice number series is configured" }, 409);
  let voucherSeries: Awaited<ReturnType<typeof getVoucherSeries>> = null;
  let accounts = new Map<string, string>();
  if (data.issue) {
    const periodError = await postPermissionError(c.env.DB, data.companyId, data.invoiceDate);
    if (periodError) return c.json({ error: periodError }, 409);
    accounts = await activeAccountIds(c.env.DB, data.companyId, ["1100", "4000", "2200"]);
    if (!accounts.has("1100") || !accounts.has("4000") || (amounts.tax > 0 && !accounts.has("2200"))) {
      return c.json({ error: "Configure active postable Accounts Receivable (1100), Service Revenue (4000), and Output Tax (2200) accounts first" }, 409);
    }
    voucherSeries = await getVoucherSeries(c.env.DB, data.companyId);
    if (!voucherSeries) return c.json({ error: "No journal voucher series is configured" }, 409);
  }
  if (invoiceSeries.nextNumber + customers.length - 1 > Number.MAX_SAFE_INTEGER) {
    return c.json({ error: "Invoice number series is exhausted" }, 409);
  }
  if (voucherSeries && voucherSeries.nextNumber + customers.length - 1 > Number.MAX_SAFE_INTEGER) {
    return c.json({ error: "Journal voucher series is exhausted" }, 409);
  }

  const batchId = crypto.randomUUID();
  const now = new Date().toISOString();
  const arId = accounts.get("1100");
  const revenueId = accounts.get("4000");
  const taxId = accounts.get("2200");
  const invoiceResults: {
    id: string;
    customerId: string;
    customerName: string;
    invoiceNumber: string;
    status: string;
    totalMinor: number;
    journalEntryId?: string;
    voucherNumber?: string;
  }[] = [];
  const mutations: { companyId: string; statement: D1PreparedStatement; expectedChanges: number }[] = [
    {
      companyId: data.companyId,
      statement: c.env.DB.prepare(
        `UPDATE sales_invoice_series SET next_number=next_number+?
         WHERE company_id=? AND id=? AND next_number=?`,
      ).bind(customers.length, data.companyId, invoiceSeries.id, invoiceSeries.nextNumber),
      expectedChanges: 1,
    },
  ];
  if (voucherSeries) mutations.push({
    companyId: data.companyId,
    statement: c.env.DB.prepare(
      `UPDATE voucher_series SET next_number=next_number+?
       WHERE company_id=? AND id=? AND next_number=?`,
    ).bind(customers.length, data.companyId, voucherSeries.id, voucherSeries.nextNumber),
    expectedChanges: 1,
  });

  for (const [index, customer] of customers.entries()) {
    const invoiceId = crypto.randomUUID();
    const invoiceNumber = formatInvoiceNumber(invoiceSeries, invoiceSeries.nextNumber + index);
    const journalEntryId = data.issue ? crypto.randomUUID() : undefined;
    const voucherNumber = voucherSeries
      ? `${voucherSeries.prefix}${String(voucherSeries.nextNumber + index).padStart(voucherSeries.padding, "0")}`
      : undefined;
    mutations.push({
      companyId: data.companyId,
      statement: c.env.DB.prepare(
        `INSERT INTO sales_invoices (
          company_id,id,customer_id,invoice_number,invoice_date,due_date,currency,reference,description,
          issuer_profile_json,invoice_template_json,discount_minor,tax_inclusive,discount_type,discount_value,
          tax_rate_bps,subtotal_minor,tax_minor,total_minor,batch_id,status,journal_entry_id,created_by,
          issued_at,created_at,updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'draft',NULL,?,NULL,?,?)`,
      ).bind(
        data.companyId, invoiceId, customer.id, invoiceNumber, data.invoiceDate, data.dueDate,
        data.currency.toUpperCase(), data.reference ?? null, data.description ?? null,
        JSON.stringify(data.issuerProfile), JSON.stringify(data.template), amounts.discount,
        data.taxInclusive ? 1 : 0, data.discountType, data.discountValue, data.taxRateBps,
        amounts.subtotal, amounts.tax, amounts.total, batchId, access.userId, now, now,
      ),
      expectedChanges: 1,
    });
    for (const line of data.lines) {
      mutations.push({
        companyId: data.companyId,
        statement: c.env.DB.prepare(
          `INSERT INTO sales_invoice_lines
           (company_id,id,invoice_id,description,quantity_milli,unit_price_minor,amount_minor)
           VALUES (?,?,?,?,?,?,?)`,
        ).bind(
          data.companyId, crypto.randomUUID(), invoiceId, line.description,
          line.quantityMilli, line.unitPriceMinor,
          Number(roundedProduct(line.quantityMilli, line.unitPriceMinor)),
        ),
        expectedChanges: 1,
      });
    }
    if (journalEntryId && voucherNumber && voucherSeries && arId && revenueId) {
      const journalLines = [
        { accountId: arId, description: `Invoice ${invoiceNumber}`, debitMinor: amounts.total, creditMinor: 0 },
        { accountId: revenueId, description: `Invoice ${invoiceNumber} revenue`, debitMinor: 0, creditMinor: amounts.subtotal },
        ...(amounts.tax > 0 && taxId
          ? [{ accountId: taxId, description: `Invoice ${invoiceNumber} tax`, debitMinor: 0, creditMinor: amounts.tax }]
          : []),
      ];
      mutations.push({
        companyId: data.companyId,
        statement: addPostedEntryStatements(c.env.DB, {
          companyId: data.companyId, entryId: journalEntryId, date: data.invoiceDate,
          currency: data.currency.toUpperCase(), reference: invoiceNumber,
          description: `Sales invoice ${invoiceNumber}`, sourceType: "sales_invoice",
          sourceId: invoiceId, actorId: access.userId, lines: journalLines, now,
        }),
        expectedChanges: 1,
      });
      for (const statement of addEntryLines(c.env.DB, data.companyId, journalEntryId, journalLines)) {
        mutations.push({ companyId: data.companyId, statement, expectedChanges: 1 });
      }
      mutations.push({
        companyId: data.companyId,
        statement: c.env.DB.prepare(
          `UPDATE journal_entries
           SET status='posted',voucher_number=?,series_id=?,posted_by=?,posted_at=?,updated_at=?
           WHERE company_id=? AND id=? AND status='draft'`,
        ).bind(voucherNumber, voucherSeries.id, access.userId, now, now, data.companyId, journalEntryId),
        expectedChanges: 1,
      });
      mutations.push({
        companyId: data.companyId,
        statement: c.env.DB.prepare(
          `UPDATE sales_invoices SET status='issued',journal_entry_id=?,issued_at=?,updated_at=?
           WHERE company_id=? AND id=? AND status='draft'`,
        ).bind(journalEntryId, now, now, data.companyId, invoiceId),
        expectedChanges: 1,
      });
    }
    invoiceResults.push({
      id: invoiceId,
      customerId: customer.id,
      customerName: customer.name,
      invoiceNumber,
      status: data.issue ? "sent" : "draft",
      totalMinor: amounts.total,
      ...(journalEntryId ? { journalEntryId } : {}),
      ...(voucherNumber ? { voucherNumber } : {}),
    });
  }

  const responseBody = { success: true, data: { batchId, invoices: invoiceResults } };
  mutations.push({
    companyId: data.companyId,
    statement: c.env.DB.prepare(
      `INSERT INTO sales_idempotency (company_id,idempotency_key,payload_hash,response_json,created_at)
       VALUES (?,?,?,?,?)`,
    ).bind(data.companyId, idempotencyKey, hash, JSON.stringify(responseBody), now),
    expectedChanges: 1,
  });
  try {
    await appendAuditEvent(c.env.DB, {
      companyId: data.companyId, actorId: access.userId, ...auditRequestMetadata(c.req.raw.headers),
      action: "sales.invoice.batch_create", resourceType: "sales_invoice_batch", resourceId: batchId,
      after: {
        batchId,
        issue: data.issue,
        invoices: invoiceResults.map(({ id, customerId, invoiceNumber, status, totalMinor, voucherNumber: voucher }) => ({
          id, customerId, invoiceNumber, status, totalMinor, voucherNumber: voucher,
        })),
        issuerProfile: safeIssuerProfileForAudit(data.issuerProfile),
        template: data.template,
      },
    }, mutations);
  } catch (error) {
    const retry = await c.env.DB.prepare(
      `SELECT payload_hash AS payloadHash, response_json AS responseJson
       FROM sales_idempotency WHERE company_id=? AND idempotency_key=? LIMIT 1`,
    ).bind(data.companyId, idempotencyKey).first<{ payloadHash: string; responseJson: string }>();
    if (retry) {
      if (retry.payloadHash !== hash) return c.json({ error: "Idempotency key was already used with a different payload" }, 409);
      return c.json(JSON.parse(retry.responseJson));
    }
    if (error instanceof Error && error.message.includes("mutation_result")) {
      return c.json({ error: "Invoice or voucher series changed concurrently; retry this batch with a new idempotency key" }, 409);
    }
    throw error;
  }
  return c.json(responseBody, 201);
});

salesController.put("/invoices/:id", async (c) => {
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: "Request body must be valid JSON" }, 400); }
  const parsed = invoiceSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "Invalid invoice", details: parsed.error.flatten() }, 400);
  const data = parsed.data;
  const access = await permission(c, data.companyId, "sales.create");
  if ("response" in access) return access.response;
  if (!validDate(data.invoiceDate) || !validDate(data.dueDate) || data.dueDate < data.invoiceDate) {
    return c.json({ error: "Enter valid invoice and due dates; due date cannot be before invoice date" }, 400);
  }
  const id = c.req.param("id");
  const current = await c.env.DB.prepare(
    `SELECT status, invoice_number AS invoiceNumber FROM sales_invoices WHERE company_id = ? AND id = ? LIMIT 1`,
  ).bind(data.companyId, id).first<{ status: string; invoiceNumber: string }>();
  if (!current) return c.json({ error: "Invoice not found" }, 404);
  if (current.status !== "draft") return c.json({ error: "Only draft invoices can be edited" }, 409);
  const customer = await c.env.DB.prepare(
    `SELECT id FROM sales_customers WHERE company_id = ? AND id = ? AND is_active = 1`,
  ).bind(data.companyId, data.customerId).first();
  if (!customer) return c.json({ error: "Customer not found or inactive" }, 404);
  if (data.discountType === "percent" && data.discountValue > 10000) return c.json({ error: "Percentage discount cannot exceed 100%" }, 400);
  const amounts = invoiceAmounts(data.lines, data.taxRateBps, data.discountType, data.discountValue, data.taxInclusive);
  if (!amounts || amounts.subtotal <= 0) return c.json({ error: "Invoice amounts exceed supported limits, discount, or total zero" }, 400);
  const lines = await c.env.DB.prepare(
    `SELECT id FROM sales_invoice_lines WHERE company_id = ? AND invoice_id = ?`,
  ).bind(data.companyId, id).all<{ id: string }>();
  if (lines.results.length === 0) return c.json({ error: "Draft invoice lines are missing and cannot be safely replaced" }, 409);
  const invoiceNumber = data.invoiceNumber?.trim() || current.invoiceNumber;
  const duplicateNumber = await c.env.DB.prepare(
    `SELECT 1 AS found FROM sales_invoices WHERE company_id=? AND invoice_number=? AND id!=? LIMIT 1`,
  ).bind(data.companyId, invoiceNumber, id).first();
  if (duplicateNumber) return c.json({ error: "Invoice number already exists in this company" }, 409);
  const now = new Date().toISOString();
  const mutations: { companyId: string; statement: D1PreparedStatement; expectedChanges: number }[] = [
    {
      companyId: data.companyId,
      statement: c.env.DB.prepare(
        `UPDATE sales_invoices SET customer_id=?, invoice_number=?, invoice_date=?, due_date=?,
           currency=?, reference=?, description=?, issuer_profile_json=?, invoice_template_json=?,
           discount_minor=?, tax_inclusive=?, discount_type=?, discount_value=?, tax_rate_bps=?, subtotal_minor=?, tax_minor=?,
           total_minor=?, updated_at=? WHERE company_id=? AND id=? AND status='draft'`,
      ).bind(data.customerId, invoiceNumber, data.invoiceDate, data.dueDate, data.currency.toUpperCase(),
        data.reference ?? null, data.description ?? null, JSON.stringify(data.issuerProfile), JSON.stringify(data.template),
        amounts.discount, data.taxInclusive ? 1 : 0, data.discountType, data.discountValue, data.taxRateBps,
        amounts.subtotal, amounts.tax, amounts.total, now, data.companyId, id),
      expectedChanges: 1,
    },
    {
      companyId: data.companyId,
      statement: c.env.DB.prepare(`DELETE FROM sales_invoice_lines WHERE company_id=? AND invoice_id=?`).bind(data.companyId, id),
      expectedChanges: lines.results.length,
    },
  ];
  for (const line of data.lines) {
    mutations.push({
      companyId: data.companyId,
      statement: c.env.DB.prepare(
        `INSERT INTO sales_invoice_lines
         (company_id, id, invoice_id, description, quantity_milli, unit_price_minor, amount_minor)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(data.companyId, crypto.randomUUID(), id, line.description, line.quantityMilli, line.unitPriceMinor,
        Number(roundedProduct(line.quantityMilli, line.unitPriceMinor))),
      expectedChanges: 1,
    });
  }
  await appendAuditEvent(c.env.DB, {
    companyId: data.companyId, actorId: access.userId, ...auditRequestMetadata(c.req.raw.headers),
    action: "sales.invoice.update", resourceType: "sales_invoice", resourceId: id,
    before: { status: current.status, invoiceNumber: current.invoiceNumber },
    after: { status: "draft", invoiceNumber, issuerProfile: safeIssuerProfileForAudit(data.issuerProfile), template: data.template, ...amounts },
  }, mutations);
  return c.json({ success: true });
});

salesController.post("/invoices/:id/issue", async (c) => {
  let body: { companyId?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: "Request body must be valid JSON" }, 400); }
  const companyId = body.companyId ?? "";
  const access = await permission(c, companyId, "sales.issue");
  if ("response" in access) return access.response;
  const id = c.req.param("id");
  const invoice = await c.env.DB.prepare(
    `SELECT invoice_number AS invoiceNumber, invoice_date AS invoiceDate, currency,
      subtotal_minor AS subtotalMinor, tax_minor AS taxMinor, total_minor AS totalMinor, status
     FROM sales_invoices WHERE company_id = ? AND id = ? LIMIT 1`,
  ).bind(companyId, id).first<{
    invoiceNumber: string; invoiceDate: string; currency: string;
    subtotalMinor: number; taxMinor: number; totalMinor: number; status: string;
  }>();
  if (!invoice) return c.json({ error: "Invoice not found" }, 404);
  if (invoice.status !== "draft") return c.json({ error: "Only draft invoices can be issued" }, 409);
  const periodError = await postPermissionError(c.env.DB, companyId, invoice.invoiceDate);
  if (periodError) return c.json({ error: periodError }, 409);
  const accounts = await activeAccountIds(c.env.DB, companyId, ["1100", "4000", "2200"]);
  const arId = accounts.get("1100");
  const revenueId = accounts.get("4000");
  const taxId = accounts.get("2200");
  if (!arId || !revenueId || (invoice.taxMinor > 0 && !taxId)) {
    return c.json({ error: "Configure active postable Accounts Receivable (1100), Service Revenue (4000), and Output Tax (2200) accounts first" }, 409);
  }
  const series = await getVoucherSeries(c.env.DB, companyId);
  if (!series) return c.json({ error: "No journal voucher series is configured" }, 409);
  const entryId = crypto.randomUUID();
  const now = new Date().toISOString();
  const lines = [
    { accountId: arId, description: `Invoice ${invoice.invoiceNumber}`, debitMinor: invoice.totalMinor, creditMinor: 0 },
    { accountId: revenueId, description: `Invoice ${invoice.invoiceNumber} revenue`, debitMinor: 0, creditMinor: invoice.subtotalMinor },
    ...(invoice.taxMinor > 0 && taxId ? [{ accountId: taxId, description: `Invoice ${invoice.invoiceNumber} tax`, debitMinor: 0, creditMinor: invoice.taxMinor }] : []),
  ];
  const postUpdate = addPostUpdate(c.env.DB, companyId, entryId, access.userId, series, now);
  const mutations: { companyId: string; statement: D1PreparedStatement; expectedChanges: number }[] = [
    { companyId, statement: addPostedEntryStatements(c.env.DB, {
      companyId, entryId, date: invoice.invoiceDate, currency: invoice.currency,
      reference: invoice.invoiceNumber, description: `Sales invoice ${invoice.invoiceNumber}`,
      sourceType: "sales_invoice", sourceId: id, actorId: access.userId, lines, now,
    }), expectedChanges: 1 },
    ...addEntryLines(c.env.DB, companyId, entryId, lines).map((statement) => ({ companyId, statement, expectedChanges: 1 })),
    ...postUpdate.statements.map((statement) => ({ companyId, statement, expectedChanges: 1 })),
    {
      companyId,
      statement: c.env.DB.prepare(
        `UPDATE sales_invoices SET status='issued', journal_entry_id=?, issued_at=?, updated_at=?
         WHERE company_id=? AND id=? AND status='draft'`,
      ).bind(entryId, now, now, companyId, id),
      expectedChanges: 1,
    },
  ];
  try {
    await appendAuditEvent(c.env.DB, {
      companyId, actorId: access.userId, ...auditRequestMetadata(c.req.raw.headers),
      action: "sales.invoice.issue", resourceType: "sales_invoice", resourceId: id,
      before: { status: "draft" },
      after: { status: "issued", journalEntryId: entryId, voucherNumber: postUpdate.voucherNumber, totalMinor: invoice.totalMinor },
    }, mutations);
  } catch (error) {
    if (error instanceof Error && error.message.includes("mutation_result")) {
      return c.json({ error: "Invoice or voucher series changed concurrently; retry the issue action" }, 409);
    }
    throw error;
  }
  return c.json({ success: true, data: { invoiceId: id, journalEntryId: entryId, voucherNumber: postUpdate.voucherNumber } });
});

salesController.post("/invoices/:id/void", async (c) => {
  let body: { companyId?: string; reason?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: "Request body must be valid JSON" }, 400); }
  const companyId = body.companyId ?? "";
  const access = await permission(c, companyId, "sales.issue");
  if ("response" in access) return access.response;
  if (!body.reason?.trim()) return c.json({ error: "A void reason is required" }, 400);
  const id = c.req.param("id");
  const invoice = await c.env.DB.prepare(
    `SELECT status, invoice_date AS invoiceDate, invoice_number AS invoiceNumber,
      journal_entry_id AS journalEntryId, subtotal_minor AS subtotalMinor,
      tax_minor AS taxMinor, total_minor AS totalMinor, currency
     FROM sales_invoices WHERE company_id=? AND id=? LIMIT 1`,
  ).bind(companyId, id).first<{
    status: string; invoiceDate: string; invoiceNumber: string; journalEntryId: string | null;
    subtotalMinor: number; taxMinor: number; totalMinor: number; currency: string;
  }>();
  if (!invoice) return c.json({ error: "Invoice not found" }, 404);
  if (invoice.status === "void") return c.json({ error: "Invoice is already void" }, 409);
  const payments = await c.env.DB.prepare(
    `SELECT 1 AS found FROM sales_invoice_allocations WHERE company_id=? AND invoice_id=? LIMIT 1`,
  ).bind(companyId, id).first();
  const credits = await c.env.DB.prepare(
    `SELECT 1 AS found FROM sales_credit_notes WHERE company_id=? AND invoice_id=? LIMIT 1`,
  ).bind(companyId, id).first();
  if (payments || credits) return c.json({ error: "Invoices with payments or credit notes cannot be voided; issue a credit note instead" }, 409);
  if (invoice.status === "draft") {
    const now = new Date().toISOString();
    await appendAuditEvent(c.env.DB, {
      companyId, actorId: access.userId, ...auditRequestMetadata(c.req.raw.headers),
      action: "sales.invoice.void", resourceType: "sales_invoice", resourceId: id,
      before: { status: "draft" }, after: { status: "void", reason: body.reason.trim() },
    }, [{
      companyId,
      statement: c.env.DB.prepare(
        `UPDATE sales_invoices SET status='void', updated_at=?
         WHERE company_id=? AND id=? AND status='draft'`,
      ).bind(now, companyId, id),
      expectedChanges: 1,
    }]);
    return c.json({ success: true });
  }
  const reversalDate = new Date().toISOString().slice(0, 10);
  const periodError = await postPermissionError(c.env.DB, companyId, reversalDate);
  if (periodError) return c.json({ error: periodError }, 409);
  const accounts = await activeAccountIds(c.env.DB, companyId, ["1100", "4000", "2200"]);
  const arId = accounts.get("1100");
  const revenueId = accounts.get("4000");
  const taxId = accounts.get("2200");
  if (!arId || !revenueId || (invoice.taxMinor > 0 && !taxId)) return c.json({ error: "Required active posting accounts are unavailable" }, 409);
  const series = await getVoucherSeries(c.env.DB, companyId);
  if (!series) return c.json({ error: "No journal voucher series is configured" }, 409);
  const entryId = crypto.randomUUID();
  const now = new Date().toISOString();
  const lines = [
    { accountId: revenueId, description: `Void invoice ${invoice.invoiceNumber}`, debitMinor: invoice.subtotalMinor, creditMinor: 0 },
    ...(invoice.taxMinor > 0 && taxId ? [{ accountId: taxId, description: `Void invoice ${invoice.invoiceNumber} tax`, debitMinor: invoice.taxMinor, creditMinor: 0 }] : []),
    { accountId: arId, description: `Void invoice ${invoice.invoiceNumber}`, debitMinor: 0, creditMinor: invoice.totalMinor },
  ];
  const postUpdate = addPostUpdate(c.env.DB, companyId, entryId, access.userId, series, now);
  const mutations: { companyId: string; statement: D1PreparedStatement; expectedChanges: number }[] = [
    { companyId, statement: addPostedEntryStatements(c.env.DB, {
      companyId, entryId, date: reversalDate, currency: invoice.currency,
      reference: `VOID-${invoice.invoiceNumber}`, description: `Void invoice ${invoice.invoiceNumber}: ${body.reason.trim()}`,
      sourceType: "sales_invoice_void", sourceId: id, actorId: access.userId, lines, now,
    }), expectedChanges: 1 },
    ...addEntryLines(c.env.DB, companyId, entryId, lines).map((statement) => ({ companyId, statement, expectedChanges: 1 })),
    ...postUpdate.statements.map((statement) => ({ companyId, statement, expectedChanges: 1 })),
    {
      companyId,
      statement: c.env.DB.prepare(
        `UPDATE sales_invoices SET status='void', updated_at=?
         WHERE company_id=? AND id=? AND status='issued'`,
      ).bind(now, companyId, id),
      expectedChanges: 1,
    },
  ];
  await appendAuditEvent(c.env.DB, {
    companyId, actorId: access.userId, ...auditRequestMetadata(c.req.raw.headers),
    action: "sales.invoice.void", resourceType: "sales_invoice", resourceId: id,
    before: { status: "issued" },
    after: { status: "void", reversalEntryId: entryId, voucherNumber: postUpdate.voucherNumber, reason: body.reason.trim() },
  }, mutations);
  return c.json({ success: true, data: { reversalEntryId: entryId, voucherNumber: postUpdate.voucherNumber } });
});

salesController.post("/invoices/:id/credit-notes", async (c) => {
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: "Request body must be valid JSON" }, 400); }
  const parsed = creditNoteSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "Invalid credit note", details: parsed.error.flatten() }, 400);
  const data = parsed.data;
  const access = await permission(c, data.companyId, "sales.issue");
  if ("response" in access) return access.response;
  if (!validDate(data.creditDate)) return c.json({ error: "Credit date must be a valid YYYY-MM-DD date" }, 400);
  const id = c.req.param("id");
  const invoice = await c.env.DB.prepare(
    `SELECT customer_id AS customerId, status, invoice_number AS invoiceNumber, currency,
      subtotal_minor AS subtotalMinor, total_minor AS totalMinor,
      COALESCE((SELECT SUM(amount_minor) FROM sales_invoice_allocations a
        WHERE a.company_id=i.company_id AND a.invoice_id=i.id), 0) AS appliedMinor,
      COALESCE((SELECT SUM(amount_minor) FROM sales_credit_notes n
        WHERE n.company_id=i.company_id AND n.invoice_id=i.id), 0) AS creditMinor
     FROM sales_invoices i WHERE company_id=? AND id=? LIMIT 1`,
  ).bind(data.companyId, id).first<{
    customerId: string; status: string; invoiceNumber: string; currency: string;
    subtotalMinor: number; totalMinor: number; appliedMinor: number; creditMinor: number;
  }>();
  if (!invoice) return c.json({ error: "Invoice not found" }, 404);
  if (invoice.status !== "issued") return c.json({ error: "Only issued invoices can have credit notes" }, 409);
  if (data.amountMinor > invoice.totalMinor - invoice.appliedMinor - invoice.creditMinor) {
    return c.json({ error: "Credit note exceeds the invoice's outstanding balance" }, 400);
  }
  const periodError = await postPermissionError(c.env.DB, data.companyId, data.creditDate);
  if (periodError) return c.json({ error: periodError }, 409);
  const accounts = await activeAccountIds(c.env.DB, data.companyId, ["1100", "4000", "2200"]);
  const arId = accounts.get("1100");
  const revenueId = accounts.get("4000");
  const taxId = accounts.get("2200");
  if (!arId || !revenueId || (data.amountMinor > 0 && !taxId)) return c.json({ error: "Required active posting accounts are unavailable" }, 409);
  const series = await getVoucherSeries(c.env.DB, data.companyId);
  if (!series) return c.json({ error: "No journal voucher series is configured" }, 409);
  const baseMinor = Number((BigInt(data.amountMinor) * BigInt(invoice.subtotalMinor) + BigInt(invoice.totalMinor) / 2n) / BigInt(invoice.totalMinor));
  const taxMinor = data.amountMinor - baseMinor;
  const entryId = crypto.randomUUID();
  const creditId = crypto.randomUUID();
  const creditNumber = data.creditNumber?.trim() || `CN-${data.creditDate.replaceAll("-", "")}-${creditId.slice(0, 8).toUpperCase()}`;
  const now = new Date().toISOString();
  const lines = [
    ...(baseMinor > 0 ? [{ accountId: revenueId, description: `Credit note ${creditNumber} revenue`, debitMinor: baseMinor, creditMinor: 0 }] : []),
    ...(taxMinor > 0 && taxId ? [{ accountId: taxId, description: `Credit note ${creditNumber} tax`, debitMinor: taxMinor, creditMinor: 0 }] : []),
    { accountId: arId, description: `Credit note ${creditNumber}`, debitMinor: 0, creditMinor: data.amountMinor },
  ];
  const postUpdate = addPostUpdate(c.env.DB, data.companyId, entryId, access.userId, series, now);
  const mutations: { companyId: string; statement: D1PreparedStatement; expectedChanges: number }[] = [
    { companyId: data.companyId, statement: addPostedEntryStatements(c.env.DB, {
      companyId: data.companyId, entryId, date: data.creditDate, currency: invoice.currency,
      reference: creditNumber, description: `Credit note ${creditNumber}`,
      sourceType: "sales_credit_note", sourceId: creditId, actorId: access.userId, lines, now,
    }), expectedChanges: 1 },
    ...addEntryLines(c.env.DB, data.companyId, entryId, lines).map((statement) => ({ companyId: data.companyId, statement, expectedChanges: 1 })),
    ...postUpdate.statements.map((statement) => ({ companyId: data.companyId, statement, expectedChanges: 1 })),
    {
      companyId: data.companyId,
      statement: c.env.DB.prepare(
        `INSERT INTO sales_credit_notes
         (company_id,id,invoice_id,credit_number,credit_date,amount_minor,reason,journal_entry_id,created_by,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      ).bind(data.companyId, creditId, id, creditNumber, data.creditDate, data.amountMinor, data.reason, entryId, access.userId, now),
      expectedChanges: 1,
    },
  ];
  await appendAuditEvent(c.env.DB, {
    companyId: data.companyId, actorId: access.userId, ...auditRequestMetadata(c.req.raw.headers),
    action: "sales.credit_note.create", resourceType: "sales_credit_note", resourceId: creditId,
    after: { invoiceId: id, amountMinor: data.amountMinor, baseMinor, taxMinor, voucherNumber: postUpdate.voucherNumber },
  }, mutations);
  return c.json({ success: true, data: { id: creditId, creditNumber, journalEntryId: entryId, voucherNumber: postUpdate.voucherNumber } }, 201);
});

salesController.post("/payments", async (c) => {
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: "Request body must be valid JSON" }, 400); }
  const parsed = paymentSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "Invalid customer payment", details: parsed.error.flatten() }, 400);
  const data = parsed.data;
  const access = await permission(c, data.companyId, "sales.payment");
  if ("response" in access) return access.response;
  const key = c.req.header("Idempotency-Key")?.trim() ?? "";
  if (key.length < 8 || key.length > 128) return c.json({ error: "A valid Idempotency-Key header is required" }, 400);
  if (!validDate(data.paymentDate)) return c.json({ error: "Payment date must be a valid YYYY-MM-DD date" }, 400);
  const hash = await payloadHash(data);
  const previous = await c.env.DB.prepare(
    `SELECT payload_hash AS payloadHash, response_json AS responseJson
     FROM sales_idempotency WHERE company_id=? AND idempotency_key=? LIMIT 1`,
  ).bind(data.companyId, key).first<{ payloadHash: string; responseJson: string }>();
  if (previous) {
    if (previous.payloadHash !== hash) return c.json({ error: "Idempotency key was already used with a different payload" }, 409);
    return c.json(JSON.parse(previous.responseJson));
  }

  const customer = await c.env.DB.prepare(
    `SELECT id FROM sales_customers WHERE company_id=? AND id=? AND is_active=1`,
  ).bind(data.companyId, data.customerId).first();
  if (!customer) return c.json({ error: "Customer not found or inactive" }, 404);
  const allocationTotal = data.allocations.reduce((sum, allocation) => sum + BigInt(allocation.amountMinor), 0n);
  if (allocationTotal > BigInt(data.amountMinor)) return c.json({ error: "Allocated amount exceeds payment amount" }, 400);
  const creditBalance = BigInt(data.amountMinor) - allocationTotal;
  if (creditBalance > 0n && !data.creditOnAccount) {
    return c.json({ error: "Payment exceeds allocated invoice balances; enable credit on account to record the excess" }, 400);
  }
  const seenInvoices = new Set<string>();
  for (const allocation of data.allocations) {
    if (seenInvoices.has(allocation.invoiceId)) return c.json({ error: "An invoice can only be allocated once per payment" }, 400);
    seenInvoices.add(allocation.invoiceId);
    const invoice = await c.env.DB.prepare(
      `SELECT i.total_minor AS totalMinor, i.status, i.currency,
        COALESCE((SELECT SUM(a.amount_minor) FROM sales_invoice_allocations a
          WHERE a.company_id=i.company_id AND a.invoice_id=i.id),0) AS appliedMinor,
        COALESCE((SELECT SUM(n.amount_minor) FROM sales_credit_notes n
          WHERE n.company_id=i.company_id AND n.invoice_id=i.id),0) AS creditMinor
       FROM sales_invoices i WHERE i.company_id=? AND i.id=? AND i.customer_id=? LIMIT 1`,
    ).bind(data.companyId, allocation.invoiceId, data.customerId).first<{
      totalMinor: number; status: string; currency: string; appliedMinor: number; creditMinor: number;
    }>();
    if (!invoice || invoice.status !== "issued") return c.json({ error: "Every allocation must reference an issued invoice for this customer" }, 400);
    if (invoice.currency !== data.currency.toUpperCase()) return c.json({ error: "Payment and invoice currencies must match" }, 400);
    if (allocation.amountMinor > invoice.totalMinor - invoice.appliedMinor - invoice.creditMinor) {
      return c.json({ error: "Allocation exceeds the invoice balance" }, 400);
    }
  }
  const periodError = await postPermissionError(c.env.DB, data.companyId, data.paymentDate);
  if (periodError) return c.json({ error: periodError }, 409);
  const accountCodes = ["1000", ...(allocationTotal > 0n ? ["1100"] : []), ...(creditBalance > 0n ? ["2300"] : [])];
  const accounts = await activeAccountIds(c.env.DB, data.companyId, accountCodes);
  const cashId = accounts.get("1000");
  const arId = accounts.get("1100");
  const creditId = accounts.get("2300");
  if (!cashId || (allocationTotal > 0n && !arId) || (creditBalance > 0n && !creditId)) {
    return c.json({ error: "Configure active postable Cash (1000), Accounts Receivable (1100), and Customer Credits (2300) accounts first" }, 409);
  }
  const series = await getVoucherSeries(c.env.DB, data.companyId);
  if (!series) return c.json({ error: "No journal voucher series is configured" }, 409);
  const paymentId = crypto.randomUUID();
  const entryId = crypto.randomUUID();
  const now = new Date().toISOString();
  const entryLines: { accountId: string; description: string; debitMinor: number; creditMinor: number }[] = [
    { accountId: cashId, description: "Customer payment received", debitMinor: data.amountMinor, creditMinor: 0 },
  ];
  if (allocationTotal > 0n && arId) {
    entryLines.push({ accountId: arId, description: "Customer invoice allocations", debitMinor: 0, creditMinor: Number(allocationTotal) });
  }
  if (creditBalance > 0n && creditId) {
    entryLines.push({ accountId: creditId, description: "Customer credit on account", debitMinor: 0, creditMinor: Number(creditBalance) });
  }
  const postUpdate = addPostUpdate(c.env.DB, data.companyId, entryId, access.userId, series, now);
  const responseData = {
    success: true,
    data: { paymentId, journalEntryId: entryId, voucherNumber: postUpdate.voucherNumber },
  };
  const responseJson = JSON.stringify(responseData);
  const mutations: { companyId: string; statement: D1PreparedStatement; expectedChanges: number }[] = [
    { companyId: data.companyId, statement: addPostedEntryStatements(c.env.DB, {
      companyId: data.companyId, entryId, date: data.paymentDate, currency: data.currency.toUpperCase(),
      reference: data.reference ?? `PAY-${paymentId.slice(0, 8).toUpperCase()}`,
      description: "Customer payment", sourceType: "sales_payment", sourceId: paymentId,
      actorId: access.userId, lines: entryLines, now,
    }), expectedChanges: 1 },
    ...addEntryLines(c.env.DB, data.companyId, entryId, entryLines).map((statement) => ({ companyId: data.companyId, statement, expectedChanges: 1 })),
    ...postUpdate.statements.map((statement) => ({ companyId: data.companyId, statement, expectedChanges: 1 })),
    {
      companyId: data.companyId,
      statement: c.env.DB.prepare(
        `INSERT INTO sales_payments
         (company_id,id,customer_id,payment_date,currency,amount_minor,reference,journal_entry_id,created_by,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      ).bind(data.companyId, paymentId, data.customerId, data.paymentDate, data.currency.toUpperCase(), data.amountMinor,
        data.reference ?? null, entryId, access.userId, now),
      expectedChanges: 1,
    },
    ...data.allocations.map((allocation) => ({
      companyId: data.companyId,
      statement: c.env.DB.prepare(
        `INSERT INTO sales_invoice_allocations (company_id,id,payment_id,invoice_id,amount_minor)
         VALUES (?,?,?,?,?)`,
      ).bind(data.companyId, crypto.randomUUID(), paymentId, allocation.invoiceId, allocation.amountMinor),
      expectedChanges: 1,
    })),
    ...(creditBalance > 0n ? [{
      companyId: data.companyId,
      statement: c.env.DB.prepare(
        `INSERT INTO sales_customer_credits (company_id,id,customer_id,payment_id,amount_minor,created_at)
         VALUES (?,?,?,?,?,?)`,
      ).bind(data.companyId, crypto.randomUUID(), data.customerId, paymentId, Number(creditBalance), now),
      expectedChanges: 1,
    }] : []),
    {
      companyId: data.companyId,
      statement: c.env.DB.prepare(
        `INSERT INTO sales_idempotency (company_id,idempotency_key,payload_hash,response_json,created_at)
         VALUES (?,?,?,?,?)`,
      ).bind(data.companyId, key, hash, responseJson, now),
      expectedChanges: 1,
    },
  ];
  try {
    await appendAuditEvent(c.env.DB, {
      companyId: data.companyId, actorId: access.userId, ...auditRequestMetadata(c.req.raw.headers),
      action: "sales.payment.create", resourceType: "sales_payment", resourceId: paymentId,
      after: { paymentId, amountMinor: data.amountMinor, allocatedMinor: Number(allocationTotal), creditOnAccountMinor: Number(creditBalance), voucherNumber: postUpdate.voucherNumber },
      metadata: { idempotencyKey: key },
    }, mutations);
  } catch (error) {
    const retry = await c.env.DB.prepare(
      `SELECT payload_hash AS payloadHash, response_json AS responseJson
       FROM sales_idempotency WHERE company_id=? AND idempotency_key=? LIMIT 1`,
    ).bind(data.companyId, key).first<{ payloadHash: string; responseJson: string }>();
    if (retry) {
      if (retry.payloadHash !== hash) return c.json({ error: "Idempotency key was already used with a different payload" }, 409);
      return c.json(JSON.parse(retry.responseJson));
    }
    if (error instanceof Error && error.message.includes("mutation_result")) {
      return c.json({ error: "Invoice balance or voucher series changed concurrently; retry with the same idempotency key" }, 409);
    }
    throw error;
  }
  return c.json(responseData, 201);
});

salesController.get("/payments", async (c) => {
  const companyId = c.req.query("companyId") ?? "";
  const access = await permission(c, companyId, "sales.view");
  if ("response" in access) return access.response;
  const rows = await c.env.DB.prepare(
    `SELECT p.id, p.customer_id AS customerId, c.name AS customerName,
      p.payment_date AS paymentDate, p.currency, p.amount_minor AS amountMinor,
      p.reference, p.journal_entry_id AS journalEntryId, e.voucher_number AS voucherNumber,
      COALESCE((SELECT SUM(a.amount_minor) FROM sales_invoice_allocations a
        WHERE a.company_id=p.company_id AND a.payment_id=p.id),0) AS allocatedMinor,
      COALESCE((SELECT SUM(cr.amount_minor) FROM sales_customer_credits cr
        WHERE cr.company_id=p.company_id AND cr.payment_id=p.id),0) AS creditMinor
     FROM sales_payments p
     JOIN sales_customers c ON c.company_id=p.company_id AND c.id=p.customer_id
     JOIN journal_entries e ON e.company_id=p.company_id AND e.id=p.journal_entry_id
     WHERE p.company_id = ?
     ORDER BY p.payment_date DESC, p.created_at DESC LIMIT 500`,
  ).bind(companyId).all();
  return c.json({ data: rows.results });
});

salesController.get("/aging", async (c) => {
  const companyId = c.req.query("companyId") ?? "";
  const access = await permission(c, companyId, "sales.view");
  if ("response" in access) return access.response;
  const today = new Date().toISOString().slice(0, 10);
  const rows = await c.env.DB.prepare(
    `${invoiceSelect} WHERE i.company_id = ? AND i.status = 'issued'
     ORDER BY i.due_date, c.name, i.invoice_number LIMIT 1000`,
  ).bind(companyId).all<Record<string, unknown>>();
  const data = rows.results.map((row) => {
    const invoice = toComputedInvoice(row, today);
    const daysPastDue = Math.max(0, Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${String(row.dueDate)}T00:00:00Z`)) / 86400000));
    const bucket = daysPastDue === 0 ? "current"
      : daysPastDue <= 30 ? "1-30"
        : daysPastDue <= 60 ? "31-60"
          : daysPastDue <= 90 ? "61-90" : "90+";
    return { ...invoice, daysPastDue, bucket };
  }).filter((invoice) => invoice.remainingMinor > 0);
  const totals = data.reduce((result, invoice) => {
    const bucket = invoice.bucket as keyof typeof result;
    result[bucket] = (result[bucket] ?? 0) + invoice.remainingMinor;
    return result;
  }, { current: 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0 } as Record<string, number>);
  return c.json({ data, totals });
});

salesController.get("/summary", async (c) => {
  const companyId = c.req.query("companyId") ?? "";
  const access = await permission(c, companyId, "sales.view");
  if ("response" in access) return access.response;
  const today = new Date().toISOString().slice(0, 10);
  const rows = await c.env.DB.prepare(
    `${invoiceSelect} WHERE i.company_id = ?`,
  ).bind(companyId).all<Record<string, unknown>>();
  const invoices = rows.results.map((row) => toComputedInvoice(row, today));
  const start = `${today.slice(0, 7)}-01`;
  const paid = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(amount_minor), 0) AS amountMinor
     FROM sales_payments
     WHERE company_id = ? AND payment_date >= ? AND payment_date <= ?`,
  ).bind(companyId, start, today).first<{ amountMinor: number }>();
  return c.json({
    data: {
      receivablesMinor: invoices.filter((invoice) => invoice.status !== "draft" && invoice.status !== "void").reduce((sum, invoice) => sum + invoice.remainingMinor, 0),
      overdueMinor: invoices.filter((invoice) => invoice.status === "overdue").reduce((sum, invoice) => sum + invoice.remainingMinor, 0),
      paidThisMonthMinor: paid?.amountMinor ?? 0,
      draftCount: invoices.filter((invoice) => invoice.status === "draft").length,
    },
  });
});

export default salesController;
