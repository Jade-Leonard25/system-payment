CREATE TABLE `accounting_periods` (
  `company_id` text NOT NULL,
  `id` text NOT NULL,
  `period_start` text NOT NULL,
  `period_end` text NOT NULL,
  `status` text NOT NULL CHECK (`status` IN ('open', 'closed')),
  `closed_by` text,
  `closed_at` text,
  `close_reason` text,
  PRIMARY KEY (`company_id`, `id`),
  UNIQUE (`company_id`, `period_start`, `period_end`),
  FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `accounting_periods_company_status_idx` ON `accounting_periods` (`company_id`, `status`, `period_start`);
--> statement-breakpoint
CREATE TABLE `accounts` (
  `company_id` text NOT NULL,
  `id` text NOT NULL,
  `code` text NOT NULL,
  `name` text NOT NULL,
  `type` text NOT NULL CHECK (`type` IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
  `normal_balance` text NOT NULL DEFAULT 'debit' CHECK (`normal_balance` IN ('debit', 'credit')),
  `is_header` integer NOT NULL DEFAULT 0 CHECK (`is_header` IN (0, 1)),
  `is_postable` integer NOT NULL DEFAULT 1 CHECK (`is_postable` IN (0, 1)),
  `is_active` integer NOT NULL DEFAULT 1 CHECK (`is_active` IN (0, 1)),
  `parent_id` text,
  `created_at` text NOT NULL,
  PRIMARY KEY (`company_id`, `id`),
  UNIQUE (`company_id`, `code`),
  FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`company_id`, `parent_id`) REFERENCES `accounts`(`company_id`, `id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `accounts_company_type_active_idx` ON `accounts` (`company_id`, `type`, `is_active`);
--> statement-breakpoint
CREATE TABLE `voucher_series` (
  `company_id` text NOT NULL,
  `id` text NOT NULL,
  `prefix` text NOT NULL,
  `next_number` integer NOT NULL DEFAULT 1 CHECK (`next_number` > 0),
  `padding` integer NOT NULL DEFAULT 6 CHECK (`padding` >= 1),
  PRIMARY KEY (`company_id`, `id`),
  UNIQUE (`company_id`, `prefix`),
  FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `journal_entries` (
  `company_id` text NOT NULL,
  `id` text NOT NULL,
  `voucher_number` text,
  `series_id` text,
  `entry_date` text NOT NULL,
  `currency` text NOT NULL DEFAULT 'PHP',
  `reference` text,
  `description` text,
  `status` text NOT NULL DEFAULT 'draft' CHECK (`status` IN ('draft', 'pending approval', 'posted', 'voided')),
  `source_type` text,
  `source_id` text,
  `created_by` text,
  `posted_by` text,
  `posted_at` text,
  `voided_by` text,
  `voided_at` text,
  `void_reason` text,
  `reversed_entry_id` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  PRIMARY KEY (`company_id`, `id`),
  UNIQUE (`company_id`, `voucher_number`),
  FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`company_id`, `series_id`) REFERENCES `voucher_series`(`company_id`, `id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`company_id`, `reversed_entry_id`) REFERENCES `journal_entries`(`company_id`, `id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `journal_entries_company_status_date_idx` ON `journal_entries` (`company_id`, `status`, `entry_date`);
--> statement-breakpoint
CREATE TABLE `journal_lines` (
  `company_id` text NOT NULL,
  `id` text NOT NULL,
  `entry_id` text NOT NULL,
  `account_id` text NOT NULL,
  `description` text,
  `debit_minor` integer NOT NULL DEFAULT 0 CHECK (`debit_minor` >= 0),
  `credit_minor` integer NOT NULL DEFAULT 0 CHECK (`credit_minor` >= 0),
  CHECK (`debit_minor` = 0 OR `credit_minor` = 0),
  PRIMARY KEY (`company_id`, `id`),
  FOREIGN KEY (`company_id`, `entry_id`) REFERENCES `journal_entries`(`company_id`, `id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`company_id`, `account_id`) REFERENCES `accounts`(`company_id`, `id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `journal_lines_company_entry_idx` ON `journal_lines` (`company_id`, `entry_id`);
--> statement-breakpoint
CREATE INDEX `journal_lines_company_account_idx` ON `journal_lines` (`company_id`, `account_id`);
--> statement-breakpoint
CREATE TABLE `journal_attachments` (
  `company_id` text NOT NULL,
  `id` text NOT NULL,
  `entry_id` text NOT NULL,
  `file_name` text NOT NULL,
  `mime_type` text NOT NULL,
  `size_bytes` integer NOT NULL CHECK (`size_bytes` >= 0),
  `data_base64` text NOT NULL,
  `uploaded_by` text,
  `created_at` text NOT NULL,
  PRIMARY KEY (`company_id`, `id`),
  FOREIGN KEY (`company_id`, `entry_id`) REFERENCES `journal_entries`(`company_id`, `id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `journal_attachments_company_entry_idx` ON `journal_attachments` (`company_id`, `entry_id`);
--> statement-breakpoint
CREATE TRIGGER `journal_entries_posted_no_update`
BEFORE UPDATE ON `journal_entries`
WHEN OLD.status = 'posted'
BEGIN
  SELECT RAISE(ABORT, 'posted journal entries are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `journal_entries_posted_no_delete`
BEFORE DELETE ON `journal_entries`
BEGIN
  SELECT RAISE(ABORT, 'posted journal entries are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `journal_lines_posted_no_update`
BEFORE UPDATE ON `journal_lines`
WHEN EXISTS (SELECT 1 FROM `journal_entries` e WHERE e.company_id = OLD.company_id AND e.id = OLD.entry_id AND e.status = 'posted')
BEGIN
  SELECT RAISE(ABORT, 'posted journal entries are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `journal_lines_posted_no_delete`
BEFORE DELETE ON `journal_lines`
WHEN EXISTS (SELECT 1 FROM `journal_entries` e WHERE e.company_id = OLD.company_id AND e.id = OLD.entry_id AND e.status = 'posted')
BEGIN
  SELECT RAISE(ABORT, 'posted journal entries are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `accounts_postings_no_delete`
BEFORE DELETE ON `accounts`
WHEN EXISTS (SELECT 1 FROM `journal_lines` l JOIN `journal_entries` e ON e.company_id = l.company_id AND e.id = l.entry_id WHERE l.company_id = OLD.company_id AND l.account_id = OLD.id AND e.status = 'posted')
BEGIN
  SELECT RAISE(ABORT, 'accounts with postings must be deactivated instead of deleted');
END;
--> statement-breakpoint
CREATE TRIGGER `journal_entry_posted_balance_check`
BEFORE UPDATE OF `status` ON `journal_entries`
WHEN NEW.status = 'posted' AND NEW.status != OLD.status
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM (
      SELECT COALESCE(SUM(debit_minor), 0) AS debit_total,
             COALESCE(SUM(credit_minor), 0) AS credit_total
      FROM `journal_lines`
      WHERE company_id = NEW.company_id AND entry_id = NEW.id
    ) WHERE debit_total = credit_total AND debit_total > 0
  ) THEN RAISE(ABORT, 'posted journal entry must balance') END;
END;
--> statement-breakpoint
INSERT INTO `accounting_periods` (`company_id`, `id`, `period_start`, `period_end`, `status`, `closed_at`, `closed_by`, `close_reason`)
SELECT `id`, 'period-' || substr(`id`, 1, 12), '2000-01-01', '2099-12-31', 'open', NULL, NULL, NULL FROM `company`;
--> statement-breakpoint
INSERT INTO `voucher_series` (`company_id`, `id`, `prefix`, `next_number`, `padding`)
SELECT `id`, 'journal-' || substr(`id`, 1, 12), 'JE-', 1, 6 FROM `company`;
--> statement-breakpoint
INSERT OR IGNORE INTO `permissions` (`company_id`, `permission_key`, `description`)
SELECT `id`, 'ledger.view', 'View the chart of accounts and journal entries' FROM `company`;
--> statement-breakpoint
INSERT OR IGNORE INTO `permissions` (`company_id`, `permission_key`, `description`)
SELECT `id`, 'ledger.create', 'Create and edit draft journal entries' FROM `company`;
--> statement-breakpoint
INSERT OR IGNORE INTO `permissions` (`company_id`, `permission_key`, `description`)
SELECT `id`, 'ledger.post', 'Post journal entries' FROM `company`;
--> statement-breakpoint
INSERT OR IGNORE INTO `permissions` (`company_id`, `permission_key`, `description`)
SELECT `id`, 'ledger.reverse', 'Reverse posted journal entries' FROM `company`;
--> statement-breakpoint
INSERT OR IGNORE INTO `role_permissions` (`company_id`, `role`, `permission_key`)
SELECT `id`, 'admin', 'ledger.view' FROM `company`;
--> statement-breakpoint
INSERT OR IGNORE INTO `role_permissions` (`company_id`, `role`, `permission_key`)
SELECT `id`, 'admin', 'ledger.create' FROM `company`;
--> statement-breakpoint
INSERT OR IGNORE INTO `role_permissions` (`company_id`, `role`, `permission_key`)
SELECT `id`, 'admin', 'ledger.post' FROM `company`;
--> statement-breakpoint
INSERT OR IGNORE INTO `role_permissions` (`company_id`, `role`, `permission_key`)
SELECT `id`, 'admin', 'ledger.reverse' FROM `company`;
--> statement-breakpoint
INSERT OR IGNORE INTO `role_permissions` (`company_id`, `role`, `permission_key`)
SELECT `id`, 'auditor', 'ledger.view' FROM `company`;
--> statement-breakpoint
INSERT OR IGNORE INTO `accounts` (`company_id`, `id`, `code`, `name`, `type`, `normal_balance`, `is_header`, `is_postable`, `is_active`, `parent_id`, `created_at`)
SELECT `id`, 'demo-' || substr(`id`, 1, 8) || '-1000', '1000', 'Cash on Hand', 'asset', 'debit', 0, 1, 1, NULL, '2000-01-01T00:00:00.000Z' FROM `company`;
--> statement-breakpoint
INSERT OR IGNORE INTO `accounts` (`company_id`, `id`, `code`, `name`, `type`, `normal_balance`, `is_header`, `is_postable`, `is_active`, `parent_id`, `created_at`)
SELECT `id`, 'demo-' || substr(`id`, 1, 8) || '-1100', '1100', 'Accounts Receivable', 'asset', 'debit', 0, 1, 1, NULL, '2000-01-01T00:00:00.000Z' FROM `company`;
--> statement-breakpoint
INSERT OR IGNORE INTO `accounts` (`company_id`, `id`, `code`, `name`, `type`, `normal_balance`, `is_header`, `is_postable`, `is_active`, `parent_id`, `created_at`)
SELECT `id`, 'demo-' || substr(`id`, 1, 8) || '-2100', '2100', 'Accounts Payable', 'liability', 'credit', 0, 1, 1, NULL, '2000-01-01T00:00:00.000Z' FROM `company`;
--> statement-breakpoint
INSERT OR IGNORE INTO `accounts` (`company_id`, `id`, `code`, `name`, `type`, `normal_balance`, `is_header`, `is_postable`, `is_active`, `parent_id`, `created_at`)
SELECT `id`, 'demo-' || substr(`id`, 1, 8) || '-4000', '4000', 'Service Revenue', 'revenue', 'credit', 0, 1, 1, NULL, '2000-01-01T00:00:00.000Z' FROM `company`;
--> statement-breakpoint
INSERT OR IGNORE INTO `accounts` (`company_id`, `id`, `code`, `name`, `type`, `normal_balance`, `is_header`, `is_postable`, `is_active`, `parent_id`, `created_at`)
SELECT `id`, 'demo-' || substr(`id`, 1, 8) || '-5000', '5000', 'Salaries Expense', 'expense', 'debit', 0, 1, 1, NULL, '2000-01-01T00:00:00.000Z' FROM `company`;
--> statement-breakpoint
INSERT OR IGNORE INTO `accounts` (`company_id`, `id`, `code`, `name`, `type`, `normal_balance`, `is_header`, `is_postable`, `is_active`, `parent_id`, `created_at`)
SELECT `id`, 'demo-' || substr(`id`, 1, 8) || '-3000', '3000', 'Owner’s Capital', 'equity', 'credit', 0, 1, 1, NULL, '2000-01-01T00:00:00.000Z' FROM `company`;
