ALTER TABLE `prune_audit` ADD `status` text DEFAULT 'pending' NOT NULL;
--> statement-breakpoint
-- Backfill from the column this supersedes, so rows written before
-- the tri-state existed do not all read as "outcome unknown".
UPDATE `prune_audit` SET `status` = CASE WHEN `succeeded` = 1 THEN 'succeeded' ELSE 'failed' END;
