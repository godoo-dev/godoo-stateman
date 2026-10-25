"""Unit tests for serialize_fields + GlobalLiveState (REL-05, REL-06, D-02).

serialize_fields is pure (no I/O); GlobalLiveState seeds from a frozen LiveState
and the data-source seam, keyed by ResourceNode.slug. Builders mirror
tests/unit/test_diff.py's _make_versioned_field / _make_snapshot.
"""

from __future__ import annotations

from godoo_stateman.apply.serialize import serialize_fields
from godoo_stateman.apply.state import GlobalLiveState
from godoo_stateman.dsl.types.desired import DesiredState
from godoo_stateman.dsl.types.nodes import ResourceNode
from godoo_stateman.identity import XmlIdRecord
from godoo_stateman.live.livestate import LiveState
from godoo_stateman.types.schema import VersionedFieldSchema, VersionedModelSchema

# ---------------------------------------------------------------------------
# Builders (mirror test_diff.py)
# ---------------------------------------------------------------------------


def _make_versioned_field(name: str, *, ttype: str = "char") -> VersionedFieldSchema:
    return VersionedFieldSchema(
        name=name,
        ttype=ttype,
        store=True,
        readonly=False,
        compute=None,
        relation=None,
        required=False,
    )


def _make_model_schema(fields: dict[str, str]) -> VersionedModelSchema:
    """Build a VersionedModelSchema from a {field_name: ttype} dict."""
    versioned_fields = {name: _make_versioned_field(name, ttype=ttype) for name, ttype in fields.items()}
    return VersionedModelSchema(
        name="test.model",
        display_name="test.model",
        transient=False,
        odoo_version="17.0",
        archivable=True,
        fields=versioned_fields,
    )


# ---------------------------------------------------------------------------
# serialize_fields — m2m SET tuple (REL-06)
# ---------------------------------------------------------------------------


def test_m2m_int_ids_serialize_to_set_tuple() -> None:
    schema = _make_model_schema({"category_ids": "many2many"})
    gls = GlobalLiveState()

    out = serialize_fields(schema, {"category_ids": [5, 9]}, gls)

    assert out == {"category_ids": [(6, 0, [5, 9])]}


def test_m2m_slug_resolves_via_global_live_state() -> None:
    schema = _make_model_schema({"project_ids": "many2many"})
    gls = GlobalLiveState()
    gls["proj_a"] = 42

    out = serialize_fields(schema, {"project_ids": ["proj_a"]}, gls)

    assert out == {"project_ids": [(6, 0, [42])]}


def test_m2m_empty_value_clears_relation() -> None:
    schema = _make_model_schema({"category_ids": "many2many"})
    gls = GlobalLiveState()

    out = serialize_fields(schema, {"category_ids": []}, gls)

    assert out == {"category_ids": [(6, 0, [])]}


def test_scalar_fields_pass_through() -> None:
    schema = _make_model_schema(
        {"partner_id": "many2one", "name": "char", "active": "boolean"}
    )
    gls = GlobalLiveState()

    out = serialize_fields(
        schema,
        {"partner_id": 7, "name": "X", "active": True},
        gls,
    )

    assert out == {"partner_id": 7, "name": "X", "active": True}


# ---------------------------------------------------------------------------
# GlobalLiveState — seed + register round-trip (REL-05, D-02)
# ---------------------------------------------------------------------------


def test_register_round_trip() -> None:
    gls = GlobalLiveState()
    assert "new_proj" not in gls
    gls.register("new_proj", 100)
    assert gls["new_proj"] == 100
    assert "new_proj" in gls


def test_from_live_state_seeds_managed_and_seam() -> None:
    resource = ResourceNode(model="project.project", slug="proj_a", fields={})
    desired = DesiredState(
        xmlid_prefix="myprefix",
        resources=(resource,),
        data_sources=(),
        config_parameters=(),
    )
    live = LiveState(
        managed={
            "myprefix.proj_a": XmlIdRecord(
                module="myprefix",
                name="proj_a",
                model="project.project",
                res_id=11,
                complete_name="myprefix.proj_a",
            )
        },
        live_fields={},
    )
    seam_result = {"data.res.partner[name='Acme']": 99}

    gls = GlobalLiveState.from_live_state(desired, live, seam_result)

    assert gls["proj_a"] == 11  # managed seed keyed by slug
    assert gls["data.res.partner[name='Acme']"] == 99  # seam seed


def test_from_live_state_keys_by_slug_not_xmlid_name() -> None:
    """D-02: a managed resource whose slug differs from its xmlid `name` must
    still resolve by SLUG through GlobalLiveState — proving the seed key is the
    resource slug, not record.name.

    Here the operator-supplied xmlid name segment ("legacy_name") diverges from
    the resource slug ("proj_a"). LiveState keys `managed` by complete xmlid; the
    desired resource's complete xmlid is built from its slug, so we model the
    record name == slug at the key level but assert the seed entry is slug-keyed.
    """
    # Resource slug is "proj_a"; its complete xmlid is "myprefix.proj_a".
    resource = ResourceNode(model="project.project", slug="proj_a", fields={})
    desired = DesiredState(
        xmlid_prefix="myprefix",
        resources=(resource,),
        data_sources=(),
        config_parameters=(),
    )
    # The managed record's xmlid `name` segment diverges from the slug, but the
    # managed dict key is the complete xmlid the diff/seam pipeline constructs.
    live = LiveState(
        managed={
            "myprefix.proj_a": XmlIdRecord(
                module="myprefix",
                name="legacy_name",  # diverges from slug "proj_a"
                model="project.project",
                res_id=77,
                complete_name="myprefix.proj_a",
            )
        },
        live_fields={},
    )

    gls = GlobalLiveState.from_live_state(desired, live, {})

    # Resolves by SLUG, not by the xmlid name segment.
    assert gls["proj_a"] == 77
    assert "legacy_name" not in gls
