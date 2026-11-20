import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";

// --- Better Auth Tables ---
export const userAdmin = sqliteTable("user_admin", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull(),
  image: text("image"),
  role: text("role").notNull().default("employee"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => userAdmin.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => userAdmin.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp" }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp" }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }),
  updatedAt: integer("updated_at", { mode: "timestamp" }),
});

// --- App Business Tables ---
export const company = sqliteTable("company", {
  id: text("id").primaryKey(),
  adminId: text("admin_id")
    .notNull()
    .references(() => userAdmin.id, { onDelete: "cascade" }),

  name: text("name").notNull(),
  legalName: text("legal_name"),
  address: text("address"),
  contactNumber: text("contact_number"),
  email: text("email"),
  companyLogo: text("company_logo").notNull(),

  taxId: text("tax_id").notNull(),
  rdoCode: text("rdo_code"),
  employerSSS: text("employer_sss"),
  employerPhilHealth: text("employer_philhealth"),
  employerPagIbig: text("employer_pag_ibig"),

  compTaxReduct: real("comp_tax_reduct").default(0.0).notNull(),
  compPermit: text("company_permit"),

  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const employees = sqliteTable("employees", {
  id: text("id").primaryKey(),
  adminId: text("admin_id").references(() => userAdmin.id, { onDelete: "cascade" }),
  companyId: text("company_id")
    .notNull()
    .references(() => company.id, { onDelete: "cascade" }),

  firstname: text("firstname").notNull(),
  middlename: text("middlename"),
  lastname: text("lastname").notNull(),
  extname: text("extname"),
  birthdate: text("birthdate"),
  gender: text("gender"),
  civilStatus: text("civil_status").default("SINGLE"),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),

  employmentType: text("employment_type").notNull().default("REGULAR"),
  employmentStatus: text("employment_status").notNull().default("ACTIVE"),
  dateHired: text("date_hired").notNull(),
  dateResigned: text("date_resigned"),
  department: text("department"),
  position: text("position"),

  socialSecurityNumber: text("sss").notNull(),
  pagIbigID: text("pag_ibig").notNull(),
  philhealth: text("philhealth").notNull(),
  taxIdNumber: text("tin").notNull(),

  baseSalaryCents: integer("base_salary_cents").notNull(),
  dailyRateCents: integer("daily_rate_cents").notNull(),
  hourlyRateCents: integer("hourly_rate_cents").notNull(),

  deductSSS: integer("deduct_sss", { mode: "boolean" }).default(true).notNull(),
  deductPhilHealth: integer("deduct_philhealth", { mode: "boolean" }).default(true).notNull(),
  deductPagIbig: integer("deduct_pag_ibig", { mode: "boolean" }).default(true).notNull(),
  deductTax: integer("deduct_tax", { mode: "boolean" }).default(true).notNull(),

  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const attendanceLogs = sqliteTable("attendance_logs", {
  id: text("id").primaryKey(),
  employeeId: text("employee_id")
    .notNull()
    .references(() => employees.id, { onDelete: "cascade" }),

  logDate: text("log_date").notNull(),
  timeInMinutes: integer("time_in_minutes").notNull(),
  timeOutMinutes: integer("time_out_minutes"),

  totalHoursWorked: real("total_hours_worked").default(0.0).notNull(),
  overtimeHours: real("overtime_hours").default(0.0).notNull(),
  lateMinutes: integer("late_minutes").default(0).notNull(),

  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const keyProduct = sqliteTable("key_product", {
  id: text("id").primaryKey(),
  keySelector: text("key_selector").notNull().unique(),
  keyHash: text("key_hash").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// --- Relations ---
export const userRelations = relations(userAdmin, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  companies: many(company),
  employees: many(employees),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(userAdmin, {
    fields: [session.userId],
    references: [userAdmin.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(userAdmin, {
    fields: [account.userId],
    references: [userAdmin.id],
  }),
}));

export const companyRelations = relations(company, ({ one, many }) => ({
  admin: one(userAdmin, {
    fields: [company.adminId],
    references: [userAdmin.id],
  }),
  employees: many(employees),
}));

export const employeeRelations = relations(employees, ({ one, many }) => ({
  admin: one(userAdmin, {
    fields: [employees.adminId],
    references: [userAdmin.id],
  }),
  company: one(company, {
    fields: [employees.companyId],
    references: [company.id],
  }),
  attendanceLogs: many(attendanceLogs),
}));

export const attendanceLogRelations = relations(attendanceLogs, ({ one }) => ({
  employee: one(employees, {
    fields: [attendanceLogs.employeeId],
    references: [employees.id],
  }),
}));