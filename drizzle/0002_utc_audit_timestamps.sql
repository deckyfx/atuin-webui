-- prune_audit.created_at was created with a localtime default in 0000. The
-- schema was later changed to UTC, but SQLite column defaults cannot be
-- altered in place, so every existing database kept writing local time while
-- the UI rendered those values as UTC — displaying them shifted by the
-- server's offset (seven hours ahead on the machine this was found on).
--
-- Rebuild the table with the UTC default and convert the rows already stored.
CREATE TABLE `prune_audit_utc` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`action` text NOT NULL,
	`profile` text NOT NULL,
	`rule` text,
	`matched_count` integer DEFAULT 0 NOT NULL,
	`sample` text,
	`succeeded` integer DEFAULT true NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`output` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
-- datetime(x,'utc') reads x as local time and returns the UTC instant.
INSERT INTO `prune_audit_utc`
	(`id`, `action`, `profile`, `rule`, `matched_count`, `sample`, `succeeded`, `status`, `output`, `created_at`)
SELECT `id`, `action`, `profile`, `rule`, `matched_count`, `sample`, `succeeded`, `status`, `output`,
	datetime(`created_at`, 'utc')
FROM `prune_audit`;
--> statement-breakpoint
DROP TABLE `prune_audit`;
--> statement-breakpoint
ALTER TABLE `prune_audit_utc` RENAME TO `prune_audit`;
--> statement-breakpoint
CREATE INDEX `idx_prune_audit_created` ON `prune_audit` (`created_at`);
