ALTER TABLE `sales_invoices`
ADD COLUMN `issuer_profile_json` text NOT NULL DEFAULT '{}'
CHECK (json_valid(`issuer_profile_json`));
--> statement-breakpoint
ALTER TABLE `sales_invoices`
ADD COLUMN `invoice_template_json` text NOT NULL DEFAULT '{}'
CHECK (json_valid(`invoice_template_json`));
--> statement-breakpoint
ALTER TABLE `sales_invoices`
ADD COLUMN `batch_id` text;
--> statement-breakpoint
CREATE INDEX `sales_invoices_company_batch_idx`
ON `sales_invoices` (`company_id`, `batch_id`);
--> statement-breakpoint
ALTER TABLE `sales_invoices`
ADD COLUMN `discount_minor` integer NOT NULL DEFAULT 0 CHECK (`discount_minor` >= 0);
--> statement-breakpoint
ALTER TABLE `sales_invoices`
ADD COLUMN `tax_inclusive` integer NOT NULL DEFAULT 0 CHECK (`tax_inclusive` IN (0, 1));
--> statement-breakpoint
ALTER TABLE `sales_invoices`
ADD COLUMN `discount_type` text CHECK (`discount_type` IN ('fixed', 'percent') OR `discount_type` IS NULL);
--> statement-breakpoint
ALTER TABLE `sales_invoices`
ADD COLUMN `discount_value` integer NOT NULL DEFAULT 0 CHECK (`discount_value` >= 0);
--> statement-breakpoint
CREATE TRIGGER `sales_issued_invoice_profile_no_update`
BEFORE UPDATE ON `sales_invoices`
WHEN OLD.status = 'issued' AND (
  NEW.issuer_profile_json IS NOT OLD.issuer_profile_json OR
  NEW.invoice_template_json IS NOT OLD.invoice_template_json OR
  NEW.batch_id IS NOT OLD.batch_id OR
  NEW.discount_minor IS NOT OLD.discount_minor OR
  NEW.tax_inclusive IS NOT OLD.tax_inclusive OR
  NEW.discount_type IS NOT OLD.discount_type OR
  NEW.discount_value IS NOT OLD.discount_value
)
BEGIN
  SELECT RAISE(ABORT, 'issued invoice branding and batch details are immutable');
END;
--> statement-breakpoint
CREATE TABLE `sales_invoice_templates` (
  `company_id` text NOT NULL,
  `issuer_profile_json` text NOT NULL CHECK (json_valid(`issuer_profile_json`)),
  `template_json` text NOT NULL CHECK (json_valid(`template_json`)),
  `updated_by` text,
  `updated_at` text NOT NULL,
  PRIMARY KEY (`company_id`),
  FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `sales_invoice_templates` (`company_id`, `issuer_profile_json`, `template_json`, `updated_by`, `updated_at`)
SELECT `id`,
  json_object(
    'name', `name`,
    'legalName', `legal_name`,
    'address', `address`,
    'email', `email`,
    'phone', `contact_number`,
    'logo', CASE
      WHEN `company_logo` LIKE 'https://%' OR `company_logo` LIKE 'data:image/png;base64,%'
        OR `company_logo` LIKE 'data:image/jpeg;base64,%' OR `company_logo` LIKE 'data:image/webp;base64,%'
      THEN `company_logo` ELSE '' END
  ),
  json_object(
    'title', 'INVOICE',
    'accentColor', '#111827',
    'layout', 'clean',
    'logoSize', 'medium',
    'logoAlignment', 'left',
    'visibility', json_object(
      'logo', json('true'), 'customerEmail', json('true'), 'reference', json('true'), 'discount', json('true'),
      'tax', json('true'), 'paymentNotes', json('true'), 'preparedBy', json('false')
    ),
    'paymentInstructions', '',
    'terms', '',
    'preparedBy', ''
  ),
  NULL,
  '2000-01-01T00:00:00.000Z'
FROM `company`;
--> statement-breakpoint
INSERT OR IGNORE INTO `sales_customers`
  (`company_id`,`id`,`name`,`email`,`phone`,`billing_address`,`is_active`,`created_by`,`created_at`,`updated_at`)
SELECT `id`, 'demo-customer-' || substr(`id`, 1, 8) || '-2',
  'Demo Customer 2', 'customer2@example.test', NULL, 'Demo billing address', 1, NULL,
  '2000-01-01T00:00:00.000Z', '2000-01-01T00:00:00.000Z'
FROM `company`;
--> statement-breakpoint
CREATE TABLE `sales_invoice_series` (
  `company_id` text NOT NULL,
  `id` text NOT NULL,
  `prefix` text NOT NULL,
  `next_number` integer NOT NULL DEFAULT 1 CHECK (`next_number` > 0),
  `padding` integer NOT NULL DEFAULT 6 CHECK (`padding` BETWEEN 1 AND 12),
  PRIMARY KEY (`company_id`, `id`),
  UNIQUE (`company_id`, `prefix`),
  FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `sales_invoice_series` (`company_id`, `id`, `prefix`, `next_number`, `padding`)
SELECT `id`, 'sales-invoice-' || substr(`id`, 1, 12), 'INV-', 1, 6 FROM `company`;
--> statement-breakpoint
CREATE TRIGGER `company_seed_sales_invoice_defaults`
AFTER INSERT ON `company`
BEGIN
  INSERT INTO `sales_invoice_templates` (`company_id`, `issuer_profile_json`, `template_json`, `updated_by`, `updated_at`)
  VALUES (
    NEW.`id`,
    json_object(
      'name', NEW.`name`, 'legalName', NEW.`legal_name`, 'address', NEW.`address`,
      'email', NEW.`email`, 'phone', NEW.`contact_number`, 'logo', ''
    ),
    json_object(
      'title', 'INVOICE', 'accentColor', '#111827', 'layout', 'clean',
      'logoSize', 'medium', 'logoAlignment', 'left',
      'visibility', json_object(
        'logo', json('true'), 'customerEmail', json('true'), 'reference', json('true'), 'discount', json('true'),
        'tax', json('true'), 'paymentNotes', json('true'), 'preparedBy', json('false')
      ),
      'paymentInstructions', '', 'terms', '', 'preparedBy', ''
    ),
    NULL,
    '2000-01-01T00:00:00.000Z'
  );
  INSERT INTO `sales_invoice_series` (`company_id`, `id`, `prefix`, `next_number`, `padding`)
  VALUES (NEW.`id`, 'sales-invoice-' || substr(NEW.`id`, 1, 12), 'INV-', 1, 6);
  INSERT INTO `sales_customers`
    (`company_id`,`id`,`name`,`email`,`phone`,`billing_address`,`is_active`,`created_by`,`created_at`,`updated_at`)
  VALUES (
    NEW.`id`, 'demo-customer-' || substr(NEW.`id`, 1, 8) || '-2',
    'Demo Customer 2', 'customer2@example.test', NULL, 'Demo billing address', 1, NULL,
    '2000-01-01T00:00:00.000Z', '2000-01-01T00:00:00.000Z'
  );
END;
