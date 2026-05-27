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


class XmlidCollisionError(StatemanError):
    """Raised when find_by_xmlid resolves to a record of a different model (D-02).

    The xmlid namespace is already owned by a different Odoo model than the
    config declares. This is a Reject action — operator must resolve manually.
    """

    def __init__(self, message: str) -> None:
        super().__init__(message)


class LiveStateFetchError(StatemanError):
    """Raised when a live Odoo fetch fails or returns unexpected results.

    Examples: DataSourceNode selector resolves 0 or >1 records (Pitfall 5).
    """

    def __init__(self, message: str) -> None:
        super().__init__(message)
