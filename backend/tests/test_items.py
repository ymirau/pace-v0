from httpx import AsyncClient


async def test_list_items_returns_seeded(client: AsyncClient, seed_item: int) -> None:
    response = await client.get("/api/items")
    assert response.status_code == 200
    body = response.json()
    assert any(i["id"] == seed_item for i in body)


async def test_create_item_returns_201(client: AsyncClient) -> None:
    response = await client.post(
        "/api/items",
        json={
            "name": "Widget",
            "description": "A test widget",
            "category": "widgets",
            "amount": "19.99",
            "date": "2024-01-15",
        },
    )
    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "Widget"
    assert body["description"] == "A test widget"
    assert body["category"] == "widgets"
    assert body["amount"] == "19.99"  # Numeric serializes to a string
    assert body["date"] == "2024-01-15"
    assert isinstance(body["id"], int)


async def test_create_item_optional_fields_default_null(client: AsyncClient) -> None:
    # name is the only required field; the rest default to null.
    response = await client.post("/api/items", json={"name": "Bare"})
    assert response.status_code == 201
    body = response.json()
    assert body["description"] is None
    assert body["category"] is None
    assert body["amount"] is None
    assert body["date"] is None


async def test_create_item_negative_amount_returns_422(client: AsyncClient) -> None:
    response = await client.post("/api/items", json={"name": "Bad", "amount": "-5.00"})
    assert response.status_code == 422


async def test_update_item_patches_fields(client: AsyncClient) -> None:
    created = (await client.post("/api/items", json={"name": "Before", "amount": "1.00"})).json()
    response = await client.patch(
        f"/api/items/{created['id']}",
        json={"name": "After", "category": "widgets", "amount": None},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "After"
    assert body["category"] == "widgets"
    assert body["amount"] is None  # explicit null clears it


async def test_update_missing_item_returns_404(client: AsyncClient) -> None:
    response = await client.patch("/api/items/999999", json={"name": "Nope"})
    assert response.status_code == 404


async def test_delete_item_returns_204_then_404(client: AsyncClient) -> None:
    created = (await client.post("/api/items", json={"name": "Doomed"})).json()
    assert (await client.delete(f"/api/items/{created['id']}")).status_code == 204
    # Second delete (now gone) → 404.
    assert (await client.delete(f"/api/items/{created['id']}")).status_code == 404


async def test_create_item_missing_name_returns_422(client: AsyncClient) -> None:
    response = await client.post("/api/items", json={"description": "missing name"})
    assert response.status_code == 422
