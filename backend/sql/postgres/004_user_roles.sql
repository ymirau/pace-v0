-- sql/postgres/004_user_roles.sql
-- user_roles - who is an admin (app/core/roles.py). Sparse by design: only admins
-- need a row. A signed-in user with NO row is a plain 'user', so a missing row
-- never locks anyone out. Email is the identity key, stored lowercased (the app
-- lowercases before writing and looking up). display_name ("Jane Smith") is a
-- display copy from the Entra people picker on Admin -> Users.
--
-- DDL is an owner step: run as the schema owner in each environment's database,
-- then re-run 999_grants.sql. Safe to run twice.

CREATE TABLE IF NOT EXISTS pace.user_roles (
    id           SERIAL PRIMARY KEY,
    display_name VARCHAR(256),
    email        VARCHAR(320) NOT NULL UNIQUE,
    role         VARCHAR(20)  NOT NULL,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT ck_user_roles_role CHECK (role IN ('admin', 'user'))
);

-- The first admin, so the Admin page is reachable on a fresh environment.
-- /syn-init-webapp replaces the placeholders with the developer's git name and
-- email; change them here (before the first run) if someone else should be the
-- first admin.
-- Re-running never clobbers an existing row.
INSERT INTO pace.user_roles (display_name, email, role)
VALUES ('Inji Choe', 'injic05@gmail.com', 'admin')
ON CONFLICT (email) DO NOTHING;
