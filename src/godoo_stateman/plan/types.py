"""Plan stage type contracts — PlanAction, FieldDiff, PlanStep.

These frozen Pydantic models are the serializable output of the diff stage and
the input to the plan render stage.  No I/O — pure data types only.

Conventions:
- ``tuple[T, ...]`` over ``list[T]`` for ordered frozen collections,
  consistent with the ``DesiredState`` precedent in ``dsl/types/desired.py``.
- All models are frozen (``ConfigDict(frozen=True)``) so plan steps can be
  safely shared across pipeline stages without defensive copying.
"""

from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict


class PlanAction(str, Enum):
    """The action the executor will take for a given managed resource.

    ``str`` mixin makes the enum JSON-serialisable and Rich-printable with no
    extra conversion step.

    Values:
    - CREATE  — xmlid absent in ir.model.data; resource will be created.
    - UPDATE  — xmlid present, same model, but at least one field differs.
    - NOOP    — xmlid present, same model, all fields match.
    - DELETE  — managed by this xmlid_prefix but absent from desired state;
                model is not archivable, so record will be deleted.
    - ARCHIVE — managed by this xmlid_prefix but absent from desired state;
                model is archivable, so record will be archived (active=False).
    - REJECT  — xmlid present but points to a different model (D-02 collision).
                Operator must resolve manually — no auto-action taken.
    """

    CREATE = "create"
    UPDATE = "update"
    NOOP = "noop"
    DELETE = "delete"
    ARCHIVE = "archive"
    REJECT = "reject"


class FieldDiff(BaseModel):
    """A single field-level difference between desired and live values.

    Used exclusively inside ``PlanStep.field_diff`` for UPDATE actions.
    """

    model_config = ConfigDict(frozen=True)

    field_name: str
    old_value: Any  # live Odoo value (normalised)
    new_value: Any  # desired value (normalised)


class PlanStep(BaseModel):
    """One resource's resolved plan action — the unit of the ordered plan list.

    ``field_diff`` is an empty tuple for non-UPDATE actions.  ``res_id`` is
    ``None`` for CREATE (the record does not yet exist in Odoo).

    ``xmlid`` is the full xmlid string, e.g. ``"myprefix.my_slug"``.
    """

    model_config = ConfigDict(frozen=True)

    action: PlanAction
    slug: str
    model: str
    xmlid: str  # full xmlid e.g. "myprefix.my_slug"
    res_id: int | None  # None for CREATE (not yet exists)
    field_diff: tuple[FieldDiff, ...]  # empty for non-UPDATE actions
