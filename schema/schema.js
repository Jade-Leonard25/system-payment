import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";

// --- Tables ---
export const userAdmin = sqliteTable("user_admin", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull(),
  image: text("image"),
  password: text("password").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => userAdmin.id, { onDelete: "cascade" }),
  token: text("token").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});
export const company = sqliteTable("company", {
  id: text("id").primaryKey(), // custom xxx-xxx-xxx format
  adminId: text("admin_id")
    .notNull()
    .references(() => userAdmin.id, { onDelete: "cascade" }),

  // Company Information
  name: text("name").notNull(),
  legalName: text("legal_name"),
  address: text("address"),
  contactNumber: text("contact_number"),
  email: text("email"),
  companyLogo: text("company_logo").notNull(), // URL or local file path

  // Philippine Tax & Statutory Details
  taxId: text("tax_id").notNull(), // Company BIR TIN
  rdoCode: text("rdo_code"), // Revenue District Office code (e.g., "052")
  employerSSS: text("employer_sss"), // SSS Employer ID number
  employerPhilHealth: text("employer_philhealth"), // PhilHealth Employer Number (PEN)
  employerPagIbig: text("employer_pag_ibig"), // Pag-IBIG Employer ID number

  // Tax Reductions / Special Rate Settings
  compTaxReduct: real("comp_tax_reduct").default(0.0).notNull(), // Percentage or fixed rate reduction
  compPermit: text("company_permit"),

  // Timestamps
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});
// Example custom table for your payroll app (e.g., employee time logs)
export const employees = sqliteTable("employees", {
  id: text("id").primaryKey(), // custom xxx-xxx-xxx format
  adminId: text("admin_id").references(() => userAdmin.id), // Created/managed by admin
  companyId: text("company_id")
    .notNull()
    .references(() => company.id, { onDelete: "cascade" }), // Belongs to a company

  // Personal & Civil Details
  firstname: text("firstname").notNull(),
  middlename: text("middlename"),
  lastname: text("lastname").notNull(),
  extname: text("extname"), // e.g., Jr., III
  birthdate: text("birthdate"), // ISO string YYYY-MM-DD
  gender: text("gender"), // MALE, FEMALE
  civilStatus: text("civil_status").default("SINGLE"), // SINGLE, MARRIED, WIDOWED, LEGALLY_SEPARATED
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  // Employment & Classification Details
  employmentType: text("employment_type").notNull().default("REGULAR"), // REGULAR, PROBATIONARY, CONTRACTUAL, PART_TIME
  employmentStatus: text("employment_status").notNull().default("ACTIVE"), // ACTIVE, RESIGNED, TERMINATED, SUSPENDED
  dateHired: text("date_hired").notNull(), // ISO string YYYY-MM-DD
  dateResigned: text("date_resigned"), // Nullable if active
  department: text("department"),
  position: text("position"),

  // Philippine Statutory Identification Numbers
  socialSecurityNumber: text("sss").notNull(), // SSS Number
  pagIbigID: text("pag_ibig").notNull(), // Pag-IBIG MID / RTN
  philhealth: text("philhealth").notNull(), // PhilHealth Identification Number (PIN)
  taxIdNumber: text("tin").notNull(), // Bureau of Internal Revenue (BIR) TIN

  // Compensation & Financial (Stored in integer cents to avoid floating-point drift)
  baseSalaryCents: integer("base_salary_cents").notNull(),
  dailyRateCents: integer("daily_rate_cents").notNull(),
  hourlyRateCents: integer("hourly_rate_cents").notNull(),

  // Statutory Deduction Overrides (Toggles for special exemption cases)
  deductSSS: integer("deduct_sss", { mode: "boolean" }).default(true).notNull(),
  deductPhilHealth: integer("deduct_philhealth", { mode: "boolean" })
    .default(true)
    .notNull(),
  deductPagIbig: integer("deduct_pag_ibig", { mode: "boolean" })
    .default(true)
    .notNull(),
  deductTax: integer("deduct_tax", { mode: "boolean" }).default(true).notNull(),

  // Timestamps
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});
export const attendanceLogs = sqliteTable("attendance_logs", {
  id: text("id").primaryKey(), // e.g. custom xxx-xxx-xxx format
  employeeId: text("employee_id")
    .notNull()
    .references(() => employees.id, { onDelete: "cascade" }),

  logDate: text("log_date").notNull(), // ISO string YYYY-MM-DD

  // Time stored as minutes from midnight (e.g., 08:00 AM = 480 minutes, 05:00 PM = 1020 minutes)
  timeInMinutes: integer("time_in_minutes").notNull(),
  timeOutMinutes: integer("time_out_minutes"),

  // Calculated metrics
  totalHoursWorked: real("total_hours_worked").default(0.0).notNull(),
  overtimeHours: real("overtime_hours").default(0.0).notNull(),
  lateMinutes: integer("late_minutes").default(0).notNull(),

  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});
// --- Relations ---
export const userRelations = relations(userAdmin, ({ many }) => ({
  sessions: many(session),
  employees: many(employees),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(userAdmin, {
    fields: [session.userId],
    references: [userAdmin.id],
  }),
}));

export const employeeRelations = relations(employees, ({ one }) => ({
  user: one(userAdmin, {
    fields: [employees.userId],
    references: [userAdmin.id],
  }),
}));
