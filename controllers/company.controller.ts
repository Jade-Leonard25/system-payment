import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { and, eq } from "drizzle-orm";
import { company } from "../schema/schema";
import { generateCustomId } from "../customID";
import { requireAdmin } from "./admin-access";

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

  await db.insert(company).values(newCompany);
  return c.json({ success: true, data: newCompany }, 201);
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
  const [ownedCompany] = await db
    .select({ id: company.id })
    .from(company)
    .where(and(eq(company.id, id), eq(company.adminId, access.userId)))
    .limit(1);
  if (!ownedCompany) {
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

  await db
    .update(company)
    .set(updates)
    .where(eq(company.id, id));

  return c.json({ success: true });
});

export default companyController;
