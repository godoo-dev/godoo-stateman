"""Unit tests for eval_config() — CORE-01, RSRC-01 through RSRC-07.

All tests use tmp_path; no Docker, no Odoo calls.
asyncio_mode = "auto" in pyproject.toml — no @pytest.mark.asyncio needed.
All test functions are top-level def (no class TestX).
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest

from godoo_stateman.dsl.eval import _flatten, eval_config
from godoo_stateman.dsl.types.nodes import ChildrenWrapper, ResourceNode
from godoo_stateman.errors import DslEvalError, MissingModuleError

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _write_config(tmp_path: Path, content: str) -> Path:
    """Write content to a temporary config.py and return the path."""
    config_path = tmp_path / "config.py"
    config_path.write_text(content, encoding="utf-8")
    return config_path


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_resource_constructor(tmp_path: Path) -> None:
    """RSRC-01: resource.<model>(slug, **fields) creates a ResourceNode."""
    path = _write_config(
        tmp_path,
        'xmlid_prefix = "test_mod"\nresource.res_partner("p1", name="Acme")\n',
    )
    state = eval_config(path)
    assert len(state.resources) == 1
    node = state.resources[0]
    assert node.slug == "p1"
    assert node.model == "res.partner"
    assert node.fields["name"] == "Acme"


def test_data_source(tmp_path: Path) -> None:
    """RSRC-02: data.<model>(**selector) creates a DataSourceNode."""
    path = _write_config(
        tmp_path,
        'xmlid_prefix = "test_mod"\ndata.res_users(login="admin")\n',
    )
    state = eval_config(path)
    assert len(state.data_sources) == 1
    node = state.data_sources[0]
    assert node.model == "res.users"
    assert node.selector == {"login": "admin"}


def test_with_block(tmp_path: Path) -> None:
    """RSRC-03: with block + attribute assignment populates resource fields."""
    path = _write_config(
        tmp_path,
        'xmlid_prefix = "test_mod"\n'
        'with resource.res_partner("p1") as r:\n'
        '    r.name = "Acme"\n'
        '    r.email = "acme@example.com"\n',
    )
    state = eval_config(path)
    assert len(state.resources) == 1
    node = state.resources[0]
    assert node.fields["name"] == "Acme"
    assert node.fields["email"] == "acme@example.com"


def test_mail_config(tmp_path: Path) -> None:
    """RSRC-04: mail.config["key"] = "val" appends a config_parameter entry."""
    path = _write_config(
        tmp_path,
        'xmlid_prefix = "test_mod"\nmail.config["web.base.url"] = "https://odoo.example.com"\n',
    )
    state = eval_config(path)
    assert len(state.config_parameters) == 1
    entry = state.config_parameters[0]
    assert entry["key"] == "web.base.url"
    assert entry["value"] == "https://odoo.example.com"


def test_walrus_operator(tmp_path: Path) -> None:
    """RSRC-05: walrus := inside expression context works and resource ref is captured."""
    path = _write_config(
        tmp_path,
        'xmlid_prefix = "test_mod"\n'
        '_ = (p := resource.res_partner("p1"))\n'
        'resource.project_project("proj", partner_id=p)\n',
    )
    state = eval_config(path)
    assert len(state.resources) == 2
    # The project's partner_id should be the _ResourceBuilder for p1.
    # The builder exposes _node which is the ResourceNode.
    proj = next(n for n in state.resources if n.slug == "proj")
    # partner_id is the _ResourceBuilder returned by resource.res_partner("p1")
    # We can't do isinstance check here directly, but verify it has a _node or is ResourceNode
    partner_id_val = proj.fields["partner_id"]
    # The value set via the walrus is a _ResourceBuilder — check it wraps the right node
    assert hasattr(partner_id_val, "_node") or isinstance(partner_id_val, ResourceNode)
    # Verify it points to p1
    if hasattr(partner_id_val, "_node"):
        assert partner_id_val._node.slug == "p1"
    else:
        assert partner_id_val.slug == "p1"


def test_restricted_builtins_blocks_import(tmp_path: Path) -> None:
    """RSRC-07: import statement in config raises NameError — __import__ absent."""
    path = _write_config(
        tmp_path,
        'xmlid_prefix = "test_mod"\nimport os\n',
    )
    # import statement uses __import__ under the hood; absent from _SAFE_BUILTINS
    with pytest.raises((NameError, ImportError)):
        eval_config(path)


def test_restricted_builtins_blocks_open(tmp_path: Path) -> None:
    """RSRC-07: open() in config raises NameError — open absent from _SAFE_BUILTINS."""
    path = _write_config(
        tmp_path,
        'xmlid_prefix = "test_mod"\nopen("/etc/passwd")\n',
    )
    with pytest.raises(NameError):
        eval_config(path)


def test_missing_module_raises(tmp_path: Path) -> None:
    """D-02: config with no module = "..." declaration raises MissingModuleError."""
    path = _write_config(
        tmp_path,
        'resource.res_partner("p1", name="Acme")\n',
    )
    with pytest.raises(MissingModuleError):
        eval_config(path)


def test_module_declaration_extracted(tmp_path: Path) -> None:
    """D-02: module declaration in exec_locals is correctly extracted."""
    path = _write_config(
        tmp_path,
        'xmlid_prefix = "my_project"\n',
    )
    state = eval_config(path)
    assert state.xmlid_prefix == "my_project"


def test_inline_children_flatten(tmp_path: Path) -> None:
    """D-09: children() wrapper is stripped; child node promoted to top-level with prefixed slug."""
    path = _write_config(
        tmp_path,
        'xmlid_prefix = "test_mod"\n'
        'with resource.sale_order("order1") as o:\n'
        '    o.name = "SO001"\n'
        '    o.lines = children("sale.order.line", "order_id", [\n'
        '        resource.sale_order_line("line1", product_id=1),\n'
        "    ])\n",
    )
    state = eval_config(path)
    # Should have 2 resources: parent + child
    assert len(state.resources) == 2

    slugs = {n.slug for n in state.resources}
    assert "order1" in slugs
    assert "order1.line1" in slugs

    # Parent's 'lines' field should be a list of slug strings, not ChildrenWrapper
    parent = next(n for n in state.resources if n.slug == "order1")
    assert not isinstance(parent.fields.get("lines"), ChildrenWrapper)
    assert parent.fields["lines"] == ["order1.line1"]

    # Child should have parent_slug set and inverse_field holding the parent SLUG STRING
    # (WR-01 fix: must be a str, not a ResourceNode, to prevent spurious diffs in diff()).
    child = next(n for n in state.resources if n.slug == "order1.line1")
    assert child.parent_slug == "order1"
    assert "order_id" in child.fields
    assert child.fields["order_id"] == "order1", (
        f"WR-01: inverse_field must hold the parent slug string 'order1', "
        f"got {type(child.fields['order_id']).__name__!r}: {child.fields['order_id']!r}"
    )
    assert isinstance(child.fields["order_id"], str), (
        "WR-01: inverse_field must be a slug string, not ResourceNode or other type"
    )

    # No ChildrenWrapper anywhere in any resource fields
    for node in state.resources:
        for fval in node.fields.values():
            assert not isinstance(fval, ChildrenWrapper), (
                f"ChildrenWrapper found in {node.slug}.fields after eval_config()"
            )


def test_three_segment_model_name(tmp_path: Path) -> None:
    """MA-01: 3-segment model names translate correctly via full underscore-to-dot replacement.

    resource.sale_order_line → model "sale.order.line" (not "sale.order_line").
    data.account_move_line → model "account.move.line".
    """
    path = _write_config(
        tmp_path,
        'xmlid_prefix = "test_mod"\n'
        'resource.sale_order_line("line1", product_id=1)\n'
        "data.account_move_line(move_id=42)\n",
    )
    state = eval_config(path)
    assert len(state.resources) == 1
    node = state.resources[0]
    assert node.model == "sale.order.line", (
        f"Expected 'sale.order.line', got {node.model!r} — full underscore replacement broken"
    )
    assert len(state.data_sources) == 1
    ds = state.data_sources[0]
    assert ds.model == "account.move.line", (
        f"Expected 'account.move.line', got {ds.model!r} — full underscore replacement broken"
    )


def test_nested_children_raises(tmp_path: Path) -> None:
    """IN-01: nested children() calls (children-of-children) raise a clear ValueError.

    DesiredState must never hold ChildrenWrapper values (nodes.py invariant).
    _flatten() enforces a post-condition: if a child node itself carries a
    ChildrenWrapper field (i.e. nested children()), it must raise ValueError
    with a clear message rather than silently corrupting DesiredState.

    We construct the scenario directly: a grandchild node whose fields contain
    a ChildrenWrapper, wrapped as a child inside a parent ChildrenWrapper.
    This bypasses DSL eval to produce exactly the unsupported structure.
    """
    # Grandchild: a node whose fields already contain a ChildrenWrapper.
    great_grandchild = ResourceNode(model="a.b.c", slug="ggc1", fields={})
    nested_wrapper = ChildrenWrapper(
        child_model="a.b.c",
        inverse_field="line_id",
        children=(great_grandchild,),
    )
    grandchild = ResourceNode(
        model="sale.order.line",
        slug="line1",
        fields={"details": nested_wrapper},  # <-- nested ChildrenWrapper
    )
    # Parent: wraps the grandchild in a ChildrenWrapper.
    outer_wrapper = ChildrenWrapper(
        child_model="sale.order.line",
        inverse_field="order_id",
        children=(grandchild,),
    )
    parent = ResourceNode(
        model="sale.order",
        slug="order1",
        fields={"lines": outer_wrapper},
    )

    with pytest.raises(ValueError, match="ChildrenWrapper survived flattening"):
        _flatten([parent])


def test_children_underscore_model_normalization(tmp_path: Path) -> None:
    """IN-02: children() applies underscore-to-dot normalization on child_model.

    children("sale_order_line", ...) must store child_model = "sale.order.line",
    consistent with the ResourceProxy sugar (D-03). Without normalization, the
    child nodes would carry "sale_order_line" which does not match any Odoo schema.
    """
    path = _write_config(
        tmp_path,
        'xmlid_prefix = "test_mod"\n'
        'with resource.sale_order("order1") as o:\n'
        '    o.name = "SO001"\n'
        '    o.lines = children("sale_order_line", "order_id", [\n'
        '        resource.sale_order_line("line1", product_id=1),\n'
        "    ])\n",
    )
    state = eval_config(path)
    # Child node must have model "sale.order.line", not "sale_order_line"
    child = next(n for n in state.resources if n.slug == "order1.line1")
    assert child.model == "sale.order.line", (
        f"Expected 'sale.order.line', got {child.model!r} — children() must normalize underscores to dots (IN-02)"
    )


def test_resource_builder_rejects_underscore_prefix(tmp_path: Path) -> None:
    """WR-02/CR-01: assigning a _-prefixed attribute on the resource builder raises AttributeError."""
    path = _write_config(
        tmp_path,
        'xmlid_prefix = "test_mod"\nwith resource.res_partner("p1") as r:\n    r._secret = "bad"\n',
    )
    with pytest.raises((AttributeError, NameError)):
        eval_config(path)


def test_duplicate_slug_top_level_raises(tmp_path: Path) -> None:
    """WR-02: two top-level resources with the same slug raise DslEvalError."""
    path = _write_config(
        tmp_path,
        'xmlid_prefix = "test_mod"\nresource.res_partner("p1", name="A")\nresource.res_partner("p1", name="B")\n',
    )
    with pytest.raises(DslEvalError, match="Duplicate resource slug 'p1'"):
        eval_config(path)


def test_duplicate_slug_children_raises(tmp_path: Path) -> None:
    """WR-02: two sibling children with the same slug raise DslEvalError (promoted slug collision)."""
    path = _write_config(
        tmp_path,
        'xmlid_prefix = "test_mod"\n'
        'with resource.sale_order("order1") as o:\n'
        '    o.name = "SO001"\n'
        '    o.lines = children("sale.order.line", "order_id", [\n'
        '        resource.sale_order_line("line1", product_id=1),\n'
        '        resource.sale_order_line("line1", product_id=2),\n'
        "    ])\n",
    )
    with pytest.raises(DslEvalError, match=r"Duplicate resource slug 'order1\.line1'"):
        eval_config(path)


def test_distinct_slugs_pass(tmp_path: Path) -> None:
    """WR-02: a config with distinct slugs (including children) evaluates without error."""
    path = _write_config(
        tmp_path,
        'xmlid_prefix = "test_mod"\nresource.res_partner("p1", name="A")\nresource.res_partner("p2", name="B")\n',
    )
    state = eval_config(path)
    assert len(state.resources) == 2
    slugs = {n.slug for n in state.resources}
    assert slugs == {"p1", "p2"}


def test_eval_purity_no_odoo_calls(tmp_path: Path) -> None:
    """CORE-01: eval_config() makes zero Odoo/network calls (purity invariant).

    Patches ``godoo.client.client.OdooClient`` to a Mock that raises on any
    call — if eval_config() touches the client, the test fails.
    """
    path = _write_config(
        tmp_path,
        'xmlid_prefix = "test_mod"\n'
        'with resource.res_partner("p1") as r:\n'
        '    r.name = "Acme"\n'
        '_ = data.res_users(login="admin")\n'
        'mail.config["web.base.url"] = "https://odoo.example.com"\n',
    )

    # Patch OdooClient so any instantiation or call raises AssertionError.
    # This is the nuclear option: if eval_config() touches Odoo transport at all,
    # the test will fail with a clear message.
    #
    # Use patch.object on the live module rather than a string path so that a
    # future package restructure causes an immediate AttributeError here (broken
    # guard) rather than silently patching a non-existent path (IN-04).
    def _fail_on_odoo(*args: object, **kwargs: object) -> None:
        raise AssertionError("eval_config() must not access OdooClient — purity violation")

    import godoo.client.client as _godoo_client_mod  # ImportError = guard is broken

    with patch.object(_godoo_client_mod, "OdooClient", side_effect=_fail_on_odoo):
        state = eval_config(path)

    # Verify the result is correct (proves real eval ran to completion).
    assert state.xmlid_prefix == "test_mod"
    assert len(state.resources) == 1
    assert len(state.data_sources) == 1
    assert len(state.config_parameters) == 1
