"""Unit tests for the live network I/O layer — LiveState.fetch and seam resolution.

All tests use unittest.mock.AsyncMock for OdooClient — no Docker required.
asyncio_mode = "auto" in pyproject.toml means no @pytest.mark.asyncio decorator is needed.

Covers:
- CORE-04: Plan stage resolves data-source reads (read seam) without mutating Odoo
- REL-03: DataSourceNode selectors resolve at plan stage; node_key → res_id
- REL-04: Deferred.fn fires with resolved seam args; produces new ResourceNode

TDD RED: this file is written before livestate.py and seam.py exist.
Import failures below are expected until Task 3 (GREEN).
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, call

import pytest

from godoo_stateman.dsl.types.deferred import Deferred
from godoo_stateman.dsl.types.nodes import DataSourceNode, ResourceNode
from godoo_stateman.errors import LiveStateFetchError
from godoo_stateman.live.livestate import LiveState
from godoo_stateman.live.seam import resolve_data_sources, resolve_deferred

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_client(
    *,
    search_read_return: list[list[dict[str, Any]]] | None = None,
) -> AsyncMock:
    """Build a minimal AsyncMock standing in for OdooClient.

    ``search_read_return`` is a list of return-value lists — one per sequential
    call.  A single-item list sets ``return_value``; multiple items use
    ``side_effect`` so each call gets the next value in order.
    If ``None``, ``search_read`` always returns ``[]``.
    """
    client = AsyncMock()
    if search_read_return is None:
        client.search_read.return_value = []
    elif len(search_read_return) == 1:
        client.search_read.return_value = search_read_return[0]
    else:
        client.search_read.side_effect = search_read_return
    return client


# ---------------------------------------------------------------------------
# LiveState.fetch — batch fetch from ir.model.data + per-model search_read
# ---------------------------------------------------------------------------


async def test_fetch_groups_res_ids_per_model() -> None:
    """LiveState.fetch groups res_ids for the same model into one search_read call.

    ir.model.data returns 2 rows for model "res.partner" (res_ids 7 and 42).
    The per-model search_read must be called with [("id","in",[7,42])] (sorted).
    """
    imd_rows = [
        {"name": "partner_a", "model": "res.partner", "res_id": 42},
        {"name": "partner_b", "model": "res.partner", "res_id": 7},
    ]
    live_rows = [
        {"id": 7, "email": "b@example.com", "name": "B"},
        {"id": 42, "email": "a@example.com", "name": "A"},
    ]
    client = _make_client(search_read_return=[imd_rows, live_rows])

    desired_fields_by_model = {"res.partner": {"email", "name"}}
    state = await LiveState.fetch(client, "myprefix", desired_fields_by_model)

    # The per-model call must use sorted res_ids [7, 42]
    assert client.search_read.call_count == 2
    partner_call = client.search_read.call_args_list[1]
    domain_arg = partner_call[0][1]
    assert domain_arg == [("id", "in", [7, 42])]


async def test_fetch_separate_query_per_model() -> None:
    """LiveState.fetch issues separate search_read calls for different models.

    ir.model.data rows span two models — one search_read per model is issued
    (batch per model, not one combined query).
    """
    imd_rows = [
        {"name": "partner_x", "model": "res.partner", "res_id": 10},
        {"name": "country_y", "model": "res.country", "res_id": 20},
    ]
    partner_rows = [{"id": 10, "name": "X"}]
    country_rows = [{"id": 20, "name": "Y"}]
    client = _make_client(search_read_return=[imd_rows, partner_rows, country_rows])

    desired_fields_by_model = {
        "res.partner": {"name"},
        "res.country": {"name"},
    }
    await LiveState.fetch(client, "myprefix", desired_fields_by_model)

    # 1 ir.model.data call + 2 per-model calls = 3 total
    assert client.search_read.call_count == 3
    # The first call must target ir.model.data
    first_call = client.search_read.call_args_list[0]
    assert first_call[0][0] == "ir.model.data"


async def test_fetch_managed_keyed_by_slug() -> None:
    """LiveState.managed is a dict keyed by slug (ir.model.data "name" column).

    Each value must be an XmlIdRecord for the corresponding managed row.
    """
    imd_rows = [
        {"name": "my_slug", "model": "res.partner", "res_id": 99},
    ]
    live_rows = [{"id": 99, "name": "Test Partner"}]
    client = _make_client(search_read_return=[imd_rows, live_rows])

    state = await LiveState.fetch(client, "testprefix", {"res.partner": {"name"}})

    assert "my_slug" in state.managed
    record = state.managed["my_slug"]
    assert record.module == "testprefix"
    assert record.name == "my_slug"
    assert record.model == "res.partner"
    assert record.res_id == 99
    assert record.complete_name == "testprefix.my_slug"


async def test_fetch_uses_explicit_fields_and_order() -> None:
    """Every search_read call from LiveState.fetch passes explicit fields= and order=.

    Verifies read-only determinism (SC-2): no open-ended field fetches,
    no non-deterministic query ordering.
    """
    imd_rows = [
        {"name": "slug1", "model": "res.partner", "res_id": 5},
    ]
    live_rows = [{"id": 5, "email": "x@x.com"}]
    client = _make_client(search_read_return=[imd_rows, live_rows])

    await LiveState.fetch(client, "pfx", {"res.partner": {"email"}})

    for i, mock_call in enumerate(client.search_read.call_args_list):
        kwargs = mock_call[1]  # keyword args
        positional = mock_call[0]  # positional args
        # fields= must be present as either kwarg or 3rd positional arg
        fields_in_kwargs = "fields" in kwargs
        fields_in_positional = len(positional) >= 3
        assert fields_in_kwargs or fields_in_positional, (
            f"search_read call {i} is missing explicit fields= — violates SC-2 (T-03-03)"
        )
        # order= must be present as either kwarg or 4th positional arg
        order_in_kwargs = "order" in kwargs
        order_in_positional = len(positional) >= 4
        assert order_in_kwargs or order_in_positional, (
            f"search_read call {i} is missing explicit order= — violates SC-2 determinism"
        )


# ---------------------------------------------------------------------------
# resolve_data_sources — DataSourceNode selector → res_id (REL-03)
# ---------------------------------------------------------------------------


async def test_datasource_resolves_to_id() -> None:
    """resolve_data_sources resolves a selector to the matching record's id.

    DataSourceNode with selector {"name": "Internal"} → search_read returns
    [{"id": 5}] → seam_result[node_key] == 5.
    """
    ds = DataSourceNode(
        model="res.partner",
        selector={"name": "Internal"},
        node_key="data.res_partner[name=Internal]",
    )
    client = _make_client(search_read_return=[[{"id": 5}]])

    result = await resolve_data_sources(client, (ds,))

    assert result[ds.node_key] == 5
    # Must call search_read with fields=["id"] and limit=2 (Pitfall 5 detection)
    client.search_read.assert_called_once_with(
        "res.partner",
        [("name", "=", "Internal")],
        fields=["id"],
        limit=2,
    )


async def test_datasource_zero_records_raises() -> None:
    """resolve_data_sources raises LiveStateFetchError when 0 records match.

    Pitfall 5: ambiguous or absent selector must never silently return wrong data.
    """
    ds = DataSourceNode(
        model="res.partner",
        selector={"name": "NonExistent"},
        node_key="data.res_partner[name=NonExistent]",
    )
    client = _make_client(search_read_return=[[]])  # 0 records

    with pytest.raises(LiveStateFetchError) as exc_info:
        await resolve_data_sources(client, (ds,))

    assert ds.node_key in str(exc_info.value)


async def test_datasource_two_records_raises() -> None:
    """resolve_data_sources raises LiveStateFetchError when >1 records match.

    Pitfall 5: ambiguous selector (>1 match) must raise, never pick record 0.
    limit=2 is used precisely to detect this ambiguity efficiently.
    """
    ds = DataSourceNode(
        model="res.partner",
        selector={"name": "Duplicate"},
        node_key="data.res_partner[name=Duplicate]",
    )
    client = _make_client(search_read_return=[[{"id": 1}, {"id": 2}]])  # 2 records

    with pytest.raises(LiveStateFetchError) as exc_info:
        await resolve_data_sources(client, (ds,))

    assert ds.node_key in str(exc_info.value)


# ---------------------------------------------------------------------------
# resolve_deferred — Deferred.fn fires with resolved args (REL-04)
# ---------------------------------------------------------------------------


def test_deferred_fires_with_resolved_args() -> None:
    """resolve_deferred fires Deferred.fn with the resolved seam args.

    Deferred with fn=lambda x: x*2, deps={"ds1"}, seam_result={"ds1": 3}
    → the field resolves to 6 in the returned ResourceNode.
    """
    resource = ResourceNode(
        model="res.partner",
        slug="my_partner",
        fields={"some_field": Deferred(fn=lambda x: x * 2, deps=frozenset({"ds1"}))},
    )
    seam_result = {"ds1": 3}

    resolved = resolve_deferred(resource, seam_result)

    assert resolved.fields["some_field"] == 6


def test_deferred_no_mutation() -> None:
    """resolve_deferred does NOT mutate the original ResourceNode.fields dict.

    Pitfall 7: ResourceNode is @dataclass(frozen=True) — its .fields dict is
    mutable, but the pipeline invariant is that it must never be mutated.
    After resolve_deferred, the original resource.fields must be unchanged.
    """
    original_deferred = Deferred(fn=lambda x: x + 100, deps=frozenset({"dep1"}))
    resource = ResourceNode(
        model="res.partner",
        slug="no_mutate",
        fields={"computed_field": original_deferred},
    )
    original_fields_id = id(resource.fields)

    resolved = resolve_deferred(resource, {"dep1": 7})

    # The original fields dict must be unchanged — same object, same content
    assert id(resource.fields) == original_fields_id, "resolve_deferred must not replace resource.fields"
    assert isinstance(resource.fields["computed_field"], Deferred), (
        "Original resource.fields['computed_field'] must still be a Deferred"
    )
    # The resolved node must be a different object
    assert resolved is not resource, "resolve_deferred must return a new ResourceNode"


def test_non_deferred_field_passthrough() -> None:
    """Non-Deferred fields are copied unchanged into the resolved ResourceNode.

    Only Deferred values are replaced; plain values pass through as-is.
    """
    resource = ResourceNode(
        model="res.partner",
        slug="passthrough",
        fields={
            "name": "Static Name",
            "email": "test@example.com",
            "deferred_field": Deferred(fn=lambda x: x, deps=frozenset({"ds1"})),
        },
    )
    seam_result = {"ds1": 42}

    resolved = resolve_deferred(resource, seam_result)

    assert resolved.fields["name"] == "Static Name"
    assert resolved.fields["email"] == "test@example.com"
    assert resolved.fields["deferred_field"] == 42
