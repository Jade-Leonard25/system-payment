import { Hono } from "hono";
import type { D1Database } from "@cloudflare/workers-types";
import { drizzle } from "drizzle-orm/d1";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  attendanceBatches,
  attendanceLogs,
  company,
  employees,
} from "../schema/schema";
import { generateCustomId } from "../customID";
import { requireAdmin } from "./admin-access";
import { appendAuditEvent, auditRequestMetadata } from "../services/audit";
import {
  canonicalizeAttendancePayload,
  getBatchReplayDecision,
  normalizeEmployeeIdentifier,
  normalizePunchTimestamp,
  scanPunches,
  type PunchEvent,
} from "./attendance-scan";

type Bindings = { DB: D1Database };

const attendanceController = new Hono<{ Bindings: Bindings }>();
const SCAN_RULES_VERSION = "attendance-scan-v1-unconfigured-payroll";
const MAX_SCAN_ROWS = 1000;
const MAX_REQUEST_BYTES = 5 * 1024 * 1024;
const INSERT_CHUNK_SIZE = 50;
const scanRequestSchema = z
  .object({
    companyId: z.string().trim().min(1).max(128),
    batchId: z.string().trim().min(1).max(128),
    rows: z.array(z.unknown()).min(1).max(MAX_SCAN_ROWS),
  })
  .strict();

const issueMessages: Record<string, string> = {
  invalid_row: "Row must be an object with employeeId, punchType, and timestamp.",
  invalid_employee_id: "Employee ID must use the xxx-xxx-xxx format.",
  unknown_employee: "Employee ID does not belong to this company.",
  invalid_punch_type: "Punch type must be either 'in' or 'out'.",
  invalid_timestamp: "Timestamp must be a valid ISO-8601 value with a timezone.",
  duplicate_scan: "This employee punch appears more than once in the batch.",
  missing_time_in: "An out punch has no matching earlier in punch.",
  missing_time_out: "An in punch has no matching later out punch.",
  overlapping_punches:
    "Multiple in punches overlap before an out punch; review the punch sequence.",
  invalid_shift_duration: "The matched punches do not form a positive-duration shift.",
  shift_exceeds_24_hours:
    "The matched shift exceeds 24 hours and requires manual review.",
};

function stableStringify(value: unknown): string {
  return canonicalizeAttendancePayload(value);
}

async function hashPayload(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(stableStringify(value)),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function reasonsFor(issues: string[]) {
  return issues.map((code) => ({
    code,
    message: issueMessages[code] ?? "This row requires manual review.",
  }));
}

function insertStatement(
  database: D1Database,
  table: string,
  columns: string[],
  rows: unknown[][],
) {
  const placeholders = `(${columns.map(() => "?").join(",")})`;
  const values = rows.flat();
  const sql = `INSERT INTO "${table}" (${columns.map((column) => `"${column}"`).join(",")}) VALUES ${rows.map(() => placeholders).join(",")}`;
  return database.prepare(sql).bind(...values);
}

function chunkRows<T>(rows: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}

attendanceController.post("/scan-compute", async (c) => {
  const access = await requireAdmin(c);
  if ("response" in access) return access.response;

  const contentLength = Number(c.req.header("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return c.json({ error: "Attendance batches must be 5 MB or smaller" }, 413);
  }

  let requestJson: unknown;
  try {
    const requestText = await c.req.text();
    if (new TextEncoder().encode(requestText).byteLength > MAX_REQUEST_BYTES) {
      return c.json({ error: "Attendance batches must be 5 MB or smaller" }, 413);
    }
    requestJson = JSON.parse(requestText);
  } catch {
    return c.json({ error: "Request body must be valid JSON" }, 400);
  }

  const parsedRequest = scanRequestSchema.safeParse(requestJson);
  if (!parsedRequest.success) {
    return c.json(
      {
        error:
          "Provide companyId, batchId, and between 1 and 1,000 attendance rows.",
        details: parsedRequest.error.flatten(),
      },
      400,
    );
  }

  const { companyId, batchId, rows } = parsedRequest.data;
  const db = drizzle(c.env.DB);
  const [ownedCompany] = await db
    .select({ id: company.id })
    .from(company)
    .where(and(eq(company.id, companyId), eq(company.adminId, access.userId)))
    .limit(1);
  if (!ownedCompany) {
    return c.json({ error: "Company not found" }, 404);
  }

  const payloadHash = await hashPayload(parsedRequest.data);
  const readExistingBatch = () =>
    db
      .select({
        payloadHash: attendanceBatches.payloadHash,
        responseJson: attendanceBatches.responseJson,
      })
      .from(attendanceBatches)
      .where(
        and(
          eq(attendanceBatches.companyId, companyId),
          eq(attendanceBatches.batchId, batchId),
        ),
      )
      .limit(1);

  const [existingBatch] = await readExistingBatch();
  if (existingBatch) {
    if (
      getBatchReplayDecision(existingBatch.payloadHash, payloadHash) ===
      "conflict"
    ) {
      return c.json(
        { error: "This batchId was already used with different attendance data." },
        409,
      );
    }
    return c.json(JSON.parse(existingBatch.responseJson), 200);
  }

  const employeeRows = await db
    .select({ id: employees.id })
    .from(employees)
    .where(eq(employees.companyId, companyId));
  const companyEmployeeIds = new Set(employeeRows.map((employee) => employee.id));
  const rejectedRows: {
    sourceRow: number;
    rawEmployeeIdentifier: string;
    rawPayload: unknown;
    issues: string[];
  }[] = [];
  const normalizedEvents: PunchEvent[] = [];
  const rawRows: {
    sourceRow: number;
    rawEmployeeIdentifier: string;
    employeeId: string | null;
    punchType: "in" | "out" | null;
    timestamp: string | null;
    rawPayload: unknown;
  }[] = [];

  rows.forEach((rawPayload, index) => {
    const sourceRow = index + 1;
    const isRecord =
      typeof rawPayload === "object" &&
      rawPayload !== null &&
      !Array.isArray(rawPayload);
    const rawRow = isRecord
      ? (rawPayload as Record<string, unknown>)
      : {};
    const rawEmployeeIdentifier =
      typeof rawRow.employeeId === "string"
        ? rawRow.employeeId
        : stableStringify(rawRow.employeeId ?? "");
    const employeeIdentifier =
      normalizeEmployeeIdentifier(rawRow.employeeId) ?? "";
    const punchTypeText =
      typeof rawRow.punchType === "string"
        ? rawRow.punchType.trim().toLowerCase()
        : "";
    const punchType =
      punchTypeText === "in" || punchTypeText === "out"
        ? punchTypeText
        : null;
    const timestamp = normalizePunchTimestamp(rawRow.timestamp);
    const issues: string[] = [];

    if (!isRecord) issues.push("invalid_row");
    if (!employeeIdentifier) {
      issues.push("invalid_employee_id");
    }
    if (!punchType) issues.push("invalid_punch_type");
    if (!timestamp) issues.push("invalid_timestamp");
    if (
      !issues.length &&
      !companyEmployeeIds.has(employeeIdentifier)
    ) {
      issues.push("unknown_employee");
    }

    rawRows.push({
      sourceRow,
      rawEmployeeIdentifier,
      employeeId:
        employeeIdentifier && companyEmployeeIds.has(employeeIdentifier)
          ? employeeIdentifier
          : null,
      punchType,
      timestamp,
      rawPayload,
    });

    if (issues.length) {
      rejectedRows.push({
        sourceRow,
        rawEmployeeIdentifier,
        rawPayload,
        issues,
      });
      return;
    }
    if (!punchType || !timestamp) return;

    normalizedEvents.push({
      sourceRow,
      employeeId: employeeIdentifier,
      employeeIdentifier,
      punchType,
      timestamp,
    });
  });

  const scan = scanPunches(normalizedEvents);
  const rejectedSourceRows = new Set(
    rejectedRows.map((row) => row.sourceRow),
  );
  const reviewQueue = [
    ...scan.reviewQueue.map((record) => ({
      kind: "shift",
      ...record,
      reasons: reasonsFor(record.issues),
    })),
    ...rejectedRows.map((row) => ({
      kind: "rejected_row",
      sourceRow: row.sourceRow,
      employeeIdentifier: row.rawEmployeeIdentifier,
      status: "rejected",
      reasons: reasonsFor(row.issues),
    })),
  ];
  const completedRecords = scan.computedRecords.filter(
    (record) => record.status === "computed",
  );
  const response = {
    success: true,
    batch_summary: {
      batch_id: batchId,
      company_id: companyId,
      rows_scanned: rows.length,
      computed_count: completedRecords.length,
      flagged_count: scan.reviewQueue.length,
      rejected_count: rejectedRows.length,
      rules_version: SCAN_RULES_VERSION,
      payroll_calculation: "not_configured",
    },
    computed_records: completedRecords,
    review_queue: reviewQueue,
    rejected_rows: rejectedRows.map((row) => ({
      source_row: row.sourceRow,
      employee_identifier: row.rawEmployeeIdentifier,
      status: "rejected",
      reasons: reasonsFor(row.issues),
    })),
  };

  const internalBatchId = generateCustomId();
  const createdAt = Date.now();
  const rawPersistRows = rawRows.map((row) => {
    const issues = rejectedSourceRows.has(row.sourceRow)
      ? rejectedRows.find((rejected) => rejected.sourceRow === row.sourceRow)?.issues ?? []
      : scan.rowIssues.get(row.sourceRow) ?? [];
    return [
      generateCustomId(),
      internalBatchId,
      companyId,
      row.sourceRow,
      row.rawEmployeeIdentifier,
      row.employeeId,
      row.punchType,
      row.timestamp,
      rejectedSourceRows.has(row.sourceRow)
        ? "rejected"
        : issues.length
          ? "needs_review"
          : "accepted",
      JSON.stringify(issues),
      stableStringify(row.rawPayload),
    ];
  });
  const summaryPersistRows = scan.computedRecords.map((record) => [
    generateCustomId(),
    internalBatchId,
    companyId,
    record.employeeId,
    record.employeeIdentifier,
    `${record.employeeId}:${record.sourceRows.join("-")}`,
    JSON.stringify(record.sourceRows),
    record.timeInAt,
    record.timeOutAt,
    record.elapsedMinutes,
    record.rawNightWindowMinutes,
    record.payroll.regularMinutes,
    record.payroll.lateMinutes,
    record.payroll.undertimeMinutes,
    record.payroll.overtimeMinutes,
    record.payroll.nightDifferentialMinutes,
    record.payroll.grossPayCents,
    record.status,
    JSON.stringify(record.issues),
  ]);
  const auditMetadata = {
    batchId,
    rowsScanned: rows.length,
    computedCount: completedRecords.length,
    flaggedCount: scan.reviewQueue.length,
    rejectedCount: rejectedRows.length,
  };
  const mutations = [
    {
      companyId,
      expectedChanges: 1,
      statement: c.env.DB.prepare(
      `INSERT INTO "attendance_batches" (
        "id", "company_id", "batch_id", "payload_hash", "status",
        "total_rows", "computed_count", "flagged_count", "rejected_count",
        "actor_id", "rules_version", "response_json", "created_at"
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      internalBatchId,
      companyId,
      batchId,
      payloadHash,
      "completed",
      rows.length,
      completedRecords.length,
      scan.reviewQueue.length,
      rejectedRows.length,
      access.userId,
      SCAN_RULES_VERSION,
      JSON.stringify(response),
      createdAt,
      ),
    },
    ...chunkRows(rawPersistRows, INSERT_CHUNK_SIZE).map((chunk) => ({
      companyId,
      expectedChanges: chunk.length,
      statement: insertStatement(
        c.env.DB,
        "raw_attendance_logs",
        [
          "id",
          "batch_id",
          "company_id",
          "source_row",
          "raw_employee_identifier",
          "employee_id",
          "punch_type",
          "punched_at",
          "status",
          "issues_json",
          "raw_payload_json",
        ],
        chunk,
      ),
    })),
    ...chunkRows(summaryPersistRows, INSERT_CHUNK_SIZE).map((chunk) => ({
      companyId,
      expectedChanges: chunk.length,
      statement: insertStatement(
        c.env.DB,
        "computed_shift_summaries",
        [
          "id",
          "batch_id",
          "company_id",
          "employee_id",
          "employee_identifier",
          "source_key",
          "source_rows_json",
          "time_in_at",
          "time_out_at",
          "elapsed_minutes",
          "raw_night_window_minutes",
          "regular_minutes",
          "late_minutes",
          "undertime_minutes",
          "overtime_minutes",
          "night_differential_minutes",
          "gross_pay_cents",
          "status",
          "issues_json",
        ],
        chunk,
      ),
    })),
    {
      companyId,
      expectedChanges: 1,
      statement: c.env.DB.prepare(
      `INSERT INTO "audit_logs" (
      "id", "company_id", "actor_id", "batch_id", "action",
        "rules_version", "occurred_at", "metadata_json"
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      generateCustomId(),
      companyId,
      access.userId,
      internalBatchId,
      "attendance_batch.scan_compute",
      SCAN_RULES_VERSION,
      createdAt,
      JSON.stringify(auditMetadata),
      ),
    },
  ];

  try {
    await appendAuditEvent(
      c.env.DB,
      {
        companyId,
        actorId: access.userId,
        ...auditRequestMetadata(c.req.raw.headers),
        action: "attendance_batch.scan_compute",
        resourceType: "attendance_batch",
        resourceId: batchId,
        after: auditMetadata,
      },
      mutations,
    );
  } catch (persistenceError) {
    const [concurrentBatch] = await readExistingBatch();
    if (concurrentBatch) {
      if (
        getBatchReplayDecision(concurrentBatch.payloadHash, payloadHash) ===
        "conflict"
      ) {
        return c.json(
          { error: "This batchId was already used with different attendance data." },
          409,
        );
      }
      return c.json(JSON.parse(concurrentBatch.responseJson), 200);
    }
    throw persistenceError;
  }

  return c.json(response, 201);
});

function isClockMinute(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === "number" && value >= 0 && value < 1440;
}

function isLogDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    (() => {
      const parsed = new Date(`${value}T00:00:00Z`);
      return (
        !Number.isNaN(parsed.getTime()) &&
        parsed.toISOString().slice(0, 10) === value
      );
    })()
  );
}

attendanceController.post("/admin/clock-in", async (c) => {
  const access = await requireAdmin(c);
  if ("response" in access) return access.response;

  let body: {
    employeeId?: unknown;
    companyId?: unknown;
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
    typeof body.companyId !== "string" ||
    !body.companyId ||
    !isLogDate(body.logDate) ||
    !isClockMinute(body.timeInMinutes) ||
    (body.shiftStartMinutes !== undefined &&
      !isClockMinute(body.shiftStartMinutes))
  ) {
    return c.json(
      {
        error:
          "Provide employeeId, companyId, logDate (YYYY-MM-DD), and timeInMinutes (0-1439)",
      },
      400,
    );
  }

  const db = drizzle(c.env.DB);
  const [employee] = await db
    .select({ id: employees.id })
    .from(employees)
    .innerJoin(company, eq(employees.companyId, company.id))
    .where(
      and(
        eq(employees.id, body.employeeId),
        eq(employees.companyId, body.companyId),
        eq(company.adminId, access.userId),
        eq(employees.employmentStatus, "ACTIVE"),
      ),
    )
    .limit(1);
  if (!employee) {
    return c.json({ error: "Active employee not found in your company" }, 404);
  }

  const [openLog] = await db
    .select({ id: attendanceLogs.id })
    .from(attendanceLogs)
    .where(
      and(
        eq(attendanceLogs.employeeId, body.employeeId),
        isNull(attendanceLogs.timeOutMinutes),
      ),
    )
    .limit(1);
  if (openLog) {
    return c.json(
      { error: "Employee already has an open attendance record", data: openLog },
      409,
    );
  }

  const shiftStartMinutes = body.shiftStartMinutes ?? 480;
  const newLog = {
    id: generateCustomId(),
    employeeId: body.employeeId,
    logDate: body.logDate,
    timeInMinutes: body.timeInMinutes,
    timeOutMinutes: null,
    totalHoursWorked: 0,
    overtimeHours: 0,
    lateMinutes: Math.max(0, body.timeInMinutes - shiftStartMinutes),
    createdAt: new Date(),
  };

  const createdAt = Math.floor(newLog.createdAt.getTime() / 1000);
  const insertStatement = c.env.DB.prepare(
    `INSERT INTO attendance_logs (
       id, employee_id, log_date, time_in_minutes, time_out_minutes,
       total_hours_worked, overtime_hours, late_minutes, created_at
     )
     SELECT ?, ?, ?, ?, NULL, ?, ?, ?, ?
     WHERE EXISTS (
       SELECT 1 FROM employees
       WHERE id = ? AND company_id = ?
     )`,
  ).bind(
    newLog.id,
    newLog.employeeId,
    newLog.logDate,
    newLog.timeInMinutes,
    newLog.totalHoursWorked,
    newLog.overtimeHours,
    newLog.lateMinutes,
    createdAt,
    newLog.employeeId,
    body.companyId,
  );
  await appendAuditEvent(c.env.DB, {
    companyId: body.companyId,
    actorId: access.userId,
    ...auditRequestMetadata(c.req.raw.headers),
    action: "attendance.clock_in",
    resourceType: "attendance_log",
    resourceId: newLog.id,
    after: newLog,
  }, [{ companyId: body.companyId, statement: insertStatement, expectedChanges: 1 }]);
  return c.json({ success: true, data: newLog }, 201);
});

attendanceController.put("/admin/clock-out/:id", async (c) => {
  const access = await requireAdmin(c);
  if ("response" in access) return access.response;

  let body: { timeOutMinutes?: unknown; breakMinutes?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Request body must be valid JSON" }, 400);
  }

  if (
    !isClockMinute(body.timeOutMinutes) ||
    (body.breakMinutes !== undefined &&
      (!Number.isInteger(body.breakMinutes) ||
        typeof body.breakMinutes !== "number" ||
        body.breakMinutes < 0))
  ) {
    return c.json(
      {
        error:
          "Provide timeOutMinutes (0-1439) and an optional non-negative breakMinutes",
      },
      400,
    );
  }

  const db = drizzle(c.env.DB);
  const id = c.req.param("id");
  const [existing] = await db
    .select({
      id: attendanceLogs.id,
      timeInMinutes: attendanceLogs.timeInMinutes,
      logDate: attendanceLogs.logDate,
      timeOutMinutes: attendanceLogs.timeOutMinutes,
      totalHoursWorked: attendanceLogs.totalHoursWorked,
      overtimeHours: attendanceLogs.overtimeHours,
      lateMinutes: attendanceLogs.lateMinutes,
      employeeId: attendanceLogs.employeeId,
      companyId: employees.companyId,
    })
    .from(attendanceLogs)
    .innerJoin(employees, eq(attendanceLogs.employeeId, employees.id))
    .innerJoin(company, eq(employees.companyId, company.id))
    .where(
      and(
        eq(attendanceLogs.id, id),
        eq(company.adminId, access.userId),
        isNull(attendanceLogs.timeOutMinutes),
      ),
    )
    .limit(1);

  if (!existing) {
    return c.json({ error: "Open attendance record not found" }, 404);
  }

  const elapsedMinutes =
    body.timeOutMinutes >= existing.timeInMinutes
      ? body.timeOutMinutes - existing.timeInMinutes
      : body.timeOutMinutes + 1440 - existing.timeInMinutes;
  const breakMinutes = body.breakMinutes ?? 60;
  const netMinutes = Math.max(0, elapsedMinutes - breakMinutes);
  const totalHoursWorked = Number((netMinutes / 60).toFixed(2));
  const overtimeHours = Number(Math.max(0, totalHoursWorked - 8).toFixed(2));
  await appendAuditEvent(c.env.DB, {
    companyId: existing.companyId,
    actorId: access.userId,
    ...auditRequestMetadata(c.req.raw.headers),
    action: "attendance.clock_out",
    resourceType: "attendance_log",
    resourceId: id,
    before: {
      id: existing.id,
      employeeId: existing.employeeId,
      logDate: existing.logDate,
      timeInMinutes: existing.timeInMinutes,
      timeOutMinutes: existing.timeOutMinutes,
      totalHoursWorked: existing.totalHoursWorked,
      overtimeHours: existing.overtimeHours,
      lateMinutes: existing.lateMinutes,
    },
    after: {
      id: existing.id,
      employeeId: existing.employeeId,
      logDate: existing.logDate,
      timeInMinutes: existing.timeInMinutes,
      timeOutMinutes: body.timeOutMinutes,
      totalHoursWorked,
      overtimeHours,
      lateMinutes: existing.lateMinutes,
    },
  }, [{
    companyId: existing.companyId,
    statement: c.env.DB.prepare(
      `UPDATE attendance_logs
       SET time_out_minutes = ?, total_hours_worked = ?, overtime_hours = ?
       WHERE id = ? AND time_out_minutes IS NULL
         AND EXISTS (
           SELECT 1 FROM employees
           WHERE employees.id = attendance_logs.employee_id
             AND employees.company_id = ?
         )`,
    ).bind(
      body.timeOutMinutes,
      totalHoursWorked,
      overtimeHours,
      id,
      existing.companyId,
    ),
    expectedChanges: 1,
  }]);
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
