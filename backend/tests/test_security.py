"""principal_identity / principal_email: the claim fallback order, defined once.

Pure functions over a claims dict — no HTTP, no database.
"""

from app.core.security import _DEV_USER, principal_email, principal_identity


def test_identity_prefers_oid_and_name() -> None:
    claims = {
        "oid": "oid-1",
        "sub": "sub-1",
        "name": "Ada Lovelace",
        "preferred_username": "ada@example.com",
    }
    assert principal_identity(claims) == ("oid-1", "Ada Lovelace")


def test_identity_falls_back_to_sub_without_oid() -> None:
    assert principal_identity({"sub": "sub-1", "name": "Ada"}) == ("sub-1", "Ada")


def test_display_name_falls_back_to_upn_then_id() -> None:
    assert principal_identity({"oid": "oid-1", "preferred_username": "ada@example.com"}) == (
        "oid-1",
        "ada@example.com",
    )
    assert principal_identity({"oid": "oid-1"}) == ("oid-1", "oid-1")


def test_identity_of_empty_claims_is_empty() -> None:
    assert principal_identity({}) == ("", "")


def test_identity_of_the_dev_user() -> None:
    assert principal_identity(_DEV_USER) == ("dev-user", "dev@local")


def test_email_prefers_the_email_claim() -> None:
    assert (
        principal_email({"email": "ada@example.com", "preferred_username": "other@example.com"})
        == "ada@example.com"
    )


def test_email_falls_back_to_upn() -> None:
    assert principal_email({"preferred_username": "ada@example.com"}) == "ada@example.com"


def test_email_skips_values_that_are_not_addresses() -> None:
    assert (
        principal_email({"email": "not-an-address", "preferred_username": "ada@example.com"})
        == "ada@example.com"
    )
    assert principal_email({"preferred_username": "3f2c-guid"}) is None
    assert principal_email({}) is None
