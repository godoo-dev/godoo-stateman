"""Unit tests for build_graph() — REL-01, REL-02, REL-07, SC-4.

All tests construct DesiredState in-process; no file eval, no Docker.
Covers: DAG node creation, edge derivation from Deferred.deps, direct resource
references, parent→child relationships (inline O2m), cycle detection with
path reporting, and empty-state edge case.
"""

from __future__ import annotations

from typing import Any

import pytest

from godoo_stateman.dsl.graph import build_graph
from godoo_stateman.dsl.types.deferred import Deferred
from godoo_stateman.dsl.types.desired import DesiredState
from godoo_stateman.dsl.types.nodes import DataSourceNode, ResourceNode
from godoo_stateman.errors import CycleError

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_resource(model: str, slug: str, **fields: Any) -> ResourceNode:
    """Construct a ResourceNode for testing."""
    return ResourceNode(model=model, slug=slug, fields=dict(fields))


def _make_data_source(model: str, node_key: str, **selector: Any) -> DataSourceNode:
    """Construct a DataSourceNode for testing."""
    return DataSourceNode(model=model, selector=dict(selector), node_key=node_key)


def _make_desired(
    resources: list[ResourceNode],
    data_sources: list[DataSourceNode] | None = None,
) -> DesiredState:
    """Construct a DesiredState with empty config_parameters."""
    return DesiredState(
        xmlid_prefix="test_module",
        resources=tuple(resources),
        data_sources=tuple(data_sources or []),
        config_parameters=(),
    )


# ---------------------------------------------------------------------------
# Tests — REL-01: nodes added for resources and data sources
# ---------------------------------------------------------------------------


def test_nodes_added_for_resources() -> None:
    """Two resources → DiGraph has both slug strings as nodes (REL-01)."""
    r1 = _make_resource("res.partner", "partner_a", name="A")
    r2 = _make_resource("res.partner", "partner_b", name="B")
    state = _make_desired([r1, r2])

    G = build_graph(state)

    assert "partner_a" in G
    assert "partner_b" in G
    assert len(G.nodes) == 2


def test_nodes_added_for_data_sources() -> None:
    """One data_source → DiGraph has its node_key as a node (REL-01)."""
    ds = _make_data_source("res.users", "data.res_users[login='admin']", login="admin")
    state = _make_desired([], data_sources=[ds])

    G = build_graph(state)

    assert "data.res_users[login='admin']" in G
    assert len(G.nodes) == 1


# ---------------------------------------------------------------------------
# Tests — REL-01: edges from direct resource references and Deferred.deps
# ---------------------------------------------------------------------------


def test_direct_ref_edge() -> None:
    """Resource A with a field pointing to resource B → edge (B.slug, A.slug) in G (REL-01)."""
    r_b = _make_resource("res.partner", "partner_b", name="B")
    r_a = _make_resource("res.partner", "partner_a", name="A", partner_id=r_b)
    state = _make_desired([r_b, r_a])

    G = build_graph(state)

    assert G.has_edge("partner_b", "partner_a"), "Expected edge from dep to consumer"


def test_deferred_deps_edge() -> None:
    """Resource A with Deferred(fn=..., deps=frozenset({B.slug})) → edge (B.slug, A.slug) (REL-01)."""
    r_b = _make_resource("res.partner", "partner_b", name="B")
    deferred_field = Deferred(fn=lambda x: x, deps=frozenset({"partner_b"}))
    r_a = _make_resource("res.partner", "partner_a", name="A", ref_field=deferred_field)
    state = _make_desired([r_b, r_a])

    G = build_graph(state)

    assert G.has_edge("partner_b", "partner_a"), "Expected Deferred.deps edge"


def test_deferred_data_source_edge() -> None:
    """Resource A with Deferred deps referencing a DataSourceNode.node_key → edge (node_key, A.slug)."""
    ds = _make_data_source("res.users", "data.res_users[login='admin']", login="admin")
    deferred_field = Deferred(fn=lambda x: x, deps=frozenset({"data.res_users[login='admin']"}))
    r_a = _make_resource("res.partner", "partner_a", name="A", user_ref=deferred_field)
    state = _make_desired([r_a], data_sources=[ds])

    G = build_graph(state)

    assert G.has_edge("data.res_users[login='admin']", "partner_a"), (
        "Expected edge from DataSourceNode.node_key to consumer resource"
    )


# ---------------------------------------------------------------------------
# Tests — REL-07: parent→child edges for inline One2many children
# ---------------------------------------------------------------------------


def test_parent_child_edge() -> None:
    """Child ResourceNode with parent_slug='parent' → edge ('parent', child.slug) in G (REL-07)."""
    parent = _make_resource("sale.order", "order_01", name="Order 1")
    child = ResourceNode(
        model="sale.order.line",
        slug="order_01.line_1",
        fields={"name": "Line 1"},
        parent_slug="order_01",
    )
    state = _make_desired([parent, child])

    G = build_graph(state)

    assert G.has_edge("order_01", "order_01.line_1"), "Expected parent→child edge from parent_slug"


# ---------------------------------------------------------------------------
# Tests — REL-02: cycle detection
# ---------------------------------------------------------------------------


def test_cycle_detection() -> None:
    """Resource A field references B, resource B field references A → CycleError raised (REL-02)."""
    r_b = _make_resource("res.partner", "slug_b", name="B")
    r_a = _make_resource("res.partner", "slug_a", name="A", partner_id=r_b)
    # Give r_b a direct reference field to r_a to close the cycle
    r_b_cyclic = ResourceNode(
        model="res.partner",
        slug="slug_b",
        fields={"name": "B", "partner_id": r_a},
    )
    state = _make_desired([r_b_cyclic, r_a])

    with pytest.raises(CycleError) as exc_info:
        build_graph(state)

    assert "cycle" in str(exc_info.value).lower()


def test_cycle_error_contains_path() -> None:
    """CycleError message contains both slugs involved in the cycle (REL-02)."""
    r_b = _make_resource("res.partner", "slug_b", name="B")
    r_a = _make_resource("res.partner", "slug_a", name="A", partner_id=r_b)
    r_b_cyclic = ResourceNode(
        model="res.partner",
        slug="slug_b",
        fields={"name": "B", "partner_id": r_a},
    )
    state = _make_desired([r_b_cyclic, r_a])

    with pytest.raises(CycleError) as exc_info:
        build_graph(state)

    error_msg = str(exc_info.value)
    assert "slug_a" in error_msg and "slug_b" in error_msg, (
        f"Expected both slug_a and slug_b in CycleError message, got: {error_msg}"
    )


def test_no_cycle_returns_graph() -> None:
    """Linear dependency chain A→B→C → build_graph returns DiGraph without error (REL-01)."""
    r_c = _make_resource("res.partner", "slug_c", name="C")
    r_b = _make_resource("res.partner", "slug_b", name="B", parent_ref=r_c)
    r_a = _make_resource("res.partner", "slug_a", name="A", parent_ref=r_b)
    state = _make_desired([r_c, r_b, r_a])

    G = build_graph(state)

    assert G is not None
    assert len(G.nodes) == 3
    assert G.has_edge("slug_c", "slug_b")
    assert G.has_edge("slug_b", "slug_a")


def test_children_participate_in_cycle() -> None:
    """Inline child participates in cycle detection via parent→child edges (REL-07).

    Cycle: parent → child (via parent_slug) and parent depends on child (via
    Deferred.deps on the parent resource pointing to the child's slug).
    Edge direction: parent→child AND child→parent creates a cycle.
    """
    # The child must be constructed first so we can reference its slug.
    # parent has a Deferred field that depends on the child slug →
    # edge (order_01.line_1, order_01) added to the graph.
    # parent_slug on the child adds edge (order_01, order_01.line_1).
    # Result: order_01 → order_01.line_1 → order_01 — cycle.
    deferred_on_parent = Deferred(fn=lambda x: x, deps=frozenset({"order_01.line_1"}))
    parent = ResourceNode(
        model="sale.order",
        slug="order_01",
        fields={"name": "Order 1", "child_dep": deferred_on_parent},
    )
    child = ResourceNode(
        model="sale.order.line",
        slug="order_01.line_1",
        fields={"name": "Line 1"},
        parent_slug="order_01",
    )
    state = _make_desired([parent, child])

    with pytest.raises(CycleError) as exc_info:
        build_graph(state)

    assert "cycle" in str(exc_info.value).lower()


# ---------------------------------------------------------------------------
# Tests — edge case: empty state
# ---------------------------------------------------------------------------


def test_empty_state_returns_empty_graph() -> None:
    """DesiredState with no resources or data_sources → empty DiGraph returned without error."""
    state = _make_desired([])

    G = build_graph(state)

    assert G is not None
    assert len(G.nodes) == 0
    assert len(G.edges) == 0
