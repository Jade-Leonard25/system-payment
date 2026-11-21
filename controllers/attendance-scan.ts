export type PunchEvent = {
  sourceRow: number;
  employeeId: string;
  employeeIdentifier: string;
  punchType: "in" | "out";
  timestamp: string;
  issues?: string[];
};

export type ComputedShift = {
  employeeId: string;
  employeeIdentifier: string;
  sourceRows: number[];
  timeInAt: string | null;
  timeOutAt: string | null;
  elapsedMinutes: number | null;
  rawNightWindowMinutes: number | null;
  status: "computed" | "needs_review";
  issues: string[];
  payroll: {
    regularMinutes: null;
    lateMinutes: null;
    undertimeMinutes: null;
    overtimeMinutes: null;
    nightDifferentialMinutes: null;
    grossPayCents: null;
    status: "not_configured";
  };
};

export type AttendanceScanResult = {
  computedRecords: ComputedShift[];
  reviewQueue: ComputedShift[];
  rowIssues: Map<number, string[]>;
};

export function canonicalizeAttendancePayload(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeAttendancePayload(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalizeAttendancePayload(record[key])}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function getBatchReplayDecision(
  existingPayloadHash: string | null,
  requestPayloadHash: string,
): "new" | "replay" | "conflict" {
  if (existingPayloadHash === null) return "new";
  return existingPayloadHash === requestPayloadHash ? "replay" : "conflict";
}

const MINUTES_PER_DAY = 24 * 60;
const MAX_SHIFT_MINUTES = MINUTES_PER_DAY;
const PHILIPPINES_UTC_OFFSET_MINUTES = 8 * 60;
const EMPLOYEE_ID_PATTERN = /^[a-z0-9]{3}(?:-[a-z0-9]{3}){2}$/i;
const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/i;

export function normalizeEmployeeIdentifier(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalizedIdentifier = value.trim().toLowerCase();
  return EMPLOYEE_ID_PATTERN.test(normalizedIdentifier)
    ? normalizedIdentifier
    : null;
}

export function normalizePunchTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || !ISO_TIMESTAMP_PATTERN.test(value.trim())) {
    return null;
  }
  const normalizedValue = value.trim();
  const inputDate = normalizedValue.slice(0, 10);
  const date = new Date(`${inputDate}T00:00:00Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== inputDate
  ) {
    return null;
  }
  const timestamp = new Date(normalizedValue);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
}

function uniqueIssues(issues: string[]) {
  return [...new Set(issues)];
}

export function calculateRawNightWindowMinutes(
  timeInAt: string,
  timeOutAt: string,
): number {
  const start = Date.parse(timeInAt);
  const end = Date.parse(timeOutAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return 0;
  }

  const localStart = Math.floor(
    (start + PHILIPPINES_UTC_OFFSET_MINUTES * 60_000) / 60_000,
  );
  const localEnd = Math.floor(
    (end + PHILIPPINES_UTC_OFFSET_MINUTES * 60_000) / 60_000,
  );
  let nightMinutes = 0;

  for (
    let day = Math.floor(localStart / MINUTES_PER_DAY);
    day <= Math.floor((localEnd - 1) / MINUTES_PER_DAY);
    day += 1
  ) {
    const dayStart = day * MINUTES_PER_DAY;
    const nightIntervals = [
      [dayStart, dayStart + 6 * 60],
      [dayStart + 22 * 60, dayStart + MINUTES_PER_DAY],
    ];
    for (const interval of nightIntervals) {
      const intervalStart = interval[0];
      const intervalEnd = interval[1];
      if (intervalStart === undefined || intervalEnd === undefined) continue;
      nightMinutes += Math.max(
        0,
        Math.min(localEnd, intervalEnd) - Math.max(localStart, intervalStart),
      );
    }
  }

  return nightMinutes;
}

function createShift(
  employeeId: string,
  employeeIdentifier: string,
  sourceRows: number[],
  timeInAt: string | null,
  timeOutAt: string | null,
  elapsedMinutes: number | null,
  issues: string[],
): ComputedShift {
  const normalizedIssues = uniqueIssues(issues);
  return {
    employeeId,
    employeeIdentifier,
    sourceRows,
    timeInAt,
    timeOutAt,
    elapsedMinutes,
    rawNightWindowMinutes:
      timeInAt && timeOutAt
        ? calculateRawNightWindowMinutes(timeInAt, timeOutAt)
        : null,
    status: normalizedIssues.length ? "needs_review" : "computed",
    issues: normalizedIssues,
    payroll: {
      regularMinutes: null,
      lateMinutes: null,
      undertimeMinutes: null,
      overtimeMinutes: null,
      nightDifferentialMinutes: null,
      grossPayCents: null,
      status: "not_configured",
    },
  };
}

export function scanPunches(events: PunchEvent[]): AttendanceScanResult {
  const groupedEvents = new Map<string, PunchEvent[]>();
  const duplicateKeys = new Set<string>();
  const seenPunches = new Map<string, number>();

  for (const event of events) {
    const key = `${event.employeeId}\u0000${event.punchType}\u0000${event.timestamp}`;
    if (seenPunches.has(key)) {
      duplicateKeys.add(key);
    } else {
      seenPunches.set(key, event.sourceRow);
    }

    const employeeEvents = groupedEvents.get(event.employeeId) ?? [];
    employeeEvents.push(event);
    groupedEvents.set(event.employeeId, employeeEvents);
  }

  const computedRecords: ComputedShift[] = [];
  const rowIssues = new Map<number, string[]>();
  const addRowIssues = (sourceRow: number, issues: string[]) => {
    const currentIssues = rowIssues.get(sourceRow) ?? [];
    rowIssues.set(sourceRow, uniqueIssues([...currentIssues, ...issues]));
  };

  for (const employeeEvents of groupedEvents.values()) {
    employeeEvents.sort(
      (left, right) =>
        Date.parse(left.timestamp) - Date.parse(right.timestamp) ||
        left.sourceRow - right.sourceRow,
    );

    let openPunch: PunchEvent | null = null;
    for (const event of employeeEvents) {
      const eventKey = `${event.employeeId}\u0000${event.punchType}\u0000${event.timestamp}`;
      const eventIssues = [
        ...(event.issues ?? []),
        ...(duplicateKeys.has(eventKey) ? ["duplicate_scan"] : []),
      ];

      if (event.punchType === "in") {
        if (openPunch) {
          const overlappingIssues = ["missing_time_out", "overlapping_punches"];
          const incompleteShift = createShift(
            openPunch.employeeId,
            openPunch.employeeIdentifier,
            [openPunch.sourceRow],
            openPunch.timestamp,
            null,
            null,
            [...(openPunch.issues ?? []), ...overlappingIssues],
          );
          addRowIssues(openPunch.sourceRow, incompleteShift.issues);
          computedRecords.push(incompleteShift);
          eventIssues.push("overlapping_punches");
        }
        openPunch = { ...event, issues: eventIssues };
        continue;
      }

      if (!openPunch) {
        const issues = [...eventIssues, "missing_time_in"];
        addRowIssues(event.sourceRow, issues);
        computedRecords.push(
          createShift(
            event.employeeId,
            event.employeeIdentifier,
            [event.sourceRow],
            null,
            event.timestamp,
            null,
            issues,
          ),
        );
        continue;
      }

      const elapsedMinutes = Math.floor(
        (Date.parse(event.timestamp) - Date.parse(openPunch.timestamp)) / 60_000,
      );
      const issues = [...(openPunch.issues ?? []), ...eventIssues];
      if (elapsedMinutes <= 0) issues.push("invalid_shift_duration");
      if (elapsedMinutes > MAX_SHIFT_MINUTES) issues.push("shift_exceeds_24_hours");
      const shift = createShift(
        event.employeeId,
        event.employeeIdentifier,
        [openPunch.sourceRow, event.sourceRow],
        openPunch.timestamp,
        event.timestamp,
        elapsedMinutes,
        issues,
      );
      computedRecords.push(shift);
      if (shift.issues.length) {
        addRowIssues(openPunch.sourceRow, shift.issues);
        addRowIssues(event.sourceRow, shift.issues);
      }
      openPunch = null;
    }

    if (openPunch) {
      const issues = [...(openPunch.issues ?? []), "missing_time_out"];
      addRowIssues(openPunch.sourceRow, issues);
      computedRecords.push(
        createShift(
          openPunch.employeeId,
          openPunch.employeeIdentifier,
          [openPunch.sourceRow],
          openPunch.timestamp,
          null,
          null,
          issues,
        ),
      );
    }
  }

  computedRecords.sort(
    (left, right) =>
      (left.sourceRows[0] ?? 0) - (right.sourceRows[0] ?? 0),
  );
  return {
    computedRecords,
    reviewQueue: computedRecords.filter((record) => record.status === "needs_review"),
    rowIssues,
  };
}
