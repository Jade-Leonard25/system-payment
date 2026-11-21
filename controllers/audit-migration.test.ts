import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { readFileSync } from "node:fs";
import { appendAuditEvent, verifyAuditChain } from "../services/audit";
import { checkCompanyPermission } from "./admin-access";
import auditController from "./audit.controller";

type TestStatement = {
  bind: (...values: (string | number | null)[]) => TestStatement;
  run: () => { meta: { changes: number } };
  first: <T>() => T | null;
  all: <T>() => { results: T[] };
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
    CREATE TABLE company (
      id TEXT PRIMARY KEY,
      admin_id TEXT NOT NULL
    );
    CREATE TABLE user_admin (id TEXT PRIMARY KEY);
    INSERT INTO user_admin (id) VALUES ('admin-1'), ('auditor-1'), ('employee-1');
    INSERT INTO company (id, admin_id) VALUES ('company-1', 'admin-1');
  `);
  const migration = readFileSync(
    new URL("../drizzle/0008_accounting_audit.sql", import.meta.url),
    "utf8",
  );
  database.exec(migration);
  database.exec(
    readFileSync(
      new URL("../drizzle/0009_audit_atomic_writes.sql", import.meta.url),
      "utf8",
    ),
  );
  database.exec(
    readFileSync(
      new URL("../drizzle/0010_company_scoped_audit_key.sql", import.meta.url),
      "utf8",
    ),
  );
  return database;
}

test("accounting audit migration scopes permissions and preserves append-only history", () => {
  const database = makeDatabase();
  try {
    const membership = database
      .query(
        "SELECT role FROM company_memberships WHERE company_id = ? AND user_id = ?",
      )
      .get("company-1", "admin-1") as { role: string } | null;
    expect(membership?.role).toBe("admin");
    const grants = database
      .query(
        "SELECT role FROM role_permissions WHERE company_id = ? AND permission_key = ? ORDER BY role",
      )
      .all("company-1", "audit.view") as { role: string }[];
    expect(grants.map(({ role }) => role)).toEqual(["admin", "auditor"]);

    database.exec(`
      INSERT INTO user_admin (id) VALUES ('admin-2');
      INSERT INTO company (id, admin_id) VALUES ('company-2', 'admin-2');
    `);
    expect(
      database
        .query("SELECT COUNT(*) AS count FROM company_memberships WHERE company_id = ?")
        .get("company-2"),
    ).toEqual({ count: 1 });
    expect(
      database
        .query("SELECT COUNT(*) AS count FROM company_audit_heads WHERE company_id = ?")
        .get("company-2"),
    ).toEqual({ count: 1 });

    database.exec(`
      INSERT INTO company_audit_events (
        id, company_id, sequence, occurred_at, action, resource_type,
        request_id, metadata_json, previous_hash, entry_hash
      ) VALUES (
        'event-1', 'company-1', 1, '2026-11-22T00:00:00.000Z',
        'test.create', 'test', 'request-1', '{}', '0', 'hash-1'
      );
    `);
    expect(() =>
      database.exec("UPDATE company_audit_events SET action = 'tampered' WHERE id = 'event-1'"),
    ).toThrow("company_audit_events are append-only");
    expect(() =>
      database.exec("DELETE FROM company_audit_events WHERE id = 'event-1'"),
    ).toThrow("company_audit_events are append-only");
  } finally {
    database.close();
  }
});

test("concurrent audit appends serialize and integrity verification detects tampering", async () => {
  const database = makeDatabase();
  try {
    const d1 = createD1Adapter(database);
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        appendAuditEvent(d1, {
          companyId: "company-1",
          actorId: "admin-1",
          action: "test.create",
          resourceType: "test",
          resourceId: `resource-${index}`,
          requestId: `request-${index}`,
          occurredAt: `2026-11-22T00:00:0${index}.000Z`,
          after: { index },
        }),
      ),
    );
    expect(new Set(results.map((result) => result.sequence)).size).toBe(8);
    expect(results.map((result) => result.sequence).sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
    expect(await verifyAuditChain(d1, "company-1")).toEqual({
      valid: true,
      checked: 8,
    });

    database.exec("DROP TRIGGER company_audit_events_no_update");
    database.exec(
      "UPDATE company_audit_events SET action = 'tampered' WHERE sequence = 4",
    );
    const result = await verifyAuditChain(d1, "company-1");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Entry hash mismatch");
  } finally {
    database.close();
  }
});

test("audit permission checks require a company membership and an explicit role grant", async () => {
  const database = makeDatabase();
  try {
    database.exec(`
      INSERT INTO company_memberships (company_id, user_id, role, created_at)
      VALUES ('company-1', 'auditor-1', 'auditor', 1);
      INSERT INTO company_memberships (company_id, user_id, role, created_at)
      VALUES ('company-1', 'employee-1', 'employee', 1);
      INSERT INTO user_admin (id) VALUES ('admin-2');
      INSERT INTO company (id, admin_id) VALUES ('company-2', 'admin-2');
    `);
    const d1 = createD1Adapter(database);
    expect(await checkCompanyPermission(d1, "admin-1", "company-1", "audit.view")).toEqual({
      member: true,
      allowed: true,
      role: "admin",
    });
    expect(await checkCompanyPermission(d1, "auditor-1", "company-1", "audit.view")).toEqual({
      member: true,
      allowed: true,
      role: "auditor",
    });
    expect(await checkCompanyPermission(d1, "employee-1", "company-1", "audit.view")).toEqual({
      member: true,
      allowed: false,
      role: "employee",
    });
    expect(await checkCompanyPermission(d1, "admin-1", "company-2", "audit.view")).toEqual({
      member: false,
      allowed: false,
    });
  } finally {
    database.close();
  }
});

test("audited mutations commit atomically with the chain and roll back when row counts differ", async () => {
  const database = makeDatabase();
  try {
    database.exec("CREATE TABLE audited_business_rows (id TEXT PRIMARY KEY)");
    const d1 = createD1Adapter(database);
    await appendAuditEvent(
      d1,
      {
        companyId: "company-1",
        actorId: "admin-1",
        action: "test.create",
        resourceType: "test",
        resourceId: "row-1",
        requestId: "atomic-request",
        after: { id: "row-1" },
      },
      [{
        companyId: "company-1",
        statement: d1
          .prepare("INSERT INTO audited_business_rows (id) VALUES (?)")
          .bind("row-1"),
        expectedChanges: 1,
      }],
    );
    expect(
      database.query("SELECT COUNT(*) AS count FROM audited_business_rows").get(),
    ).toEqual({ count: 1 });
    expect(
      database.query("SELECT COUNT(*) AS count FROM company_audit_events").get(),
    ).toEqual({ count: 1 });

    await expect(
      appendAuditEvent(
        d1,
        {
          companyId: "company-1",
          actorId: "admin-1",
          action: "test.create",
          resourceType: "test",
          resourceId: "row-2",
          requestId: "atomic-request-failure",
        },
        [{
          companyId: "company-1",
          statement: d1
            .prepare("INSERT INTO audited_business_rows (id) VALUES (?)")
            .bind("row-2"),
          expectedChanges: 2,
        }],
      ),
    ).rejects.toThrow();
    expect(
      database.query("SELECT COUNT(*) AS count FROM audited_business_rows").get(),
    ).toEqual({ count: 1 });
    expect(
      database.query("SELECT COUNT(*) AS count FROM company_audit_events").get(),
    ).toEqual({ count: 1 });
    expect(await verifyAuditChain(d1, "company-1")).toEqual({
      valid: true,
      checked: 1,
    });
  } finally {
    database.close();
  }
});

test("company creation mutation can create its own chain head atomically", async () => {
  const database = makeDatabase();
  try {
    database.exec("INSERT INTO user_admin (id) VALUES ('admin-3')");
    const d1 = createD1Adapter(database);
    await appendAuditEvent(
      d1,
      {
        companyId: "company-new",
        actorId: "admin-3",
        action: "company.create",
        resourceType: "company",
        resourceId: "company-new",
        requestId: "company-create-1",
        after: { id: "company-new", name: "Dynamic" },
      },
      [{
        companyId: "company-new",
        statement: d1.prepare(
          "INSERT INTO company (id, admin_id) VALUES (?, ?)",
        ).bind("company-new", "admin-3"),
        expectedChanges: 1,
      }],
    );
    expect(database.query("SELECT COUNT(*) AS count FROM company WHERE id=?").get("company-new")).toEqual({ count: 1 });
    expect(database.query("SELECT COUNT(*) AS count FROM company_audit_heads WHERE company_id=?").get("company-new")).toEqual({ count: 1 });
    expect(database.query("SELECT COUNT(*) AS count FROM company_audit_events WHERE company_id=?").get("company-new")).toEqual({ count: 1 });
  } finally {
    database.close();
  }
});

test("audit API rejects anonymous access even when a company ID is supplied", async () => {
  const database = makeDatabase();
  try {
    const response = await auditController.request(
      "/?companyId=company-1",
      {},
      { DB: createD1Adapter(database) },
    );
    expect(response.status).toBe(401);
  } finally {
    database.close();
  }
});
