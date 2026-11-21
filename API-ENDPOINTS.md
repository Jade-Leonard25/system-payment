# API Endpoint Reference

This document describes the HTTP endpoints currently mounted by the
System Payroll API. Unless otherwise noted, request and response bodies use
JSON. The examples use `http://localhost:8787`; replace it with the deployed
API origin when appropriate.

## Authentication and access

- **Administrator endpoints** require a valid Better Auth session and the
  signed-in user's `role` must be `admin`. Send the session cookie or a bearer
  token accepted by the configured Better Auth bearer plugin.
- **Public endpoints** are called without an administrator session.
- Company and employee operations check that the requested records belong to
  the signed-in administrator. Do not treat an ID supplied by the client as
  proof of ownership.
- Unless a route says otherwise, an unauthenticated administrator endpoint
  returns `401`; an authenticated non-admin generally receives `403`.

## Health

### `GET /`

Public liveness endpoint.

**Response**

```json
{ "status": "ok", "service": "System Payroll API" }
```

## Authentication

### `GET|POST /api/auth/*`

Requests under this prefix are passed through to Better Auth. The application
enables email/password authentication and the bearer plugin; Better Auth owns
the request schemas, status codes, cookie/session behavior, and any additional
routes provided by the installed version.

Common operations include:

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/auth/sign-up/email` | Create an account with `name`, `email`, and `password`. The minimum password length is six characters. Public administrator registration should use the product-key registration endpoint instead. |
| `POST` | `/api/auth/sign-in/email` | Authenticate with `email` and `password`; returns a session according to Better Auth's configured cookie/bearer behavior. |
| `POST` | `/api/auth/sign-out` | End the current session. |
| `GET` | `/api/auth/get-session` | Return the current session and user when credentials are present. |

These are Better Auth routes, not custom Hono handlers. Refer to the installed
Better Auth version for its complete route catalog and exact response schemas.

## Companies

Base path: `/api/companies`. All listed routes require an administrator session.

### `POST /api/companies`

Create a company owned by the signed-in administrator.

**JSON body**

The handler uses `name` and `taxId` from the body without additional schema
validation. Other accepted fields are `legalName`, `address`, `contactNumber`,
`email`, `companyLogo`, `rdoCode`, `employerSSS`, `employerPhilHealth`,
`employerPagIbig`, `compTaxReduct`, and `compPermit`. Optional values default
to `null`, an empty logo string, or zero tax reduction as applicable.

**Success:** `201 { "success": true, "data": <company> }`.

### `GET /api/companies/admin/:adminId`

List companies belonging to the signed-in administrator. The path `adminId`
must equal the current user's ID; another user's ID returns `403`.

**Success:** `200 { "data": [<company>, ...] }`.

### `PUT /api/companies/:id`

Update the owned company identified by `id`. Include only fields to change:
`name`, `legalName`, `address`, `contactNumber`, `email`, `companyLogo`,
`taxId`, `rdoCode`, `employerSSS`, `employerPhilHealth`, `employerPagIbig`,
`compTaxReduct`, or `compPermit`. String fields that support clearing accept
`null`; `compTaxReduct` accepts a number.

**Success:** `200 { "success": true }`. Returns `404` if the company is not
owned by the caller or does not exist.

## Employees

Base path: `/api/employees`. All routes require an administrator session.

### `POST /api/employees`

Create one employee. `companyId` is required and must identify a company
owned by the caller. The handler maps these fields from the JSON body:
`firstname`, `middlename`, `lastname`, `extname`, `birthdate`, `gender`,
`civilStatus`, `email`, `phone`, `address`, `employmentType`,
`employmentStatus`, `dateHired`, `dateResigned`, `department`, `position`,
`socialSecurityNumber`, `pagIbigID`, `philhealth`, `taxIdNumber`,
`baseSalaryCents`, `dailyRateCents`, `hourlyRateCents`, `deductSSS`,
`deductPhilHealth`, `deductPagIbig`, and `deductTax`. The handler does not
perform a field-by-field schema validation pass. Defaults are `null` for
optional personal/job fields, `SINGLE` for `civilStatus`, `REGULAR` for
`employmentType`, `ACTIVE` for `employmentStatus`, and `true` for each
deduction flag.

**Success:** `201 { "success": true, "data": <employee> }`. Returns `400` if
`companyId` is missing and `404` if the company is not found or not owned.

### `GET /api/employees/company/:companyId`

List employees in an owned company.

**Success:** `200 { "data": [<employee>, ...] }`. Returns `404` if the company
is not found or not owned.

### `PUT /api/employees/batch-rates`

Update salary rates for multiple employees in one D1 batch operation.

**JSON body**

```json
{
  "updates": [
    {
      "id": "employee-id",
      "baseSalaryCents": 5000000,
      "dailyRateCents": 200000,
      "hourlyRateCents": 25000
    }
  ]
}
```

Every employee must belong to a company owned by the caller. Values are stored
in integer cents.

**Success:** `200 { "success": true, "updatedCount": 1 }`. Returns `400` for
an empty update list or invalid IDs and `404` if any employee is not found or
not owned.

### `DELETE /api/employees/:id`

Delete an employee owned by the caller. This is a delete operation, not an
archive operation.

**Success:** `200 { "success": true }`. Returns `404` if the employee is not
found or not owned.

## Attendance

Base path: `/api/attendance`. All routes require an administrator session.

### `POST /api/attendance/scan-compute`

Validate, normalize, pair, and persist a raw attendance batch. The full request
contract, response fields, issue codes, idempotency behavior, and local
migration instructions are documented in
[ATTENDANCE-SCAN-PIPELINE.md](./ATTENDANCE-SCAN-PIPELINE.md).

Briefly, the JSON body contains `companyId`, `batchId`, and 1–1,000 `rows`.
Each row contains `employeeId`, `punchType` (`in` or `out`), and a
timezone-qualified ISO-8601 `timestamp`. The company must be owned by the
caller. Payloads are limited to 5 MB.

**Success:** `200` with the saved response for a repeated identical batch, or
`201` for a new batch. Returns `400` for malformed JSON/envelope, `401` or
`403` for missing/non-admin session, `404` for an unowned company, `409` when
a previously used `batchId` is submitted with different content, and `413`
when the body exceeds 5 MB. Invalid individual rows are represented in the
response rather than aborting the whole batch.

### `POST /api/attendance/admin/clock-in`

Create an open attendance record for an active employee in an owned company.

**JSON body**

```json
{
  "employeeId": "employee-id",
  "companyId": "company-id",
  "logDate": "2026-11-21",
  "timeInMinutes": 480,
  "shiftStartMinutes": 480
}
```

`logDate` must be a real `YYYY-MM-DD` date. `timeInMinutes` and optional
`shiftStartMinutes` are integers from `0` to `1439`. If no shift start is
provided, late time is calculated against minute `480` (08:00).

**Success:** `201 { "success": true, "data": <attendance-log> }`. Returns
`400` for invalid input, `404` if the active employee is not in the owned
company, and `409` if the employee already has an open attendance record.

### `PUT /api/attendance/admin/clock-out/:id`

Close an open attendance record owned by the caller.

**JSON body**

```json
{ "timeOutMinutes": 1020, "breakMinutes": 60 }
```

`timeOutMinutes` must be an integer from `0` to `1439`.
`breakMinutes` is optional and must be a non-negative integer; if omitted, it
defaults to 60. The handler supports a clock-out time after midnight by
treating a lower minute value as the next day. It stores net hours after the
break and calculates overtime above eight hours.

**Success:** `200` with the closed record's `id`, `timeOutMinutes`,
`totalHoursWorked`, and `overtimeHours`. Returns `400` for invalid input,
`404` if there is no owned open record, and `409` if it was already closed.

### `GET /api/attendance/company/:companyId`

List attendance logs for all employees in an owned company.

**Success:** `200 { "data": [<joined attendance log>, ...] }`. Returns `404`
if the company is not found or not owned.

### `GET /api/attendance/employee/:employeeId`

List attendance logs for an employee in a company owned by the caller.
Optional query parameter `date=YYYY-MM-DD` filters the results by log date.

**Success:** `200 { "data": [<attendance log>, ...] }`. Returns `404` if the
employee is not found or not owned.

## Admin accounts and profiles

Base path: `/admin`.

### `POST /admin`

Create an employee-role account through Better Auth email sign-up. The JSON
body must include `role: "employee"` plus the Better Auth sign-up fields
`name`, `email`, and `password`. This route rejects roles other than
`employee`; administrator registration uses the product-key endpoint.

The Better Auth sign-up response is passed through. Invalid signup requests
return the corresponding Better Auth error response; a successful account
without a returned user ID results in `500`.

### `GET /admin/:id`

Return a limited profile by user ID: `id`, `name`, `email`, `emailVerified`,
`image`, and `createdAt`.

**Success:** `200 { "data": <profile> }`; `404` if the profile does not exist.
This route currently does not require an administrator session.

## Product keys

Base path: `/api/key-products`.

### `POST /api/key-products/verify`

Publicly verify that a correctly formatted product key exists and is still in
`active` status. This does not activate or consume the key.

**JSON body:** `{ "key": "abc-def-123" }`

**Success:** `200 { "valid": true, "keyId": "<id>" }`. Invalid JSON returns
`400`; malformed, unknown, inactive, or unverifiable keys return
`401 { "valid": false }`.

### `POST /api/key-products/activate`

Publicly activate a valid `active` product key.

**JSON body:** `{ "key": "abc-def-123" }`

**Success:** `200` with `success`, `activated`, `keyId`, and `activatedAt`.
Returns `400` for invalid JSON/key format, `401` for an invalid or inactive
key, and `409` if the key has already been activated or another activation
won the race.

### `POST /api/key-products/register-admin`

Publicly register an administrator using an activated, unused product key.

**JSON body**

```json
{
  "key": "abc-def-123",
  "name": "Admin Name",
  "email": "admin@example.com",
  "password": "at-least-six-characters"
}
```

The password must contain at least six characters. Registration reserves the
key while Better Auth creates the account, links the key to the new admin, and
marks it as redeemed. A redeemed key cannot register another admin.

**Success:** Better Auth sign-up response with the created user, including
`role: "admin"` and `keyProductId`. Returns `400` for invalid input, `401` for
an invalid key, `409` if the key is not activated/already used/in use, and
`500` or `502` if account/key linking does not complete correctly.

### `POST /api/key-products`

Create a new product key. Requires an administrator session.

**Success:** `201 { "success": true, "data": { "id", "key", "status",
"createdAt" } }`. The generated key is returned in this response; store it
securely because this endpoint exposes the full key.

### `GET /api/key-products?limit=<n>`

List product keys, newest first. Requires an administrator session. `limit`
defaults to `100` and must be an integer from `1` through `1000`.

**Success:** `200 { "data": [<key record>, ...], "count": <number> }`. Returns
`400` if the limit is outside the allowed range.

### `DELETE /api/key-products/:id`

Revoke a product key. Requires an administrator session. This updates its
status to `revoked`; it does not physically delete the database row.

**Success:** `200 { "success": true }`.

## CORS

The API allows credentialed requests from configured local development and
Tauri origins and the deployed API origin. Allowed methods are `GET`, `POST`,
`PUT`, `DELETE`, and `OPTIONS`; allowed request headers are `Content-Type` and
`Authorization`.
