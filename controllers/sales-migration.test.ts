import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { readFileSync } from "node:fs";
import { verifyAuditChain } from "../services/audit";
import salesController from "./sales.controller";

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
    async batch(statements: D1PreparedStatement[]) {
      return database.transaction(() =>
        statements.map((statement) => {
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
      id TEXT PRIMARY KEY, admin_id TEXT NOT NULL, name TEXT, legal_name TEXT,
      address TEXT, contact_number TEXT, email TEXT, company_logo TEXT
    );
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
  const now = Math.floor(Date.now() / 1000);
  for (const [id, role] of [["admin-1", "admin"], ["admin-2", "admin"]] as const) {
    database.query(
      `INSERT INTO user_admin (id,name,email,email_verified,role,created_at,updated_at)
       VALUES (?,?,?,0,?,?,?)`,
    ).run(id, id, `${id}@example.test`, role, now, now);
    database.query(
      `INSERT INTO session (id,user_id,token,expires_at,created_at,updated_at)
       VALUES (?,?,?,?,?,?)`,
    ).run(`session-${id}`, id, `token-${id}`, now + 3600, now, now);
  }
  database.query(
    `INSERT INTO user_admin (id,name,email,email_verified,role,created_at,updated_at)
     VALUES (?,?,?,0,'employee',?,?)`,
  ).run("employee-1", "Employee One", "employee@example.test", now, now);
  database.query(
    `INSERT INTO session (id,user_id,token,expires_at,created_at,updated_at)
     VALUES (?,?,?,?,?,?)`,
  ).run("session-employee", "employee-1", "token-employee-1", now + 3600, now, now);
  for (const migrationName of [
    "0008_accounting_audit.sql",
    "0009_audit_atomic_writes.sql",
    "0010_company_scoped_audit_key.sql",
  ]) {
    database.exec(readFileSync(new URL(`../drizzle/${migrationName}`, import.meta.url), "utf8"));
  }
  database.exec(`
    INSERT INTO company (id,admin_id) VALUES ('company-1','admin-1'),('company-2','admin-2');
  `);
  for (const migrationName of [
    "0011_ledger_core.sql",
    "0012_ledger_company_defaults.sql",
    "0013_sales_receivables.sql",
    "0014_invoice_branding.sql",
  ]) {
    database.exec(readFileSync(new URL(`../drizzle/${migrationName}`, import.meta.url), "utf8"));
  }
  return database;
}

const adminOneHeaders = { Authorization: "Bearer token-admin-1" };
const employeeHeaders = { Authorization: "Bearer token-employee-1" };

async function createAndIssueInvoice(database: Database) {
  const db = createD1Adapter(database);
  const customer = database.query(
    "SELECT id FROM sales_customers WHERE company_id=? AND name='Demo Customer'",
  ).get("company-1") as { id: string };
  const create = await salesController.request(
    "/invoices",
    {
      method: "POST",
      headers: { ...adminOneHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId: "company-1",
        customerId: customer.id,
        invoiceNumber: "INV-2026-001",
        invoiceDate: "2026-11-20",
        dueDate: "2026-11-22",
        currency: "PHP",
        issuerProfile: {
          name: "Northwind Studio",
          legalName: "Northwind Studio Inc.",
          address: "Makati City",
          email: "billing@example.test",
          phone: "+63 2 1234 5678",
          logo: "",
        },
        taxRateBps: 500,
        lines: [{ description: "Consulting", quantityMilli: 1500, unitPriceMinor: 10000 }],
      }),
    },
    { DB: db },
  );
  expect(create.status).toBe(201);
  const created = await create.json() as { data: { id: string; subtotal: number; tax: number; total: number } };
  expect(created.data).toMatchObject({ subtotal: 15000, tax: 750, total: 15750 });
  const issue = await salesController.request(
    `/invoices/${created.data.id}/issue`,
    {
      method: "POST",
      headers: { ...adminOneHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ companyId: "company-1" }),
    },
    { DB: db },
  );
  expect(issue.status).toBe(200);
  const issued = await issue.json() as { data: { journalEntryId: string } };
  return { db, customerId: customer.id, invoiceId: created.data.id, entryId: issued.data.journalEntryId };
}

test("sales migration scopes grants, creates demo customer, and seeds defaults for new companies", () => {
  const database = makeDatabase();
  try {
    expect(database.query(
      "SELECT name FROM sales_customers WHERE company_id=? AND id LIKE 'demo-customer-%'",
    ).get("company-1")).toEqual({ name: "Demo Customer" });
    expect(database.query(
      "SELECT role FROM role_permissions WHERE company_id=? AND permission_key='sales.view' ORDER BY role",
    ).all("company-1")).toEqual([{ role: "admin" }, { role: "auditor" }]);
    database.exec("INSERT INTO company (id,admin_id) VALUES ('company-new','admin-2')");
    expect(database.query(
      "SELECT COUNT(*) AS count FROM sales_customers WHERE company_id=?",
    ).get("company-new")).toEqual({ count: 2 });
    expect(database.query(
      "SELECT code FROM accounts WHERE company_id=? AND code IN ('2200','2300') ORDER BY code",
    ).all("company-new")).toEqual([{ code: "2200" }, { code: "2300" }]);
    expect(database.query(
      "SELECT COUNT(*) AS count FROM sales_customers WHERE company_id=? AND id LIKE 'demo-customer-%'",
    ).get("company-new")).toEqual({ count: 2 });
    expect(database.query(
      "SELECT prefix FROM sales_invoice_series WHERE company_id=?",
    ).get("company-new")).toEqual({ prefix: "INV-" });
  } finally {
    database.close();
  }
});

test("batch invoice creation personalizes customers, posts balanced entries, and is idempotent", async () => {
  const database = makeDatabase();
  try {
    const db = createD1Adapter(database);
    const payload = {
      companyId: "company-1",
      applyToAllActive: true,
      customerIds: [],
      issue: true,
      invoiceDate: "2026-11-20",
      dueDate: "2026-11-22",
      currency: "PHP",
      taxRateBps: 500,
      discountType: null,
      discountValue: 0,
      taxInclusive: false,
      lines: [{ description: "Monthly service", quantityMilli: 1000, unitPriceMinor: 10000 }],
      issuerProfile: { name: "Northwind Studio", address: "Makati", logo: "" },
      template: { title: "INVOICE", accentColor: "#123456", layout: "clean" },
    };
    const request = {
      method: "POST",
      headers: { ...adminOneHeaders, "Content-Type": "application/json", "Idempotency-Key": "batch-invoice-0001" },
      body: JSON.stringify(payload),
    };
    const created = await salesController.request("/invoices/batch", request, { DB: db });
    expect(created.status).toBe(201);
    const responseJson = await created.json() as { data: { batchId: string; invoices: { id: string; customerId: string; customerName: string; invoiceNumber: string; journalEntryId: string; voucherNumber: string }[] } };
    expect(responseJson.data.invoices).toHaveLength(2);
    expect(new Set(responseJson.data.invoices.map((item) => item.customerId)).size).toBe(2);
    expect(responseJson.data.invoices.map((item) => item.invoiceNumber)).toEqual(["INV-000001", "INV-000002"]);
    expect(responseJson.data.invoices.map((item) => item.voucherNumber)).toEqual(["JE-000001", "JE-000002"]);
    for (const invoice of responseJson.data.invoices) {
      const detail = await salesController.request(`/invoices/${invoice.id}?companyId=company-1`, { headers: adminOneHeaders }, { DB: db });
      const result = await detail.json() as { data: { invoice: { customerName: string; status: string; totalMinor: number; issuerProfile: { name: string } } } };
      expect(result.data.invoice).toMatchObject({ customerName: invoice.customerName, status: "sent", totalMinor: 10500, issuerProfile: { name: "Northwind Studio" } });
      expect(database.query(
        `SELECT SUM(debit_minor) AS debit, SUM(credit_minor) AS credit
         FROM journal_lines WHERE company_id=? AND entry_id=?`,
      ).get("company-1", invoice.journalEntryId)).toEqual({ debit: 10500, credit: 10500 });
    }
    const replay = await salesController.request("/invoices/batch", request, { DB: db });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(responseJson);
    const changed = await salesController.request("/invoices/batch", {
      ...request,
      body: JSON.stringify({ ...payload, reference: "different payload" }),
    }, { DB: db });
    expect(changed.status).toBe(409);
    expect(await verifyAuditChain(db, "company-1")).toEqual({ valid: true, checked: 1 });
  } finally {
    database.close();
  }
});

test("invoice template is company-scoped, audited, and discount totals use exact minor units", async () => {
  const database = makeDatabase();
  try {
    const db = createD1Adapter(database);
    const defaultTemplate = await salesController.request("/invoice-template?companyId=company-1", { headers: adminOneHeaders }, { DB: db });
    expect((await defaultTemplate.json() as { data: { template: { visibility: { logo: boolean; preparedBy: boolean } } } }).data.template.visibility)
      .toMatchObject({ logo: true, preparedBy: false });
    const templatePayload = {
      companyId: "company-1",
      issuerProfile: { name: "Northwind Studio", address: "Makati City", logo: "" },
      template: {
        title: "INVOICE",
        accentColor: "#123456",
        layout: "compact",
        logoSize: "small",
        logoAlignment: "right",
      },
    };
    const savedTemplate = await salesController.request("/invoice-template", {
      method: "PUT",
      headers: { ...adminOneHeaders, "Content-Type": "application/json" },
      body: JSON.stringify(templatePayload),
    }, { DB: db });
    expect(savedTemplate.status).toBe(200);
    const loadedTemplate = await salesController.request("/invoice-template?companyId=company-1", { headers: adminOneHeaders }, { DB: db });
    expect((await loadedTemplate.json() as { data: { template: { title: string; accentColor: string; layout: string } } }).data.template)
      .toMatchObject({ title: "INVOICE", accentColor: "#123456", layout: "compact" });
    const crossCompany = await salesController.request("/invoice-template?companyId=company-2", { headers: adminOneHeaders }, { DB: db });
    expect(crossCompany.status).toBe(404);

    const customer = database.query("SELECT id FROM sales_customers WHERE company_id=? LIMIT 1").get("company-1") as { id: string };
    const inclusivePayload = {
      companyId: "company-1",
      customerId: customer.id,
      invoiceDate: "2026-11-20",
      dueDate: "2026-11-22",
      taxRateBps: 500,
      taxInclusive: true,
      discountType: "fixed",
      discountValue: 1000,
      lines: [{ description: "Consulting", quantityMilli: 1000, unitPriceMinor: 11000 }],
    };
    const created = await salesController.request("/invoices", {
      method: "POST",
      headers: { ...adminOneHeaders, "Content-Type": "application/json" },
      body: JSON.stringify(inclusivePayload),
    }, { DB: db });
    expect(created.status).toBe(201);
    const invoice = await created.json() as { data: { id: string; invoiceNumber: string; grossSubtotal: number; discount: number; subtotal: number; tax: number; total: number } };
    expect(invoice.data).toMatchObject({
      invoiceNumber: "INV-000001",
      grossSubtotal: 11000,
      discount: 1000,
      subtotal: 9524,
      tax: 476,
      total: 10000,
    });

    const invalidInclusive = await salesController.request("/invoices", {
      method: "POST",
      headers: { ...adminOneHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        ...inclusivePayload,
        lines: [{ description: "Rounding edge", quantityMilli: 1000, unitPriceMinor: 10 }],
        discountType: null,
        discountValue: 0,
      }),
    }, { DB: db });
    expect(invalidInclusive.status).toBe(400);
    expect(await verifyAuditChain(db, "company-1")).toEqual({ valid: true, checked: 2 });
  } finally {
    database.close();
  }
});

test("invoice issue creates an audited balanced journal entry and keeps records tenant-scoped", async () => {
  const database = makeDatabase();
  try {
    const { db, invoiceId, entryId } = await createAndIssueInvoice(database);
    const totals = database.query(
      `SELECT SUM(debit_minor) AS debit, SUM(credit_minor) AS credit
       FROM journal_lines WHERE company_id=? AND entry_id=?`,
    ).get("company-1", entryId);
    expect(totals).toEqual({ debit: 15750, credit: 15750 });
    expect(database.query(
      "SELECT status FROM sales_invoices WHERE company_id=? AND id=?",
    ).get("company-1", invoiceId)).toEqual({ status: "issued" });
    const detail = await salesController.request(
      `/invoices/${invoiceId}?companyId=company-1`,
      { headers: adminOneHeaders },
      { DB: db },
    );
    expect((await detail.json() as { data: { invoice: { issuerProfile: { name: string; legalName: string } } } }).data.invoice.issuerProfile)
      .toMatchObject({ name: "Northwind Studio", legalName: "Northwind Studio Inc." });
    expect(() => database.exec(
      `UPDATE sales_invoices SET reference='tampered' WHERE company_id='company-1' AND id='${invoiceId}'`,
    )).toThrow("issued invoices are immutable");
    expect(() => database.exec(
      `UPDATE sales_invoices SET invoice_template_json='{}' WHERE company_id='company-1' AND id='${invoiceId}'`,
    )).toThrow("issued invoice branding and batch details are immutable");
    expect(await verifyAuditChain(db, "company-1")).toEqual({ valid: true, checked: 2 });
    const crossCompany = await salesController.request(
      `/invoices/${invoiceId}?companyId=company-2`,
      { headers: { Authorization: "Bearer token-admin-2" } },
      { DB: db },
    );
    expect(crossCompany.status).toBe(404);
  } finally {
    database.close();
  }
});

test("payment rejects unapplied excess without explicit credit and safely replays idempotency keys", async () => {
  const database = makeDatabase();
  try {
    const { db, customerId, invoiceId } = await createAndIssueInvoice(database);
    const payload = {
      companyId: "company-1",
      customerId,
      paymentDate: "2026-11-22",
      currency: "PHP",
      amountMinor: 20000,
      allocations: [{ invoiceId, amountMinor: 15750 }],
      creditOnAccount: false,
    };
    const url = "/payments";
    const rejected = await salesController.request(
      url,
      { method: "POST", headers: { ...adminOneHeaders, "Content-Type": "application/json", "Idempotency-Key": "payment-key-0001" }, body: JSON.stringify(payload) },
      { DB: db },
    );
    expect(rejected.status).toBe(400);

    const acceptedPayload = { ...payload, creditOnAccount: true };
    const acceptedRequest = {
      method: "POST",
      headers: { ...adminOneHeaders, "Content-Type": "application/json", "Idempotency-Key": "payment-key-0001" },
      body: JSON.stringify(acceptedPayload),
    };
    const accepted = await salesController.request(url, acceptedRequest, { DB: db });
    expect(accepted.status).toBe(201);
    const acceptedJson = await accepted.json();
    const result = acceptedJson as { data: { journalEntryId: string } };
    expect(database.query(
      `SELECT SUM(debit_minor) AS debit, SUM(credit_minor) AS credit
       FROM journal_lines WHERE company_id=? AND entry_id=?`,
    ).get("company-1", result.data.journalEntryId)).toEqual({ debit: 20000, credit: 20000 });

    const replay = await salesController.request(url, acceptedRequest, { DB: db });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(acceptedJson);

    const differentPayload = { ...acceptedPayload, amountMinor: 20001 };
    const conflict = await salesController.request(
      url,
      { ...acceptedRequest, body: JSON.stringify(differentPayload) },
      { DB: db },
    );
    expect(conflict.status).toBe(409);
    expect(database.query(
      "SELECT amount_minor AS amount FROM sales_customer_credits WHERE company_id=?",
    ).get("company-1")).toEqual({ amount: 4250 });
    const history = await salesController.request(
      "/payments?companyId=company-1",
      { headers: adminOneHeaders },
      { DB: db },
    );
    expect(history.status).toBe(200);
    expect((await history.json() as { data: { amountMinor: number; allocatedMinor: number; creditMinor: number }[] }).data).toEqual([
      expect.objectContaining({ amountMinor: 20000, allocatedMinor: 15750, creditMinor: 4250 }),
    ]);
    const paymentId = (database.query(
      "SELECT id FROM sales_payments WHERE company_id=?",
    ).get("company-1") as { id: string }).id;
    expect(() => database.exec(
      `INSERT INTO sales_invoice_allocations (company_id,id,payment_id,invoice_id,amount_minor)
       VALUES ('company-1','over-allocation','${paymentId}','${invoiceId}',1)`,
    )).toThrow("invoice allocations and credits cannot exceed invoice total");
  } finally {
    database.close();
  }
});

test("credit notes post balanced reversals and invoice status remains allocation-derived", async () => {
  const database = makeDatabase();
  try {
    const { db, invoiceId } = await createAndIssueInvoice(database);
    const response = await salesController.request(
      `/invoices/${invoiceId}/credit-notes`,
      {
        method: "POST",
        headers: { ...adminOneHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: "company-1",
          creditDate: "2026-11-22",
          amountMinor: 3150,
          reason: "Service adjustment",
        }),
      },
      { DB: db },
    );
    expect(response.status).toBe(201);
    const result = await response.json() as { data: { journalEntryId: string } };
    expect(database.query(
      `SELECT SUM(debit_minor) AS debit, SUM(credit_minor) AS credit
       FROM journal_lines WHERE company_id=? AND entry_id=?`,
    ).get("company-1", result.data.journalEntryId)).toEqual({ debit: 3150, credit: 3150 });
    const detail = await salesController.request(
      `/invoices/${invoiceId}?companyId=company-1`,
      { headers: adminOneHeaders },
      { DB: db },
    );
    const invoice = (await detail.json() as { data: { invoice: { status: string; remainingMinor: number } } }).data.invoice;
    expect(invoice).toMatchObject({ status: "sent", remainingMinor: 12600 });
    expect(await verifyAuditChain(db, "company-1")).toEqual({ valid: true, checked: 3 });
  } finally {
    database.close();
  }
});

test("sales API rejects posting into a closed period and unauthorized access", async () => {
  const database = makeDatabase();
  try {
    const db = createD1Adapter(database);
    const denied = await salesController.request(
      "/customers?companyId=company-1",
      { headers: employeeHeaders },
      { DB: db },
    );
    expect(denied.status).toBe(404);
    database.exec("INSERT INTO company_memberships (company_id,user_id,role,created_at) VALUES ('company-1','employee-1','employee',1)");
    const forbidden = await salesController.request(
      "/customers?companyId=company-1",
      { headers: employeeHeaders },
      { DB: db },
    );
    expect(forbidden.status).toBe(403);
    const batchForbidden = await salesController.request(
      "/invoices/batch",
      {
        method: "POST",
        headers: { ...employeeHeaders, "Content-Type": "application/json", "Idempotency-Key": "no-sales-perm-001" },
        body: JSON.stringify({ companyId: "company-1", customerIds: ["customer-1"], invoiceDate: "2026-11-20", dueDate: "2026-11-22", lines: [{ description: "Service", quantityMilli: 1000, unitPriceMinor: 10000 }] }),
      },
      { DB: db },
    );
    expect(batchForbidden.status).toBe(403);
    database.exec("UPDATE accounting_periods SET status='closed', close_reason='month end' WHERE company_id='company-1'");
    const customer = database.query("SELECT id FROM sales_customers WHERE company_id=?").get("company-1") as { id: string };
    const created = await salesController.request(
      "/invoices",
      {
        method: "POST",
        headers: { ...adminOneHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: "company-1", customerId: customer.id, invoiceDate: "2026-11-20",
          dueDate: "2026-11-22", lines: [{ description: "Service", quantityMilli: 1000, unitPriceMinor: 10000 }],
        }),
      },
      { DB: db },
    );
    const result = await created.json() as { data: { id: string } };
    const issue = await salesController.request(
      `/invoices/${result.data.id}/issue`,
      { method: "POST", headers: { ...adminOneHeaders, "Content-Type": "application/json" }, body: JSON.stringify({ companyId: "company-1" }) },
      { DB: db },
    );
    expect(issue.status).toBe(409);
    expect(await issue.json()).toEqual({ error: "Cannot post into a closed accounting period" });
  } finally {
    database.close();
  }
});

test("sales migration rolls back cleanly when no customer transactions exist", () => {
  const database = makeDatabase();
  try {
    database.exec(readFileSync(new URL("../drizzle/rollback/0014_invoice_branding.sql", import.meta.url), "utf8"));
    database.exec(readFileSync(new URL("../drizzle/rollback/0013_sales_receivables.sql", import.meta.url), "utf8"));
    expect(() => database.query("SELECT * FROM sales_invoices")).toThrow();
    expect(database.query("SELECT COUNT(*) AS count FROM accounts WHERE code IN ('2200','2300')").get()).toEqual({ count: 0 });
    expect(() => database.query("SELECT * FROM sales_customers")).toThrow();
  } finally {
    database.close();
  }
});
