CREATE TABLE `key_product` (
	`id` text PRIMARY KEY NOT NULL,
	`key_selector` text NOT NULL,
	`key_hash` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `key_product_key_selector_unique` ON `key_product` (`key_selector`);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);
