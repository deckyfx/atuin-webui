CREATE TABLE `prune_audit` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`action` text NOT NULL,
	`profile` text NOT NULL,
	`rule` text,
	`matched_count` integer DEFAULT 0 NOT NULL,
	`sample` text,
	`succeeded` integer DEFAULT true NOT NULL,
	`output` text,
	`created_at` text DEFAULT (datetime('now','localtime')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_prune_audit_created` ON `prune_audit` (`created_at`);