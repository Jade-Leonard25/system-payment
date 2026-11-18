import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq, sql } from "drizzle-orm";
import { employees } from "../schema/schema";
import { generateCustomId } from "../customID";

type Bindings = { DB: D1Database };
const employeeController = new Hono<{ Bindings: Bindings }>();

const PLAN_LIMITS: Record<string, number> = {
  free: 20, // ₱0/month
  small_100: 50, // ₱100/month
  medium_500: 500, // ₱500/month
};

// Add a single employee (with tier limit check)
employeeController.post("/", async (c) => {
  const db = drizzle(c.env.DB);
  const body = await c.req.json();
  const plan = body.plan || "free";

  // Check current employee count for this company
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(employees)
    .where(eq(employees.companyId, body.companyId));

  const limit = PLAN_LIMITS[plan] ?? 20;
  if (count >= limit) {
    return c.json(
      {
        error: `Plan limit reached (${limit} employees). Upgrade to add more.`,
      },
      403,
    );
  }

  const now = new Date();
  const newEmployee = {
    id: generateCustomId(),
    adminId: body.adminId ?? null,
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
  const db = drizzle(c.env.DB);
  const companyId = c.req.param("companyId");

  const results = await db
    .select()
    .from(employees)
    .where(eq(employees.companyId, companyId));

  return c.json({ data: results });
});

// Batch update employee salaries/rates (1 fast D1 round-trip)
employeeController.put("/batch-rates", async (c) => {
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
  const db = drizzle(c.env.DB);
  const id = c.req.param("id");

  await db.delete(employees).where(eq(employees.id, id));
  return c.json({ success: true });
});

export default employeeController;
