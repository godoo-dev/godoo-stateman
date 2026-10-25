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


class ApplyError(StatemanError):
    """Base class for all apply-stage errors.

    Inherits ``StatemanError`` so it is caught by the existing
    ``except (StatemanError, ...)`` funnels in the CLI commands.
    """

    def __init__(self, message: str) -> None:
        super().__init__(message)


class ArchiveNotSupportedError(ApplyError):
    """Raised when an ARCHIVE step targets a model with no writable ``active`` field.

    The archivability preflight (SchemaRegistry.get(model).archivable) failed,
    so no RPC is issued (SAFE-02 / R6).
    """

    def __init__(self, *, model: str, slug: str) -> None:
        super().__init__(f"Model {model!r} is not archivable (no writable 'active' field); slug={slug!r}")


class DeleteRejectedError(ApplyError):
    """Raised when a resource's ``delete_behavior`` is ``"reject"`` and a deletion would occur.

    Destructive intent must be explicit (SAFE-01) — the default ``"reject"``
    blocks deletion until the operator opts in.
    """

    def __init__(self, *, slug: str) -> None:
        super().__init__(f"delete_behavior='reject' for slug {slug!r}; no deletion performed")


class ApplyStepError(ApplyError):
    """Wraps the underlying cause of a failed apply step (stop-on-first-failure, R9).

    Carries the originating ``slug``, ``action``, and ``cause`` so the executor
    can record per-step status and surface a precise message.
    """

    def __init__(self, *, slug: str, action: str, cause: Exception) -> None:
        self.slug = slug
        self.action = action
        self.cause = cause
        super().__init__(f"apply step failed: {action} {slug}: {cause}")
