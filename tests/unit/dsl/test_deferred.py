"""Unit tests for Deferred and resolve() — RSRC-06, D-04/D-05 contract."""

from __future__ import annotations

import dataclasses

import pytest

from godoo_stateman.dsl.types.deferred import Deferred, resolve
from godoo_stateman.dsl.types.nodes import DataSourceNode, ResourceNode

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_resource_node(slug: str, model: str = "res.partner") -> ResourceNode:
    """Build a minimal ResourceNode for testing."""
    return ResourceNode(model=model, slug=slug, fields={})


def _make_data_source_node(node_key: str, model: str = "res.users") -> DataSourceNode:
    """Build a minimal DataSourceNode for testing."""
    selector = {"login": "admin"}
    return DataSourceNode(model=model, selector=selector, node_key=node_key)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_resolve_returns_deferred() -> None:
    """resolve() returns a Deferred instance."""
    node = _make_resource_node("parent")
    result = resolve(lambda x: x, node)
    assert isinstance(result, Deferred)


def test_resolve_never_calls_fn() -> None:
    """resolve() stores fn but never calls it — D-04 eval purity invariant."""
    call_count = 0

    def tracking_fn() -> int:
        nonlocal call_count
        call_count += 1
        return call_count

    node = _make_resource_node("some-slug")
    resolve(tracking_fn, node)
    assert call_count == 0, "fn must not be called during resolve()"


def test_resolve_deps_from_resource_slug() -> None:
    """resolve() extracts .slug from ResourceNode and adds it to deps."""
    node = _make_resource_node("parent")
    result = resolve(lambda x: x, node)
    assert result.deps == frozenset({"parent"})


def test_resolve_deps_from_data_source_node_key() -> None:
    """resolve() extracts .node_key from DataSourceNode when .slug is absent."""
    node_key = "data.res_users[login=admin]"
    ds = _make_data_source_node(node_key)
    result = resolve(lambda x: x, ds)
    assert node_key in result.deps


def test_resolve_empty_refs() -> None:
    """resolve() with no refs returns Deferred with empty deps frozenset."""
    result = resolve(lambda: None)
    assert result.deps == frozenset()


def test_deferred_is_frozen() -> None:
    """Attempting to mutate a Deferred field raises dataclasses.FrozenInstanceError."""
    d = Deferred(fn=lambda: None, deps=frozenset())
    try:
        d.fn = None  # type: ignore[misc]
        raise AssertionError("Expected FrozenInstanceError was not raised")
    except dataclasses.FrozenInstanceError:
        pass


def test_deferred_deps_type() -> None:
    """Deferred.deps is always a frozenset."""
    d = Deferred(fn=lambda: None, deps=frozenset())
    assert isinstance(d.deps, frozenset)


def test_resolve_deps_from_resource_builder() -> None:
    """WR-01: resolve() extracts .slug from a _ResourceBuilder via its ._node attribute."""
    # Simulate a _ResourceBuilder via a minimal duck-typed object — avoids circular import.
    inner_node = _make_resource_node("partner1")

    class _FakeBuilder:
        _node = inner_node

    result = resolve(lambda x: x, _FakeBuilder())
    assert "partner1" in result.deps, (
        "resolve() must produce a DAG edge when given a _ResourceBuilder (has ._node.slug)"
    )


def test_resolve_raises_on_unrecognised_ref() -> None:
    """WR-01: resolve() raises TypeError for unrecognised ref types (no silent drop)."""
    with pytest.raises(TypeError, match="resolve\\(\\) ref must be"):
        resolve(lambda x: x, object())
