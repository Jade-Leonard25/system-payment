CREATE TABLE `company_audit_write_guards` (
  `company_id` text NOT NULL,
  `guard_id` text NOT NULL,
  `cas_result` integer,
  `mutation_result` integer,
  PRIMARY KEY (`company_id`, `guard_id`),
  CHECK (`cas_result` IS NULL OR `cas_result` = 1),
  CHECK (`mutation_result` IS NULL OR `mutation_result` = 1),
  FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade
);
