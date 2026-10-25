"""Unit tests for the pure _execution_order helper (CORE-05, REL-08).

Proves the NEW within-generation Creates→Updates→Deletes/Archives action-class
tiebreak (NOT render.py's slug-only order) and cross-generation ordering via
nx.topological_generations. No client, no I/O — _execution_order is pure.
"""

from __future__ import annotations

import networkx as nx

from godoo_stateman.apply.executor import _execution_order
from godoo_stateman.plan.types import PlanAction, PlanStep


def _step(slug: str, action: PlanAction, *, res_id: int | None = 1) -> PlanStep:
    return PlanStep(
        action=action,
        slug=slug,
        model="test.model",
        xmlid=f"pfx.{slug}",
        res_id=None if action == PlanAction.CREATE else res_id,
        field_diff=(),
    )


def test_action_class_tiebreak_within_generation() -> None:
    """Same generation, A=Create B=Update C=Archive → executed A, B, C.

    This is the NEW action-class tiebreak — render.py would order them by slug
    (A, B, C happens to also be slug order here, so use a slug that proves the
    action rank dominates: see test_action_rank_dominates_slug below).
    """
    a = _step("a_create", PlanAction.CREATE)
    b = _step("b_update", PlanAction.UPDATE)
    c = _step("c_archive", PlanAction.ARCHIVE)

    # A→B and A→C edges put B and C in a later generation than A.
    graph: nx.DiGraph = nx.DiGraph()
    graph.add_nodes_from(["a_create", "b_update", "c_archive"])
    graph.add_edge("a_create", "b_update")
    graph.add_edge("a_create", "c_archive")

    order = _execution_order([a, b, c], graph)

    assert [s.slug for s in order] == ["a_create", "b_update", "c_archive"]


def test_action_rank_dominates_slug() -> None:
    """In ONE generation, action rank wins over slug: a Delete with an early slug
    still runs after a Create with a late slug."""
    create_late = _step("zzz_create", PlanAction.CREATE)
    delete_early = _step("aaa_delete", PlanAction.DELETE)

    graph: nx.DiGraph = nx.DiGraph()
    graph.add_nodes_from(["zzz_create", "aaa_delete"])  # no edges → single generation

    order = _execution_order([create_late, delete_early], graph)

    # Create (rank 0) before Delete (rank 2), despite "zzz" > "aaa".
    assert [s.slug for s in order] == ["zzz_create", "aaa_delete"]


def test_slug_tiebreak_within_action_class() -> None:
    """Two creates in the same generation are slug-sorted."""
    c2 = _step("beta", PlanAction.CREATE)
    c1 = _step("alpha", PlanAction.CREATE)

    graph: nx.DiGraph = nx.DiGraph()
    graph.add_nodes_from(["beta", "alpha"])  # single generation

    order = _execution_order([c2, c1], graph)

    assert [s.slug for s in order] == ["alpha", "beta"]


def test_graphless_steps_appended_last_slug_sorted() -> None:
    """Delete/Archive steps with no graph node are appended after graph steps,
    sorted by slug (diff.py Pass-2 order)."""
    create = _step("in_graph", PlanAction.CREATE)
    del_b = _step("absent_b", PlanAction.DELETE)
    del_a = _step("absent_a", PlanAction.ARCHIVE)

    graph: nx.DiGraph = nx.DiGraph()
    graph.add_node("in_graph")  # only the create is in the graph

    order = _execution_order([create, del_b, del_a], graph)

    assert [s.slug for s in order] == ["in_graph", "absent_a", "absent_b"]
