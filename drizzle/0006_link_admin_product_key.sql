ALTER TABLE `user_admin` ADD `key_product_id` text REFERENCES key_product(id);--> statement-breakpoint
CREATE UNIQUE INDEX `user_admin_key_product_id_unique` ON `user_admin` (`key_product_id`);