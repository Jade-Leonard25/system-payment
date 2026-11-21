import { Hono } from "hono";
import type { Context } from "hono";
import type { D1Database } from "@cloudflare/workers-types";
import { drizzle } from "drizzle-orm/d1";
import { and, eq, isNull } from "drizzle-orm";
import { attendanceLogs, company, employees } from "../schema/schema";
import { generateCustomId } from "../customID";
import { requireAdmin } from "./admin-access";

type Bindings = {
  DB: D1Database;
  ATTENDANCE_API_TOKEN: string;
};

const attendanceController = new Hono<{ Bindings: Bindings }>();

function matchesToken(supplied: string, expected: string): boolean {
  const suppliedBytes = new TextEncoder().encode(supplied);
  const expectedBytes = new TextEncoder().encode(expected);
  let difference = suppliedBytes.length ^ expectedBytes.length;
  const length = Math.max(suppliedBytes.length, expectedBytes.length);
  for (let index = 0; index < length; index += 1) {
    difference |=
      (suppliedBytes[index] ?? 0) ^ (expectedBytes[index] ?? 0);
  }
  return difference === 0;
}

function requireAttendanceToken(c: Context<{ Bindings: Bindings }>) {
  const expectedToken = c.env.ATTENDANCE_API_TOKEN;
  if (!expectedToken) {
    return c.json({ error: "Attendance API is not configured" }, 503);
  }

  const authorization = c.req.header("Authorization") ?? "";
  const prefix = "Bearer ";
  if (!authorization.startsWith(prefix)) {
    return c.json({ error: "Attendance API token required" }, 401);
  }

  if (!matchesToken(authorization.slice(prefix.length), expectedToken)) {
    return c.json({ error: "Invalid attendance API token" }, 401);
  }
  return null;
}

function isClockMinute(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === "number" && value >= 0 && value < 1440;
}

function isLogDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  );
}

attendanceController.post("/clock-in", async (c) => {
  const tokenError = requireAttendanceToken(c);
  if (tokenError) return tokenError;

  let body: {
    employeeId?: unknown;
    logDate?: unknown;
    timeInMinutes?: unknown;
    shiftStartMinutes?: unknown;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Request body must be valid JSON" }, 400);
  }

  if (
    typeof body.employeeId !== "string" ||
    !body.employeeId ||
    !isLogDate(body.logDate) ||
    !isClockMinute(body.timeInMinutes) ||
    (body.shiftStartMinutes !== undefined && !isClockMinute(body.shiftStartMinutes))
  ) {
    return c.json(
      { error: "Provide employeeId, logDate (YYYY-MM-DD), and timeInMinutes (0-1439)" },
      400,
    );
  }

  const db = drizzle(c.env.DB);
  const [employee] = await db
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.id, body.employeeId), eq(employees.employmentStatus, "ACTIVE")))
    .limit(1);
  if (!employee) {
    return c.json({ error: "Active employee not found" }, 404);
  }

  const [openLog] = await db
    .select({ id: attendanceLogs.id })
    .from(attendanceLogs)
    .where(
      and(
        eq(attendanceLogs.employeeId, body.employeeId),
        eq(attendanceLogs.logDate, body.logDate),
        isNull(attendanceLogs.timeOutMinutes),
      ),
    )
    .limit(1);
  if (openLog) {
    return c.json({ error: "Employee already has an open attendance record for this date" }, 409);
  }

  const shiftStartMinutes = body.shiftStartMinutes ?? 480;
  const now = new Date();
  const newLog = {
    id: generateCustomId(),
    employeeId: body.employeeId,
    logDate: body.logDate,
    timeInMinutes: body.timeInMinutes,
    timeOutMinutes: null,
    totalHoursWorked: 0,
    overtimeHours: 0,
    lateMinutes: Math.max(0, body.timeInMinutes - shiftStartMinutes),
    createdAt: now,
  };

  await db.insert(attendanceLogs).values(newLog);
  return c.json({ success: true, data: newLog }, 201);
});

attendanceController.put("/clock-out/:id", async (c) => {
  const tokenError = requireAttendanceToken(c);
  if (tokenError) return tokenError;

  let body: { timeOutMinutes?: unknown; breakMinutes?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Request body must be valid JSON" }, 400);
  }

  if (
    !isClockMinute(body.timeOutMinutes) ||
    (body.breakMinutes !== undefined &&
      (!Number.isInteger(body.breakMinutes) || (body.breakMinutes as number) < 0))
  ) {
    return c.json({ error: "Provide timeOutMinutes (0-1439) and an optional non-negative breakMinutes" }, 400);
  }

  const db = drizzle(c.env.DB);
  const id = c.req.param("id");
  const [existing] = await db
    .select()
    .from(attendanceLogs)
    .where(and(eq(attendanceLogs.id, id), isNull(attendanceLogs.timeOutMinutes)))
    .limit(1);

  if (!existing) {
    return c.json({ error: "Open attendance record not found" }, 404);
  }
  if (body.timeOutMinutes < existing.timeInMinutes) {
    return c.json({ error: "Clock-out time cannot be earlier than clock-in time" }, 400);
  }

  const breakMinutes = body.breakMinutes ?? 60;
  const netMinutes = Math.max(
    0,
    body.timeOutMinutes - existing.timeInMinutes - breakMinutes,
  );
  const totalHoursWorked = Number((netMinutes / 60).toFixed(2));
  const overtimeHours = Number(Math.max(0, totalHoursWorked - 8).toFixed(2));
  const [closedLog] = await db
    .update(attendanceLogs)
    .set({
      timeOutMinutes: body.timeOutMinutes,
      totalHoursWorked,
      overtimeHours,
    })
    .where(and(eq(attendanceLogs.id, id), isNull(attendanceLogs.timeOutMinutes)))
    .returning({ id: attendanceLogs.id });

  if (!closedLog) {
    return c.json({ error: "Attendance record was already clocked out" }, 409);
  }

  return c.json({
    success: true,
    data: { id, timeOutMinutes: body.timeOutMinutes, totalHoursWorked, overtimeHours },
  });
});

attendanceController.get("/company/:companyId", async (c) => {
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

  const logs = await db
    .select()
    .from(attendanceLogs)
    .innerJoin(employees, eq(attendanceLogs.employeeId, employees.id))
    .where(eq(employees.companyId, companyId));
  return c.json({ data: logs });
});

attendanceController.get("/employee/:employeeId", async (c) => {
  const access = await requireAdmin(c);
  if ("response" in access) return access.response;

  const db = drizzle(c.env.DB);
  const employeeId = c.req.param("employeeId");
  const [ownedEmployee] = await db
    .select({ id: employees.id })
    .from(employees)
    .innerJoin(company, eq(employees.companyId, company.id))
    .where(and(eq(employees.id, employeeId), eq(company.adminId, access.userId)))
    .limit(1);
  if (!ownedEmployee) {
    return c.json({ error: "Employee not found" }, 404);
  }

  const dateFilter = c.req.query("date");
  const condition = dateFilter
    ? and(
        eq(attendanceLogs.employeeId, employeeId),
        eq(attendanceLogs.logDate, dateFilter),
      )
    : eq(attendanceLogs.employeeId, employeeId);
  const logs = await db.select().from(attendanceLogs).where(condition);
  return c.json({ data: logs });
});

export default attendanceController;
