import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";

test("attendance scan migration adds batch tables and immutable audit records", () => {
  const database = new Database(":memory:");
  try {
    database.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE company (id TEXT PRIMARY KEY);
      CREATE TABLE user_admin (id TEXT PRIMARY KEY);
      CREATE TABLE employees (id TEXT PRIMARY KEY);
    `);
    const migration = readFileSync(
      new URL("../drizzle/0007_attendance_scan_pipeline.sql", import.meta.url),
      "utf8",
    );
    database.exec(migration);
    database.exec(`
      INSERT INTO company (id) VALUES ('company-1');
      INSERT INTO user_admin (id) VALUES ('admin-1');
      INSERT INTO attendance_batches (
        id, company_id, batch_id, payload_hash, status, total_rows,
        computed_count, flagged_count, rejected_count, actor_id, rules_version,
        response_json, created_at
      ) VALUES (
        'batch-row-1', 'company-1', 'batch-1', 'hash-1', 'completed', 2,
        1, 0, 1, 'admin-1', 'attendance-scan-v1', '{}', 0
      );
      INSERT INTO audit_logs (
        id, company_id, actor_id, batch_id, action, rules_version,
        occurred_at, metadata_json
      ) VALUES (
        'audit-1', 'company-1', 'admin-1', 'batch-row-1',
        'attendance_batch.scan_compute', 'attendance-scan-v1', 0, '{}'
      );
    `);

    expect(() =>
      database.exec(`
        INSERT INTO attendance_batches (
          id, company_id, batch_id, payload_hash, status, total_rows,
          computed_count, flagged_count, rejected_count, actor_id, rules_version,
          response_json, created_at
        ) VALUES (
          'batch-row-2', 'company-1', 'batch-1', 'hash-1', 'completed', 2,
          1, 0, 1, 'admin-1', 'attendance-scan-v1', '{}', 0
        );
      `),
    ).toThrow();
    expect(() =>
      database.exec("UPDATE audit_logs SET metadata_json = '{}' WHERE id = 'audit-1'"),
    ).toThrow("audit_logs are append-only");
    expect(() =>
      database.exec("DELETE FROM audit_logs WHERE id = 'audit-1'"),
    ).toThrow("audit_logs are append-only");
  } finally {
    database.close();
  }
});
