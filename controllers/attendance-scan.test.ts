import { describe, expect, test } from "bun:test";
import {
  calculateRawNightWindowMinutes,
  canonicalizeAttendancePayload,
  getBatchReplayDecision,
  normalizeEmployeeIdentifier,
  normalizePunchTimestamp,
  scanPunches,
} from "./attendance-scan";

const punch = (
  sourceRow: number,
  punchType: "in" | "out",
  timestamp: string,
  employeeId = "abc-def-123",
) => ({
  sourceRow,
  employeeId,
  employeeIdentifier: employeeId,
  punchType,
  timestamp,
});

describe("attendance scan", () => {
  test("pairs a normal shift and reports whole elapsed minutes", () => {
    const result = scanPunches([
      punch(1, "in", "2026-11-21T08:00:00+08:00"),
      punch(2, "out", "2026-11-21T17:00:00+08:00"),
    ]);

    expect(result.computedRecords).toHaveLength(1);
    expect(result.computedRecords[0]).toMatchObject({
      elapsedMinutes: 540,
      rawNightWindowMinutes: 0,
      status: "computed",
      payroll: {
        regularMinutes: null,
        lateMinutes: null,
        undertimeMinutes: null,
        overtimeMinutes: null,
        nightDifferentialMinutes: null,
        grossPayCents: null,
        status: "not_configured",
      },
    });
    expect(result.reviewQueue).toHaveLength(0);
  });

  test("pairs overnight punches and counts Philippine night-window minutes", () => {
    const result = scanPunches([
      punch(1, "in", "2026-11-21T21:00:00+08:00"),
      punch(2, "out", "2026-11-22T07:00:00+08:00"),
    ]);

    expect(result.computedRecords[0]).toMatchObject({
      elapsedMinutes: 600,
      rawNightWindowMinutes: 480,
      status: "computed",
    });
  });

  test("flags an in punch without an out punch for review", () => {
    const result = scanPunches([
      punch(1, "in", "2026-11-21T08:00:00+08:00"),
    ]);

    expect(result.reviewQueue[0]?.issues).toContain("missing_time_out");
    expect(result.rowIssues.get(1)).toContain("missing_time_out");
  });

  test("flags an out punch without an in punch for review", () => {
    const result = scanPunches([
      punch(1, "out", "2026-11-21T17:00:00+08:00"),
    ]);

    expect(result.reviewQueue[0]?.issues).toContain("missing_time_in");
  });

  test("flags duplicate scans and overlapping in punches", () => {
    const duplicate = scanPunches([
      punch(1, "in", "2026-11-21T08:00:00+08:00"),
      punch(2, "in", "2026-11-21T08:00:00+08:00"),
      punch(3, "out", "2026-11-21T17:00:00+08:00"),
    ]);

    expect(duplicate.reviewQueue.some((record) =>
      record.issues.includes("duplicate_scan"),
    )).toBe(true);
    expect(duplicate.reviewQueue.some((record) =>
      record.issues.includes("overlapping_punches"),
    )).toBe(true);
  });

  test("calculates night window for an ISO timestamp with UTC offset", () => {
    expect(
      calculateRawNightWindowMinutes(
        "2026-11-21T14:00:00Z",
        "2026-11-21T22:00:00Z",
      ),
    ).toBe(480);
  });

  test("normalizes employee IDs and timezone-qualified timestamps", () => {
    expect(normalizeEmployeeIdentifier(" ABC-DEF-123 ")).toBe("abc-def-123");
    expect(normalizeEmployeeIdentifier("employee-123")).toBeNull();
    expect(normalizePunchTimestamp("2026-11-21T08:00:00+08:00")).toBe(
      "2026-11-21T00:00:00.000Z",
    );
    expect(normalizePunchTimestamp("2026-02-30T08:00:00+08:00")).toBeNull();
    expect(normalizePunchTimestamp("2026-11-21T08:00:00")).toBeNull();
  });

  test("treats a repeated batch hash as an idempotent replay", () => {
    const firstPayload = canonicalizeAttendancePayload({
      companyId: "company-1",
      batchId: "batch-1",
      rows: [{ employeeId: "abc-def-123", punchType: "in" }],
    });
    const retryPayload = canonicalizeAttendancePayload({
      rows: [{ punchType: "in", employeeId: "abc-def-123" }],
      batchId: "batch-1",
      companyId: "company-1",
    });

    expect(firstPayload).toBe(retryPayload);
    expect(getBatchReplayDecision("same-hash", "same-hash")).toBe("replay");
    expect(getBatchReplayDecision("old-hash", "new-hash")).toBe("conflict");
    expect(getBatchReplayDecision(null, "new-hash")).toBe("new");
  });
});
