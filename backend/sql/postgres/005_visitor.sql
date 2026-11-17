-- One world per visitor, one log for all of them.
--
-- Until now there was a single state document (key 'current') and
-- `latest_session_id` handed every caller the most recently touched session. Two people
-- on the review link therefore shared one world AND one conversation: they watched each
-- other type, last write won, and the second reviewer opened an app whose planted
-- problems the first had already cleaned up. That last part is what made it worth
-- fixing — it quietly destroys the comparability the ratings exist to provide.
--
-- So state and conversations are now partitioned by visitor, while chat_events and
-- chat_ratings stay global: the log is the deliverable and it is read across everybody.
--
-- A visitor id is a random value minted by the browser (frontend/src/visitor.ts), not an
-- identity. It says "same browser as before", nothing more, and it is validated against
-- a strict charset before it reaches SQL (app/core/visitor.py).
--
-- 'solo' is the default for a caller that sends no id: the terminal spike, curl, and
-- local dev. It maps to the pre-existing 'current' state row, so nothing already stored
-- is moved, rewritten or orphaned by this migration.
--
-- Applied by a DBA/owner: the app role cannot run DDL. Re-run 999_grants.sql afterwards.

ALTER TABLE pace.chat_sessions
    ADD COLUMN IF NOT EXISTS visitor TEXT NOT NULL DEFAULT 'solo';

-- Resuming is "the latest session for this seed AND this visitor", so that is the index.
CREATE INDEX IF NOT EXISTS ix_chat_sessions_visitor_seed
    ON pace.chat_sessions (visitor, seed, updated_at DESC);
