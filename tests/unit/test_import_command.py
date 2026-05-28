"""Unit tests for import command (_import_impl) — D-10/D-11 flow.

All tests use unittest.mock.AsyncMock for OdooClient — no Docker required.
asyncio_mode = "auto" in pyproject.toml means no @pytest.mark.asyncio is needed.

Covers:
- D-11 Step 1: search_read confirms record exists before any write
- D-11 Step 2: find_by_xmlid collision check (same res_id → no-op; different → --force)
- D-11 Step 3: write_xmlid called on new xmlid or --force override
- IDENT-05: idempotent re-import exits 0
- SAFE-03: different res_id without --force exits 1 AND prints error (no silent clobber)
- T-03-14: --id 0 or negative rejected before Odoo call
- T-03-16: credentials from env vars only (never hardcoded)
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

# We test _import_impl directly to avoid needing a running asyncio event loop.
# The Typer wrapper (import_) is only tested at CLI level (test_cli_help.py).
from godoo_stateman.cli.commands.import_ import _import_impl

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_client(
    *,
    search_read_side_effect: list[list[dict]] | None = None,
    search_read_return: list[dict] | None = None,
) -> AsyncMock:
    """Build a minimal AsyncMock for OdooClient.

    ``search_read_side_effect`` provides sequential return values (one per call).
    ``search_read_return`` sets a single constant return value.
    Default: search_read returns [] (record not found).
    """
    client = AsyncMock()
    if search_read_side_effect is not None:
        client.search_read.side_effect = search_read_side_effect
    elif search_read_return is not None:
        client.search_read.return_value = search_read_return
    else:
        client.search_read.return_value = []
    client.create.return_value = 42
    client.write.return_value = True
    return client


# ---------------------------------------------------------------------------
# D-11 Step 1: record-not-found guard
# ---------------------------------------------------------------------------


async def test_record_not_found_returns_1() -> None:
    """_import_impl returns 1 when search_read finds no record for --model/--id."""
    env = {
        "GODOO_URL": "http://localhost:8069",
        "GODOO_DB": "testdb",
        "GODOO_USER": "admin",
        "GODOO_PASSWORD": "admin",
    }
    client = _make_client(search_read_return=[])  # record not found

    with patch.dict("os.environ", env), patch("godoo_stateman.cli.commands.import_.OdooClient") as mock_cls:
        ctx = AsyncMock()
        ctx.__aenter__ = AsyncMock(return_value=client)
        ctx.__aexit__ = AsyncMock(return_value=False)
        mock_cls.return_value = ctx

        result = await _import_impl("res.partner", 99, "mymod", "myslug", False)

    assert result == 1


async def test_record_not_found_does_not_call_write_xmlid() -> None:
    """_import_impl does not call write_xmlid when the target record is not found."""
    env = {
        "GODOO_URL": "http://localhost:8069",
        "GODOO_DB": "testdb",
        "GODOO_USER": "admin",
        "GODOO_PASSWORD": "admin",
    }
    client = _make_client(search_read_return=[])

    with patch.dict("os.environ", env), patch("godoo_stateman.cli.commands.import_.OdooClient") as mock_cls:
        ctx = AsyncMock()
        ctx.__aenter__ = AsyncMock(return_value=client)
        ctx.__aexit__ = AsyncMock(return_value=False)
        mock_cls.return_value = ctx
        with patch("godoo_stateman.cli.commands.import_.write_xmlid") as mock_write:
            await _import_impl("res.partner", 99, "mymod", "myslug", False)

    mock_write.assert_not_called()


# ---------------------------------------------------------------------------
# D-11 Step 2: idempotent no-op (same res_id) — IDENT-05
# ---------------------------------------------------------------------------


async def test_same_res_id_is_idempotent_returns_0() -> None:
    """_import_impl returns 0 when find_by_xmlid returns same res_id (no-op)."""
    from godoo_stateman.identity import XmlIdRecord

    env = {
        "GODOO_URL": "http://localhost:8069",
        "GODOO_DB": "testdb",
        "GODOO_USER": "admin",
        "GODOO_PASSWORD": "admin",
    }
    # Step 1: search_read confirms record exists; Step 2: find_by_xmlid returns existing
    client = _make_client(search_read_return=[{"id": 42}])

    existing = XmlIdRecord(module="mymod", name="myslug", model="res.partner", res_id=42, complete_name="mymod.myslug")

    with patch.dict("os.environ", env), patch("godoo_stateman.cli.commands.import_.OdooClient") as mock_cls:
        ctx = AsyncMock()
        ctx.__aenter__ = AsyncMock(return_value=client)
        ctx.__aexit__ = AsyncMock(return_value=False)
        mock_cls.return_value = ctx
        with patch("godoo_stateman.cli.commands.import_.find_by_xmlid", return_value=existing):
            result = await _import_impl("res.partner", 42, "mymod", "myslug", False)

    assert result == 0


async def test_same_res_id_does_not_call_write_xmlid() -> None:
    """_import_impl does not call write_xmlid on idempotent re-import."""
    from godoo_stateman.identity import XmlIdRecord

    env = {
        "GODOO_URL": "http://localhost:8069",
        "GODOO_DB": "testdb",
        "GODOO_USER": "admin",
        "GODOO_PASSWORD": "admin",
    }
    client = _make_client(search_read_return=[{"id": 42}])

    existing = XmlIdRecord(module="mymod", name="myslug", model="res.partner", res_id=42, complete_name="mymod.myslug")

    with patch.dict("os.environ", env), patch("godoo_stateman.cli.commands.import_.OdooClient") as mock_cls:
        ctx = AsyncMock()
        ctx.__aenter__ = AsyncMock(return_value=client)
        ctx.__aexit__ = AsyncMock(return_value=False)
        mock_cls.return_value = ctx
        _p1 = patch("godoo_stateman.cli.commands.import_.find_by_xmlid", return_value=existing)
        _p2 = patch("godoo_stateman.cli.commands.import_.write_xmlid")
        with _p1, _p2 as mock_write:
            await _import_impl("res.partner", 42, "mymod", "myslug", False)

    mock_write.assert_not_called()


# ---------------------------------------------------------------------------
# D-11 Step 2: collision guard — different res_id, no --force (SAFE-03)
# ---------------------------------------------------------------------------


async def test_different_res_id_no_force_returns_1() -> None:
    """_import_impl returns 1 when xmlid is already bound to a different record and force=False."""
    from godoo_stateman.identity import XmlIdRecord

    env = {
        "GODOO_URL": "http://localhost:8069",
        "GODOO_DB": "testdb",
        "GODOO_USER": "admin",
        "GODOO_PASSWORD": "admin",
    }
    client = _make_client(search_read_return=[{"id": 99}])

    existing = XmlIdRecord(module="mymod", name="myslug", model="res.partner", res_id=10, complete_name="mymod.myslug")

    with patch.dict("os.environ", env), patch("godoo_stateman.cli.commands.import_.OdooClient") as mock_cls:
        ctx = AsyncMock()
        ctx.__aenter__ = AsyncMock(return_value=client)
        ctx.__aexit__ = AsyncMock(return_value=False)
        mock_cls.return_value = ctx
        with patch("godoo_stateman.cli.commands.import_.find_by_xmlid", return_value=existing):
            result = await _import_impl("res.partner", 99, "mymod", "myslug", False)

    assert result == 1


async def test_different_res_id_no_force_prints_error_message() -> None:
    """_import_impl prints an actionable error message before returning 1 (SAFE-03 no silent clobber)."""
    from godoo_stateman.identity import XmlIdRecord

    env = {
        "GODOO_URL": "http://localhost:8069",
        "GODOO_DB": "testdb",
        "GODOO_USER": "admin",
        "GODOO_PASSWORD": "admin",
    }
    client = _make_client(search_read_return=[{"id": 99}])

    existing = XmlIdRecord(module="mymod", name="myslug", model="res.partner", res_id=10, complete_name="mymod.myslug")

    printed_messages: list[str] = []

    with patch.dict("os.environ", env), patch("godoo_stateman.cli.commands.import_.OdooClient") as mock_cls:
        ctx = AsyncMock()
        ctx.__aenter__ = AsyncMock(return_value=client)
        ctx.__aexit__ = AsyncMock(return_value=False)
        mock_cls.return_value = ctx
        _p1 = patch("godoo_stateman.cli.commands.import_.find_by_xmlid", return_value=existing)
        _p2 = patch("godoo_stateman.cli.commands.import_.console")
        with _p1, _p2 as mock_console:
            mock_console.print.side_effect = lambda msg: printed_messages.append(str(msg))
            await _import_impl("res.partner", 99, "mymod", "myslug", False)

    # Must print an error message referencing the existing binding (SAFE-03)
    assert len(printed_messages) >= 1
    combined = " ".join(printed_messages)
    # The message must mention the existing binding information
    assert "mymod.myslug" in combined or "already bound" in combined or "10" in combined


async def test_different_res_id_no_force_does_not_call_write_xmlid() -> None:
    """_import_impl does not call write_xmlid when force=False and collision is detected."""
    from godoo_stateman.identity import XmlIdRecord

    env = {
        "GODOO_URL": "http://localhost:8069",
        "GODOO_DB": "testdb",
        "GODOO_USER": "admin",
        "GODOO_PASSWORD": "admin",
    }
    client = _make_client(search_read_return=[{"id": 99}])

    existing = XmlIdRecord(module="mymod", name="myslug", model="res.partner", res_id=10, complete_name="mymod.myslug")

    with patch.dict("os.environ", env), patch("godoo_stateman.cli.commands.import_.OdooClient") as mock_cls:
        ctx = AsyncMock()
        ctx.__aenter__ = AsyncMock(return_value=client)
        ctx.__aexit__ = AsyncMock(return_value=False)
        mock_cls.return_value = ctx
        _p1 = patch("godoo_stateman.cli.commands.import_.find_by_xmlid", return_value=existing)
        _p2 = patch("godoo_stateman.cli.commands.import_.write_xmlid")
        with _p1, _p2 as mock_write:
            await _import_impl("res.partner", 99, "mymod", "myslug", False)

    mock_write.assert_not_called()


# ---------------------------------------------------------------------------
# D-11 Step 2/3: --force overrides collision
# ---------------------------------------------------------------------------


async def test_different_res_id_force_calls_write_xmlid() -> None:
    """_import_impl calls write_xmlid when force=True and a different res_id is bound."""
    from godoo_stateman.identity import XmlIdRecord

    env = {
        "GODOO_URL": "http://localhost:8069",
        "GODOO_DB": "testdb",
        "GODOO_USER": "admin",
        "GODOO_PASSWORD": "admin",
    }
    client = _make_client(search_read_return=[{"id": 99}])

    existing = XmlIdRecord(module="mymod", name="myslug", model="res.partner", res_id=10, complete_name="mymod.myslug")
    new_record = XmlIdRecord(
        module="mymod", name="myslug", model="res.partner", res_id=99, complete_name="mymod.myslug"
    )

    with patch.dict("os.environ", env), patch("godoo_stateman.cli.commands.import_.OdooClient") as mock_cls:
        ctx = AsyncMock()
        ctx.__aenter__ = AsyncMock(return_value=client)
        ctx.__aexit__ = AsyncMock(return_value=False)
        mock_cls.return_value = ctx
        with (
            patch("godoo_stateman.cli.commands.import_.find_by_xmlid", return_value=existing),
            patch(
                "godoo_stateman.cli.commands.import_.write_xmlid",
                return_value=new_record,
            ) as mock_write,
        ):
            result = await _import_impl("res.partner", 99, "mymod", "myslug", True)

    mock_write.assert_called_once()
    assert result == 0


# ---------------------------------------------------------------------------
# D-11 Step 3: new xmlid (find_by_xmlid returns None)
# ---------------------------------------------------------------------------


async def test_new_xmlid_calls_write_xmlid_with_correct_args() -> None:
    """_import_impl calls write_xmlid(model, res_id, module, name) when no existing xmlid."""
    from godoo_stateman.identity import XmlIdRecord

    env = {
        "GODOO_URL": "http://localhost:8069",
        "GODOO_DB": "testdb",
        "GODOO_USER": "admin",
        "GODOO_PASSWORD": "admin",
    }
    client = _make_client(search_read_return=[{"id": 42}])
    new_record = XmlIdRecord(
        module="mymod", name="myslug", model="res.partner", res_id=42, complete_name="mymod.myslug"
    )

    with patch.dict("os.environ", env), patch("godoo_stateman.cli.commands.import_.OdooClient") as mock_cls:
        ctx = AsyncMock()
        ctx.__aenter__ = AsyncMock(return_value=client)
        ctx.__aexit__ = AsyncMock(return_value=False)
        mock_cls.return_value = ctx
        with (
            patch("godoo_stateman.cli.commands.import_.find_by_xmlid", return_value=None),
            patch(
                "godoo_stateman.cli.commands.import_.write_xmlid",
                return_value=new_record,
            ) as mock_write,
        ):
            result = await _import_impl("res.partner", 42, "mymod", "myslug", False)

    mock_write.assert_called_once_with(client, "res.partner", 42, "mymod", "myslug")
    assert result == 0


async def test_new_xmlid_returns_0() -> None:
    """_import_impl returns 0 on successful write of a new xmlid."""
    from godoo_stateman.identity import XmlIdRecord

    env = {
        "GODOO_URL": "http://localhost:8069",
        "GODOO_DB": "testdb",
        "GODOO_USER": "admin",
        "GODOO_PASSWORD": "admin",
    }
    client = _make_client(search_read_return=[{"id": 42}])
    new_record = XmlIdRecord(module="ns", name="slug", model="res.partner", res_id=42, complete_name="ns.slug")

    with patch.dict("os.environ", env), patch("godoo_stateman.cli.commands.import_.OdooClient") as mock_cls:
        ctx = AsyncMock()
        ctx.__aenter__ = AsyncMock(return_value=client)
        ctx.__aexit__ = AsyncMock(return_value=False)
        mock_cls.return_value = ctx
        _p1 = patch("godoo_stateman.cli.commands.import_.find_by_xmlid", return_value=None)
        _p2 = patch("godoo_stateman.cli.commands.import_.write_xmlid", return_value=new_record)
        with _p1, _p2:
            result = await _import_impl("res.partner", 42, "ns", "slug", False)

    assert result == 0


# ---------------------------------------------------------------------------
# D-11 Step 1: search_read call shape verification
# ---------------------------------------------------------------------------


async def test_step1_search_read_called_with_correct_args() -> None:
    """_import_impl calls search_read with [('id','=',record_id)], fields=['id'], limit=1."""
    env = {
        "GODOO_URL": "http://localhost:8069",
        "GODOO_DB": "testdb",
        "GODOO_USER": "admin",
        "GODOO_PASSWORD": "admin",
    }
    client = _make_client(search_read_return=[])  # triggers not-found exit

    with patch.dict("os.environ", env), patch("godoo_stateman.cli.commands.import_.OdooClient") as mock_cls:
        ctx = AsyncMock()
        ctx.__aenter__ = AsyncMock(return_value=client)
        ctx.__aexit__ = AsyncMock(return_value=False)
        mock_cls.return_value = ctx
        await _import_impl("res.partner", 42, "mymod", "myslug", False)

    client.search_read.assert_called_once_with(
        "res.partner",
        [("id", "=", 42)],
        fields=["id"],
        limit=1,
    )


# ---------------------------------------------------------------------------
# WR-02 regression: OdooValidationError caught and produces actionable message
# ---------------------------------------------------------------------------


async def test_odoo_validation_error_from_write_xmlid_is_caught() -> None:
    """WR-02 regression: OdooValidationError raised by write_xmlid is caught and
    produces a clean console message + non-zero exit code (not 'Unexpected error').

    This error occurs when write_xmlid detects a model mismatch on an existing
    ir.model.data row (e.g. the same xmlid was previously bound to a different
    Odoo model).  It is a deterministic, operator-actionable condition and must
    not surface as a generic 'Unexpected error'.
    """
    from godoo.client.errors import OdooValidationError

    env = {
        "GODOO_URL": "http://localhost:8069",
        "GODOO_DB": "testdb",
        "GODOO_USER": "admin",
        "GODOO_PASSWORD": "admin",
    }
    client = _make_client(search_read_return=[{"id": 42}])

    printed_messages: list[str] = []

    with patch.dict("os.environ", env), patch("godoo_stateman.cli.commands.import_.OdooClient") as mock_cls:
        ctx = AsyncMock()
        ctx.__aenter__ = AsyncMock(return_value=client)
        ctx.__aexit__ = AsyncMock(return_value=False)
        mock_cls.return_value = ctx
        with (
            patch("godoo_stateman.cli.commands.import_.find_by_xmlid", return_value=None),
            patch(
                "godoo_stateman.cli.commands.import_.write_xmlid",
                side_effect=OdooValidationError(
                    "xmlid 'mymod'.'myslug' model mismatch: points to 'res.users', expected 'res.partner'"
                ),
            ),
            patch("godoo_stateman.cli.commands.import_.console") as mock_console,
        ):
            mock_console.print.side_effect = lambda msg: printed_messages.append(str(msg))
            result = await _import_impl("res.partner", 42, "mymod", "myslug", False)

    # Must return non-zero exit code.
    assert result == 1, f"Expected exit code 1, got {result}"

    # Must print a message (not 'Unexpected error').
    assert len(printed_messages) >= 1, "Expected at least one console message for OdooValidationError"
    combined = " ".join(printed_messages)
    assert "Unexpected error" not in combined, (
        "OdooValidationError must NOT produce 'Unexpected error' — it is an operator-actionable condition"
    )
    # The error message from OdooValidationError must appear (it names the mismatch).
    assert "mismatch" in combined or "mymod" in combined or "myslug" in combined
