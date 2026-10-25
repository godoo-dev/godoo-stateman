"""GlobalLiveState — the mutable slug→remote_id resolver for the apply stage.

``GlobalLiveState`` is the executor's only cross-step state (REL-05). It maps a
:class:`~godoo_stateman.dsl.types.nodes.ResourceNode` ``slug`` to its live Odoo
``res_id`` so that an m2m field referencing a managed sibling by slug can be
resolved to an int before the ``(6, 0, [ids])`` SET tuple is emitted.

Design (locked D-02 / SPEC R3):

- The map is **keyed by ``ResourceNode.slug``** — NEVER by ``XmlIdRecord.name``.
  ``record.name`` is the xmlid *name segment* and can diverge from the resource
  slug (the import command accepts an operator-supplied ``name``; ``LiveState``
  keys ``managed`` by the *complete* xmlid ``"{module}.{name}"``). Keying the
  seed by ``record.name`` would let an m2m slug-reference miss a managed target
  — that is the D-02 violation this object corrects.
- It is **mutable by design** — the executor registers a newly-created record's
  id after each CREATE, before the next step runs. It NEVER mutates the frozen
  :class:`~godoo_stateman.live.livestate.LiveState` it seeds from (Pitfall 1).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from godoo_stateman.dsl.types.desired import DesiredState
    from godoo_stateman.live.livestate import LiveState


@dataclass
class GlobalLiveState:
    """Mutable ``slug -> res_id`` map, seeded from managed state and the read seam.

    Use :meth:`from_live_state` to construct a seeded instance; call
    :meth:`register` (or ``__setitem__``) after each successful CREATE.
    """

    _slug_to_res_id: dict[str, int] = field(default_factory=dict)

    @classmethod
    def from_live_state(
        cls,
        desired_state: DesiredState,
        live_state: LiveState,
        seam_result: dict[str, int],
    ) -> GlobalLiveState:
        """Seed a ``GlobalLiveState`` from managed resources and the data-source seam.

        Seeds from BOTH sources:

        1. For every resource in ``desired_state.resources`` whose complete xmlid is
           present in ``live_state.managed``, the entry ``resource.slug -> res_id``.
           The complete xmlid is reconstructed the SAME way ``LiveState`` builds its
           ``managed`` keys: ``f"{module}.{name}"`` where ``module`` is
           ``resource.xmlid_module or desired_state.xmlid_prefix`` and ``name`` is the
           resource slug. The resulting seed entry is keyed by ``resource.slug`` (D-02).
        2. Every ``node_key -> res_id`` entry from ``seam_result`` (data-source ids).

        Args:
            desired_state: Evaluated desired state; provides resources, slugs, and the
                           ``xmlid_prefix`` plus per-resource ``xmlid_module`` overrides.
            live_state:    Frozen managed state, keyed by complete xmlid.
            seam_result:   ``node_key -> res_id`` map from the data-source read seam.

        Returns:
            A seeded, mutable ``GlobalLiveState``.
        """
        slug_to_res_id: dict[str, int] = {}

        # (1) Managed resources → slug -> res_id, keyed by SLUG (D-02), recovering
        # res_id via the complete-xmlid key shape that LiveState.managed uses.
        for resource in desired_state.resources:
            module = resource.xmlid_module or desired_state.xmlid_prefix
            complete_xmlid = f"{module}.{resource.slug}"
            record = live_state.managed.get(complete_xmlid)
            if record is not None:
                slug_to_res_id[resource.slug] = record.res_id

        # (2) Data-source seam → node_key -> res_id.
        slug_to_res_id.update(seam_result)

        return cls(_slug_to_res_id=slug_to_res_id)

    def register(self, slug: str, res_id: int) -> None:
        """Record a newly-created record's ``res_id`` under its ``slug``."""
        self._slug_to_res_id[slug] = res_id

    def __getitem__(self, slug: str) -> int:
        return self._slug_to_res_id[slug]

    def __setitem__(self, slug: str, res_id: int) -> None:
        self._slug_to_res_id[slug] = res_id

    def __contains__(self, slug: str) -> bool:
        return slug in self._slug_to_res_id
