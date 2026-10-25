"""Apply stage — pure transforms and mutable cross-step state for the executor.

This subpackage holds the interface-first foundations the apply executor
(Plan 02) consumes:

- ``serialize.py`` — the m2m ``(6, 0, [ids])`` SET serialization seam (REL-06).
- ``state.py`` — the mutable ``GlobalLiveState`` slug→int map (REL-05, D-02).
"""

from __future__ import annotations
