"""Diff engine — pure function that classifies desired vs live state.

``diff()`` is a **synchronous, pure function** with no I/O:

- Takes a pre-built :class:`~godoo_stateman.schema.snapshot.VersionedSnapshot`
  (sync dict access, populated by ``await registry.build_snapshot(...)`` before
  this call).
- Takes a :class:`~godoo_stateman.live.livestate.LiveState` (already fetched).
- Takes a :class:`~godoo_stateman.dsl.types.desired.DesiredState` whose
  ``ResourceNode.fields`` have already had ``Deferred`` values resolved by the
  seam stage.

No ``client``, no ``registry``, no async — diff is entirely deterministic given
its inputs (SC-2).

Classification rules (CORE-03, SAFE-03, D-01, D-02, D-04):

- **CREATE**  — slug absent from ``live_state.managed`` (D-01: no
  natural-identity probing; ``find_by_xmlid`` returning None means Create).
- **REJECT**  — slug present but ``XmlIdRecord.model != resource.model``
  (D-02: xmlid namespace collision; decided from ``ir.model.data`` alone).
- **UPDATE**  — same model, at least one stored+writable field differs after
  live-value normalization (Pitfall 1: must call ``_normalize_value`` on live
  values to avoid false-positive diffs on m2o/m2m fields).
- **NOOP**    — same model, all stored+writable fields match after normalization.
- **ARCHIVE** — slug in managed set but absent from desired; model is archivable.
- **DELETE**  — slug in managed set but absent from desired; model not archivable.

Non-stored (``store=False``) and readonly fields are excluded from comparison
(Pitfall 2 — they cannot be written anyway).

Effective xmlid prefix: ``resource.xmlid_module or state.xmlid_prefix`` (Pitfall 3
— per-resource override takes precedence over the top-level config prefix).
"""

from __future__ import annotations

from typing import Any

from godoo_stateman.dsl.normalize import _normalize_value
from godoo_stateman.dsl.types.desired import DesiredState
from godoo_stateman.live.livestate import LiveState
from godoo_stateman.plan.types import FieldDiff, PlanAction, PlanStep
from godoo_stateman.schema.snapshot import VersionedSnapshot


def diff(
    state: DesiredState,
    live_state: LiveState,
    snapshot: VersionedSnapshot,
) -> list[PlanStep]:
    """Classify each resource as Create/Update/NoOp/Delete/Archive/Reject.

    Returns an ordered ``list[PlanStep]``:

    - Desired-state resources appear first, in their declaration order.
    - Delete/Archive candidates (managed slugs absent from desired) follow,
      sorted by slug for determinism (SC-2).

    This function is **synchronous and pure** — no I/O, no client calls,
    no registry.get() (async). The caller is responsible for building
    ``snapshot`` via ``await registry.build_snapshot(...)`` before invoking
    ``diff()``.

    Args:
        state:      Evaluated and normalized ``DesiredState``; ``ResourceNode.fields``
                    must already have ``Deferred`` values resolved by the seam stage.
        live_state: Frozen snapshot of all managed ``ir.model.data`` rows plus
                    per-record live field values.
        snapshot:   Pre-built ``VersionedSnapshot`` providing synchronous access
                    to model schemas (``snapshot.models[model]``).

    Returns:
        Ordered flat list of ``PlanStep`` objects — one per resource.
    """
    steps: list[PlanStep] = []
    # Compute the complete xmlids for all desired resources so Pass 2 can find
    # managed-but-absent entries (now keyed by complete xmlid, not bare slug).
    desired_xmlids: set[str] = {
        f"{(r.xmlid_module or state.xmlid_prefix)}.{r.slug}" for r in state.resources
    }

    # -----------------------------------------------------------------------
    # Pass 1: classify each desired resource
    # -----------------------------------------------------------------------
    for resource in state.resources:
        # Pitfall 3: per-resource xmlid_module override takes precedence.
        effective_prefix = resource.xmlid_module or state.xmlid_prefix
        xmlid = f"{effective_prefix}.{resource.slug}"

        # Look up by complete xmlid ("{effective_prefix}.{slug}") — the managed
        # dict is now keyed by complete xmlid to support per-resource xmlid_module
        # overrides (CR-02 fix).
        record = live_state.managed.get(xmlid)

        if record is None:
            # D-01: No natural-identity probing. Absent slug → CREATE.
            steps.append(
                PlanStep(
                    action=PlanAction.CREATE,
                    slug=resource.slug,
                    model=resource.model,
                    xmlid=xmlid,
                    res_id=None,
                    field_diff=(),
                )
            )
            continue

        if record.model != resource.model:
            # D-02: xmlid namespace collision → REJECT (SAFE-03).
            # The xmlid is already owned by a different Odoo model.
            # Operator must resolve this manually — no auto-action taken.
            steps.append(
                PlanStep(
                    action=PlanAction.REJECT,
                    slug=resource.slug,
                    model=resource.model,
                    xmlid=xmlid,
                    res_id=record.res_id,
                    field_diff=(),
                )
            )
            continue

        # Same model — compare fields to determine UPDATE or NOOP.
        live_fields: dict[str, Any] = live_state.live_fields.get(record.res_id, {})
        model_schema = snapshot.models.get(resource.model)

        field_diffs: list[FieldDiff] = []

        for fname, desired_val in resource.fields.items():
            # Pitfall 2: skip non-stored or readonly fields — cannot be written.
            if model_schema is None:
                # Unknown model in snapshot — cannot classify fields; skip.
                continue
            schema_field = model_schema.fields.get(fname)
            if schema_field is None:
                # Unknown field — skip (schema is the authority).
                continue
            if not schema_field.store or schema_field.readonly:
                continue

            live_val = live_fields.get(fname)

            # Pitfall 1: normalize BOTH sides with the same rules.
            # desired_val is already normalized by the normalize() stage;
            # live_val comes raw from Odoo and must be normalized here.
            norm_desired = _normalize_value(desired_val, schema_field.ttype)
            norm_live = _normalize_value(live_val, schema_field.ttype)

            if norm_desired != norm_live:
                field_diffs.append(
                    FieldDiff(
                        field_name=fname,
                        old_value=norm_live,
                        new_value=norm_desired,
                    )
                )

        action = PlanAction.UPDATE if field_diffs else PlanAction.NOOP
        steps.append(
            PlanStep(
                action=action,
                slug=resource.slug,
                model=resource.model,
                xmlid=xmlid,
                res_id=record.res_id,
                field_diff=tuple(field_diffs),
            )
        )

    # -----------------------------------------------------------------------
    # Pass 2: managed xmlids absent from desired → Delete or Archive (D-04)
    # -----------------------------------------------------------------------
    # live_state.managed is now keyed by complete xmlid ("{module}.{slug}").
    # Sort by complete xmlid for determinism (SC-2).
    absent_xmlids = sorted(
        complete_xmlid
        for complete_xmlid in live_state.managed
        if complete_xmlid not in desired_xmlids
    )

    for complete_xmlid in absent_xmlids:
        record = live_state.managed[complete_xmlid]
        model_schema = snapshot.models.get(record.model)

        action = PlanAction.ARCHIVE if model_schema is not None and model_schema.archivable else PlanAction.DELETE

        steps.append(
            PlanStep(
                action=action,
                slug=record.name,
                model=record.model,
                xmlid=complete_xmlid,
                res_id=record.res_id,
                field_diff=(),
            )
        )

    return steps
