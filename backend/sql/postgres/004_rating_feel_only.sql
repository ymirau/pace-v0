-- One press is a whole rating: the cleanup score becomes optional.
--
-- 002_chat.sql required both halves — how it felt AND what it cost to clean up — and
-- that was wrong for the question v0 is actually asking. Magic-or-annoying is a gut
-- reaction worth one tap in the moment; cleanup cost is something you only know after
-- you have used the reply. Requiring both meant a turn that felt annoying went unrated
-- because the founder had not edited anything yet, and an unrated turn is lost evidence.
--
-- `feel` stays NOT NULL: a rating with no feel is not a rating.
--
-- Applied by a DBA/owner: the app role cannot run DDL. Re-run 999_grants.sql afterwards.
-- Re-runnable — DROP NOT NULL on a column that is already nullable is a no-op.

ALTER TABLE pace.chat_ratings ALTER COLUMN score DROP NOT NULL;
