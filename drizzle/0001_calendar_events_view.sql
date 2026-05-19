-- calendar_events: unified availability feed across meetings + demo_bookings.
--
-- meetings owns customer-facing bookings, scoped by company_id. demo_bookings
-- has no company_id column; demos are implicitly tenant 1 (WAK Solutions) and
-- the literal 1::integer here matches the application-level WAK_COMPANY_ID = 1
-- enforced at app/api/demo-booking/book/route.ts:36 and peers.
--
-- meeting_token is intentionally NOT in the projection: meetings.meeting_token
-- is text and demo_bookings.meeting_token is uuid — unioning them would force
-- an explicit cast on every read for a column no availability query needs.
--
-- Read-only. Writes still go to the underlying tables directly.
--
-- Rollback:
--   DROP VIEW IF EXISTS "calendar_events";
CREATE VIEW "calendar_events" AS
  SELECT
    id::text                AS id,
    company_id,
    customer_phone,
    scheduled_at,
    status,
    'meeting'::text         AS source
  FROM meetings
  WHERE status NOT IN ('completed', 'cancelled')

  UNION ALL

  SELECT
    id::text                AS id,
    1::integer              AS company_id,
    NULL::text              AS customer_phone,
    scheduled_at,
    status,
    'demo'::text            AS source
  FROM demo_bookings
  WHERE status NOT IN ('completed', 'cancelled');
