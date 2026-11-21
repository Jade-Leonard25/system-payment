import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";

// --- Better Auth Tables ---
export const userAdmin = sqliteTable("user_admin", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull(),
  image: text("image"),
  role: text("role").notNull().default("employee"),
  keyProductId: text("key_product_id").unique().references(() => keyProduct.id, {
    onDelete: "set null",
  }),
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
  keyValue: text("key_value"),
  keyHash: text("key_hash").notNull(),
  status: text("status").notNull().default("active"),
  activatedAt: integer("activated_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const attendanceBatches = sqliteTable(
  "attendance_batches",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    batchId: text("batch_id").notNull(),
    payloadHash: text("payload_hash").notNull(),
    status: text("status").notNull(),
    totalRows: integer("total_rows").notNull(),
    computedCount: integer("computed_count").notNull(),
    flaggedCount: integer("flagged_count").notNull(),
    rejectedCount: integer("rejected_count").notNull(),
    actorId: text("actor_id").references(() => userAdmin.id, {
      onDelete: "set null",
    }),
    rulesVersion: text("rules_version").notNull(),
    responseJson: text("response_json").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("attendance_batches_company_batch_id_unique").on(
      table.companyId,
      table.batchId,
    ),
    index("attendance_batches_company_created_at_idx").on(
      table.companyId,
      table.createdAt,
    ),
  ],
);

export const rawAttendanceLogs = sqliteTable(
  "raw_attendance_logs",
  {
    id: text("id").primaryKey(),
    batchId: text("batch_id")
      .notNull()
      .references(() => attendanceBatches.id, { onDelete: "cascade" }),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    sourceRow: integer("source_row").notNull(),
    rawEmployeeIdentifier: text("raw_employee_identifier").notNull(),
    employeeId: text("employee_id").references(() => employees.id, {
      onDelete: "set null",
    }),
    punchType: text("punch_type"),
    punchedAt: text("punched_at"),
    status: text("status").notNull(),
    issuesJson: text("issues_json").notNull(),
    rawPayloadJson: text("raw_payload_json").notNull(),
  },
  (table) => [
    uniqueIndex("raw_attendance_logs_batch_row_unique").on(
      table.batchId,
      table.sourceRow,
    ),
    index("raw_attendance_logs_company_punched_at_idx").on(
      table.companyId,
      table.punchedAt,
    ),
    index("raw_attendance_logs_employee_punched_at_idx").on(
      table.employeeId,
      table.punchedAt,
    ),
  ],
);

export const computedShiftSummaries = sqliteTable(
  "computed_shift_summaries",
  {
    id: text("id").primaryKey(),
    batchId: text("batch_id")
      .notNull()
      .references(() => attendanceBatches.id, { onDelete: "cascade" }),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    employeeId: text("employee_id").references(() => employees.id, {
      onDelete: "set null",
    }),
    employeeIdentifier: text("employee_identifier").notNull(),
    sourceKey: text("source_key").notNull(),
    sourceRowsJson: text("source_rows_json").notNull(),
    timeInAt: text("time_in_at"),
    timeOutAt: text("time_out_at"),
    elapsedMinutes: integer("elapsed_minutes"),
    rawNightWindowMinutes: integer("raw_night_window_minutes"),
    regularMinutes: integer("regular_minutes"),
    lateMinutes: integer("late_minutes"),
    undertimeMinutes: integer("undertime_minutes"),
    overtimeMinutes: integer("overtime_minutes"),
    nightDifferentialMinutes: integer("night_differential_minutes"),
    grossPayCents: integer("gross_pay_cents"),
    status: text("status").notNull(),
    issuesJson: text("issues_json").notNull(),
  },
  (table) => [
    uniqueIndex("computed_shift_summaries_batch_source_unique").on(
      table.batchId,
      table.sourceKey,
    ),
    index("computed_shift_summaries_company_employee_idx").on(
      table.companyId,
      table.employeeId,
    ),
  ],
);

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    actorId: text("actor_id").references(() => userAdmin.id, {
      onDelete: "set null",
    }),
    batchId: text("batch_id")
      .notNull()
      .references(() => attendanceBatches.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    rulesVersion: text("rules_version").notNull(),
    occurredAt: integer("occurred_at", { mode: "timestamp" }).notNull(),
    metadataJson: text("metadata_json").notNull(),
  },
  (table) => [
    uniqueIndex("audit_logs_batch_action_unique").on(
      table.batchId,
      table.action,
    ),
    index("audit_logs_company_occurred_at_idx").on(
      table.companyId,
      table.occurredAt,
    ),
  ],
);

// --- Relations ---
export const userRelations = relations(userAdmin, ({ many, one }) => ({
  sessions: many(session),
  accounts: many(account),
  companies: many(company),
  employees: many(employees),
  attendanceBatches: many(attendanceBatches),
  auditLogs: many(auditLogs),
  keyProduct: one(keyProduct, {
    fields: [userAdmin.keyProductId],
    references: [keyProduct.id],
  }),
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
  attendanceBatches: many(attendanceBatches),
  rawAttendanceLogs: many(rawAttendanceLogs),
  computedShiftSummaries: many(computedShiftSummaries),
  auditLogs: many(auditLogs),
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
  rawAttendanceLogs: many(rawAttendanceLogs),
  computedShiftSummaries: many(computedShiftSummaries),
}));

export const attendanceLogRelations = relations(attendanceLogs, ({ one }) => ({
  employee: one(employees, {
    fields: [attendanceLogs.employeeId],
    references: [employees.id],
  }),
}));

export const keyProductRelations = relations(keyProduct, ({ one }) => ({
  userAdmin: one(userAdmin),
}));

export const attendanceBatchRelations = relations(
  attendanceBatches,
  ({ one, many }) => ({
    company: one(company, {
      fields: [attendanceBatches.companyId],
      references: [company.id],
    }),
    actor: one(userAdmin, {
      fields: [attendanceBatches.actorId],
      references: [userAdmin.id],
    }),
    rawLogs: many(rawAttendanceLogs),
    summaries: many(computedShiftSummaries),
    auditLogs: many(auditLogs),
  }),
);

export const rawAttendanceLogRelations = relations(
  rawAttendanceLogs,
  ({ one }) => ({
    batch: one(attendanceBatches, {
      fields: [rawAttendanceLogs.batchId],
      references: [attendanceBatches.id],
    }),
    company: one(company, {
      fields: [rawAttendanceLogs.companyId],
      references: [company.id],
    }),
    employee: one(employees, {
      fields: [rawAttendanceLogs.employeeId],
      references: [employees.id],
    }),
  }),
);

export const computedShiftSummaryRelations = relations(
  computedShiftSummaries,
  ({ one }) => ({
    batch: one(attendanceBatches, {
      fields: [computedShiftSummaries.batchId],
      references: [attendanceBatches.id],
    }),
    company: one(company, {
      fields: [computedShiftSummaries.companyId],
      references: [company.id],
    }),
    employee: one(employees, {
      fields: [computedShiftSummaries.employeeId],
      references: [employees.id],
    }),
  }),
);

export const auditLogRelations = relations(auditLogs, ({ one }) => ({
  company: one(company, {
    fields: [auditLogs.companyId],
    references: [company.id],
  }),
  actor: one(userAdmin, {
    fields: [auditLogs.actorId],
    references: [userAdmin.id],
  }),
  batch: one(attendanceBatches, {
    fields: [auditLogs.batchId],
    references: [attendanceBatches.id],
  }),
}));