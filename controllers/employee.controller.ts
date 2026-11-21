import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { and, eq, inArray } from "drizzle-orm";
import { company, employees } from "../schema/schema";
import { generateCustomId } from "../customID";
import { requireAdmin } from "./admin-access";
import { z } from "zod";

type Bindings = { DB: D1Database };
const employeeController = new Hono<{ Bindings: Bindings }>();
const MAX_BATCH_EMPLOYEES = 1000;
const MAX_BATCH_REQUEST_BYTES = 5 * 1024 * 1024;
const batchEmployeeSchema = z
  .object({
    firstname: z.string().trim().min(1).max(128),
    middlename: z.string().nullable().optional(),
    lastname: z.string().trim().min(1).max(128),
    extname: z.string().nullable().optional(),
    birthdate: z.string().nullable().optional(),
    gender: z.string().nullable().optional(),
    civilStatus: z.string().default("SINGLE"),
    email: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    address: z.string().nullable().optional(),
    employmentType: z.string().default("REGULAR"),
    employmentStatus: z.string().default("ACTIVE"),
    dateHired: z.string().trim().min(1),
    dateResigned: z.string().nullable().optional(),
    department: z.string().nullable().optional(),
    position: z.string().nullable().optional(),
    socialSecurityNumber: z.string().trim().min(1),
    pagIbigID: z.string().trim().min(1),
    philhealth: z.string().trim().min(1),
    taxIdNumber: z.string().trim().min(1),
    baseSalaryCents: z.number().int().safe().nonnegative(),
    dailyRateCents: z.number().int().safe().nonnegative(),
    hourlyRateCents: z.number().int().safe().nonnegative(),
    deductSSS: z.boolean().default(true),
    deductPhilHealth: z.boolean().default(true),
    deductPagIbig: z.boolean().default(true),
    deductTax: z.boolean().default(true),
  })
  .strict();
const batchCreateRequestSchema = z
  .object({
    companyId: z.string().trim().min(1).max(128),
    employees: z.array(batchEmployeeSchema).min(1).max(MAX_BATCH_EMPLOYEES),
  })
  .strict();

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

employeeController.post("/batch", async (c) => {
  const access = await requireAdmin(c);
  if ("response" in access) return access.response;

  const contentLength = Number(c.req.header("content-length") ?? 0);
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_BATCH_REQUEST_BYTES
  ) {
    return c.json({ error: "Employee batches must be 5 MB or smaller" }, 413);
  }

  let requestJson: unknown;
  try {
    const requestText = await c.req.text();
    if (new TextEncoder().encode(requestText).byteLength > MAX_BATCH_REQUEST_BYTES) {
      return c.json({ error: "Employee batches must be 5 MB or smaller" }, 413);
    }
    requestJson = JSON.parse(requestText);
  } catch {
    return c.json({ error: "Request body must be valid JSON" }, 400);
  }

  const parsedRequest = batchCreateRequestSchema.safeParse(requestJson);
  if (!parsedRequest.success) {
    return c.json(
      {
        error: `Provide a companyId and between 1 and ${MAX_BATCH_EMPLOYEES} valid employees.`,
        details: parsedRequest.error.flatten(),
      },
      400,
    );
  }

  const { companyId, employees: employeeInputs } = parsedRequest.data;
  const db = drizzle(c.env.DB);
  const [ownedCompany] = await db
    .select({ id: company.id })
    .from(company)
    .where(and(eq(company.id, companyId), eq(company.adminId, access.userId)))
    .limit(1);
  if (!ownedCompany) {
    return c.json({ error: "Company not found" }, 404);
  }

  const now = new Date();
  const createdAt = Math.floor(now.getTime() / 1000);
  const newEmployees = employeeInputs.map((input) => ({
    id: generateCustomId(),
    adminId: access.userId,
    companyId,
    firstname: input.firstname,
    middlename: input.middlename ?? null,
    lastname: input.lastname,
    extname: input.extname ?? null,
    birthdate: input.birthdate ?? null,
    gender: input.gender ?? null,
    civilStatus: input.civilStatus,
    email: input.email ?? null,
    phone: input.phone ?? null,
    address: input.address ?? null,
    employmentType: input.employmentType,
    employmentStatus: input.employmentStatus,
    dateHired: input.dateHired,
    dateResigned: input.dateResigned ?? null,
    department: input.department ?? null,
    position: input.position ?? null,
    socialSecurityNumber: input.socialSecurityNumber,
    pagIbigID: input.pagIbigID,
    philhealth: input.philhealth,
    taxIdNumber: input.taxIdNumber,
    baseSalaryCents: input.baseSalaryCents,
    dailyRateCents: input.dailyRateCents,
    hourlyRateCents: input.hourlyRateCents,
    deductSSS: input.deductSSS,
    deductPhilHealth: input.deductPhilHealth,
    deductPagIbig: input.deductPagIbig,
    deductTax: input.deductTax,
    createdAt: now,
    updatedAt: now,
  }));
  const insertPayload = newEmployees.map((employee) => ({
    ...employee,
    createdAt,
    updatedAt: createdAt,
  }));

  await c.env.DB.prepare(
    `INSERT INTO employees (
      id, admin_id, company_id, firstname, middlename, lastname, extname,
      birthdate, gender, civil_status, email, phone, address, employment_type,
      employment_status, date_hired, date_resigned, department, position, sss,
      pag_ibig, philhealth, tin, base_salary_cents, daily_rate_cents,
      hourly_rate_cents, deduct_sss, deduct_philhealth, deduct_pag_ibig,
      deduct_tax, created_at, updated_at
    )
    SELECT
      json_extract(value, '$.id'),
      json_extract(value, '$.adminId'),
      json_extract(value, '$.companyId'),
      json_extract(value, '$.firstname'),
      json_extract(value, '$.middlename'),
      json_extract(value, '$.lastname'),
      json_extract(value, '$.extname'),
      json_extract(value, '$.birthdate'),
      json_extract(value, '$.gender'),
      json_extract(value, '$.civilStatus'),
      json_extract(value, '$.email'),
      json_extract(value, '$.phone'),
      json_extract(value, '$.address'),
      json_extract(value, '$.employmentType'),
      json_extract(value, '$.employmentStatus'),
      json_extract(value, '$.dateHired'),
      json_extract(value, '$.dateResigned'),
      json_extract(value, '$.department'),
      json_extract(value, '$.position'),
      json_extract(value, '$.socialSecurityNumber'),
      json_extract(value, '$.pagIbigID'),
      json_extract(value, '$.philhealth'),
      json_extract(value, '$.taxIdNumber'),
      json_extract(value, '$.baseSalaryCents'),
      json_extract(value, '$.dailyRateCents'),
      json_extract(value, '$.hourlyRateCents'),
      json_extract(value, '$.deductSSS'),
      json_extract(value, '$.deductPhilHealth'),
      json_extract(value, '$.deductPagIbig'),
      json_extract(value, '$.deductTax'),
      json_extract(value, '$.createdAt'),
      json_extract(value, '$.updatedAt')
    FROM json_each(?)`,
  ).bind(JSON.stringify(insertPayload)).run();

  return c.json(
    { success: true, data: newEmployees.map(({ id }) => ({ id })) },
    201,
  );
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
