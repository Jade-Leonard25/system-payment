import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { checkCompanyPermission } from "./admin-access";
import { verifyAuditChain } from "../services/audit";
import ledgerController from "./ledger.controller";

type TestStatement = {
  bind: (...values: (string | number | null)[]) => TestStatement;
  run: () => { meta: { changes: number } };
  first: <T>() => T | null;
  all: <T>() => { results: T[] };
  raw: () => unknown[][];
};

function createD1Adapter(database: Database): D1Database {
  const adapter = {
    prepare(sql: string) {
      let values: (string | number | null)[] = [];
      const statement: TestStatement = {
        bind(...boundValues) {
          values = boundValues;
          return statement;
        },
        run() {
          const result = database.query(sql).run(...values);
          return { meta: { changes: result.changes } };
        },
        first<T>() {
          return (database.query(sql).get(...values) as T | undefined) ?? null;
        },
        all<T>() {
          return { results: database.query(sql).all(...values) as T[] };
        },
        raw() {
          return database.query(sql).values(...values);
        },
      };
      return statement;
    },
    async batch(batchStatements: D1PreparedStatement[]) {
      return database.transaction(() =>
        batchStatements.map((statement) => {
          const result = (statement as unknown as TestStatement).run();
          return { meta: result.meta };
        }),
      )();
    },
  };
  return adapter as unknown as D1Database;
}

function makeDatabase() {
  const database = new Database(":memory:");
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE company (id TEXT PRIMARY KEY, admin_id TEXT NOT NULL);
    CREATE TABLE user_admin (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
      email_verified INTEGER NOT NULL, image TEXT, role TEXT NOT NULL DEFAULT 'employee',
      key_product_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE session (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token TEXT NOT NULL UNIQUE,
      expires_at INTEGER NOT NULL, ip_address TEXT, user_agent TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE account (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL, provider_id TEXT NOT NULL,
      user_id TEXT NOT NULL, access_token TEXT, refresh_token TEXT, id_token TEXT,
      access_token_expires_at INTEGER, refresh_token_expires_at INTEGER,
      scope TEXT, password TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE verification (
      id TEXT PRIMARY KEY, identifier TEXT NOT NULL, value TEXT NOT NULL,
      expires_at INTEGER NOT NULL, created_at INTEGER, updated_at INTEGER
    );
  `);
  const timestamp = Math.floor(Date.now() / 1000);
  database.query(
    `INSERT INTO user_admin (id, name, email, email_verified, role, created_at, updated_at)
     VALUES (?, ?, ?, 0, ?, ?, ?)`,
  ).run("admin-1", "Admin One", "admin-1@example.test", "admin", timestamp, timestamp);
  database.query(
    `INSERT INTO user_admin (id, name, email, email_verified, role, created_at, updated_at)
     VALUES (?, ?, ?, 0, ?, ?, ?)`,
  ).run("admin-2", "Admin Two", "admin-2@example.test", "admin", timestamp, timestamp);
  database.query(
    `INSERT INTO user_admin (id, name, email, email_verified, role, created_at, updated_at)
     VALUES (?, ?, ?, 0, ?, ?, ?)`,
  ).run("employee-1", "Employee One", "employee-1@example.test", "admin", timestamp, timestamp);
  database.query(
    `INSERT INTO session (id, user_id, token, expires_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run("ledger-session", "employee-1", "ledger-test-token", timestamp + 3600, timestamp, timestamp);
  database.query(
    `INSERT INTO session (id, user_id, token, expires_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run("ledger-admin-session", "admin-2", "ledger-admin-token", timestamp + 3600, timestamp, timestamp);
  for (const migrationName of [
    "0008_accounting_audit.sql",
    "0009_audit_atomic_writes.sql",
    "0010_company_scoped_audit_key.sql",
  ]) {
    database.exec(readFileSync(new URL(`../drizzle/${migrationName}`, import.meta.url), "utf8"));
  }
  database.exec("INSERT INTO company (id, admin_id) VALUES ('company-1', 'admin-1'), ('company-2', 'admin-2')");
  for (const migrationName of [
    "0011_ledger_core.sql",
    "0012_ledger_company_defaults.sql",
    "0013_sales_receivables.sql",
  ]) {
    database.exec(readFileSync(new URL(`../drizzle/${migrationName}`, import.meta.url), "utf8"));
  }
  return database;
}

function accountId(database: Database, companyId: string, code: string) {
  return (database.query("SELECT id FROM accounts WHERE company_id=? AND code=?")
    .get(companyId, code) as { id: string }).id;
}

const authHeaders = { Authorization: "Bearer ledger-test-token" };
const adminHeaders = { Authorization: "Bearer ledger-admin-token" };

function insertDraft(database: Database, companyId: string, id: string, date = "2026-11-22") {
  database.exec(`INSERT INTO journal_entries (
    company_id,id,entry_date,currency,status,created_at,updated_at
  ) VALUES (
    '${companyId}','${id}','${date}','PHP','draft','2026-11-22T00:00:00Z','2026-11-22T00:00:00Z'
  )`);
}

test("ledger migration seeds scoped starter accounts and permissions", () => {
  const database = makeDatabase();
  try {
    expect((database.query("SELECT COUNT(*) AS count FROM accounts WHERE company_id=?").get("company-1") as {count:number}).count).toBeGreaterThanOrEqual(6);
    expect((database.query("SELECT COUNT(*) AS count FROM accounts WHERE company_id=?").get("company-2") as {count:number}).count).toBeGreaterThanOrEqual(6);
    expect((database.query("SELECT COUNT(*) AS count FROM voucher_series WHERE company_id=?").get("company-1") as {count:number}).count).toBe(1);
    expect(database.query("SELECT COUNT(*) AS count FROM role_permissions WHERE company_id=? AND permission_key LIKE 'ledger.%'").get("company-1")).toEqual({ count: 5 });
  } finally { database.close(); }
});

test("ledger defaults and admin permissions are seeded for companies created after migration", async () => {
  const database = makeDatabase();
  try {
    database.exec("INSERT INTO company (id, admin_id) VALUES ('company-new', 'admin-2')");

    expect((database.query("SELECT COUNT(*) AS count FROM accounts WHERE company_id=?").get("company-new") as {count:number}).count).toBe(8);
    expect(database.query("SELECT name FROM sales_customers WHERE company_id=?").get("company-new")).toEqual({ name: "Demo Customer" });
    expect(database.query("SELECT prefix, next_number AS nextNumber FROM voucher_series WHERE company_id=?").get("company-new")).toEqual({ prefix: "JE-", nextNumber: 1 });
    expect(await checkCompanyPermission(createD1Adapter(database), "admin-2", "company-new", "ledger.view")).toEqual({
      member: true,
      allowed: true,
      role: "admin",
    });
  } finally { database.close(); }
});

test("company admin can load transactions after company-scoped ledger defaults are seeded", async () => {
  const database = makeDatabase();
  try {
    database.exec("INSERT INTO company (id, admin_id) VALUES ('dynamic', 'admin-2')");
    const response = await ledgerController.request(
      "/accounts?companyId=dynamic",
      { headers: adminHeaders },
      { DB: createD1Adapter(database) },
    );
    expect(response.status).toBe(200);
    const result = await response.json() as { data: { code: string }[] };
    expect(result.data.map((account) => account.code)).toContain("1000");
    expect(result.data.length).toBeGreaterThanOrEqual(6);
  } finally { database.close(); }
});

test("ledger API returns 403 when a company member lacks ledger permission", async () => {
  const database = makeDatabase();
  try {
    database.exec("INSERT INTO company_memberships (company_id, user_id, role, created_at) VALUES ('company-1', 'employee-1', 'employee', 1)");
    const response = await ledgerController.request(
      "/accounts?companyId=company-1",
      { headers: authHeaders },
      { DB: createD1Adapter(database) },
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Permission denied" });
  } finally { database.close(); }
});

test("ledger API rejects unbalanced entries and posting into a closed period", async () => {
  const database = makeDatabase();
  try {
    const d1 = createD1Adapter(database);
    database.exec(`
      INSERT INTO company_memberships (company_id, user_id, role, created_at)
      VALUES ('company-1', 'employee-1', 'admin', 1);
      UPDATE accounting_periods SET status='closed', close_reason='month end'
      WHERE company_id='company-1';
    `);
    insertDraft(database, "company-1", "entry-closed");
    const cash = accountId(database, "company-1", "1000");
    const revenue = accountId(database, "company-1", "4000");
    database.exec(`INSERT INTO journal_lines (company_id,id,entry_id,account_id,debit_minor,credit_minor)
      VALUES ('company-1','closed-line-1','entry-closed','${cash}',10000,0),
             ('company-1','closed-line-2','entry-closed','${revenue}',0,10000)`);
    const closedResponse = await ledgerController.request(
      "/entries/entry-closed/post",
      { method: "POST", headers: { ...authHeaders, "Content-Type": "application/json" }, body: JSON.stringify({ companyId: "company-1" }) },
      { DB: d1 },
    );
    expect(closedResponse.status).toBe(409);
    expect(await closedResponse.json()).toEqual({ error: "Cannot post into a closed accounting period" });

    database.exec("UPDATE accounting_periods SET status='open' WHERE company_id='company-1'");
    insertDraft(database, "company-1", "entry-unbalanced");
    database.exec(`INSERT INTO journal_lines (company_id,id,entry_id,account_id,debit_minor,credit_minor)
      VALUES ('company-1','unbalanced-line-1','entry-unbalanced','${cash}',10000,0),
             ('company-1','unbalanced-line-2','entry-unbalanced','${revenue}',0,9000)`);
    const unbalancedResponse = await ledgerController.request(
      "/entries/entry-unbalanced/post",
      { method: "POST", headers: { ...authHeaders, "Content-Type": "application/json" }, body: JSON.stringify({ companyId: "company-1" }) },
      { DB: d1 },
    );
    expect(unbalancedResponse.status).toBe(400);
    expect(await unbalancedResponse.json()).toEqual({
      error: "Journal entry is unbalanced",
      debitMinor: 10000,
      creditMinor: 9000,
    });
  } finally { database.close(); }
});

test("ledger API submits a draft for approval and records the audited status change", async () => {
  const database = makeDatabase();
  try {
    const d1 = createD1Adapter(database);
    database.exec("INSERT INTO company_memberships (company_id, user_id, role, created_at) VALUES ('company-1', 'employee-1', 'admin', 1)");
    insertDraft(database, "company-1", "entry-submit");
    const cash = accountId(database, "company-1", "1000");
    const revenue = accountId(database, "company-1", "4000");
    database.exec(`INSERT INTO journal_lines (company_id,id,entry_id,account_id,debit_minor,credit_minor)
      VALUES ('company-1','submit-line-1','entry-submit','${cash}',10000,0),
             ('company-1','submit-line-2','entry-submit','${revenue}',0,10000)`);

    const response = await ledgerController.request(
      "/entries/entry-submit/submit",
      { method: "POST", headers: { ...authHeaders, "Content-Type": "application/json" }, body: JSON.stringify({ companyId: "company-1" }) },
      { DB: d1 },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { id: "entry-submit", status: "pending approval" } });
    expect(database.query("SELECT status FROM journal_entries WHERE company_id=? AND id=?").get("company-1", "entry-submit")).toEqual({ status: "pending approval" });
    expect(await verifyAuditChain(d1, "company-1")).toEqual({ valid: true, checked: 1 });
  } finally { database.close(); }
});

test("posted journal entries reject updates, deletes, unbalanced posting, and cross-company lines", () => {
  const database = makeDatabase();
  try {
    insertDraft(database, "company-1", "entry-1");
    const cash = accountId(database, "company-1", "1000");
    const revenue = accountId(database, "company-1", "4000");
    database.exec(`INSERT INTO journal_lines (company_id,id,entry_id,account_id,debit_minor,credit_minor)
      VALUES ('company-1','line-1','entry-1','${cash}',10000,0),
             ('company-1','line-2','entry-1','${revenue}',0,10000)`);
    database.exec("UPDATE journal_entries SET status='posted' WHERE company_id='company-1' AND id='entry-1'");

    expect(() => database.exec("UPDATE journal_entries SET description='changed' WHERE id='entry-1'")).toThrow("posted journal entries are immutable");
    expect(() => database.exec("DELETE FROM journal_entries WHERE id='entry-1'")).toThrow("posted journal entries are immutable");
    expect(() => database.exec(`UPDATE accounts SET code='1001' WHERE company_id='company-1' AND id='${cash}'`)).not.toThrow();

    insertDraft(database, "company-1", "entry-2");
    database.exec(`INSERT INTO journal_lines (company_id,id,entry_id,account_id,debit_minor,credit_minor)
      VALUES ('company-1','line-3','entry-2','${cash}',10000,0),
             ('company-1','line-4','entry-2','${revenue}',0,9000)`);
    expect(() => database.exec("UPDATE journal_entries SET status='posted' WHERE company_id='company-1' AND id='entry-2'")).toThrow("posted journal entry must balance");

    insertDraft(database, "company-2", "entry-foreign");
    const foreignRevenue = accountId(database, "company-2", "4000");
    expect(() => database.exec(`INSERT INTO journal_lines (company_id,id,entry_id,account_id,debit_minor,credit_minor)
      VALUES ('company-1','line-5','entry-foreign','${foreignRevenue}',100,0)`)).toThrow();
  } finally { database.close(); }
});

test("closed periods, account deactivation, and posted account deletion rules are enforced", () => {
  const database = makeDatabase();
  try {
    database.exec("UPDATE accounting_periods SET status='closed', close_reason='month end' WHERE company_id='company-1'");
    insertDraft(database, "company-1", "entry-closed", "2026-11-22");
    expect(database.query("SELECT 1 AS closed FROM accounting_periods WHERE company_id=? AND period_start<=? AND period_end>=? AND status='closed'").get("company-1", "2026-11-22", "2026-11-22")).toEqual({ closed: 1 });

    const revenue = accountId(database, "company-1", "4000");
    database.exec(`UPDATE accounts SET is_active=0 WHERE company_id='company-1' AND id='${revenue}'`);
    expect((database.query("SELECT is_active AS active FROM accounts WHERE company_id=? AND id=?").get("company-1", revenue) as {active:number}).active).toBe(0);
  } finally { database.close(); }
});
