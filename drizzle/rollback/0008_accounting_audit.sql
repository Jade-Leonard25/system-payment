-- Refuse rollback after an immutable audit event has been recorded.
CREATE TABLE IF NOT EXISTS `_audit_rollback_guard` (
  `allow_rollback` integer NOT NULL CHECK (`allow_rollback` = 0)
);
INSERT INTO `_audit_rollback_guard` (`allow_rollback`)
SELECT CASE WHEN EXISTS (SELECT 1 FROM `company_audit_events`) THEN 1 ELSE 0 END;
DROP TABLE `_audit_rollback_guard`;
DROP TRIGGER IF EXISTS `company_seed_accounting_access`;
DROP TRIGGER IF EXISTS `company_audit_events_no_delete`;
DROP TRIGGER IF EXISTS `company_audit_events_no_update`;
DROP TABLE IF EXISTS `company_audit_write_guards`;
DROP TABLE IF EXISTS `company_audit_events`;
DROP TABLE IF EXISTS `company_audit_heads`;
DROP TABLE IF EXISTS `role_permissions`;
DROP TABLE IF EXISTS `permissions`;
DROP TABLE IF EXISTS `company_memberships`;
