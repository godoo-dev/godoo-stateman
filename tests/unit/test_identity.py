"""Unit tests for identity.py — find_by_xmlid and write_xmlid.

All tests use unittest.mock.AsyncMock for OdooClient — no Docker required.
asyncio_mode = "auto" in pyproject.toml means no @pytest.mark.asyncio is needed.

Covers all contract cases:
- find_by_xmlid: absent xmlid (None, no raise)
- find_by_xmlid: present xmlid (returns populated XmlIdRecord)
- write_xmlid: absent → create
- write_xmlid: idempotent (same res_id, same model → no-op)
- write_xmlid: res_id updated (same model, different res_id → write)
- write_xmlid: model mismatch guard → OdooValidationError
- XmlIdRecord: frozen (cannot set attributes)
- find_by_xmlid: search_read fields parameter (id, res_id, model — not complete_name)
- write_xmlid two-step update: search_read with fields=["id"] then write with row PK
"""

from __future__ import annotations

from unittest.mock import AsyncMock, call

import pytest
from godoo.client.errors import OdooValidationError

from godoo_stateman.identity import XmlIdRecord, find_by_xmlid, write_xmlid

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_client(
    *,
    search_read_return: list[list[dict]] | None = None,
    create_return: int = 10,
) -> AsyncMock:
    """Build a minimal AsyncMock standing in for OdooClient.

    ``search_read_return`` is a list of return values — one per call in order.
    If ``None``, ``search_read`` always returns ``[]``.
    """
    client = AsyncMock()
    if search_read_return is None:
        client.search_read.return_value = []
    elif len(search_read_return) == 1:
        client.search_read.return_value = search_read_return[0]
    else:
        client.search_read.side_effect = search_read_return
    client.create.return_value = create_return
    client.write.return_value = True
    return client


# ---------------------------------------------------------------------------
# find_by_xmlid
# ---------------------------------------------------------------------------


async def test_find_by_xmlid_absent_returns_none() -> None:
    """find_by_xmlid returns None when search_read returns [] — never raises."""
    client = _make_client()
    result = await find_by_xmlid(client, "my_module", "absent_name")
    assert result is None


async def test_find_by_xmlid_absent_does_not_raise() -> None:
    """find_by_xmlid never raises OdooMissingError or any error when absent."""
    client = _make_client()
    # Should not raise
    result = await find_by_xmlid(client, "my_module", "absent_name")
    assert result is None


async def test_find_by_xmlid_present_returns_xmlid_record() -> None:
    """find_by_xmlid returns populated XmlIdRecord when record exists."""
    client = _make_client(search_read_return=[[{"id": 5, "res_id": 42, "model": "res.partner"}]])
    result = await find_by_xmlid(client, "my_module", "my_record")

    assert result is not None
    assert result.module == "my_module"
    assert result.name == "my_record"
    assert result.model == "res.partner"
    assert result.res_id == 42
    assert result.complete_name == "my_module.my_record"


async def test_find_by_xmlid_uses_correct_fields() -> None:
    """find_by_xmlid calls search_read with fields=['id', 'res_id', 'model'].

    Per Open Question Q1 RESOLVED: 'complete_name' is NOT fetched from Odoo —
    it is constructed in Python.
    """
    client = _make_client()
    await find_by_xmlid(client, "my_module", "my_record")

    client.search_read.assert_called_once_with(
        "ir.model.data",
        [("module", "=", "my_module"), ("name", "=", "my_record")],
        fields=["id", "res_id", "model"],
        limit=1,
    )


async def test_find_by_xmlid_complete_name_constructed_in_python() -> None:
    """complete_name is f'{module}.{name}' — NOT fetched from Odoo."""
    client = _make_client(search_read_return=[[{"id": 5, "res_id": 7, "model": "project.project"}]])
    result = await find_by_xmlid(client, "base", "user_admin")

    assert result is not None
    assert result.complete_name == "base.user_admin"


# ---------------------------------------------------------------------------
# XmlIdRecord: frozen dataclass
# ---------------------------------------------------------------------------


def test_xmlid_record_is_frozen() -> None:
    """XmlIdRecord is a frozen dataclass — attribute assignment raises."""
    record = XmlIdRecord(
        module="mod",
        name="rec",
        model="res.partner",
        res_id=1,
        complete_name="mod.rec",
    )
    with pytest.raises((AttributeError, TypeError)):
        record.res_id = 999  # type: ignore[misc]


def test_xmlid_record_fields() -> None:
    """XmlIdRecord stores all five fields correctly."""
    record = XmlIdRecord(
        module="my_module",
        name="my_record",
        model="res.partner",
        res_id=42,
        complete_name="my_module.my_record",
    )
    assert record.module == "my_module"
    assert record.name == "my_record"
    assert record.model == "res.partner"
    assert record.res_id == 42
    assert record.complete_name == "my_module.my_record"


# ---------------------------------------------------------------------------
# write_xmlid — absent: create
# ---------------------------------------------------------------------------


async def test_write_xmlid_absent_calls_create() -> None:
    """write_xmlid creates a new ir.model.data row when xmlid is absent."""
    # First search_read (find_by_xmlid) returns absent; create returns new row id
    client = _make_client(create_return=10)
    await write_xmlid(client, "res.partner", 42, "my_module", "my_record")

    # create called exactly once with correct payload including noupdate=True
    client.create.assert_called_once_with(
        "ir.model.data",
        {
            "model": "res.partner",
            "res_id": 42,
            "module": "my_module",
            "name": "my_record",
            "noupdate": True,
        },
    )
    # write should NOT be called
    client.write.assert_not_called()


async def test_write_xmlid_absent_returns_xmlid_record() -> None:
    """write_xmlid returns a correctly populated XmlIdRecord after create."""
    client = _make_client(create_return=10)
    result = await write_xmlid(client, "res.partner", 42, "my_module", "my_record")

    assert isinstance(result, XmlIdRecord)
    assert result.module == "my_module"
    assert result.name == "my_record"
    assert result.model == "res.partner"
    assert result.res_id == 42
    assert result.complete_name == "my_module.my_record"


# ---------------------------------------------------------------------------
# write_xmlid — idempotent (same res_id, same model)
# ---------------------------------------------------------------------------


async def test_write_xmlid_idempotent_no_create_no_write() -> None:
    """write_xmlid is a no-op when xmlid exists with same res_id and model."""
    # find_by_xmlid returns existing row with same res_id and model
    client = _make_client(search_read_return=[[{"id": 5, "res_id": 42, "model": "res.partner"}]])
    result = await write_xmlid(client, "res.partner", 42, "my_module", "my_record")

    client.create.assert_not_called()
    client.write.assert_not_called()
    assert isinstance(result, XmlIdRecord)
    assert result.res_id == 42


# ---------------------------------------------------------------------------
# write_xmlid — res_id update (same model, different res_id)
# ---------------------------------------------------------------------------


async def test_write_xmlid_updates_res_id() -> None:
    """write_xmlid calls client.write when xmlid exists but res_id differs."""
    # Call 1 (find_by_xmlid): existing row with old res_id=10
    # Call 2 (get row PK for update): returns id=5
    client = _make_client(
        search_read_return=[
            [{"id": 5, "res_id": 10, "model": "res.partner"}],  # find_by_xmlid
            [{"id": 5}],  # second search_read for row PK
        ]
    )
    result = await write_xmlid(client, "res.partner", 99, "my_module", "my_record")

    # write called with the ir.model.data row id (5), not the new res_id
    client.write.assert_called_once_with(
        "ir.model.data",
        [5],
        {"res_id": 99},
    )
    client.create.assert_not_called()
    assert result.res_id == 99


async def test_write_xmlid_update_fetches_row_id_not_res_id() -> None:
    """write_xmlid passes ir.model.data row PK to client.write, not res_id.

    The second search_read uses fields=['id'] to fetch the row's own PK.
    """
    client = _make_client(
        search_read_return=[
            [{"id": 7, "res_id": 10, "model": "res.partner"}],  # find_by_xmlid
            [{"id": 7}],  # second search_read with fields=["id"]
        ]
    )
    await write_xmlid(client, "res.partner", 99, "my_module", "my_record")

    # Verify the second search_read call uses fields=["id"]
    second_call = client.search_read.call_args_list[1]
    assert second_call == call(
        "ir.model.data",
        [("module", "=", "my_module"), ("name", "=", "my_record")],
        fields=["id"],
        limit=1,
    )


# ---------------------------------------------------------------------------
# write_xmlid — model mismatch guard
# ---------------------------------------------------------------------------


async def test_write_xmlid_raises_on_model_mismatch() -> None:
    """write_xmlid raises OdooValidationError when existing xmlid points to a different model."""
    # Existing xmlid points to "project.project", caller claims "res.partner"
    client = _make_client(search_read_return=[[{"id": 3, "res_id": 42, "model": "project.project"}]])
    with pytest.raises(OdooValidationError) as exc_info:
        await write_xmlid(client, "res.partner", 42, "my_module", "my_record")

    assert "model mismatch" in str(exc_info.value).lower()


async def test_write_xmlid_model_mismatch_no_write_called() -> None:
    """write_xmlid does not call create or write before raising on model mismatch."""
    client = _make_client(search_read_return=[[{"id": 3, "res_id": 42, "model": "project.project"}]])
    with pytest.raises(OdooValidationError):
        await write_xmlid(client, "res.partner", 42, "my_module", "my_record")

    client.create.assert_not_called()
    client.write.assert_not_called()
