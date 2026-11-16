-- The business state (projects, tasks, people, proposals, changelog, clock).
--
-- One JSONB document, not normalised tables. The spike's engine owns this shape and
-- mutates it in place (app/pace/store.py); normalising it would mean rewriting every
-- tool and would make the web copy and the terminal copy disagree. A serverless host
-- has no durable disk, so this row is where it actually lives.
--
-- Single row, last-write-wins. That is honest for one founder looking at their own work
-- and would not survive a second concurrent writer.
--
-- Applied by a DBA/owner: the app role cannot run DDL. Re-run 999_grants.sql afterwards.

CREATE TABLE IF NOT EXISTS pace.pace_state (
    key        TEXT        PRIMARY KEY,
    state      JSONB       NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
