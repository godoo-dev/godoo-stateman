"""godoo-stateman local error hierarchy."""

from __future__ import annotations


# Stateman-specific errors — do NOT subclass OdooError (these are local, not RPC errors)
class StatemanError(Exception):
    """Base class for all godoo-stateman local errors."""

    def __init__(self, message: str) -> None:
        super().__init__(message)


class VersionMismatchError(StatemanError):
    """Raised when a snapshot's odoo_version or schema_format_version does not match."""

    def __init__(self, message: str) -> None:
        super().__init__(message)


class DslEvalError(StatemanError):
    """Raised when a DSL config file fails to evaluate."""

    def __init__(self, message: str) -> None:
        super().__init__(message)


class MissingModuleError(DslEvalError):
    """Raised when a DSL config file does not declare a top-level `module = "..."` variable."""

    def __init__(self, message: str) -> None:
        super().__init__(message)


class CycleError(StatemanError):
    """Raised when the dependency graph contains a cycle."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
