"""Dependency DAG construction and cycle detection — REL-01, REL-02, REL-07.

``build_graph()`` is the single public entry point.  It accepts a
:class:`~godoo_stateman.dsl.types.desired.DesiredState` produced by the
eval/normalize pipeline and returns a :class:`networkx.DiGraph` representing
the full dependency ordering across resources, inline children, and data
sources.

Cycle detection
---------------
``nx.find_cycle(G)`` raises :exc:`networkx.NetworkXNoCycle` when the graph is
acyclic (it does NOT return ``None``).  The implementation wraps the call in a
``try/except nx.NetworkXNoCycle`` block — NOT a ``None``-check (Pitfall 1 from
Phase 2 RESEARCH.md).  A detected cycle raises
:exc:`~godoo_stateman.errors.CycleError` with the full cycle path embedded in
the message, before any Odoo call is made.

Inline One2many children (REL-07)
-----------------------------------
Inline children are identified by a non-``None``
:attr:`~godoo_stateman.dsl.types.nodes.ResourceNode.parent_slug`.  A directed
edge ``parent_slug → child_slug`` is added so the DAG includes the
parent→child dependency in cycle detection.

Edge sources
------------
Three sources contribute edges to the graph:

A. **Parent→child** — ``ResourceNode.parent_slug is not None`` implies an edge
   ``(parent_slug, resource.slug)`` when both nodes are in the graph.
B. **Deferred.deps** — each slug in
   :attr:`~godoo_stateman.dsl.types.deferred.Deferred.deps` becomes an edge
   ``(dep_slug, resource.slug)`` when ``dep_slug`` is a known node (covers
   both ``ResourceNode.slug`` and ``DataSourceNode.node_key`` targets).
C. **Direct resource references** — field values with a ``.slug`` attribute
   whose value is a known graph node yield an edge
   ``(field_val.slug, resource.slug)``.
"""

from __future__ import annotations

import networkx as nx

from godoo_stateman.dsl.types.deferred import Deferred
from godoo_stateman.dsl.types.desired import DesiredState
from godoo_stateman.errors import CycleError


def build_graph(state: DesiredState) -> nx.DiGraph:
    """Build a directed dependency graph from *state* and detect cycles.

    Parameters
    ----------
    state:
        The fully evaluated (and optionally normalized) desired state produced
        by :func:`~godoo_stateman.dsl.eval.eval_config`.

    Returns
    -------
    nx.DiGraph
        A directed graph where each node is a resource slug or data-source
        ``node_key``, and each edge ``(u, v)`` means "``u`` must be
        reconciled before ``v``".

    Raises
    ------
    CycleError
        When the dependency graph contains a cycle.  The exception message
        includes the full cycle path as a human-readable string.
    """
    G: nx.DiGraph = nx.DiGraph()

    # ------------------------------------------------------------------
    # Step 1 — Add all nodes
    # ------------------------------------------------------------------
    for resource in state.resources:
        G.add_node(resource.slug, node_type="resource")

    for data_source in state.data_sources:
        G.add_node(data_source.node_key, node_type="data_source")

    # ------------------------------------------------------------------
    # Step 2 — Add edges from three sources
    # ------------------------------------------------------------------
    for resource in state.resources:
        # A. Parent→child edges (REL-07)
        if resource.parent_slug is not None and G.has_node(resource.parent_slug):
            G.add_edge(resource.parent_slug, resource.slug)

        # B + C. Field-value edges
        for field_val in resource.fields.values():
            if isinstance(field_val, Deferred):
                # B. Deferred.deps — one edge per dep slug/node_key
                for dep_slug in field_val.deps:
                    if G.has_node(dep_slug):
                        G.add_edge(dep_slug, resource.slug)
            elif (
                hasattr(field_val, "slug")
                and isinstance(field_val.slug, str)
                and G.has_node(field_val.slug)
            ):
                # C. Direct resource reference via .slug attribute
                G.add_edge(field_val.slug, resource.slug)
            # NOTE: list[str] values (post-flatten parent→child slug lists) are NOT
            # traversed here. Parent→child edges are covered by source A (parent_slug).
            # Only direct field-value references produce edges in sources B and C.

    # ------------------------------------------------------------------
    # Step 3 — Cycle detection (Pitfall 1: catch NetworkXNoCycle, NOT None-check)
    # ------------------------------------------------------------------
    try:
        cycle_edges = nx.find_cycle(G)
        # nx.find_cycle returns list of (u, v) tuples when a cycle is found.
        # Reconstruct the full cycle path string: u1 -> u2 -> ... -> u1
        path = [e[0] for e in cycle_edges] + [cycle_edges[-1][1]]
        cycle_str = " -> ".join(path)
        raise CycleError(f"Dependency cycle detected: {cycle_str}")
    except nx.NetworkXNoCycle:
        # No cycle — graph is valid; continue.
        pass

    return G
