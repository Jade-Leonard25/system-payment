CREATE TABLE IF NOT EXISTS `_invoice_branding_rollback_guard` (
  `allow_rollback` integer NOT NULL CHECK (`allow_rollback` = 0)
);
INSERT INTO `_invoice_branding_rollback_guard` (`allow_rollback`)
SELECT CASE WHEN
  EXISTS (SELECT 1 FROM `sales_invoices`) OR
  EXISTS (SELECT 1 FROM `sales_invoice_templates` WHERE `updated_by` IS NOT NULL)
THEN 1 ELSE 0 END;
DROP TABLE `_invoice_branding_rollback_guard`;
DROP TRIGGER IF EXISTS `company_seed_sales_invoice_defaults`;
DROP TRIGGER IF EXISTS `sales_issued_invoice_profile_no_update`;
DELETE FROM `sales_customers` WHERE `id` LIKE 'demo-customer-%-2';
DROP TABLE IF EXISTS `sales_invoice_series`;
DROP TABLE IF EXISTS `sales_invoice_templates`;
DROP INDEX IF EXISTS `sales_invoices_company_batch_idx`;
ALTER TABLE `sales_invoices` DROP COLUMN `discount_value`;
ALTER TABLE `sales_invoices` DROP COLUMN `discount_type`;
ALTER TABLE `sales_invoices` DROP COLUMN `tax_inclusive`;
ALTER TABLE `sales_invoices` DROP COLUMN `discount_minor`;
ALTER TABLE `sales_invoices` DROP COLUMN `batch_id`;
ALTER TABLE `sales_invoices` DROP COLUMN `invoice_template_json`;
ALTER TABLE `sales_invoices` DROP COLUMN `issuer_profile_json`;
