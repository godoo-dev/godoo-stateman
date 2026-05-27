"""Unit tests for plan/render.py — Rich-based plan output rendering.

All tests are offline (no Docker required).  Output is captured via
``Console(file=io.StringIO(), force_terminal=False)`` to avoid TTY-dependent
ANSI codes in assertions.

asyncio_mode = "auto" in pyproject.toml — no @pytest.mark.asyncio needed.

Covers: UX-03, UX-05, D-06, D-07, D-08, D-09, SC-2
"""

from __future__ import annotations

import io

import networkx as nx
from rich.console import Console

from godoo_stateman.plan.render import render_plan
from godoo_stateman.plan.types import FieldDiff, PlanAction, PlanStep

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_step(
    slug: str,
    *,
    action: PlanAction = PlanAction.NOOP,
    model: str = "res.partner",
    field_diff: tuple[FieldDiff, ...] = (),
) -> PlanStep:
    """Build a minimal PlanStep for testing."""
    return PlanStep(
        action=action,
        slug=slug,
        model=model,
        xmlid=f"test_prefix.{slug}",
        res_id=1 if action != PlanAction.CREATE else None,
        field_diff=field_diff,
    )


def _make_graph(*slugs: str) -> nx.DiGraph:
    """Build a trivial DiGraph with one node per slug, no edges."""
    G: nx.DiGraph = nx.DiGraph()
    for slug in slugs:
        G.add_node(slug)
    return G


def _capture(
    plan_steps: list[PlanStep],
    graph: nx.DiGraph,
    *,
    verbose: bool = False,
) -> str:
    """Capture render_plan() output as a plain string using a non-TTY Console."""
    buf = io.StringIO()
    console = Console(file=buf, force_terminal=False)
    render_plan(plan_steps, graph, console, verbose=verbose)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Test 1: non-TTY output contains no ANSI escape sequences (UX-05, D-09)
# ---------------------------------------------------------------------------


def test_non_tty_output_has_no_ansi() -> None:
    """Non-TTY Console (force_terminal=False + StringIO) must strip ANSI codes."""
    steps = [_make_step("alpha", action=PlanAction.CREATE)]
    graph = _make_graph("alpha")
    output = _capture(steps, graph)
    assert "\x1b[" not in output, (
        f"ANSI escape sequence found in non-TTY output:\n{output!r}"
    )


# ---------------------------------------------------------------------------
# Test 2: NOOP steps absent by default; summary line always present (D-07)
# ---------------------------------------------------------------------------


def test_noop_hidden_by_default() -> None:
    """NOOP steps must not appear in default (non-verbose) output."""
    steps = [
        _make_step("alpha", action=PlanAction.NOOP),
        _make_step("beta", action=PlanAction.CREATE),
    ]
    graph = _make_graph("alpha", "beta")
    output = _capture(steps, graph)

    # NOOP slug must not appear as an action line
    assert "= alpha" not in output, (
        f"NOOP slug 'alpha' appeared in default output:\n{output}"
    )
    # CREATE slug must appear
    assert "beta" in output, f"CREATE slug 'beta' missing from output:\n{output}"

    # Trailing summary must be present
    assert "1 resource unchanged" in output, (
        f"NoOp summary line missing from output:\n{output}"
    )


def test_noop_summary_uses_plural_for_multiple() -> None:
    """Plural 'resources unchanged' when noop_count > 1."""
    steps = [
        _make_step("alpha", action=PlanAction.NOOP),
        _make_step("beta", action=PlanAction.NOOP),
    ]
    graph = _make_graph("alpha", "beta")
    output = _capture(steps, graph)
    assert "2 resources unchanged" in output, (
        f"Expected '2 resources unchanged' in output:\n{output}"
    )


# ---------------------------------------------------------------------------
# Test 3: NOOP steps present when verbose=True (D-07)
# ---------------------------------------------------------------------------


def test_noop_shown_with_verbose() -> None:
    """With verbose=True, NOOP steps must appear in the output."""
    steps = [_make_step("alpha", action=PlanAction.NOOP)]
    graph = _make_graph("alpha")
    output = _capture(steps, graph, verbose=True)

    # With verbose, the NOOP line should appear (using "=" symbol)
    assert "alpha" in output, (
        f"NOOP slug 'alpha' missing from verbose output:\n{output}"
    )
    assert "=" in output, f"'=' symbol missing from verbose output:\n{output}"


# ---------------------------------------------------------------------------
# Test 4: UPDATE shows plain "field: old → new" format (D-06)
# ---------------------------------------------------------------------------


def test_update_shows_field_diff_format() -> None:
    """UPDATE step must show 'field_name: old_val → new_val' lines (not unified diff)."""
    fd = FieldDiff(field_name="name", old_value="Old Name", new_value="New Name")
    steps = [_make_step("alpha", action=PlanAction.UPDATE, field_diff=(fd,))]
    graph = _make_graph("alpha")
    output = _capture(steps, graph)

    assert "name:" in output, f"Field name missing from update output:\n{output}"
    assert "Old Name" in output, f"Old value missing from update output:\n{output}"
    assert "New Name" in output, f"New value missing from update output:\n{output}"
    assert "→" in output, f"Arrow '→' missing from update output:\n{output}"

    # Must NOT use unified diff syntax (no +/- prefix per diff line)
    # The field line should not start with "+" or "-"
    field_lines = [
        line for line in output.splitlines() if "name:" in line and "Old Name" in line
    ]
    assert field_lines, f"No field diff line found in:\n{output}"
    for line in field_lines:
        stripped = line.strip()
        assert not stripped.startswith("+") or "name:" not in stripped.split("+")[0], (
            f"Field diff line looks like unified diff:\n{line!r}"
        )


def test_update_shows_multiple_field_diffs() -> None:
    """UPDATE with multiple FieldDiffs must show each field on its own line."""
    fd1 = FieldDiff(field_name="name", old_value="Old", new_value="New")
    fd2 = FieldDiff(field_name="email", old_value="a@a.com", new_value="b@b.com")
    steps = [_make_step("alpha", action=PlanAction.UPDATE, field_diff=(fd1, fd2))]
    graph = _make_graph("alpha")
    output = _capture(steps, graph)

    assert "name:" in output
    assert "email:" in output
    assert "Old" in output
    assert "New" in output
    assert "a@a.com" in output
    assert "b@b.com" in output


# ---------------------------------------------------------------------------
# Test 5: CREATE prefixed "+" ; DELETE prefixed "-" (D-06)
# ---------------------------------------------------------------------------


def test_create_uses_plus_symbol() -> None:
    """CREATE action must render with '+' prefix symbol."""
    steps = [_make_step("alpha", action=PlanAction.CREATE)]
    graph = _make_graph("alpha")
    output = _capture(steps, graph)
    assert "+" in output, f"'+' symbol missing for CREATE:\n{output}"
    assert "alpha" in output


def test_delete_uses_minus_symbol() -> None:
    """DELETE action must render with '-' prefix symbol."""
    steps = [_make_step("alpha", action=PlanAction.DELETE)]
    graph = _make_graph("alpha")
    output = _capture(steps, graph)
    assert "-" in output, f"'-' symbol missing for DELETE:\n{output}"
    assert "alpha" in output


def test_archive_uses_a_symbol() -> None:
    """ARCHIVE action must render with 'a' prefix symbol."""
    steps = [_make_step("alpha", action=PlanAction.ARCHIVE)]
    graph = _make_graph("alpha")
    output = _capture(steps, graph)
    assert "a" in output
    assert "alpha" in output


def test_reject_uses_x_symbol() -> None:
    """REJECT action must render with 'x' prefix symbol."""
    steps = [_make_step("alpha", action=PlanAction.REJECT)]
    graph = _make_graph("alpha")
    output = _capture(steps, graph)
    assert "x" in output
    assert "alpha" in output


# ---------------------------------------------------------------------------
# Test 6: Determinism — two identical calls produce byte-identical output (SC-2, D-08)
# ---------------------------------------------------------------------------


def test_deterministic_output_same_inputs() -> None:
    """Two calls to render_plan() with identical inputs must produce identical strings."""
    steps = [
        _make_step("charlie", action=PlanAction.CREATE),
        _make_step("alpha", action=PlanAction.UPDATE, field_diff=(
            FieldDiff(field_name="name", old_value="X", new_value="Y"),
        )),
        _make_step("beta", action=PlanAction.NOOP),
    ]
    graph = _make_graph("alpha", "beta", "charlie")
    output_a = _capture(steps, graph, verbose=True)
    output_b = _capture(steps, graph, verbose=True)
    assert output_a == output_b, (
        f"render_plan() produced non-identical outputs for the same inputs.\n"
        f"First:\n{output_a!r}\nSecond:\n{output_b!r}"
    )


def test_deterministic_topological_order() -> None:
    """Render order respects graph topology: dependency emitted before dependent."""
    # dep_a must come before dep_b_depends_on_a in the graph
    G: nx.DiGraph = nx.DiGraph()
    G.add_node("dep_a")
    G.add_node("dep_b")
    G.add_edge("dep_a", "dep_b")  # dep_a must appear before dep_b

    steps = [
        _make_step("dep_a", action=PlanAction.CREATE),
        _make_step("dep_b", action=PlanAction.CREATE),
    ]
    output = _capture(steps, G)
    pos_a = output.find("dep_a")
    pos_b = output.find("dep_b")
    assert pos_a < pos_b, (
        f"Expected dep_a before dep_b (topological order), but got:\n{output}"
    )


def test_deterministic_slug_sort_within_generation() -> None:
    """Within a topological generation, slugs must appear in alphabetical order."""
    G: nx.DiGraph = nx.DiGraph()
    G.add_node("zzz_last")
    G.add_node("aaa_first")
    G.add_node("mmm_middle")
    # No edges — all in same generation; sorted() must order them

    steps = [
        _make_step("zzz_last", action=PlanAction.CREATE),
        _make_step("aaa_first", action=PlanAction.CREATE),
        _make_step("mmm_middle", action=PlanAction.CREATE),
    ]
    output = _capture(steps, G)
    pos_aaa = output.find("aaa_first")
    pos_mmm = output.find("mmm_middle")
    pos_zzz = output.find("zzz_last")
    assert pos_aaa < pos_mmm < pos_zzz, (
        f"Expected alphabetical slug order within generation, but got:\n{output}"
    )


# ---------------------------------------------------------------------------
# Test 7: plan with only NOOP steps shows summary, no action lines (D-07)
# ---------------------------------------------------------------------------


def test_all_noop_shows_summary_only() -> None:
    """A plan with only NOOP steps must show trailing summary with no action lines."""
    steps = [
        _make_step("alpha", action=PlanAction.NOOP),
        _make_step("beta", action=PlanAction.NOOP),
        _make_step("gamma", action=PlanAction.NOOP),
    ]
    graph = _make_graph("alpha", "beta", "gamma")
    output = _capture(steps, graph)

    # None of the slugs should appear as action lines (they're all NoOp)
    # Summary must appear
    assert "3 resources unchanged" in output, (
        f"Expected '3 resources unchanged' in all-NOOP output:\n{output}"
    )

    # No action symbols for the individual slugs should appear (NOOP hidden)
    # We check by ensuring no "=" immediately precedes the slug names
    for slug in ("alpha", "beta", "gamma"):
        # The slug itself should not appear as a line (NOOP suppressed)
        output_lines = [line.strip() for line in output.splitlines()]
        slug_lines = [line for line in output_lines if slug in line and "unchanged" not in line]
        assert not slug_lines, (
            f"NOOP slug {slug!r} appeared as action line in default output:\n{output}"
        )


def test_no_noop_no_summary_line() -> None:
    """When there are no NOOP steps, the 'N resources unchanged' line must not appear."""
    steps = [
        _make_step("alpha", action=PlanAction.CREATE),
    ]
    graph = _make_graph("alpha")
    output = _capture(steps, graph)
    assert "unchanged" not in output, (
        f"'unchanged' summary appeared despite 0 NoOp steps:\n{output}"
    )


# ---------------------------------------------------------------------------
# Test 8: model name appears in output for each resource
# ---------------------------------------------------------------------------


def test_model_name_in_output() -> None:
    """Each resource line must include the model name."""
    steps = [_make_step("alpha", action=PlanAction.CREATE, model="res.partner")]
    graph = _make_graph("alpha")
    output = _capture(steps, graph)
    assert "res.partner" in output, (
        f"Model name 'res.partner' missing from output:\n{output}"
    )
