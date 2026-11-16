"""Pre-flight database readiness check — run as the *application* login role.

This does **not** create anything. In Synveon environments the app connects as a
low-privilege login role with **no DDL rights**: it cannot create schemas or
tables. A DBA/owner stands the database up once per environment by applying the
plain SQL in `sql/postgres/` with an admin/owner account — the table DDL (`001_schema.sql`,
`002_items.sql`, …) and then `999_grants.sql`, which grants this app role the DML
it needs. See the backend README ("Database setup") and `_deploy/README.md`.

This script connects as the application role (`POSTGRES_URL`) and verifies the
DBA's work is in place before you run the app or seed:

  * every ORM-mapped schema exists,
  * every ORM-mapped table exists and the app role can SELECT it
    (proves USAGE on the schema + SELECT on the table), and
  * the app role holds INSERT/UPDATE/DELETE on it (proves `999_grants.sql` ran).

It exits non-zero with actionable guidance if anything is missing, so a
half-provisioned database is caught early rather than at the first request.

Run with:  uv run python -m scripts.postgres.setup_db
"""

import asyncio
import importlib
import pkgutil

from sqlalchemy import text

from app.sources.postgres import models as models_pkg
from app.sources.postgres.models.base import Base
from app.sources.postgres.session import dispose_engine, init_engine

# DML the app needs at runtime and for seeding; granted by sql/postgres/999_grants.sql.
REQUIRED_DML = ("INSERT", "UPDATE", "DELETE")


def _load_all_models() -> None:
    """Import every module under the models package so Base.metadata is complete.

    Models only register on `Base.metadata` when their module is imported. The
    app imports them transitively via the routers; here we import them directly
    so the check covers every entity without having to list them."""
    for mod in pkgutil.iter_modules(models_pkg.__path__):
        if mod.name != "base":
            importlib.import_module(f"{models_pkg.__name__}.{mod.name}")


DBA_GUIDANCE = (
    "DATABASE NOT READY. A DBA/owner must apply the DDL + grants with an "
    "admin/owner account (the app role cannot). From backend/, for example:\n"
    '    psql "$ADMIN_POSTGRES_URL" -f sql/postgres/001_schema.sql\n'
    '    psql "$ADMIN_POSTGRES_URL" -f sql/postgres/002_items.sql   # + every other sql/postgres/NNN_*.sql\n'
    '    psql "$ADMIN_POSTGRES_URL" -f sql/postgres/999_grants.sql'
)


async def main() -> None:
    _load_all_models()
    tables = list(Base.metadata.tables.values())
    schemas = sorted({t.schema for t in tables if t.schema})

    problems: list[str] = []
    engine = init_engine()
    try:
        async with engine.connect() as conn:
            for schema in schemas:
                if await conn.scalar(text("SELECT to_regnamespace(:s)"), {"s": schema}) is None:
                    problems.append(f"schema '{schema}' does not exist")

            for t in tables:
                fq = f"{t.schema}.{t.name}" if t.schema else t.name
                quoted = f'"{t.schema}"."{t.name}"' if t.schema else f'"{t.name}"'

                if await conn.scalar(text("SELECT to_regclass(:t)"), {"t": fq}) is None:
                    problems.append(f"table {fq} does not exist")
                    continue

                # A real SELECT proves USAGE on the schema *and* SELECT on the table.
                try:
                    await conn.execute(text(f"SELECT 1 FROM {quoted} LIMIT 1"))
                except Exception as exc:  # surface any access failure as "not ready"
                    await conn.rollback()
                    problems.append(
                        f"table {fq}: app role cannot SELECT "
                        f"(missing USAGE on schema or SELECT grant?) [{exc.__class__.__name__}]"
                    )
                    continue

                missing = [
                    priv
                    for priv in REQUIRED_DML
                    if not await conn.scalar(
                        text("SELECT has_table_privilege(:t, :p)"), {"t": fq, "p": priv}
                    )
                ]
                if missing:
                    problems.append(
                        f"table {fq}: app role lacks {', '.join(missing)} "
                        "(apply sql/postgres/999_grants.sql as the owner)"
                    )
                else:
                    print(f"  ok   {fq} (SELECT + {'/'.join(REQUIRED_DML)})")
    finally:
        await dispose_engine()

    if problems:
        print()
        for p in problems:
            print(f"  MISSING: {p}")
        print()
        print(DBA_GUIDANCE)
        raise SystemExit(1)

    print(
        f"\nDatabase ready: {len(tables)} table(s) present and accessible. Run scripts.postgres.seed next."
    )


if __name__ == "__main__":
    asyncio.run(main())
