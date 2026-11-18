CREATE TABLE `attendance_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` text NOT NULL,
	`log_date` text NOT NULL,
	`time_in_minutes` integer NOT NULL,
	`time_out_minutes` integer,
	`total_hours_worked` real DEFAULT 0 NOT NULL,
	`overtime_hours` real DEFAULT 0 NOT NULL,
	`late_minutes` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `company` (
	`id` text PRIMARY KEY NOT NULL,
	`admin_id` text NOT NULL,
	`name` text NOT NULL,
	`legal_name` text,
	`address` text,
	`contact_number` text,
	`email` text,
	`company_logo` text NOT NULL,
	`tax_id` text NOT NULL,
	`rdo_code` text,
	`employer_sss` text,
	`employer_philhealth` text,
	`employer_pag_ibig` text,
	`comp_tax_reduct` real DEFAULT 0 NOT NULL,
	`company_permit` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`admin_id`) REFERENCES `user_admin`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `employees` (
	`id` text PRIMARY KEY NOT NULL,
	`admin_id` text,
	`company_id` text NOT NULL,
	`firstname` text NOT NULL,
	`middlename` text,
	`lastname` text NOT NULL,
	`extname` text,
	`birthdate` text,
	`gender` text,
	`civil_status` text DEFAULT 'SINGLE',
	`email` text,
	`phone` text,
	`address` text,
	`employment_type` text DEFAULT 'REGULAR' NOT NULL,
	`employment_status` text DEFAULT 'ACTIVE' NOT NULL,
	`date_hired` text NOT NULL,
	`date_resigned` text,
	`department` text,
	`position` text,
	`sss` text NOT NULL,
	`pag_ibig` text NOT NULL,
	`philhealth` text NOT NULL,
	`tin` text NOT NULL,
	`base_salary_cents` integer NOT NULL,
	`daily_rate_cents` integer NOT NULL,
	`hourly_rate_cents` integer NOT NULL,
	`deduct_sss` integer DEFAULT true NOT NULL,
	`deduct_philhealth` integer DEFAULT true NOT NULL,
	`deduct_pag_ibig` integer DEFAULT true NOT NULL,
	`deduct_tax` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`admin_id`) REFERENCES `user_admin`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user_admin`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user_admin` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer NOT NULL,
	`image` text,
	`password` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_admin_email_unique` ON `user_admin` (`email`);