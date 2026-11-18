import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq, and } from "drizzle-orm";
import { attendanceLogs } from "../schema/schema";
import { generateCustomId } from "../customID";

type Bindings = { DB: D1Database };
const attendanceController = new Hono<{ Bindings: Bindings }>();

// Clock In (default shift start: 08:00 AM = 480 minutes)
attendanceController.post("/clock-in", async (c) => {
  const db = drizzle(c.env.DB);
  const {
    employeeId,
    logDate,
    timeInMinutes,
    shiftStartMinutes = 480,
  } = await c.req.json();

  const lateMinutes = Math.max(0, timeInMinutes - shiftStartMinutes);

  const newLog = {
    id: generateCustomId(),
    employeeId,
    logDate,
    timeInMinutes,
    timeOutMinutes: null,
    totalHoursWorked: 0.0,
    overtimeHours: 0.0,
    lateMinutes,
    createdAt: new Date(),
  };

  await db.insert(attendanceLogs).values(newLog);
  return c.json({ success: true, data: newLog }, 201);
});

// Clock Out & Auto-Calculate Hours
attendanceController.put("/clock-out/:id", async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param("id");
  const { timeOutMinutes, breakMinutes = 60 } = await c.req.json();

  const [existing] = await db
    .select()
    .from(attendanceLogs)
    .where(eq(attendanceLogs.id, id));

  if (!existing) {
    return c.json({ error: "Attendance log not found" }, 404);
  }

  const netMinutes = Math.max(
    0,
    timeOutMinutes - existing.timeInMinutes - breakMinutes,
  );
  const totalHoursWorked = Number((netMinutes / 60).toFixed(2));
  const overtimeHours = Number(Math.max(0, totalHoursWorked - 8).toFixed(2));

  await db
    .update(attendanceLogs)
    .set({
      timeOutMinutes,
      totalHoursWorked,
      overtimeHours,
    })
    .where(eq(attendanceLogs.id, id));

  return c.json({
    success: true,
    data: { id, timeOutMinutes, totalHoursWorked, overtimeHours },
  });
});

// Get attendance logs for a specific employee
attendanceController.get("/employee/:employeeId", async (c) => {
  const db = drizzle(c.env.DB);
  const employeeId = c.req.param("employeeId");
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
