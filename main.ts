import { Hono } from "hono";
import { cors } from "hono/cors";
import type { D1Database } from "@cloudflare/workers-types";
import { createAuth } from "./auth";
import companyController from "./controllers/company.controller";
import employeeController from "./controllers/employee.controller";
import attendanceController from "./controllers/attendance.controller";
import adminController from "./controllers/admin.controller";
import keyProductController from "./controllers/key-product.controller";
import auditController from "./controllers/audit.controller";
import ledgerController from "./controllers/ledger.controller";
import salesController from "./controllers/sales.controller";

type Bindings = {
  DB: D1Database;
};

const server = new Hono<{ Bindings: Bindings }>();
server.use(
  "*",
  cors({
    origin: (origin) => {
      const allowedOrigins = [
        "https://system-payroll-api.automation-payroll.workers.dev",
        "https://system-management-r5kxsxqtj-jade-leonard-alvezs-projects.vercel.app",
        "http://localhost:1420",
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://tauri.localhost",
        "https://tauri.localhost",
      ];

      if (!origin) return undefined;
      if (allowedOrigins.includes(origin) || origin.startsWith("tauri-payroll://")) {
        return origin;
      }

      return undefined;
    },
    allowHeaders: ["Content-Type", "Authorization", "Idempotency-Key"],
    allowMethods: ["POST", "GET", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
    exposeHeaders:["set-auth-token"]
  })
);

// Mount Better Auth handler on /api/auth/*
server.on(["POST", "GET"], "/api/auth/*", (c) => {
  const auth = createAuth(c.env.DB, new URL(c.req.url).origin);
  return auth.handler(c.req.raw);
});

server.get("/", (c) => c.json({ status: "ok", service: "System Payroll API" }));

server.route("/api/companies", companyController);
server.route("/api/employees", employeeController);
server.route("/api/attendance", attendanceController);
server.route("/api/audit", auditController);
server.route("/api/ledger", ledgerController);
server.route("/api/sales", salesController);
server.route("/admin", adminController);
server.route("/api/key-products", keyProductController);

export default server;
