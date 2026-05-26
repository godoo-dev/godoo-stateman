"""DesiredState — frozen Pydantic model capturing the evaluated DSL output."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from godoo_stateman.dsl.types.nodes import DataSourceNode, ResourceNode


class DesiredState(BaseModel):
    """Immutable, validated container for the full desired Odoo state.

    ``arbitrary_types_allowed=True`` is mandatory: ``ResourceNode.fields`` may
    hold ``Deferred`` values whose ``fn: Any`` field carries a callable.
    Without this flag Pydantic raises ``PydanticSchemaGenerationError`` when
    building the model schema (Pitfall 4 from RESEARCH.md).

    All collection fields use ``tuple`` rather than ``list`` — ``frozen=True``
    freezes attribute rebinding but not mutable container contents; ``tuple``
    prevents accidental item append.
    """

    model_config = ConfigDict(frozen=True, arbitrary_types_allowed=True)

    module: str
    resources: tuple[ResourceNode, ...]
    data_sources: tuple[DataSourceNode, ...]
    config_parameters: tuple[dict[str, str], ...]
