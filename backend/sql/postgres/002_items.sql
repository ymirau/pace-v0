CREATE TABLE IF NOT EXISTS pace.items (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(120) NOT NULL,
    description VARCHAR(500),
    category    VARCHAR(80),
    amount      NUMERIC(12, 2),
    date        DATE
);

-- For an existing items table, the DBA/owner adds the new columns (CREATE TABLE
-- IF NOT EXISTS won't alter an existing table):
--   ALTER TABLE pace.items ADD COLUMN IF NOT EXISTS category VARCHAR(80);
--   ALTER TABLE pace.items ADD COLUMN IF NOT EXISTS amount   NUMERIC(12, 2);
--   ALTER TABLE pace.items ADD COLUMN IF NOT EXISTS date     DATE;
