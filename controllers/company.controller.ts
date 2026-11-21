import { Hono } from "hono";
import type { D1Database } from "@cloudflare/workers-types";
import { drizzle } from "drizzle-orm/d1";
import { and, eq } from "drizzle-orm";
import { company } from "../schema/schema";
import { generateCustomId } from "../customID";
import { requireAdmin, requireUser } from "./admin-access";
import { appendAuditEvent, auditRequestMetadata } from "../services/audit";

type Bindings = { DB: D1Database };
const companyController = new Hono<{ Bindings: Bindings }>();

// Create a new company
companyController.post("/", async (c) => {
  const access = await requireAdmin(c);
  if ("response" in access) return access.response;

  const db = drizzle(c.env.DB);
  const body = await c.req.json();
  const now = new Date();

  const newCompany = {
    id: generateCustomId(),
    adminId: access.userId,
    name: body.name,
    legalName: body.legalName ?? null,
    address: body.address ?? null,
    contactNumber: body.contactNumber ?? null,
    email: body.email ?? null,
    companyLogo: body.companyLogo ?? "",
    taxId: body.taxId,
    rdoCode: body.rdoCode ?? null,
    employerSSS: body.employerSSS ?? null,
    employerPhilHealth: body.employerPhilHealth ?? null,
    employerPagIbig: body.employerPagIbig ?? null,
    compTaxReduct: body.compTaxReduct ?? 0.0,
    compPermit: body.compPermit ?? null,
    createdAt: now,
    updatedAt: now,
  };

  const createdAt = Math.floor(now.getTime() / 1000);
  const insertStatement = c.env.DB.prepare(
    `INSERT INTO company (
       id, admin_id, name, legal_name, address, contact_number, email,
       company_logo, tax_id, rdo_code, employer_sss, employer_philhealth,
       employer_pag_ibig, comp_tax_reduct, company_permit, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    newCompany.id,
    newCompany.adminId,
    newCompany.name,
    newCompany.legalName,
    newCompany.address,
    newCompany.contactNumber,
    newCompany.email,
    newCompany.companyLogo,
    newCompany.taxId,
    newCompany.rdoCode,
    newCompany.employerSSS,
    newCompany.employerPhilHealth,
    newCompany.employerPagIbig,
    newCompany.compTaxReduct,
    newCompany.compPermit,
    createdAt,
    createdAt,
  );
  await appendAuditEvent(c.env.DB, {
    companyId: newCompany.id,
    actorId: access.userId,
    ...auditRequestMetadata(c.req.raw.headers),
    action: "company.create",
    resourceType: "company",
    resourceId: newCompany.id,
    after: newCompany,
  }, [{ companyId: newCompany.id, statement: insertStatement, expectedChanges: 1 }]);
  return c.json({ success: true, data: newCompany }, 201);
});

companyController.get("/accessible", async (c) => {
  const access = await requireUser(c);
  if ("response" in access) return access.response;

  const results = await c.env.DB.prepare(
    `SELECT DISTINCT c.*
     FROM company AS c
     LEFT JOIN company_memberships AS m
       ON m.company_id = c.id AND m.user_id = ?
     WHERE c.admin_id = ? OR m.user_id = ?
     ORDER BY c.name`,
  )
    .bind(access.userId, access.userId, access.userId)
    .all();
  return c.json({ data: results.results });
});

// Get all companies managed by an admin
companyController.get("/admin/:adminId", async (c) => {
  const access = await requireAdmin(c);
  if ("response" in access) return access.response;

  const db = drizzle(c.env.DB);
  const adminId = c.req.param("adminId");
  if (adminId !== access.userId) {
    return c.json({ error: "You can only view your own companies" }, 403);
  }

  const results = await db
    .select()
    .from(company)
    .where(eq(company.adminId, adminId));

  return c.json({ data: results });
});

// Update company statutory/tax details
companyController.put("/:id", async (c) => {
  const access = await requireAdmin(c);
  if ("response" in access) return access.response;

  const db = drizzle(c.env.DB);
  const id = c.req.param("id");
  const [before] = await db
    .select()
    .from(company)
    .where(and(eq(company.id, id), eq(company.adminId, access.userId)))
    .limit(1);
  if (!before) {
    return c.json({ error: "Company not found" }, 404);
  }

  const body = await c.req.json<Record<string, unknown>>();
  const updates: Partial<typeof company.$inferInsert> = { updatedAt: new Date() };
  if (typeof body.name === "string") updates.name = body.name;
  if (body.legalName === null || typeof body.legalName === "string") updates.legalName = body.legalName;
  if (body.address === null || typeof body.address === "string") updates.address = body.address;
  if (body.contactNumber === null || typeof body.contactNumber === "string") updates.contactNumber = body.contactNumber;
  if (body.email === null || typeof body.email === "string") updates.email = body.email;
  if (typeof body.companyLogo === "string") updates.companyLogo = body.companyLogo;
  if (typeof body.taxId === "string") updates.taxId = body.taxId;
  if (body.rdoCode === null || typeof body.rdoCode === "string") updates.rdoCode = body.rdoCode;
  if (body.employerSSS === null || typeof body.employerSSS === "string") updates.employerSSS = body.employerSSS;
  if (body.employerPhilHealth === null || typeof body.employerPhilHealth === "string") updates.employerPhilHealth = body.employerPhilHealth;
  if (body.employerPagIbig === null || typeof body.employerPagIbig === "string") updates.employerPagIbig = body.employerPagIbig;
  if (typeof body.compTaxReduct === "number") updates.compTaxReduct = body.compTaxReduct;
  if (body.compPermit === null || typeof body.compPermit === "string") updates.compPermit = body.compPermit;

  const after = { ...before, ...updates };
  const columnNames: Record<string, string> = {
    updatedAt: "updated_at",
    name: "name",
    legalName: "legal_name",
    address: "address",
    contactNumber: "contact_number",
    email: "email",
    companyLogo: "company_logo",
    taxId: "tax_id",
    rdoCode: "rdo_code",
    employerSSS: "employer_sss",
    employerPhilHealth: "employer_philhealth",
    employerPagIbig: "employer_pag_ibig",
    compTaxReduct: "comp_tax_reduct",
    compPermit: "company_permit",
  };
  const assignments = Object.entries(updates).map(([key, value]) => {
    if (key === "updatedAt") {
      if (!(value instanceof Date)) {
        throw new Error("Company update timestamp is invalid.");
      }
      return {
        column: columnNames[key],
        value: Math.floor(value.getTime() / 1000),
      };
    }
    return { column: columnNames[key], value };
  });
  if (assignments.some(({ column }) => !column)) {
    throw new Error("Company update contains an unsupported field.");
  }
  const updateStatement = c.env.DB.prepare(
    `UPDATE company SET ${assignments.map(({ column }) => `"${column}" = ?`).join(", ")}
     WHERE id = ? AND admin_id = ?`,
  ).bind(...assignments.map(({ value }) => value), id, access.userId);
  await appendAuditEvent(c.env.DB, {
    companyId: id,
    actorId: access.userId,
    ...auditRequestMetadata(c.req.raw.headers),
    action: "company.update",
    resourceType: "company",
    resourceId: id,
    before,
    after,
  }, [{ companyId: id, statement: updateStatement, expectedChanges: 1 }]);
  return c.json({ success: true });
});

export default companyController;
