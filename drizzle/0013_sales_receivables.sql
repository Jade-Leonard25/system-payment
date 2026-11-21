INSERT OR IGNORE INTO `permissions` (`company_id`, `permission_key`, `description`)
SELECT `id`, 'sales.view', 'View customers, invoices, and receivables' FROM `company`;
--> statement-breakpoint
INSERT OR IGNORE INTO `permissions` (`company_id`, `permission_key`, `description`)
SELECT `id`, 'sales.create', 'Create and edit customer and draft invoice records' FROM `company`;
--> statement-breakpoint
INSERT OR IGNORE INTO `permissions` (`company_id`, `permission_key`, `description`)
SELECT `id`, 'sales.issue', 'Issue invoices and credit notes' FROM `company`;
--> statement-breakpoint
INSERT OR IGNORE INTO `permissions` (`company_id`, `permission_key`, `description`)
SELECT `id`, 'sales.payment', 'Record customer payments' FROM `company`;
--> statement-breakpoint
INSERT OR IGNORE INTO `role_permissions` (`company_id`, `role`, `permission_key`)
SELECT `id`, 'admin', 'sales.view' FROM `company`;
--> statement-breakpoint
INSERT OR IGNORE INTO `role_permissions` (`company_id`, `role`, `permission_key`)
SELECT `id`, 'admin', 'sales.create' FROM `company`;
--> statement-breakpoint
INSERT OR IGNORE INTO `role_permissions` (`company_id`, `role`, `permission_key`)
SELECT `id`, 'admin', 'sales.issue' FROM `company`;
--> statement-breakpoint
INSERT OR IGNORE INTO `role_permissions` (`company_id`, `role`, `permission_key`)
SELECT `id`, 'admin', 'sales.payment' FROM `company`;
--> statement-breakpoint
INSERT OR IGNORE INTO `role_permissions` (`company_id`, `role`, `permission_key`)
SELECT `id`, 'auditor', 'sales.view' FROM `company`;
--> statement-breakpoint
INSERT OR IGNORE INTO `accounts` (`company_id`, `id`, `code`, `name`, `type`, `normal_balance`, `is_header`, `is_postable`, `is_active`, `parent_id`, `created_at`)
SELECT `id`, 'demo-' || substr(`id`, 1, 8) || '-2200', '2200', 'Output Tax Payable [VERIFY]', 'liability', 'credit', 0, 1, 1, NULL, '2000-01-01T00:00:00.000Z' FROM `company`;
--> statement-breakpoint
CREATE TABLE `sales_customers` (
  `company_id` text NOT NULL,
  `id` text NOT NULL,
  `name` text NOT NULL,
  `email` text,
  `phone` text,
  `billing_address` text,
  `is_active` integer NOT NULL DEFAULT 1 CHECK (`is_active` IN (0, 1)),
  `created_by` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  PRIMARY KEY (`company_id`, `id`),
  FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `sales_customers_company_name_idx` ON `sales_customers` (`company_id`, `name`);
--> statement-breakpoint
INSERT OR IGNORE INTO `sales_customers` (`company_id`, `id`, `name`, `is_active`, `created_by`, `created_at`, `updated_at`)
SELECT `id`, 'demo-customer-' || substr(`id`, 1, 8), 'Demo Customer', 1, NULL, '2000-01-01T00:00:00.000Z', '2000-01-01T00:00:00.000Z' FROM `company`;
--> statement-breakpoint
INSERT OR IGNORE INTO `accounts` (`company_id`, `id`, `code`, `name`, `type`, `normal_balance`, `is_header`, `is_postable`, `is_active`, `parent_id`, `created_at`)
SELECT `id`, 'demo-' || substr(`id`, 1, 8) || '-2300', '2300', 'Customer Credits', 'liability', 'credit', 0, 1, 1, NULL, '2000-01-01T00:00:00.000Z' FROM `company`;
--> statement-breakpoint
CREATE TABLE `sales_invoices` (
  `company_id` text NOT NULL,
  `id` text NOT NULL,
  `customer_id` text NOT NULL,
  `invoice_number` text NOT NULL,
  `invoice_date` text NOT NULL,
  `due_date` text NOT NULL,
  `currency` text NOT NULL DEFAULT 'PHP' CHECK (length(`currency`) = 3),
  `reference` text,
  `description` text,
  `tax_rate_bps` integer NOT NULL DEFAULT 0 CHECK (`tax_rate_bps` BETWEEN 0 AND 10000),
  `subtotal_minor` integer NOT NULL CHECK (`subtotal_minor` > 0),
  `tax_minor` integer NOT NULL CHECK (`tax_minor` = (`subtotal_minor` * `tax_rate_bps` + 5000) / 10000),
  `total_minor` integer NOT NULL CHECK (`total_minor` = `subtotal_minor` + `tax_minor`),
  `status` text NOT NULL DEFAULT 'draft' CHECK (`status` IN ('draft', 'issued', 'void')),
  `journal_entry_id` text,
  `created_by` text,
  `issued_at` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  PRIMARY KEY (`company_id`, `id`),
  UNIQUE (`company_id`, `invoice_number`),
  CHECK (`due_date` >= `invoice_date`),
  FOREIGN KEY (`company_id`, `customer_id`) REFERENCES `sales_customers`(`company_id`, `id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`company_id`, `journal_entry_id`) REFERENCES `journal_entries`(`company_id`, `id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `sales_invoices_company_status_due_idx` ON `sales_invoices` (`company_id`, `status`, `due_date`);
--> statement-breakpoint
CREATE INDEX `sales_invoices_company_customer_date_idx` ON `sales_invoices` (`company_id`, `customer_id`, `invoice_date`);
--> statement-breakpoint
CREATE TABLE `sales_invoice_lines` (
  `company_id` text NOT NULL,
  `id` text NOT NULL,
  `invoice_id` text NOT NULL,
  `description` text NOT NULL,
  `quantity_milli` integer NOT NULL CHECK (`quantity_milli` > 0),
  `unit_price_minor` integer NOT NULL CHECK (`unit_price_minor` >= 0),
  `amount_minor` integer NOT NULL CHECK (`amount_minor` = (`quantity_milli` * `unit_price_minor` + 500) / 1000),
  PRIMARY KEY (`company_id`, `id`),
  FOREIGN KEY (`company_id`, `invoice_id`) REFERENCES `sales_invoices`(`company_id`, `id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sales_invoice_lines_company_invoice_idx` ON `sales_invoice_lines` (`company_id`, `invoice_id`);
--> statement-breakpoint
CREATE TABLE `sales_credit_notes` (
  `company_id` text NOT NULL,
  `id` text NOT NULL,
  `invoice_id` text NOT NULL,
  `credit_number` text NOT NULL,
  `credit_date` text NOT NULL,
  `amount_minor` integer NOT NULL CHECK (`amount_minor` > 0),
  `reason` text NOT NULL,
  `journal_entry_id` text,
  `created_by` text,
  `created_at` text NOT NULL,
  PRIMARY KEY (`company_id`, `id`),
  UNIQUE (`company_id`, `credit_number`),
  FOREIGN KEY (`company_id`, `invoice_id`) REFERENCES `sales_invoices`(`company_id`, `id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`company_id`, `journal_entry_id`) REFERENCES `journal_entries`(`company_id`, `id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `sales_credit_notes_company_invoice_idx` ON `sales_credit_notes` (`company_id`, `invoice_id`);
--> statement-breakpoint
CREATE TABLE `sales_payments` (
  `company_id` text NOT NULL,
  `id` text NOT NULL,
  `customer_id` text NOT NULL,
  `payment_date` text NOT NULL,
  `currency` text NOT NULL CHECK (length(`currency`) = 3),
  `amount_minor` integer NOT NULL CHECK (`amount_minor` > 0),
  `reference` text,
  `journal_entry_id` text NOT NULL,
  `created_by` text,
  `created_at` text NOT NULL,
  PRIMARY KEY (`company_id`, `id`),
  FOREIGN KEY (`company_id`, `customer_id`) REFERENCES `sales_customers`(`company_id`, `id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`company_id`, `journal_entry_id`) REFERENCES `journal_entries`(`company_id`, `id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `sales_payments_company_customer_date_idx` ON `sales_payments` (`company_id`, `customer_id`, `payment_date`);
--> statement-breakpoint
CREATE TABLE `sales_invoice_allocations` (
  `company_id` text NOT NULL,
  `id` text NOT NULL,
  `payment_id` text NOT NULL,
  `invoice_id` text NOT NULL,
  `amount_minor` integer NOT NULL CHECK (`amount_minor` > 0),
  PRIMARY KEY (`company_id`, `id`),
  UNIQUE (`company_id`, `payment_id`, `invoice_id`),
  FOREIGN KEY (`company_id`, `payment_id`) REFERENCES `sales_payments`(`company_id`, `id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`company_id`, `invoice_id`) REFERENCES `sales_invoices`(`company_id`, `id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `sales_allocations_company_invoice_idx` ON `sales_invoice_allocations` (`company_id`, `invoice_id`);
--> statement-breakpoint
CREATE TABLE `sales_customer_credits` (
  `company_id` text NOT NULL,
  `id` text NOT NULL,
  `customer_id` text NOT NULL,
  `payment_id` text NOT NULL,
  `amount_minor` integer NOT NULL CHECK (`amount_minor` > 0),
  `created_at` text NOT NULL,
  PRIMARY KEY (`company_id`, `id`),
  UNIQUE (`company_id`, `payment_id`),
  FOREIGN KEY (`company_id`, `customer_id`) REFERENCES `sales_customers`(`company_id`, `id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`company_id`, `payment_id`) REFERENCES `sales_payments`(`company_id`, `id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `sales_customer_credits_company_customer_idx` ON `sales_customer_credits` (`company_id`, `customer_id`);
--> statement-breakpoint
CREATE TABLE `sales_idempotency` (
  `company_id` text NOT NULL,
  `idempotency_key` text NOT NULL,
  `payload_hash` text NOT NULL,
  `response_json` text NOT NULL,
  `created_at` text NOT NULL,
  PRIMARY KEY (`company_id`, `idempotency_key`),
  FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TRIGGER `sales_issued_invoice_no_update`
BEFORE UPDATE ON `sales_invoices`
WHEN OLD.status = 'issued'
  AND NOT (
    NEW.status = 'void'
    AND NEW.company_id = OLD.company_id
    AND NEW.id = OLD.id
    AND NEW.customer_id = OLD.customer_id
    AND NEW.invoice_number = OLD.invoice_number
    AND NEW.invoice_date = OLD.invoice_date
    AND NEW.due_date = OLD.due_date
    AND NEW.currency = OLD.currency
    AND NEW.reference IS OLD.reference
    AND NEW.description IS OLD.description
    AND NEW.tax_rate_bps = OLD.tax_rate_bps
    AND NEW.subtotal_minor = OLD.subtotal_minor
    AND NEW.tax_minor = OLD.tax_minor
    AND NEW.total_minor = OLD.total_minor
    AND NEW.journal_entry_id = OLD.journal_entry_id
    AND NEW.created_by IS OLD.created_by
    AND NEW.issued_at = OLD.issued_at
    AND NEW.created_at = OLD.created_at
  )
BEGIN
  SELECT RAISE(ABORT, 'issued invoices are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `sales_issued_invoice_no_delete`
BEFORE DELETE ON `sales_invoices`
WHEN OLD.status = 'issued'
BEGIN
  SELECT RAISE(ABORT, 'issued invoices cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER `sales_issued_invoice_lines_no_insert`
BEFORE INSERT ON `sales_invoice_lines`
WHEN EXISTS (SELECT 1 FROM `sales_invoices` i WHERE i.company_id = NEW.company_id AND i.id = NEW.invoice_id AND i.status != 'draft')
BEGIN
  SELECT RAISE(ABORT, 'only draft invoice lines can be added');
END;
--> statement-breakpoint
CREATE TRIGGER `sales_issued_invoice_lines_no_update`
BEFORE UPDATE ON `sales_invoice_lines`
WHEN EXISTS (SELECT 1 FROM `sales_invoices` i WHERE i.company_id = OLD.company_id AND i.id = OLD.invoice_id AND i.status != 'draft')
BEGIN
  SELECT RAISE(ABORT, 'issued invoice lines are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `sales_issued_invoice_lines_no_delete`
BEFORE DELETE ON `sales_invoice_lines`
WHEN EXISTS (SELECT 1 FROM `sales_invoices` i WHERE i.company_id = OLD.company_id AND i.id = OLD.invoice_id AND i.status != 'draft')
BEGIN
  SELECT RAISE(ABORT, 'issued invoice lines are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `sales_credit_notes_no_update`
BEFORE UPDATE ON `sales_credit_notes`
BEGIN
  SELECT RAISE(ABORT, 'credit notes are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `sales_credit_notes_no_delete`
BEFORE DELETE ON `sales_credit_notes`
BEGIN
  SELECT RAISE(ABORT, 'credit notes are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `sales_credit_note_validate_insert`
BEFORE INSERT ON `sales_credit_notes`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `sales_invoices` i
    WHERE i.company_id = NEW.company_id AND i.id = NEW.invoice_id AND i.status = 'issued'
  ) THEN RAISE(ABORT, 'credit notes require an issued invoice') END;
  SELECT CASE WHEN NEW.amount_minor + COALESCE((
    SELECT SUM(amount_minor) FROM `sales_invoice_allocations`
    WHERE company_id = NEW.company_id AND invoice_id = NEW.invoice_id
  ), 0) + COALESCE((
    SELECT SUM(amount_minor) FROM `sales_credit_notes`
    WHERE company_id = NEW.company_id AND invoice_id = NEW.invoice_id
  ), 0) > (
    SELECT total_minor FROM `sales_invoices`
    WHERE company_id = NEW.company_id AND id = NEW.invoice_id
  ) THEN RAISE(ABORT, 'credit notes cannot exceed the invoice balance') END;
END;
--> statement-breakpoint
CREATE TRIGGER `sales_invoice_issue_total_check`
BEFORE UPDATE OF `status` ON `sales_invoices`
WHEN NEW.status = 'issued' AND OLD.status != 'issued'
BEGIN
  SELECT CASE WHEN COALESCE((
    SELECT SUM(amount_minor) FROM `sales_invoice_lines`
    WHERE company_id = NEW.company_id AND invoice_id = NEW.id
  ), 0) != NEW.subtotal_minor
  THEN RAISE(ABORT, 'invoice lines must equal invoice subtotal before issue') END;
END;
--> statement-breakpoint
CREATE TRIGGER `sales_payments_no_update`
BEFORE UPDATE ON `sales_payments`
BEGIN
  SELECT RAISE(ABORT, 'customer payments are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `sales_payments_no_delete`
BEFORE DELETE ON `sales_payments`
BEGIN
  SELECT RAISE(ABORT, 'customer payments are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `sales_allocations_no_update`
BEFORE UPDATE ON `sales_invoice_allocations`
BEGIN
  SELECT RAISE(ABORT, 'payment allocations are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `sales_allocations_no_delete`
BEFORE DELETE ON `sales_invoice_allocations`
BEGIN
  SELECT RAISE(ABORT, 'payment allocations are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `sales_allocation_validate_insert`
BEFORE INSERT ON `sales_invoice_allocations`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `sales_payments` p
    JOIN `sales_invoices` i ON i.company_id = p.company_id AND i.customer_id = p.customer_id
    WHERE p.company_id = NEW.company_id AND p.id = NEW.payment_id
      AND i.company_id = NEW.company_id AND i.id = NEW.invoice_id
      AND p.currency = i.currency AND i.status = 'issued'
  ) THEN RAISE(ABORT, 'payment and issued invoice must share company, customer, and currency') END;
  SELECT CASE WHEN NEW.amount_minor + COALESCE((
    SELECT SUM(amount_minor) FROM `sales_invoice_allocations`
    WHERE company_id = NEW.company_id AND invoice_id = NEW.invoice_id
  ), 0) + COALESCE((
    SELECT SUM(amount_minor) FROM `sales_credit_notes`
    WHERE company_id = NEW.company_id AND invoice_id = NEW.invoice_id
  ), 0) > (
    SELECT total_minor FROM `sales_invoices`
    WHERE company_id = NEW.company_id AND id = NEW.invoice_id
  ) THEN RAISE(ABORT, 'invoice allocations and credits cannot exceed invoice total') END;
  SELECT CASE WHEN NEW.amount_minor + COALESCE((
    SELECT SUM(amount_minor) FROM `sales_invoice_allocations`
    WHERE company_id = NEW.company_id AND payment_id = NEW.payment_id
  ), 0) > (
    SELECT amount_minor FROM `sales_payments`
    WHERE company_id = NEW.company_id AND id = NEW.payment_id
  ) THEN RAISE(ABORT, 'payment allocations cannot exceed payment amount') END;
END;
--> statement-breakpoint
CREATE TRIGGER `sales_customer_credit_validate_insert`
BEFORE INSERT ON `sales_customer_credits`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `sales_payments` p
    WHERE p.company_id = NEW.company_id AND p.id = NEW.payment_id
      AND p.customer_id = NEW.customer_id
  ) THEN RAISE(ABORT, 'customer credit must belong to its payment customer') END;
  SELECT CASE WHEN NEW.amount_minor + COALESCE((
    SELECT SUM(amount_minor) FROM `sales_invoice_allocations`
    WHERE company_id = NEW.company_id AND payment_id = NEW.payment_id
  ), 0) + COALESCE((
    SELECT SUM(amount_minor) FROM `sales_customer_credits`
    WHERE company_id = NEW.company_id AND payment_id = NEW.payment_id
  ), 0) > (
    SELECT amount_minor FROM `sales_payments`
    WHERE company_id = NEW.company_id AND id = NEW.payment_id
  ) THEN RAISE(ABORT, 'payment allocations and customer credit cannot exceed payment amount') END;
END;
--> statement-breakpoint
CREATE TRIGGER `sales_customer_credits_no_update`
BEFORE UPDATE ON `sales_customer_credits`
BEGIN
  SELECT RAISE(ABORT, 'customer credits are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `sales_customer_credits_no_delete`
BEFORE DELETE ON `sales_customer_credits`
BEGIN
  SELECT RAISE(ABORT, 'customer credits are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `sales_idempotency_no_update`
BEFORE UPDATE ON `sales_idempotency`
BEGIN
  SELECT RAISE(ABORT, 'idempotency records are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `sales_idempotency_no_delete`
BEFORE DELETE ON `sales_idempotency`
BEGIN
  SELECT RAISE(ABORT, 'idempotency records are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `company_seed_sales_access`
AFTER INSERT ON `company`
BEGIN
  INSERT OR IGNORE INTO `permissions` (`company_id`, `permission_key`, `description`) VALUES
    (NEW.`id`, 'sales.view', 'View customers, invoices, and receivables'),
    (NEW.`id`, 'sales.create', 'Create and edit customer and draft invoice records'),
    (NEW.`id`, 'sales.issue', 'Issue invoices and credit notes'),
    (NEW.`id`, 'sales.payment', 'Record customer payments');
  INSERT OR IGNORE INTO `role_permissions` (`company_id`, `role`, `permission_key`) VALUES
    (NEW.`id`, 'admin', 'sales.view'),
    (NEW.`id`, 'admin', 'sales.create'),
    (NEW.`id`, 'admin', 'sales.issue'),
    (NEW.`id`, 'admin', 'sales.payment'),
    (NEW.`id`, 'auditor', 'sales.view');
  INSERT OR IGNORE INTO `accounts`
    (`company_id`, `id`, `code`, `name`, `type`, `normal_balance`, `is_header`, `is_postable`, `is_active`, `parent_id`, `created_at`)
    VALUES
      (NEW.`id`, 'demo-' || substr(NEW.`id`, 1, 8) || '-2200', '2200', 'Output Tax Payable [VERIFY]', 'liability', 'credit', 0, 1, 1, NULL, '2000-01-01T00:00:00.000Z'),
      (NEW.`id`, 'demo-' || substr(NEW.`id`, 1, 8) || '-2300', '2300', 'Customer Credits', 'liability', 'credit', 0, 1, 1, NULL, '2000-01-01T00:00:00.000Z');
  INSERT OR IGNORE INTO `sales_customers`
    (`company_id`, `id`, `name`, `is_active`, `created_by`, `created_at`, `updated_at`)
    VALUES (NEW.`id`, 'demo-customer-' || substr(NEW.`id`, 1, 8), 'Demo Customer', 1, NULL, '2000-01-01T00:00:00.000Z', '2000-01-01T00:00:00.000Z');
END;
