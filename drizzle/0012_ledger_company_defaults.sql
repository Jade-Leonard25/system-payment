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
--> statement-breakpoint
INSERT OR IGNORE INTO `accounting_periods` (`company_id`, `id`, `period_start`, `period_end`, `status`, `closed_at`, `closed_by`, `close_reason`)
SELECT `id`, 'period-' || substr(`id`, 1, 12), '2000-01-01', '2099-12-31', 'open', NULL, NULL, NULL FROM `company`;
--> statement-breakpoint
INSERT OR IGNORE INTO `voucher_series` (`company_id`, `id`, `prefix`, `next_number`, `padding`)
SELECT `id`, 'journal-' || substr(`id`, 1, 12), 'JE-', 1, 6 FROM `company`;
--> statement-breakpoint
CREATE TRIGGER `company_seed_ledger_defaults`
AFTER INSERT ON `company`
BEGIN
  INSERT OR IGNORE INTO `permissions` (`company_id`, `permission_key`, `description`) VALUES
    (NEW.`id`, 'ledger.view', 'View the chart of accounts and journal entries'),
    (NEW.`id`, 'ledger.create', 'Create and edit draft journal entries'),
    (NEW.`id`, 'ledger.post', 'Post journal entries'),
    (NEW.`id`, 'ledger.reverse', 'Reverse posted journal entries');
  INSERT OR IGNORE INTO `role_permissions` (`company_id`, `role`, `permission_key`) VALUES
    (NEW.`id`, 'admin', 'ledger.view'),
    (NEW.`id`, 'admin', 'ledger.create'),
    (NEW.`id`, 'admin', 'ledger.post'),
    (NEW.`id`, 'admin', 'ledger.reverse'),
    (NEW.`id`, 'auditor', 'ledger.view');
  INSERT OR IGNORE INTO `accounting_periods`
    (`company_id`, `id`, `period_start`, `period_end`, `status`, `closed_at`, `closed_by`, `close_reason`)
    VALUES (NEW.`id`, 'period-' || substr(NEW.`id`, 1, 12), '2000-01-01', '2099-12-31', 'open', NULL, NULL, NULL);
  INSERT OR IGNORE INTO `voucher_series` (`company_id`, `id`, `prefix`, `next_number`, `padding`)
    VALUES (NEW.`id`, 'journal-' || substr(NEW.`id`, 1, 12), 'JE-', 1, 6);
  INSERT OR IGNORE INTO `accounts`
    (`company_id`, `id`, `code`, `name`, `type`, `normal_balance`, `is_header`, `is_postable`, `is_active`, `parent_id`, `created_at`)
    VALUES
      (NEW.`id`, 'demo-' || substr(NEW.`id`, 1, 8) || '-1000', '1000', 'Cash on Hand', 'asset', 'debit', 0, 1, 1, NULL, '2000-01-01T00:00:00.000Z'),
      (NEW.`id`, 'demo-' || substr(NEW.`id`, 1, 8) || '-1100', '1100', 'Accounts Receivable', 'asset', 'debit', 0, 1, 1, NULL, '2000-01-01T00:00:00.000Z'),
      (NEW.`id`, 'demo-' || substr(NEW.`id`, 1, 8) || '-2100', '2100', 'Accounts Payable', 'liability', 'credit', 0, 1, 1, NULL, '2000-01-01T00:00:00.000Z'),
      (NEW.`id`, 'demo-' || substr(NEW.`id`, 1, 8) || '-4000', '4000', 'Service Revenue', 'revenue', 'credit', 0, 1, 1, NULL, '2000-01-01T00:00:00.000Z'),
      (NEW.`id`, 'demo-' || substr(NEW.`id`, 1, 8) || '-5000', '5000', 'Salaries Expense', 'expense', 'debit', 0, 1, 1, NULL, '2000-01-01T00:00:00.000Z'),
      (NEW.`id`, 'demo-' || substr(NEW.`id`, 1, 8) || '-3000', '3000', 'Owner’s Capital', 'equity', 'credit', 0, 1, 1, NULL, '2000-01-01T00:00:00.000Z');
END;
