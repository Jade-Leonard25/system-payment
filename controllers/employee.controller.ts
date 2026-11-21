import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { and, eq, inArray } from "drizzle-orm";
import { company, employees } from "../schema/schema";
import { generateCustomId } from "../customID";
import { requireAdmin } from "./admin-access";

type Bindings = { DB: D1Database };
const employeeController = new Hono<{ Bindings: Bindings }>();

// Add a single employee
employeeController.post("/", async (c) => {
  const access = await requireAdmin(c);
  if ("response" in access) return access.response;

  const db = drizzle(c.env.DB);
  const body = await c.req.json();
  if (typeof body.companyId !== "string" || !body.companyId) {
    return c.json({ error: "Company ID is required" }, 400);
  }
  const [ownedCompany] = await db
    .select({ id: company.id })
    .from(company)
    .where(and(eq(company.id, body.companyId), eq(company.adminId, access.userId)))
    .limit(1);
  if (!ownedCompany) {
    return c.json({ error: "Company not found" }, 404);
  }

  const now = new Date();
  const newEmployee = {
    id: generateCustomId(),
    adminId: access.userId,
    companyId: body.companyId,
    firstname: body.firstname,
    middlename: body.middlename ?? null,
    lastname: body.lastname,
    extname: body.extname ?? null,
    birthdate: body.birthdate ?? null,
    gender: body.gender ?? null,
    civilStatus: body.civilStatus ?? "SINGLE",
    email: body.email ?? null,
    phone: body.phone ?? null,
    address: body.address ?? null,
    employmentType: body.employmentType ?? "REGULAR",
    employmentStatus: body.employmentStatus ?? "ACTIVE",
    dateHired: body.dateHired,
    dateResigned: body.dateResigned ?? null,
    department: body.department ?? null,
    position: body.position ?? null,
    socialSecurityNumber: body.socialSecurityNumber,
    pagIbigID: body.pagIbigID,
    philhealth: body.philhealth,
    taxIdNumber: body.taxIdNumber,
    baseSalaryCents: body.baseSalaryCents,
    dailyRateCents: body.dailyRateCents,
    hourlyRateCents: body.hourlyRateCents,
    deductSSS: body.deductSSS ?? true,
    deductPhilHealth: body.deductPhilHealth ?? true,
    deductPagIbig: body.deductPagIbig ?? true,
    deductTax: body.deductTax ?? true,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(employees).values(newEmployee);
  return c.json({ success: true, data: newEmployee }, 201);
});

// Get all employees for a company
employeeController.get("/company/:companyId", async (c) => {
  const access = await requireAdmin(c);
  if ("response" in access) return access.response;

  const db = drizzle(c.env.DB);
  const companyId = c.req.param("companyId");
  const [ownedCompany] = await db
    .select({ id: company.id })
    .from(company)
    .where(and(eq(company.id, companyId), eq(company.adminId, access.userId)))
    .limit(1);
  if (!ownedCompany) {
    return c.json({ error: "Company not found" }, 404);
  }

  const results = await db
    .select()
    .from(employees)
    .where(eq(employees.companyId, companyId));

  return c.json({ data: results });
});

// Batch update employee salaries/rates (1 fast D1 round-trip)
employeeController.put("/batch-rates", async (c) => {
  const access = await requireAdmin(c);
  if ("response" in access) return access.response;

  const db = drizzle(c.env.DB);
  const { updates } = await c.req.json<{
    updates: {
      id: string;
      baseSalaryCents: number;
      dailyRateCents: number;
      hourlyRateCents: number;
    }[];
  }>();

  if (!updates?.length) {
    return c.json({ error: "No updates provided" }, 400);
  }

  const employeeIds = [...new Set(updates.map((item) => item.id))];
  if (employeeIds.some((id) => typeof id !== "string" || !id)) {
    return c.json({ error: "Every update must include a valid employee ID" }, 400);
  }
  const ownedEmployees = await db
    .select({ id: employees.id })
    .from(employees)
    .innerJoin(company, eq(employees.companyId, company.id))
    .where(and(eq(company.adminId, access.userId), inArray(employees.id, employeeIds)));
  if (ownedEmployees.length !== employeeIds.length) {
    return c.json({ error: "One or more employees were not found" }, 404);
  }

  const now = new Date();
  const batchQueries = updates.map((item) =>
    db
      .update(employees)
      .set({
        baseSalaryCents: item.baseSalaryCents,
        dailyRateCents: item.dailyRateCents,
        hourlyRateCents: item.hourlyRateCents,
        updatedAt: now,
      })
      .where(eq(employees.id, item.id)),
  );

  await db.batch(
    batchQueries as [(typeof batchQueries)[0], ...typeof batchQueries],
  );
  return c.json({ success: true, updatedCount: updates.length });
});

// Delete an employee
employeeController.delete("/:id", async (c) => {
  const access = await requireAdmin(c);
  if ("response" in access) return access.response;

  const db = drizzle(c.env.DB);
  const id = c.req.param("id");

  const [deleted] = await db
    .delete(employees)
    .where(
      and(
        eq(employees.id, id),
        inArray(
          employees.companyId,
          db
            .select({ id: company.id })
            .from(company)
            .where(eq(company.adminId, access.userId)),
        ),
      ),
    )
    .returning({ id: employees.id });
  if (!deleted) {
    return c.json({ error: "Employee not found" }, 404);
  }
  return c.json({ success: true });
});

export default employeeController;
