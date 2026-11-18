import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { company } from "../schema/schema";
import { generateCustomId } from "../customID";

type Bindings = { DB: D1Database };
const companyController = new Hono<{ Bindings: Bindings }>();

// Create a new company
companyController.post("/", async (c) => {
  const db = drizzle(c.env.DB);
  const body = await c.req.json();
  const now = new Date();

  const newCompany = {
    id: generateCustomId(),
    adminId: body.adminId,
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
  const db = drizzle(c.env.DB);
  const adminId = c.req.param("adminId");

  const results = await db
    .select()
    .from(company)
    .where(eq(company.adminId, adminId));

  return c.json({ data: results });
});

// Update company statutory/tax details
companyController.put("/:id", async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param("id");
  const body = await c.req.json();

  await db
    .update(company)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(company.id, id));

  return c.json({ success: true });
});

export default companyController;
