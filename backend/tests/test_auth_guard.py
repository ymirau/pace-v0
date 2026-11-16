"""Every route under `/api` requires a validated token — asserted once, here.

This replaces a per-router "requires auth" test in each module. Those each hit
one URL of one router, so a NEW router, or a new route added to an existing one
without the router-level `dependencies=[Depends(get_current_user)]`, was never
checked at all. Walking the route table covers every route that exists, including
ones nobody has written a test for yet.

`/health` is the one intentionally open route, and it is not under `/api`
(main.py mounts it at the root), so no exemption list is needed.
"""

from fastapi.dependencies.models import Dependant
from fastapi.routing import APIRoute
from httpx import AsyncClient

from app.core.security import get_current_user
from main import app


def _calls(dependant: Dependant) -> set[object]:
    """Every callable in a route's dependency tree, however deeply nested —
    an admin gate that itself depends on `get_current_user` counts."""
    found: set[object] = set()
    for dependency in dependant.dependencies:
        found.add(dependency.call)
        found |= _calls(dependency)
    return found


def _api_routes() -> list[APIRoute]:
    return [
        route
        for route in app.routes
        if isinstance(route, APIRoute) and route.path.startswith("/api")
    ]


def test_every_api_route_depends_on_get_current_user() -> None:
    routes = _api_routes()
    # Only proves the walk found routes: an empty list would pass the assertion
    # below. The template ships four routers; an app only ever adds more.
    assert len(routes) >= 4

    unguarded = [
        (route.path, sorted(route.methods))
        for route in routes
        if get_current_user not in _calls(route.dependant)
    ]
    assert unguarded == []


async def test_a_request_without_a_token_is_401(unauthenticated_client: AsyncClient) -> None:
    # The walk proves the dependency is attached; this proves the dependency
    # actually refuses — a representative endpoint, with auth forced on.
    response = await unauthenticated_client.get("/api/items")
    assert response.status_code == 401
