# Payroll Activation App

React, Vite, and Electron app for activating a payroll product key.

## Development

From this directory, install dependencies with Bun if needed, then start the
Electron app:

```sh
bun install
bun run dev
```

Vite runs at `http://localhost:5173`. In development, the Electron window loads
that URL.

## Activation flow

The app opens on the login screen (`/login`). New users can open `/activate` to
enter an activation key in the `xxx-xxx-xxx` format.
The app trims and lowercases the value, validates its format, and sends it as
JSON to:

```text
POST https://system-payroll-api.automation-payroll.workers.dev/api/key-products/activate
{ "key": "xxx-xxx-xxx" }
```

On successful activation, the app navigates to `/register` and passes the
normalized key in React Router navigation state rather than putting it in the
URL. Registration submits the key together with the user's name, email, and
password to:

```text
POST https://system-payroll-api.automation-payroll.workers.dev/api/key-products/register-admin
```

The backend is responsible for linking the activated key to the new admin
account and marking it redeemed. The registration endpoint is not live until
the backend migration and deployment are complete.

## Authentication client

`src/auth-client.js` uses Better Auth's React client and exports the sign-in,
sign-up, sign-out, session, and session-fetch helpers. It includes cookies and
reads the optional Bearer token from local storage under
`payroll_auth_token`.

In development, `/api` requests are proxied from the local Vite server to the
payroll API. Set `VITE_API_URL` to override the API base URL. Production
defaults to the payroll API origin.

The root route redirects to `/login`; a signed-in user is sent to the dashboard,
and dashboard access requires a valid session. Use **Log out** on the dashboard
to end the session. Existing users can return through **Already have an
account? Log in** on the activation screen.
Electron uses its persistent default session partition for auth cookies. The
app also remembers locally that an admin account was registered, so when a
session is missing it opens the login screen rather than asking for another
activation key. This local marker does not grant dashboard access; a valid
server session is still required. Login and registration sign-in request a
remembered session when **Stay logged in** is enabled. The dashboard account
menu has a settings drawer with **Stay logged in** and **Log out when app
closes** choices. If the latter is selected, Electron waits for Better Auth
sign-out before closing. Settings are persisted in Electron user data.
**Always ask for password in other applications** and **Automatic sync** are
shown as disabled placeholders.

## Dashboard

The dashboard shows live company, active employee, and attendance counts for
the selected company. Cash, receivables, payables, and net income remain clearly
marked as unavailable until ledger, invoice, and expense data are connected;
the dashboard does not display placeholder financial amounts.

## Employee spreadsheet

Signed-in admins can open **Employees** from the dashboard or go directly to
`/createEmployees`. The page uses Univer Sheets with sample employee data and
automatically saves an in-app draft. Choose a company and use **File → Save
employees to backend** to create complete employee records through
`POST /api/employees`. The API requires a company, employee identity, statutory
IDs, and base/daily/hourly rates; incomplete rows are skipped. The dashboard's
**Create a company** section creates a company through `POST /api/companies`
and selects it for the employee page.

Use **File → Upload Excel or CSV to spreadsheet** to read an `.xlsx`, `.xls`, or
UTF-8 `.csv` file into the editable sheet. The first worksheet is read for Excel
files; its rows become editable spreadsheet cells and are not sent to the
backend. Uploaded columns size to their contents, and long values wrap and
expand row height for readability. Quoted commas, escaped quotes, and quoted
newlines are supported in CSVs. Files must have unique column headers, up to 19
columns, and up to 1,000 rows; a `Backend ID` tracking column is added when
missing. Uploads remain an in-app draft until **Save employees to backend** is
used. Univer is loaded when the spreadsheet page initializes, and Excel parsing
is loaded only when an Excel file is uploaded.
The supplied 50-employee CSV is also loaded automatically when there is no
saved employee sheet or the saved workbook contains unrelated data.

## Electron DevTools

In development builds:

- Press **F12** or **Ctrl+Shift+I** to open DevTools (use **Option+Shift+I** on
  macOS).
- Right-click and select **Inspect Element** to inspect an element.

These shortcuts and the inspect context-menu item are enabled only in
development.

## Build and lint

```sh
bun run build
bun run lint
```
