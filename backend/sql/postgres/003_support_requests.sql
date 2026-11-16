-- sql/postgres/003_support_requests.sql
-- support_requests - a write-only log of every support form send, written
-- pending -> sent/failed by routers/support.py. Best-effort: the email goes even
-- when this insert fails, so it is a record, not a gate. A row left at
-- 'pending' marks a crash mid-send. The sender columns come from the validated
-- token, never from the form. Images are attached to the email and never
-- stored; only their file names are kept. Nothing in the app reads this table.
--
-- `environment` is the code (loc/sbx/uat/prd) of the deployment that sent it:
-- local dev and sbx can share a database.
--
-- DDL is an owner step: run as the schema owner in each environment's database,
-- then re-run 999_grants.sql. Safe to run twice.

CREATE TABLE IF NOT EXISTS pace.support_requests (
    id            SERIAL PRIMARY KEY,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    environment   VARCHAR(20)  NOT NULL,
    sender_id     VARCHAR(100),
    sender_name   VARCHAR(255),
    sender_email  VARCHAR(255),
    kind          VARCHAR(20)  NOT NULL,
    subject       VARCHAR(200) NOT NULL,
    body          TEXT         NOT NULL,
    image_names   TEXT[],
    status        VARCHAR(10)  NOT NULL DEFAULT 'pending',
    error         TEXT,
    CONSTRAINT chk_support_status CHECK (status IN ('pending', 'sent', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_support_requests_created
    ON pace.support_requests (created_at);
