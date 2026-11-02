-- One-off repair (IVR-CRM): calls saved as missed while they were still ringing, before commit 74d2760.
-- Paste the whole file into the Supabase SQL Editor of the database production uses. No deploy is needed, before or after.
--
-- Why: Smartflo sends two webhooks per call, "received" while it rings (billsec 0) and "hangup" once it ends. The old code took the
-- billsec 0 on "received" as a finished call nobody picked up, so ringing calls were saved as missed (status 'missed', or 'unknown' when
-- the payload had no call_status; the Calls page shows both as missed). Every webhook is kept as it arrived in ivr_call_events, so this
-- re-reads them with the new rule and corrects ivr_calls:
--   1. a missed call whose webhooks include a hang-up with billsec above 0   -> 'answered' (outcome answered, talk time = that billsec)
--   2. a missed call whose webhooks include no hang-up at all (only received) -> 'ongoing' (no outcome)
-- Anything else is left alone: calls with no webhook events (they came from the sync), hang-ups with billsec 0 (really missed), and
-- every other status. The event's trigger column is not trusted (older rows have it empty or guessed the old way); each payload is read
-- the way the app now reads it: a named trigger if the payload has one, otherwise an end time, a hang-up cause or billsec above 0 means
-- hang-up.
--
-- HOW TO RUN
--   First run it exactly as it is: it ends in ROLLBACK, so nothing is saved, and the last result lists every call it would change
--   (old -> new status). When the list looks right, change the last line from ROLLBACK to COMMIT and run it again.
--   Safe to run more than once: a corrected call is no longer missed, so a second run changes nothing.
--
-- WHAT IT DOES NOT DO
--   A member whose call becomes answered stays in their current pipeline stage (an answered inbound call would normally move New or
--   Attempted to Connected); move them by hand if needed. A call that becomes 'ongoing' stays ongoing until Smartflo reports its end:
--   Integrations -> "Backfill 30 days" reads the call records and finishes those calls with Smartflo's own status.
--
-- UNDO (after a COMMIT): the old values are kept in ivr_call_status_fix_backup.
--   UPDATE ivr_calls c SET status = b.status::ivr_call_status, outcome = b.outcome::ivr_call_outcome, answered_sec = b.answered_sec
--   FROM ivr_call_status_fix_backup b WHERE b.id = c.id;
--   DROP TABLE ivr_call_status_fix_backup;   -- once you are happy, this table can be dropped anyway

BEGIN;

-- The calls to correct, worked out once before anything changes. Each webhook is read the way normalize.ts webhookEvent() now reads it
-- ("$"-prefixed keys too, as Smartflo templates may keep them).
CREATE TEMP TABLE ivr_status_fix ON COMMIT DROP AS
WITH ev AS (
  SELECT
    e.call_id,
    lower(trim(coalesce(e.payload->>'trigger', e.payload->>'$trigger', e.payload->>'event', e.payload->>'$event',
                        e.payload->>'event_type', e.payload->>'$event_type', e.payload->>'call_event', e.payload->>'$call_event', ''))) AS named,
    CASE WHEN trim(coalesce(e.payload->>'billsec', e.payload->>'$billsec', '')) ~ '^\d+$'
         THEN trim(coalesce(e.payload->>'billsec', e.payload->>'$billsec'))::int ELSE 0 END AS billsec,
    trim(coalesce(e.payload->>'end_stamp', e.payload->>'$end_stamp', '')) AS end_stamp,
    trim(coalesce(e.payload->>'hangup_cause', e.payload->>'$hangup_cause', '')) AS hangup_cause
  FROM ivr_call_events e
  WHERE e.call_id IS NOT NULL
),
kind AS (
  SELECT call_id, billsec,
    CASE WHEN named <> '' THEN named ~ '(hang|end|complet|disconnect)'
         ELSE (end_stamp ~ '^[1-9]\d{3}-\d{2}-\d{2}' OR end_stamp ~ '^\d{9,13}$' OR hangup_cause <> '' OR billsec > 0) END AS is_hangup
  FROM ev
),
per_call AS (
  SELECT call_id, bool_or(is_hangup) AS any_hangup, coalesce(max(billsec) FILTER (WHERE is_hangup), 0) AS hangup_billsec
  FROM kind GROUP BY call_id
)
SELECT c.id, c.smartflo_call_id, c.status AS old_status,
  CASE WHEN p.hangup_billsec > 0 THEN 'answered' ELSE 'ongoing' END AS new_status,
  p.hangup_billsec
FROM ivr_calls c
JOIN per_call p ON p.call_id = c.smartflo_call_id
WHERE c.status IN ('missed', 'unknown')
  AND (p.hangup_billsec > 0 OR NOT p.any_hangup);

CREATE TABLE IF NOT EXISTS ivr_call_status_fix_backup (
  id uuid PRIMARY KEY,
  status text NOT NULL,
  outcome text,
  answered_sec integer NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO ivr_call_status_fix_backup (id, status, outcome, answered_sec)
SELECT c.id, c.status::text, c.outcome::text, c.answered_sec
FROM ivr_calls c JOIN ivr_status_fix f ON f.id = c.id
ON CONFLICT (id) DO NOTHING;

-- 1. A hang-up with talk time: answered.
UPDATE ivr_calls c
SET status = 'answered', outcome = 'answered', answered_sec = greatest(c.answered_sec, f.hangup_billsec), updated_at = now()
FROM ivr_status_fix f
WHERE f.id = c.id AND f.new_status = 'answered';

-- 2. Only "received", never a hang-up: still ongoing as far as Smartflo has told us.
UPDATE ivr_calls c
SET status = 'ongoing', outcome = NULL, updated_at = now()
FROM ivr_status_fix f
WHERE f.id = c.id AND f.new_status = 'ongoing';

-- What changed (or would change, under ROLLBACK).
SELECT b.id, c.smartflo_call_id, c.direction, c.customer_number, c.started_at, b.status AS old_status, c.status AS new_status, c.answered_sec
FROM ivr_call_status_fix_backup b JOIN ivr_calls c ON c.id = b.id
WHERE b.saved_at >= now()   -- this run's rows only (now() is the transaction's start time)
ORDER BY c.started_at DESC;

ROLLBACK;
