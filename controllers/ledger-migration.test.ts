import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";

function makeDatabase() {
  const database = new Database(":memory:");
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE company (id TEXT PRIMARY KEY, admin_id TEXT NOT NULL);
    CREATE TABLE user_admin (id TEXT PRIMARY KEY);
    CREATE TABLE permissions (
      company_id TEXT NOT NULL,
      permission_key TEXT NOT NULL,
      description TEXT NOT NULL,
      PRIMARY KEY (company_id, permission_key)
    );
    CREATE TABLE role_permissions (
      company_id TEXT NOT NULL,
      role TEXT NOT NULL,
      permission_key TEXT NOT NULL,
      PRIMARY KEY (company_id, role, permission_key)
    );
    INSERT INTO user_admin (id) VALUES ('admin-1'), ('admin-2');
    INSERT INTO company (id, admin_id) VALUES ('company-1', 'admin-1'), ('company-2', 'admin-2');
  `);
  const migration = readFileSync(new URL("../drizzle/0011_ledger_core.sql", import.meta.url), "utf8");
  database.exec(migration);
  return database;
}

function accountId(database: Database, companyId: string, code: string) {
  return (database.query("SELECT id FROM accounts WHERE company_id=? AND code=?")
    .get(companyId, code) as { id: string }).id;
}

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
