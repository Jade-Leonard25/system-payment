import { Hono } from "hono";
import { cors } from "hono/cors";
import { createAuth } from "./auth";
import companyController from "./controllers/company.controller";
import employeeController from "./controllers/employee.controller";
import attendanceController from "./controllers/attendance.controller";
import adminController from "./controllers/admin.controller";

type Bindings = {
  DB: D1Database;
};

const server = new Hono<{ Bindings: Bindings }>();

server.use(
  "*",
  cors({
    origin: (origin) => origin || "electron_payroll://http://localhost:5173",
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["POST", "GET", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
  })
);

// Mount Better Auth handler on /api/auth/*
server.on(["POST", "GET"], "/api/auth/*", (c) => {
  const auth = createAuth(c.env.DB);
  return auth.handler(c.req.raw);
});

server.get("/", (c) => c.json({ status: "ok", service: "System Payroll API" }));

server.route("/api/companies", companyController);
server.route("/api/employees", employeeController);
server.route("/api/attendance", attendanceController);
server.route("/admin", adminController);

export default server;
