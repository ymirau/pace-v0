import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import health, items, me, reports, sources, support, user_roles
from app.sources.postgres.session import dispose_engine, init_engine
from app.sources.sqlserver.session import dispose_engine as dispose_sqlserver_engine


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_engine()
    try:
        yield
    finally:
        # Optional sources connect lazily on first use, so disposing one is a no-op
        # when nothing queried it (or it was never configured).
        await dispose_sqlserver_engine()
        await dispose_engine()


app = FastAPI(title="pace-v0", lifespan=lifespan)

# Local dev uses the Vite proxy (same origin), so CORS is only needed in
# production where the SPA is served from a different origin behind Azure App
# Proxy. Set CORS_ALLOW_ORIGINS to a comma-separated list there.
_origins = [o.strip() for o in os.getenv("CORS_ALLOW_ORIGINS", "").split(",") if o.strip()]
if _origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

# Behind the platform's Caddy, requests arrive as `<base>/api/*` and Caddy strips
# only the env prefix, so the backend must answer under `/api/*`. `/health` stays
# at the root for direct liveness checks against the service port.
# Add each new entity router here with prefix="/api".
app.include_router(health.router)
app.include_router(items.router, prefix="/api")
app.include_router(reports.router, prefix="/api")
app.include_router(sources.router, prefix="/api")
app.include_router(support.router, prefix="/api")
app.include_router(me.router, prefix="/api")
app.include_router(user_roles.router, prefix="/api")
