-- REVIEW ONLY — do not execute against production without explicit approval.
-- Purpose: zero confirmed coins on legacy GROUP bombed rounds.
-- Compatible with current production CHECK (0004): bombed captured_coins BETWEEN 0 AND 2.
--
-- Preflight (read-only):
--   SELECT count(*) AS bad_rounds
--   FROM group_round_attempts
--   WHERE status = 'bombed' AND captured_coins <> 0;
--
--   SELECT count(DISTINCT group_id) AS bad_groups,
--          count(DISTINCT participant_id) AS bad_participants
--   FROM group_round_attempts
--   WHERE status = 'bombed' AND captured_coins <> 0;
--
-- Transactional repair:

BEGIN;

SELECT count(*) AS before_bad_rounds
FROM group_round_attempts
WHERE status = 'bombed' AND captured_coins <> 0;

UPDATE group_round_attempts
SET
  captured_coins = 0,
  version = version + 1
WHERE status = 'bombed'
  AND captured_coins <> 0;

SELECT count(*) AS after_bad_rounds
FROM group_round_attempts
WHERE status = 'bombed' AND captured_coins <> 0;

-- Expect after_bad_rounds = 0 before COMMIT.
-- ROLLBACK;  -- use if verification fails
COMMIT;

-- Postflight:
--   SELECT status, captured_coins, count(*)
--   FROM group_round_attempts
--   GROUP BY status, captured_coins
--   ORDER BY status, captured_coins;
