"""Frozen DSL node value objects — ResourceNode, DataSourceNode, ChildrenWrapper."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict


class ResourceOptions(BaseModel):
    """Per-resource safety options (SAFE-01).

    ``delete_behavior`` controls what happens when a managed resource is absent
    from the desired state: ``"delete"`` removes the record, ``"archive"`` sets
    ``active=False``, ``"reject"`` (the default) blocks any destructive action so
    that destructive intent must be explicit.

    Frozen for safe sharing across pipeline stages.  ``ResourceNode.options`` is
    typed as this base class so future per-type subclasses (e.g.
    ``ProjectResourceOptions``) are not precluded (R5).
    """

    model_config = ConfigDict(frozen=True)

    delete_behavior: Literal["delete", "archive", "reject"] = "reject"


@dataclass(frozen=True)
class ResourceNode:
    """Immutable descriptor of a desired managed resource.

    ``fields`` is a ``dict[str, Any]`` — inherently mutable — matching the
    Phase-1 precedent set by ``VersionedModelSchema.fields``. Mutation of the
    dict contents is possible but undocumented behaviour; callers should treat
    the dict as logically immutable.

    ``xmlid_module`` overrides the top-level ``module`` declaration for this
    resource's xmlid, enabling cross-module references.

    ``parent_slug`` is populated by ``children()`` wrapper expansion so that
    ``build_graph()`` can add parent→child edges without a second scan.
    """

    model: str
    slug: str
    fields: dict[str, Any]
    xmlid_module: str | None = None
    parent_slug: str | None = None
    options: ResourceOptions = field(default_factory=ResourceOptions)  # NEW (R5, SAFE-01)


@dataclass(frozen=True)
class DataSourceNode:
    """Immutable descriptor of a read-only data-source reference.

    ``node_key`` is a deterministic string derived externally in the format
    ``f"data.{model}[{sorted_selector_repr}]"`` (CONTEXT.md D-03).  It serves
    as the unique identity for this data source in the dependency DAG.
    """

    model: str
    selector: dict[str, Any]
    node_key: str


@dataclass(frozen=True)
class ChildrenWrapper:
    """Transient container used during DSL evaluation to declare inline One2many children.

    ``children`` is ``tuple[Any, ...]`` (not ``tuple[ResourceNode, ...]``) to
    avoid a forward-reference issue: both types live in this module and
    ``ResourceNode`` is defined above, but using ``Any`` keeps the annotation
    simple and avoids any TYPE_CHECKING gymnastics.

    The ``_flatten()`` step in ``eval.py`` expands ``ChildrenWrapper`` values
    into top-level ``ResourceNode`` entries before constructing ``DesiredState``
    — ``DesiredState`` must never hold ``ChildrenWrapper`` values.
    """

    child_model: str
    inverse_field: str
    children: tuple[Any, ...]
