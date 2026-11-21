CREATE TABLE `attendance_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`batch_id` text NOT NULL,
	`payload_hash` text NOT NULL,
	`status` text NOT NULL,
	`total_rows` integer NOT NULL,
	`computed_count` integer NOT NULL,
	`flagged_count` integer NOT NULL,
	`rejected_count` integer NOT NULL,
	`actor_id` text,
	`rules_version` text NOT NULL,
	`response_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `user_admin`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attendance_batches_company_batch_id_unique` ON `attendance_batches` (`company_id`,`batch_id`);--> statement-breakpoint
CREATE INDEX `attendance_batches_company_created_at_idx` ON `attendance_batches` (`company_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`actor_id` text,
	`batch_id` text NOT NULL,
	`action` text NOT NULL,
	`rules_version` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`metadata_json` text NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `user_admin`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`batch_id`) REFERENCES `attendance_batches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `audit_logs_batch_action_unique` ON `audit_logs` (`batch_id`,`action`);--> statement-breakpoint
CREATE INDEX `audit_logs_company_occurred_at_idx` ON `audit_logs` (`company_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `computed_shift_summaries` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`company_id` text NOT NULL,
	`employee_id` text,
	`employee_identifier` text NOT NULL,
	`source_key` text NOT NULL,
	`source_rows_json` text NOT NULL,
	`time_in_at` text,
	`time_out_at` text,
	`elapsed_minutes` integer,
	`raw_night_window_minutes` integer,
	`regular_minutes` integer,
	`late_minutes` integer,
	`undertime_minutes` integer,
	`overtime_minutes` integer,
	`night_differential_minutes` integer,
	`gross_pay_cents` integer,
	`status` text NOT NULL,
	`issues_json` text NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `attendance_batches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `computed_shift_summaries_batch_source_unique` ON `computed_shift_summaries` (`batch_id`,`source_key`);--> statement-breakpoint
CREATE INDEX `computed_shift_summaries_company_employee_idx` ON `computed_shift_summaries` (`company_id`,`employee_id`);--> statement-breakpoint
CREATE TABLE `raw_attendance_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`company_id` text NOT NULL,
	`source_row` integer NOT NULL,
	`raw_employee_identifier` text NOT NULL,
	`employee_id` text,
	`punch_type` text,
	`punched_at` text,
	`status` text NOT NULL,
	`issues_json` text NOT NULL,
	`raw_payload_json` text NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `attendance_batches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `raw_attendance_logs_batch_row_unique` ON `raw_attendance_logs` (`batch_id`,`source_row`);--> statement-breakpoint
CREATE INDEX `raw_attendance_logs_company_punched_at_idx` ON `raw_attendance_logs` (`company_id`,`punched_at`);--> statement-breakpoint
CREATE INDEX `raw_attendance_logs_employee_punched_at_idx` ON `raw_attendance_logs` (`employee_id`,`punched_at`);
--> statement-breakpoint
CREATE TRIGGER `audit_logs_no_update`
BEFORE UPDATE ON `audit_logs`
BEGIN
	SELECT RAISE(ABORT, 'audit_logs are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `audit_logs_no_delete`
BEFORE DELETE ON `audit_logs`
BEGIN
	SELECT RAISE(ABORT, 'audit_logs are append-only');
END;