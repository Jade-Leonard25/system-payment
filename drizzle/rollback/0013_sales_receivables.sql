CREATE TABLE IF NOT EXISTS `_sales_rollback_guard` (
  `allow_rollback` integer NOT NULL CHECK (`allow_rollback` = 0)
);
INSERT INTO `_sales_rollback_guard` (`allow_rollback`)
SELECT CASE WHEN
  EXISTS (SELECT 1 FROM `sales_customers` WHERE `id` NOT LIKE 'demo-customer-%') OR
  EXISTS (SELECT 1 FROM `sales_invoices`) OR
  EXISTS (SELECT 1 FROM `sales_payments`) OR
  EXISTS (SELECT 1 FROM `sales_credit_notes`) OR
  EXISTS (SELECT 1 FROM `journal_lines` l JOIN `accounts` a ON a.company_id=l.company_id AND a.id=l.account_id WHERE a.code IN ('2200', '2300'))
THEN 1 ELSE 0 END;
DROP TABLE `_sales_rollback_guard`;
DROP TRIGGER IF EXISTS `company_seed_sales_access`;
DROP TRIGGER IF EXISTS `sales_allocations_no_delete`;
DROP TRIGGER IF EXISTS `sales_allocations_no_update`;
DROP TRIGGER IF EXISTS `sales_customer_credit_validate_insert`;
DROP TRIGGER IF EXISTS `sales_customer_credits_no_delete`;
DROP TRIGGER IF EXISTS `sales_customer_credits_no_update`;
DROP TRIGGER IF EXISTS `sales_idempotency_no_delete`;
DROP TRIGGER IF EXISTS `sales_idempotency_no_update`;
DROP TRIGGER IF EXISTS `sales_allocation_validate_insert`;
DROP TRIGGER IF EXISTS `sales_payments_no_delete`;
DROP TRIGGER IF EXISTS `sales_payments_no_update`;
DROP TRIGGER IF EXISTS `sales_credit_notes_no_delete`;
DROP TRIGGER IF EXISTS `sales_credit_notes_no_update`;
DROP TRIGGER IF EXISTS `sales_issued_invoice_lines_no_delete`;
DROP TRIGGER IF EXISTS `sales_issued_invoice_lines_no_update`;
DROP TRIGGER IF EXISTS `sales_issued_invoice_lines_no_insert`;
DROP TRIGGER IF EXISTS `sales_issued_invoice_no_delete`;
DROP TRIGGER IF EXISTS `sales_issued_invoice_no_update`;
DROP TABLE IF EXISTS `sales_customer_credits`;
DROP TABLE IF EXISTS `sales_invoice_allocations`;
DROP TABLE IF EXISTS `sales_payments`;
DROP TABLE IF EXISTS `sales_credit_notes`;
DROP TABLE IF EXISTS `sales_invoice_lines`;
DROP TABLE IF EXISTS `sales_invoices`;
DELETE FROM `sales_customers` WHERE `id` LIKE 'demo-customer-%';
DROP TABLE IF EXISTS `sales_customers`;
DROP TABLE IF EXISTS `sales_idempotency`;
DELETE FROM `role_permissions` WHERE `permission_key` LIKE 'sales.%';
DELETE FROM `permissions` WHERE `permission_key` LIKE 'sales.%';
DELETE FROM `accounts` WHERE `code` = '2200' AND `id` LIKE 'demo-%';
DELETE FROM `accounts` WHERE `code` = '2300' AND `id` LIKE 'demo-%';
