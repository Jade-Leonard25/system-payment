# Attendance Scan-and-Compute Pipeline

## Current scope

The backend accepts a JSON batch of raw employee punch events, verifies that
the caller owns the company, normalizes rows, matches chronological in/out
punches, saves the batch and results atomically, and records an audit event.
The endpoint is:

```text
POST /api/attendance/scan-compute
```

See [API-ENDPOINTS.md](./API-ENDPOINTS.md) for descriptions of every other
currently mounted API endpoint.

This version computes elapsed wall-clock minutes and the portion of the raw
interval inside the Philippine 22:00–06:00 night window. It does **not** make
payroll decisions. Regular, late, undertime, overtime, official night
differential, gross pay, statutory deductions, holidays, rest days, and unpaid
break deductions remain `null` until company schedules and approved rule
tables are configured. `elapsed_minutes` includes the full punch interval; it
does not guess an unpaid break.

![Attendance scan-and-compute flow](../system-payment/wev/web/src/assets/gemini-svg.svg)

## Request contract

The caller must be an authenticated administrator who owns `companyId`.
`employeeId` is the employee's existing backend ID in the `xxx-xxx-xxx`
format. Timestamps must be ISO-8601 strings with an explicit timezone; they
are normalized to UTC before storage.

```json
{
  "companyId": "company-id",
  "batchId": "attendance-import-2026-11-21-001",
  "rows": [
    {
      "employeeId": "abc-def-123",
      "punchType": "in",
      "timestamp": "2026-11-21T21:00:00+08:00"
    },
    {
      "employeeId": "abc-def-123",
      "punchType": "out",
      "timestamp": "2026-11-22T07:00:00+08:00"
    }
  ]
}
```

There must be 1–1,000 rows, and the request body is limited to 5 MB. CSV/XLSX
clients should parse their file into this JSON shape; parsing is not performed
by the API.

## Processing behavior

1. The endpoint validates the request envelope, administrator, and company
   ownership before processing any employee identifiers.
2. Each row is normalized independently. Malformed rows, invalid employee IDs,
   unsupported punch types, invalid timestamps, and employees outside the
   company are stored as rejected rows with issue codes and messages. Valid
   rows in the same batch continue.
3. Valid punches are grouped by employee and sorted by normalized timestamp.
   An `in` is paired with the next chronological `out`. An interval may cross
   midnight. Unmatched punches, duplicate scans, overlapping `in` punches,
   zero-duration shifts, and shifts longer than 24 hours are routed to review.
   The scanner does not silently discard ambiguous events.
4. The response, batch row, raw rows, computed shift summaries, and audit
   record are committed in one Cloudflare D1 `batch()` operation. A failed
   statement rolls the batch back.
5. A repeated `companyId` + `batchId` with the same canonical SHA-256 payload
   returns the saved response without inserting again (HTTP 200). Reusing that
   batch ID with different content returns HTTP 409. Use a new batch ID for a
   new import.

The response contains `batch_summary`, `computed_records`, `review_queue`, and
`rejected_rows`. `computed_records` contains only complete, unambiguous punch
pairs. `review_queue` contains flagged pairs/unmatched punches and rejected
input rows. A complete record includes `elapsedMinutes` and
`rawNightWindowMinutes`; its `payroll` fields are explicitly null with status
`not_configured`.

## Persistence

- `attendance_batches`: tenant-scoped batch ID, payload hash, counts, actor,
  rules version, and saved response for idempotent retries.
- `raw_attendance_logs`: original row JSON and normalized employee, punch,
  timestamp, status, and issue data.
- `computed_shift_summaries`: paired/unmatched shift inputs and minute
  calculations; unconfigured payroll values remain null.
- `audit_logs`: actor, company, batch, action, timestamp, rules version, and
  batch counts. Database triggers reject audit-row updates and deletes.

Batch IDs are unique per company. Raw source row numbers and computed source
keys are unique within a batch. Foreign keys and the company ownership check
keep records tenant-scoped.

## Local verification

From `system-management`:

```sh
bun test controllers/attendance-scan.test.ts controllers/attendance-migration.test.ts
bun run typecheck
bun run dev
```

Before calling the local API against a local D1 database, apply the new local
migration:

```sh
bunx wrangler d1 migrations apply system-payroll --local
```

Then send a request to `http://localhost:8787/api/attendance/scan-compute`
with the current admin session credentials and an owned company/employee ID.
The migration is additive. Do not use `--remote` for local verification.

### Example request

```sh
curl -X POST http://localhost:8787/api/attendance/scan-compute \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <admin-token>' \
  --data '{
    "companyId": "<owned-company-id>",
    "batchId": "local-check-001",
    "rows": [
      {"employeeId":"<employee-id>","punchType":"in","timestamp":"2026-11-21T08:00:00+08:00"},
      {"employeeId":"<employee-id>","punchType":"out","timestamp":"2026-11-21T17:00:00+08:00"}
    ]
  }'
```

Repeat the exact request to verify idempotency (HTTP 200). Change a row while
keeping the same batch ID to verify conflict handling (HTTP 409). Use an
unknown employee ID or a punch without its matching pair to verify rejection
and review behavior.

## Rule-engine follow-up

Before monetary payroll calculations are enabled, configure and version
company-level shift schedules, grace periods, break policies, overtime and
undertime rules, rest days, the Philippine holiday calendar, approved
rounding rules, and effective-dated statutory contribution/tax tables. The
current persisted employee cent rates are not enough to infer these policies.
