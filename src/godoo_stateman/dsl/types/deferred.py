"""Deferred thunk and resolve() factory — RSRC-06 contract."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class Deferred:
    """Eager thunk for a deferred computation — fires at read seam, not eval time.

    ``fn`` is typed ``Any`` (not ``Callable[..., Any]``) so that ``ResourceNode.fields``
    holding a ``Deferred`` value can be stored inside a frozen Pydantic model without
    triggering ``PydanticSchemaGenerationError`` (Pitfall 4).

    ``deps`` is a frozenset of slug / node_key strings — each entry becomes a DAG edge
    in ``build_graph()``.
    """

    fn: Any  # Callable; typed Any to allow frozen Pydantic field storage
    deps: frozenset[str]  # slug / node_key names of all *refs — become DAG edges


def resolve(fn: Any, *refs: Any) -> Deferred:
    """Return a Deferred thunk. Never calls fn in Phase 2.

    Extracts the identifier from each ref: .slug first (ResourceNode), then .node_key
    (DataSourceNode), then skips if neither attribute is a non-empty str. Both slug and
    node_key identifiers become DAG edges in the same deps frozenset.
    """
    deps: list[str] = []
    for r in refs:
        # Duck-typed check for _ResourceBuilder: has ._node whose .slug is a str.
        # Avoids a circular import (context.py imports deferred.py).
        inner = getattr(r, "_node", None)
        if inner is not None and hasattr(inner, "slug") and isinstance(inner.slug, str):
            deps.append(inner.slug)
        elif hasattr(r, "slug") and isinstance(r.slug, str):
            deps.append(r.slug)
        elif hasattr(r, "node_key") and isinstance(r.node_key, str):
            deps.append(r.node_key)
        else:
            raise TypeError(
                f"resolve() ref must be a ResourceNode, DataSourceNode, or resource builder; "
                f"got {type(r).__name__!r}"
            )
    return Deferred(fn=fn, deps=frozenset(deps))
