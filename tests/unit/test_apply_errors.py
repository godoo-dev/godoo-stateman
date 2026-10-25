"""Unit tests for the ApplyError hierarchy (R14, SAFE-01/SAFE-02).

All four apply-stage errors must inherit StatemanError so the existing CLI
error funnels catch them. ApplyStepError additionally carries .slug/.action/
.cause attributes for precise per-step reporting.
"""

from __future__ import annotations

from godoo_stateman.errors import (
    ApplyError,
    ApplyStepError,
    ArchiveNotSupportedError,
    DeleteRejectedError,
    StatemanError,
)


def test_apply_error_classes_inherit_statemanerror() -> None:
    for cls in (ApplyError, ArchiveNotSupportedError, DeleteRejectedError, ApplyStepError):
        assert issubclass(cls, StatemanError), f"{cls.__name__} must inherit StatemanError"
        assert StatemanError in cls.__mro__


def test_archive_not_supported_error_message() -> None:
    exc = ArchiveNotSupportedError(model="res.partner", slug="acme")
    msg = str(exc)
    assert "res.partner" in msg
    assert "acme" in msg
    assert isinstance(exc, ApplyError)


def test_delete_rejected_error_message() -> None:
    exc = DeleteRejectedError(slug="acme")
    msg = str(exc)
    assert "reject" in msg
    assert "acme" in msg
    assert isinstance(exc, ApplyError)


def test_apply_step_error_carries_attributes() -> None:
    cause = ValueError("boom")
    exc = ApplyStepError(slug="s", action="create", cause=cause)
    assert exc.slug == "s"
    assert exc.action == "create"
    assert exc.cause is cause
    msg = str(exc)
    assert "create" in msg
    assert "s" in msg
    assert "boom" in msg
    assert isinstance(exc, ApplyError)
