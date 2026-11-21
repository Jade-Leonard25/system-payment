CREATE TABLE `company_memberships` (
  `company_id` text NOT NULL,
  `user_id` text NOT NULL,
  `role` text NOT NULL CHECK (`role` IN ('admin', 'auditor', 'employee')),
  `created_at` integer NOT NULL,
  PRIMARY KEY (`company_id`, `user_id`),
  FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`) REFERENCES `user_admin`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `company_memberships_company_role_idx` ON `company_memberships` (`company_id`, `role`);
--> statement-breakpoint
CREATE TABLE `permissions` (
  `company_id` text NOT NULL,
  `permission_key` text NOT NULL,
  `description` text NOT NULL,
  PRIMARY KEY (`company_id`, `permission_key`),
  FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `role_permissions` (
  `company_id` text NOT NULL,
  `role` text NOT NULL CHECK (`role` IN ('admin', 'auditor', 'employee')),
  `permission_key` text NOT NULL,
  PRIMARY KEY (`company_id`, `role`, `permission_key`),
  FOREIGN KEY (`company_id`, `permission_key`) REFERENCES `permissions`(`company_id`, `permission_key`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `role_permissions_company_role_idx` ON `role_permissions` (`company_id`, `role`);
--> statement-breakpoint
CREATE TABLE `company_audit_heads` (
  `company_id` text PRIMARY KEY NOT NULL,
  `last_sequence` integer NOT NULL DEFAULT 0 CHECK (`last_sequence` >= 0),
  `last_hash` text NOT NULL,
  FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `company_audit_events` (
  `id` text PRIMARY KEY NOT NULL,
  `company_id` text NOT NULL,
  `sequence` integer NOT NULL CHECK (`sequence` > 0),
  `actor_id` text,
  `occurred_at` text NOT NULL,
  `ip_address` text,
  `action` text NOT NULL,
  `resource_type` text NOT NULL,
  `resource_id` text,
  `request_id` text NOT NULL,
  `before_json` text,
  `after_json` text,
  `metadata_json` text NOT NULL,
  `previous_hash` text NOT NULL,
  `entry_hash` text NOT NULL,
  FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE restrict,
  UNIQUE (`company_id`, `sequence`)
);
--> statement-breakpoint
CREATE INDEX `company_audit_events_company_time_idx` ON `company_audit_events` (`company_id`, `occurred_at`);
--> statement-breakpoint
CREATE INDEX `company_audit_events_company_actor_idx` ON `company_audit_events` (`company_id`, `actor_id`);
--> statement-breakpoint
CREATE TRIGGER `company_audit_events_no_update`
BEFORE UPDATE ON `company_audit_events`
BEGIN
  SELECT RAISE(ABORT, 'company_audit_events are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `company_audit_events_no_delete`
BEFORE DELETE ON `company_audit_events`
BEGIN
  SELECT RAISE(ABORT, 'company_audit_events are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `company_seed_accounting_access`
AFTER INSERT ON `company`
BEGIN
  INSERT INTO `company_memberships` (`company_id`, `user_id`, `role`, `created_at`)
  VALUES (NEW.`id`, NEW.`admin_id`, 'admin', unixepoch());
  INSERT INTO `permissions` (`company_id`, `permission_key`, `description`)
  VALUES (NEW.`id`, 'audit.view', 'View and verify the company audit log');
  INSERT INTO `role_permissions` (`company_id`, `role`, `permission_key`)
  VALUES
    (NEW.`id`, 'admin', 'audit.view'),
    (NEW.`id`, 'auditor', 'audit.view');
  INSERT INTO `company_audit_heads` (`company_id`, `last_sequence`, `last_hash`)
  VALUES (NEW.`id`, 0, '0');
END;
--> statement-breakpoint
INSERT INTO `company_memberships` (`company_id`, `user_id`, `role`, `created_at`)
SELECT `id`, `admin_id`, 'admin', unixepoch() FROM `company`;
--> statement-breakpoint
INSERT INTO `permissions` (`company_id`, `permission_key`, `description`)
SELECT `id`, 'audit.view', 'View and verify the company audit log' FROM `company`;
--> statement-breakpoint
INSERT INTO `role_permissions` (`company_id`, `role`, `permission_key`)
SELECT `id`, 'admin', 'audit.view' FROM `company`;
--> statement-breakpoint
INSERT INTO `role_permissions` (`company_id`, `role`, `permission_key`)
SELECT `id`, 'auditor', 'audit.view' FROM `company`;
--> statement-breakpoint
INSERT INTO `company_audit_heads` (`company_id`, `last_sequence`, `last_hash`)
SELECT `id`, 0, '0' FROM `company`;
