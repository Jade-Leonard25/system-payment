import { Hono } from "hono";
import type { D1Database } from "@cloudflare/workers-types";
import { requirePermission } from "./admin-access";
import { verifyAuditChain } from "../services/audit";

type Bindings = { DB: D1Database };
type AuditEnvironment = {
  Bindings: Bindings;
  Variables: {
    permissionAccess: { userId: string; role: string; companyId: string };
  };
};
type SqlValue = string | number | null;
type AuditListRow = {
  id: string;
  sequence: number;
  occurredAt: string;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  requestId: string;
};

const auditController = new Hono<AuditEnvironment>();
auditController.use("*", requirePermission("audit.view"));

function validDate(value: string | undefined): value is string {
  if (!value) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function getFilters(url: URL) {
  const clauses = ["e.company_id = ?"];
  const values: SqlValue[] = [url.searchParams.get("companyId")];
  const from = url.searchParams.get("from") ?? undefined;
  const to = url.searchParams.get("to") ?? undefined;
  const user = url.searchParams.get("user")?.trim();
  const action = url.searchParams.get("action")?.trim();
  const resource = url.searchParams.get("resource")?.trim();

  if (from && !validDate(from)) return { error: "Start date must use YYYY-MM-DD." };
  if (to && !validDate(to)) return { error: "End date must use YYYY-MM-DD." };
  if (from && to && from > to) return { error: "Start date must not follow end date." };
  if (from) {
    clauses.push("e.occurred_at >= ?");
    values.push(`${from}T00:00:00.000Z`);
  }
  if (to) {
    const endExclusive = new Date(`${to}T00:00:00.000Z`);
    endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
    clauses.push("e.occurred_at < ?");
    values.push(endExclusive.toISOString());
  }
  if (user) {
    clauses.push(
      "(e.actor_id = ? OR u.name LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\')",
    );
    const pattern = `%${user.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    values.push(user, pattern, pattern);
  }
  if (action) {
    clauses.push("e.action = ?");
    values.push(action);
  }
  if (resource) {
    clauses.push(
      "(e.resource_type LIKE ? ESCAPE '\\' OR e.resource_id LIKE ? ESCAPE '\\')",
    );
    const pattern = `%${resource.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    values.push(pattern, pattern);
  }
  return { where: clauses.join(" AND "), values };
}

function escapeCsv(value: unknown): string {
  let text = value == null ? "" : String(value);
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function csvResponse(rows: Record<string, unknown>[]) {
  const columns = [
    "occurredAt",
    "actorName",
    "actorEmail",
    "actorId",
    "action",
    "resourceType",
    "resourceId",
    "requestId",
    "beforeJson",
    "afterJson",
    "metadataJson",
    "sequence",
  ];
  const csv = [
    columns.map(escapeCsv).join(","),
    ...rows.map((row) => columns.map((column) => escapeCsv(row[column])).join(",")),
  ].join("\r\n");
  return new Response(`\uFEFF${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="audit-log.csv"',
      "Cache-Control": "no-store",
    },
  });
}

auditController.get("/access", async (c) => {
  return c.json({ allowed: true });
});

auditController.get("/integrity", async (c) => {
  const companyId = c.req.query("companyId") ?? "";
  return c.json(await verifyAuditChain(c.env.DB, companyId));
});

auditController.get("/export.csv", async (c) => {
  const url = new URL(c.req.url);
  const companyId = url.searchParams.get("companyId") ?? "";
  const filters = getFilters(url);
  if ("error" in filters) return c.json({ error: filters.error }, 400);

  const result = await c.env.DB.prepare(
    `SELECT e.id, e.sequence, e.occurred_at AS occurredAt,
            e.actor_id AS actorId, u.name AS actorName, u.email AS actorEmail,
            e.action, e.resource_type AS resourceType,
            e.resource_id AS resourceId, e.request_id AS requestId,
            e.before_json AS beforeJson, e.after_json AS afterJson,
            e.metadata_json AS metadataJson
     FROM company_audit_events AS e
     LEFT JOIN user_admin AS u ON u.id = e.actor_id
     WHERE ${filters.where}
     ORDER BY e.sequence DESC
     LIMIT 20001`,
  )
    .bind(...filters.values)
    .all<Record<string, unknown>>();
  if (result.results.length > 20000) {
    return c.json(
      { error: "Export exceeds 20,000 events. Narrow the date range or filters." },
      413,
    );
  }

  return csvResponse(result.results);
});

auditController.get("/", async (c) => {
  const url = new URL(c.req.url);
  const companyId = url.searchParams.get("companyId") ?? "";
  const filters = getFilters(url);
  if ("error" in filters) return c.json({ error: filters.error }, 400);

  const rawLimit = Number(url.searchParams.get("limit") ?? "100");
  const rawOffset = Number(url.searchParams.get("offset") ?? "0");
  if (
    !Number.isInteger(rawLimit) ||
    rawLimit < 1 ||
    rawLimit > 200 ||
    !Number.isInteger(rawOffset) ||
    rawOffset < 0 ||
    rawOffset > 100000
  ) {
    return c.json({ error: "Limit or offset is outside the allowed range." }, 400);
  }

  const result = await c.env.DB.prepare(
    `SELECT e.id, e.sequence, e.occurred_at AS occurredAt,
            e.actor_id AS actorId, u.name AS actorName, u.email AS actorEmail,
            e.action, e.resource_type AS resourceType,
            e.resource_id AS resourceId, e.request_id AS requestId
     FROM company_audit_events AS e
     LEFT JOIN user_admin AS u ON u.id = e.actor_id
     WHERE ${filters.where}
     ORDER BY e.sequence DESC
     LIMIT ? OFFSET ?`,
  )
    .bind(...filters.values, rawLimit, rawOffset)
    .all<AuditListRow>();
  return c.json({ data: result.results, limit: rawLimit, offset: rawOffset });
});

auditController.get("/:id", async (c) => {
  const companyId = c.req.query("companyId") ?? "";
  const result = await c.env.DB.prepare(
    `SELECT e.id, e.sequence, e.occurred_at AS occurredAt,
            e.actor_id AS actorId, u.name AS actorName, u.email AS actorEmail,
            e.ip_address AS ipAddress, e.action,
            e.resource_type AS resourceType, e.resource_id AS resourceId,
            e.request_id AS requestId, e.before_json AS beforeJson,
            e.after_json AS afterJson, e.metadata_json AS metadataJson,
            e.previous_hash AS previousHash, e.entry_hash AS entryHash
     FROM company_audit_events AS e
     LEFT JOIN user_admin AS u ON u.id = e.actor_id
     WHERE e.company_id = ? AND e.id = ?
     LIMIT 1`,
  )
    .bind(companyId, c.req.param("id"))
    .first();
  if (!result) return c.json({ error: "Audit event not found" }, 404);
  return c.json({ data: result });
});

export default auditController;
