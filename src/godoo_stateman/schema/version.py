"""OdooVersion dataclass and SCHEMA_FORMAT_VERSION constant."""

from __future__ import annotations

from dataclasses import dataclass

SCHEMA_FORMAT_VERSION: int = 1
"""Increment this constant on any breaking change to the snapshot JSON format."""


@dataclass(frozen=True)
class OdooVersion:
    """Immutable Odoo version descriptor.

    Example:
        OdooVersion(major=17, minor=0)  ->  str "17.0"
    """

    major: int
    minor: int

    def __str__(self) -> str:
        return f"{self.major}.{self.minor}"
