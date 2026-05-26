"""DSL proxy objects and exec() namespace factory for godoo-stateman.

Provides the proxy objects injected into the exec() namespace during DSL config
evaluation: ``ResourceProxy``, ``DataProxy``, ``OdooModuleProxy``,
``ConfigParameterProxy``, and the ``children()`` helper.

The public entry point is ``build_dsl_namespace(collector)`` which returns a
``dict`` ready to be used as ``exec_globals`` content (merged with the
restricted ``__builtins__`` dict in ``eval.py``).

Design notes
------------
- All classes are sync — no async, no Odoo I/O.
- ``_Collector`` accumulates resources/data_sources/config_parameters during a
  single ``eval_config()`` call; it is never reused across calls.
- ``ResourceProxy.__getattr__`` converts attribute names to dotted Odoo model
  names by replacing ALL underscores with dots (e.g. ``resource.res_partner``
  → ``"res.partner"``, ``resource.sale_order_line`` → ``"sale.order.line"``).
  Full replacement is correct because Odoo model ``_name`` values are dot-separated
  and no segment contains an underscore. This is intentional DSL sugar (D-03).
- ``_ResourceBuilder`` is the mutable builder exposed inside ``with`` blocks.
  The final ``ResourceNode`` (frozen dataclass) is produced on context-manager
  exit (or immediately on the first call when no ``with`` block is used).
"""

from __future__ import annotations

from typing import Any

from godoo_stateman.dsl.types.deferred import resolve as _resolve
from godoo_stateman.dsl.types.nodes import ChildrenWrapper, DataSourceNode, ResourceNode

# ---------------------------------------------------------------------------
# Internal accumulator
# ---------------------------------------------------------------------------


class _Collector:
    """Mutable accumulator used for a single eval_config() pass.

    Lists are mutated in-place by proxy objects during DSL evaluation.
    After exec() returns, eval.py reads these lists to build DesiredState.
    """

    def __init__(self) -> None:
        self.resources: list[ResourceNode] = []
        self.data_sources: list[DataSourceNode] = []
        self.config_parameters: list[dict[str, str]] = []


# ---------------------------------------------------------------------------
# Resource proxy machinery
# ---------------------------------------------------------------------------


class _ResourceBuilder:
    """Mutable field-accumulator exposed as ``r`` inside ``with resource.x("slug") as r:``.

    Attribute assignment (``r.name = "Acme"``) writes to the shared
    ``_fields`` dict.  The collector's ``ResourceNode`` is updated in-place
    because ``ResourceNode.fields`` is a dict reference (not frozen contents).

    The builder also registers the initial ``ResourceNode`` into the collector
    on construction (before ``__enter__``), so that a bare call
    ``resource.res_partner("slug", name="Acme")`` without a ``with`` block
    still appends the node.
    """

    # Declared here so mypy knows about them; set via object.__setattr__ in __init__.
    _node: ResourceNode
    _fields: dict[str, Any]

    def __init__(self, node: ResourceNode, collector: _Collector) -> None:
        # Bypass our own __setattr__ for private attributes.
        object.__setattr__(self, "_node", node)
        object.__setattr__(self, "_fields", node.fields)
        collector.resources.append(node)

    def __setattr__(self, name: str, value: Any) -> None:
        if name.startswith("_"):
            raise AttributeError(
                f"Cannot assign {name!r} on ResourceBuilder — "
                "Odoo field names do not start with '_'. "
                "Did you mean to write without the leading underscore?"
            )
        self._fields[name] = value

    def __enter__(self) -> _ResourceBuilder:
        return self

    def __exit__(self, *args: Any) -> None:
        pass


class _ModelResourceCallable:
    """Returned by ``ResourceProxy.__getattr__``.

    Calling it creates a ``ResourceNode``, registers it in the collector via
    ``_ResourceBuilder``, and returns the builder (which also acts as a context
    manager for ``with`` blocks).
    """

    def __init__(self, model: str, collector: _Collector) -> None:
        self._model = model
        self._collector = collector

    def __call__(self, slug: str, **fields: Any) -> _ResourceBuilder:
        node = ResourceNode(model=self._model, slug=slug, fields=dict(fields))
        return _ResourceBuilder(node, self._collector)


class ResourceProxy:
    """DSL ``resource`` object — attribute access returns a per-model callable.

    DSL sugar: ``resource.sale_order_line`` translates to model ``"sale.order.line"``.
    All underscores in the attribute name are substituted with dots, so 3+ segment
    Odoo models (e.g. ``sale.order.line``, ``account.move.line``) are handled correctly.
    """

    def __init__(self, collector: _Collector) -> None:
        self._collector = collector

    def __getattr__(self, model_name: str) -> _ModelResourceCallable:
        # Convert DSL-style underscore names to dotted Odoo model names.
        # Full replacement: all underscores become dots.
        # e.g. "res_partner" → "res.partner", "sale_order_line" → "sale.order.line"
        model = model_name.replace("_", ".")
        return _ModelResourceCallable(model, self._collector)


# ---------------------------------------------------------------------------
# Data source proxy
# ---------------------------------------------------------------------------


class _ModelDataCallable:
    """Returned by ``DataProxy.__getattr__``."""

    def __init__(self, model: str, collector: _Collector) -> None:
        self._model = model
        self._collector = collector

    def __call__(self, **selector: Any) -> DataSourceNode:
        # Deterministic node_key: sorted selector keys for stability.
        key_parts = ",".join(f"{k}={v!r}" for k, v in sorted(selector.items()))
        node_key = f"data.{self._model}[{key_parts}]"
        node = DataSourceNode(model=self._model, selector=dict(selector), node_key=node_key)
        self._collector.data_sources.append(node)
        return node


class DataProxy:
    """DSL ``data`` object — attribute access returns a per-model callable.

    Underscore substitution mirrors ``ResourceProxy`` — all underscores become dots.
    """

    def __init__(self, collector: _Collector) -> None:
        self._collector = collector

    def __getattr__(self, model_name: str) -> _ModelDataCallable:
        # Full replacement: all underscores become dots (mirrors ResourceProxy).
        # e.g. "sale_order_line" → "sale.order.line"
        model = model_name.replace("_", ".")
        return _ModelDataCallable(model, self._collector)


# ---------------------------------------------------------------------------
# Config parameter proxy (mail.config["key"] = "value")
# ---------------------------------------------------------------------------


class ConfigParameterProxy:
    """Proxy for ``mail.config["key"] = "value"`` DSL sugar.

    ``__setitem__`` appends a ``{"key": ..., "value": ...}`` entry to the
    collector's ``config_parameters`` list.
    """

    def __init__(self, collector: _Collector) -> None:
        self._collector = collector

    def __setitem__(self, key: str, value: str) -> None:
        self._collector.config_parameters.append({"key": key, "value": value})


class OdooModuleProxy:
    """DSL ``mail`` object (and future module proxies).

    Currently only exposes a ``config`` property that returns a
    ``ConfigParameterProxy`` scoped to this module.
    """

    def __init__(self, collector: _Collector) -> None:
        self._collector = collector

    @property
    def config(self) -> ConfigParameterProxy:
        return ConfigParameterProxy(self._collector)


# ---------------------------------------------------------------------------
# children() helper
# ---------------------------------------------------------------------------


def children(
    child_model: str, inverse_field: str, children_list: list[Any]
) -> ChildrenWrapper:
    """DSL callable — wraps inline One2many children.

    The returned ``ChildrenWrapper`` is stored as a field value on the parent
    ``ResourceNode`` and is extracted by ``_flatten()`` in ``eval.py``.

    Args:
        child_model: Odoo model name for the child records.  Accepts both dotted
            (``"sale.order.line"``) and underscore (``"sale_order_line"``) forms —
            underscores are replaced with dots to mirror the ``ResourceProxy`` sugar
            (D-03).  The stored ``ChildrenWrapper.child_model`` is always dotted.
        inverse_field: Name of the Many2one field on the child pointing back to the parent.
        children_list: List of ``_ResourceBuilder`` instances (or ``ResourceNode`` objects)
            produced by resource proxy calls.
    """
    # Mirror ResourceProxy sugar: replace all underscores with dots so
    # children("sale_order_line", ...) and children("sale.order.line", ...)
    # both produce child_model = "sale.order.line" (D-03 consistency).
    child_model = child_model.replace("_", ".")

    # children_list entries are _ResourceBuilder instances; their _node is the ResourceNode.
    resolved: list[ResourceNode] = []
    for item in children_list:
        if isinstance(item, _ResourceBuilder):
            resolved.append(item._node)
        elif isinstance(item, ResourceNode):
            resolved.append(item)
        else:
            raise TypeError(
                f"children() list must contain resource builder or ResourceNode items, "
                f"got {type(item).__name__!r}: {item!r}"
            )
    return ChildrenWrapper(
        child_model=child_model,
        inverse_field=inverse_field,
        children=tuple(resolved),
    )


# ---------------------------------------------------------------------------
# Namespace factory
# ---------------------------------------------------------------------------


def build_dsl_namespace(collector: _Collector) -> dict[str, Any]:
    """Return the exec() namespace dict for DSL config evaluation.

    Keys in the returned dict:
    - ``resource`` — ``ResourceProxy`` instance
    - ``data``     — ``DataProxy`` instance
    - ``children`` — ``children()`` callable
    - ``resolve``  — ``resolve()`` from ``godoo_stateman.dsl.types.deferred``
    - ``mail``     — ``OdooModuleProxy`` instance

    The caller merges this dict with ``{"__builtins__": _SAFE_BUILTINS}`` to
    form ``exec_globals`` before calling ``exec()``.
    """
    return {
        "resource": ResourceProxy(collector),
        "data": DataProxy(collector),
        "children": children,
        "resolve": _resolve,
        "mail": OdooModuleProxy(collector),
    }
