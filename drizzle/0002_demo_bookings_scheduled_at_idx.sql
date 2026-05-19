-- Partial btree index covering the rows the availability filter actually scans.
-- Mirrors the WHERE clause in every availability query and in calendar_events:
-- status NOT IN ('completed', 'cancelled'). Excluding completed/cancelled keeps
-- the index small as historical rows accumulate.
--
-- meetings already has idx_meetings_scheduled_at (non-partial) from the
-- baseline migration; demo_bookings had only its primary key until now.
--
-- Rollback:
--   DROP INDEX IF EXISTS "demo_bookings_scheduled_at_idx";
CREATE INDEX "demo_bookings_scheduled_at_idx"
  ON "demo_bookings" ("scheduled_at")
  WHERE status NOT IN ('completed', 'cancelled');
