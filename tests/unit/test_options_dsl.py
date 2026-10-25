"""Unit tests for the `_options=` DSL surface (SAFE-01, R5).

`resource.<model>("slug", _options=ResourceOptions(...), **fields)` must:
- attach the ResourceOptions to ResourceNode.options,
- strip `_options` so it never lands in `fields`,
- default to delete_behavior="reject" when omitted.
"""

from __future__ import annotations

from godoo_stateman.dsl.context import ResourceProxy, _Collector
from godoo_stateman.dsl.types.nodes import ResourceOptions


def test_options_kwarg_sets_options_and_is_stripped_from_fields() -> None:
    collector = _Collector()
    resource = ResourceProxy(collector)

    resource.res_partner("p", _options=ResourceOptions(delete_behavior="archive"), name="X")

    assert len(collector.resources) == 1
    node = collector.resources[0]
    assert node.options.delete_behavior == "archive"
    assert "X" not in node.fields.values() or node.fields.get("name") == "X"
    assert node.fields["name"] == "X"
    assert "_options" not in node.fields


def test_options_defaults_to_reject_when_omitted() -> None:
    collector = _Collector()
    resource = ResourceProxy(collector)

    resource.res_partner("p", name="Y")

    node = collector.resources[0]
    assert node.options.delete_behavior == "reject"
    assert node.fields["name"] == "Y"
    assert "_options" not in node.fields
