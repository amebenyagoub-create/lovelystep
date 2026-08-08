CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`reference` text NOT NULL,
	`customer_name` text NOT NULL,
	`phone` text NOT NULL,
	`address` text NOT NULL,
	`city` text NOT NULL,
	`postal_code` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`items_json` text NOT NULL,
	`item_count` integer NOT NULL,
	`subtotal_cents` integer NOT NULL,
	`delivery_cents` integer NOT NULL,
	`total_cents` integer NOT NULL,
	`status` text DEFAULT 'pending_confirmation' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_reference_unique` ON `orders` (`reference`);--> statement-breakpoint
CREATE INDEX `idx_orders_status_created_at` ON `orders` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_orders_phone_created_at` ON `orders` (`phone`,`created_at`);--> statement-breakpoint
PRAGMA optimize;
