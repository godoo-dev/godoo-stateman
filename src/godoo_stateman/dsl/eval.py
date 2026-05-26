"""DSL config file evaluator — eval_config() entry point.

Reads a ``.py`` config file, executes it in a restricted namespace, and returns
a fully constructed :class:`~godoo_stateman.dsl.types.desired.DesiredState`.

Trust boundary (NOT a security sandbox)
----------------------------------------
``_SAFE_BUILTINS`` is the only ``__builtins__`` passed to ``exec()``.  This
restricts *accidental* use of I/O functions (``open``, ``__import__``, etc.)
by **trusted** DSL authors — it is not a security boundary.  Because
``getattr`` is present in the allowlist, a determined author can traverse the
object graph (``object.__subclasses__()`` → ``__init__.__globals__`` → real
``__builtins__``) to reach ``__import__`` and arbitrary I/O.  See CLAUDE.md
for the trusted-author constraint.  Do not accept configs from untrusted
sources without a real sandbox (e.g. subprocess + seccomp).

Purity invariant
----------------
``eval_config()`` is pure sync and makes zero Odoo/network calls.  All proxy
objects in the DSL namespace (``ResourceProxy``, ``DataProxy``, etc.) are
in-process Python objects with no I/O.  The purity invariant is verified by
``test_eval_purity_no_odoo_calls`` in the unit tests (CORE-01).

exec() locals/globals split (Pitfall 2)
----------------------------------------
When both ``exec_globals`` and ``exec_locals`` are passed to ``exec()``,
module-level assignments go to ``exec_locals``, not ``exec_globals``.  The
``module = "..."`` extraction therefore checks ``exec_locals`` first, then
falls back to ``exec_globals``.  Checking only one dict causes spurious
``MissingModuleError`` for valid configs.
"""

from __future__ import annotations

import dataclasses
from pathlib import Path
from typing import Any

from godoo_stateman.dsl.context import _Collector, build_dsl_namespace
from godoo_stateman.dsl.types.desired import DesiredState
from godoo_stateman.dsl.types.nodes import ChildrenWrapper, ResourceNode
from godoo_stateman.errors import DslEvalError, MissingModuleError

# ---------------------------------------------------------------------------
# Restricted builtins — accidental-I/O guard for trusted DSL authors
# (RSRC-07, T-02-03/04)
# ---------------------------------------------------------------------------

#: NOTE: This is NOT a security sandbox against malicious config authors.
#: ``getattr`` in the allowlist enables full object-graph traversal
#: (object.__subclasses__() -> __init__.__globals__ -> real __builtins__)
#: to reach __import__ and therefore os.system. This allowlist only
#: prevents *accidental* use of I/O functions by trusted DSL authors
#: (see CLAUDE.md trusted-author constraint). Do not accept configs from
#: untrusted sources without a real sandbox (e.g. subprocess + seccomp).
#:
#: Allowlist of Python builtins available inside DSL config files.
#: Deliberately absent: ``__import__``, ``open``, ``eval``, ``exec``,
#: ``compile``, ``globals``, ``locals``, ``vars``, ``dir``, ``help``,
#: ``input``, ``print``, ``breakpoint``, ``__build_class__``.
_SAFE_BUILTINS: dict[str, object] = {
    "True": True,
    "False": False,
    "None": None,
    "int": int,
    "str": str,
    "float": float,
    "bool": bool,
    "list": list,
    "dict": dict,
    "tuple": tuple,
    "set": set,
    "len": len,
    "range": range,
    "enumerate": enumerate,
    "sorted": sorted,
    "reversed": reversed,
    "zip": zip,
    "map": map,
    "filter": filter,
    "isinstance": isinstance,
    "hasattr": hasattr,
    "getattr": getattr,
    "min": min,
    "max": max,
    "sum": sum,
    "abs": abs,
    "round": round,
    "repr": repr,
    "format": format,
    "Exception": Exception,
    "ValueError": ValueError,
    "TypeError": TypeError,
    "AttributeError": AttributeError,
}


# ---------------------------------------------------------------------------
# Flatten helper — strips ChildrenWrapper, promotes children to top-level
# ---------------------------------------------------------------------------


def _flatten(resources: list[ResourceNode]) -> list[ResourceNode]:
    """Expand inline children, producing a flat list of all ResourceNodes.

    For each parent resource:
    - Field values that are ``ChildrenWrapper`` instances are expanded.
    - Each child gets a ``parent``-prefixed slug (e.g. ``"parent.line1"``).
    - The inverse_field on each child is set to the parent ``ResourceNode``.
    - The parent's field value is replaced with a list of child slug strings.
    - Non-ChildrenWrapper fields pass through unchanged.
    - Original child node registrations (added to the collector by ResourceProxy
      at call time) are excluded from the output — only the prefixed promoted
      copies are included (preventing duplicates).

    Returns a new flat list with parents first, then their children (depth-first
    order matching input order for parents).

    Implements D-09 and Pitfall 5 (ChildrenWrapper stripped before DesiredState).
    """
    # First pass: collect object ids of all nodes that appear as children inside
    # a ChildrenWrapper.  These were registered into the collector by ResourceProxy
    # at call time and must be excluded from the output to avoid duplicates.
    child_node_ids: set[int] = set()
    for node in resources:
        for fval in node.fields.values():
            if isinstance(fval, ChildrenWrapper):
                for child in fval.children:
                    child_node_ids.add(id(child))

    flat: list[ResourceNode] = []
    for parent in resources:
        # Skip nodes that are already captured as children.
        if id(parent) in child_node_ids:
            continue

        flat_fields: dict[str, Any] = {}
        child_nodes: list[ResourceNode] = []
        for fname, fval in parent.fields.items():
            if isinstance(fval, ChildrenWrapper):
                for child in fval.children:
                    # D-09: auto-prefix slug with parent slug.
                    child_slug = f"{parent.slug}.{child.slug}"
                    # Merge inverse_field into child fields, storing a reference to the ORIGINAL
                    # (pre-rebuild) parent ResourceNode. Note: the rebuilt parent (with flat_fields
                    # replacing ChildrenWrapper values) is a separate object produced below via
                    # dataclasses.replace(). The apply stage (Phase 3) must handle
                    # ResourceNode-valued inverse_fields by resolving them to IDs.
                    child_fields = {**child.fields, fval.inverse_field: parent}
                    child_nodes.append(
                        ResourceNode(
                            model=fval.child_model,
                            slug=child_slug,
                            fields=child_fields,
                            parent_slug=parent.slug,
                        )
                    )
                # Replace ChildrenWrapper with list of child slug strings.
                flat_fields[fname] = [f"{parent.slug}.{c.slug}" for c in fval.children]
            else:
                flat_fields[fname] = fval
        # Rebuild the parent with the ChildrenWrapper-free fields dict.
        flat.append(dataclasses.replace(parent, fields=flat_fields))
        flat.extend(child_nodes)

    # Post-condition: no ChildrenWrapper must survive into the flat list.
    # Nested children() calls (children-of-children) are not yet supported —
    # surface a clear error now rather than allowing silent corruption into
    # DesiredState (see nodes.py invariant: DesiredState must never hold
    # ChildrenWrapper values).
    for node in flat:
        for fname, fval in node.fields.items():
            if isinstance(fval, ChildrenWrapper):
                raise ValueError(
                    f"ChildrenWrapper survived flattening in {node.slug!r}.{fname!r}. "
                    "Nested children() calls (children of children) are not supported."
                )
    return flat


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def eval_config(path: Path) -> DesiredState:
    """Evaluate a ``.py`` DSL config file and return a frozen :class:`DesiredState`.

    Steps
    -----
    1. Read and compile the config source (uses ``compile()`` for proper tracebacks).
    2. Build a fresh ``_Collector`` and DSL namespace.
    3. Execute with restricted builtins.
    4. Extract the required ``module = "..."`` declaration (exec_locals first).
    5. Flatten inline children (strips ChildrenWrapper from parent fields).
    6. Construct and return a frozen ``DesiredState``.

    Raises
    ------
    MissingModuleError
        When the config file does not declare a top-level ``module = "..."`` string.
    Any exception raised by the config file itself
        Propagates unchanged (e.g. ``NameError`` for blocked builtins).
    """
    source = path.read_text(encoding="utf-8")
    code = compile(source, str(path), "exec")

    collector = _Collector()
    dsl_ns = build_dsl_namespace(collector)

    # exec_globals gets the restricted builtins + DSL objects.
    # exec_locals is a separate dict — top-level assignments go here (Pitfall 2).
    exec_globals: dict[str, Any] = {"__builtins__": _SAFE_BUILTINS, **dsl_ns}
    exec_locals: dict[str, object] = {}

    exec(code, exec_globals, exec_locals)

    # Extract module — check exec_locals first, then exec_globals (Pitfall 2).
    # Use explicit None check (not truthiness) so falsy-but-wrong-typed values
    # (e.g. module = 0 or module = False) produce a clear error instead of
    # masking the actual value with the or-fallback.
    module_raw: object = exec_locals.get("module")
    if module_raw is None:
        module_raw = exec_globals.get("module")
    if not isinstance(module_raw, str) or not module_raw:
        raise MissingModuleError(
            f'Config file {path} must declare: module = "<name>"'
            f" (got {type(module_raw).__name__}: {module_raw!r})"
        )
    module: str = module_raw

    flat_resources = _flatten(collector.resources)

    seen_slugs: set[str] = set()
    for node in flat_resources:
        if node.slug in seen_slugs:
            raise DslEvalError(
                f"Duplicate resource slug {node.slug!r} in {path}. "
                "Each resource must have a unique slug within the config."
            )
        seen_slugs.add(node.slug)

    return DesiredState(
        module=module,
        resources=tuple(flat_resources),
        data_sources=tuple(collector.data_sources),
        config_parameters=tuple(collector.config_parameters),
    )
