-- Pace chat: sessions, the append-only event log, and ratings.
--
-- "Logging is the real product" (the spike's CLAUDE.md §7). The backend also writes
-- JSONL files, but a serverless host has no durable disk, so Postgres is the copy that
-- survives and the one the Log page reads.
--
-- Applied by a DBA/owner: the app role cannot run DDL. Re-run 999_grants.sql afterwards.

CREATE TABLE IF NOT EXISTS pace.chat_sessions (
    id             TEXT PRIMARY KEY,
    started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    model          TEXT        NOT NULL,
    prompt_version TEXT        NOT NULL,
    seed           TEXT        NOT NULL,
    sim_today      DATE,
    -- The conversation itself, as the Messages API shapes it. A serverless request
    -- rebuilds the agent from this instead of relying on process memory.
    messages       JSONB       NOT NULL DEFAULT '[]'::jsonb,
    -- The founder/business snapshot, so an old session still reads sensibly.
    founder        JSONB       NOT NULL DEFAULT '{}'::jsonb
);

-- Mirrors the JSONL transcript one row per line: session_start, user, tool_call,
-- tool_result, assistant, proposal, rating, clock, session_end.
CREATE TABLE IF NOT EXISTS pace.chat_events (
    id         BIGSERIAL   PRIMARY KEY,
    session_id TEXT        NOT NULL REFERENCES pace.chat_sessions(id) ON DELETE CASCADE,
    seq        INTEGER     NOT NULL,
    type       TEXT        NOT NULL,
    payload    JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_chat_events_session_id ON pace.chat_events (session_id);
CREATE INDEX IF NOT EXISTS ix_chat_events_type ON pace.chat_events (type);
CREATE UNIQUE INDEX IF NOT EXISTS ux_chat_events_session_seq
    ON pace.chat_events (session_id, seq);

-- Ratings get their own table, not just an event row: a turn can be re-rated (the
-- primary key makes that an update), and the close-out stats query them directly.
CREATE TABLE IF NOT EXISTS pace.chat_ratings (
    session_id TEXT        NOT NULL REFERENCES pace.chat_sessions(id) ON DELETE CASCADE,
    turn       INTEGER     NOT NULL,
    score      SMALLINT    NOT NULL,
    feel       TEXT        NOT NULL,
    note       TEXT        NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (session_id, turn),
    CONSTRAINT ck_chat_ratings_score CHECK (score BETWEEN 0 AND 3),
    CONSTRAINT ck_chat_ratings_feel CHECK (feel IN ('magic', 'annoying', 'meh'))
);

CREATE INDEX IF NOT EXISTS ix_chat_ratings_session_id ON pace.chat_ratings (session_id);
