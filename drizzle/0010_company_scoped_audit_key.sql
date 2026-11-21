DROP TRIGGER IF EXISTS `company_audit_events_no_update`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `company_audit_events_no_delete`;
--> statement-breakpoint
ALTER TABLE `company_audit_events` RENAME TO `company_audit_events_legacy_key`;
--> statement-breakpoint
DROP INDEX IF EXISTS `company_audit_events_company_sequence_unique`;
--> statement-breakpoint
DROP INDEX IF EXISTS `company_audit_events_company_time_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `company_audit_events_company_actor_idx`;
--> statement-breakpoint
CREATE TABLE `company_audit_events` (
  `id` text NOT NULL,
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
  PRIMARY KEY (`company_id`, `id`),
  FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `company_audit_events` (
  `id`, `company_id`, `sequence`, `actor_id`, `occurred_at`, `ip_address`,
  `action`, `resource_type`, `resource_id`, `request_id`, `before_json`,
  `after_json`, `metadata_json`, `previous_hash`, `entry_hash`
)
SELECT
  `id`, `company_id`, `sequence`, `actor_id`, `occurred_at`, `ip_address`,
  `action`, `resource_type`, `resource_id`, `request_id`, `before_json`,
  `after_json`, `metadata_json`, `previous_hash`, `entry_hash`
FROM `company_audit_events_legacy_key`;
--> statement-breakpoint
DROP TABLE `company_audit_events_legacy_key`;
--> statement-breakpoint
CREATE UNIQUE INDEX `company_audit_events_company_sequence_unique` ON `company_audit_events` (`company_id`, `sequence`);
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
