# Computed fields and MIS Builder

The local TypeScript API provides these helpers through the existing
resource graph, plan/apply/drift and durable recovery journal.

```ts
import { computedField, lookup, plan, apply } from '@godoo-dev/stateman';
import { readFileSync } from 'node:fs';
import * as mis from '@godoo-dev/stateman/mis';

const allocation = computedField('account.move.line', 'example.allocation', {
  _ref: lookup('ir.model.fields', { model: 'account.move.line', name: 'x_allocation' }),
  name: 'x_allocation', label: 'Allocation', type: 'json',
  store: false, readonly: true,
  compute: readFileSync(new URL('./allocation.py', import.meta.url), 'utf8'),
  depends: ['debit', 'credit'],
}, { onMissing: 'create' });
const report = mis.template('example.report', {
  name: 'Allocation',
  queries: [mis.query('lines', {
    name: 'lines', model: 'account.move.line', fields: [allocation],
    dateField: 'date', companyField: 'company_id', aggregate: false,
    domain: mis.queryDomain([['parent_state', '=', 'posted']]),
  })],
  kpis: [mis.kpi('net', {
    name: 'net', label: 'Net', sequence: 10,
    expression: "sum(line.x_allocation['net'] for line in lines)",
    type: 'num', accumulation: 'sum', compare: 'diff', temporal: 'additive',
    dependsOn: ['example.report.query.lines'],
  })],
});
const instance = mis.instance('example.group', {
  name: 'Group', template: report,
  companies: [lookup('res.company', { name: 'Company A' }), lookup('res.company', { name: 'Company B' })],
  currency: lookup('res.currency', { name: 'EUR' }), targetMove: 'posted',
  periods: [mis.period('jan', { label: 'January', sequence: 10, source: 'actuals',
    dates: { mode: 'fixed', from: '2026-01-01', to: '2026-01-31' } })],
});
```

Load the complete graph and review an ordinary plan. A MIS query's field record
reference can follow creation in the same apply. If planning a consumer requires
new target-model metadata, `FIELD_PENDING` asks for a selected field plan first;
apply it with the same journal, then make a fresh consumer plan. Selection expands
dependencies; do not include unrelated explicit removals in a selected stage.

The supported field contract covers manual `x_` JSON fields with nonempty compute,
`store: false` and `readonly: true`. Technical identity and storage/type transitions
are protected even through raw resources or adoption. Omission never deletes a
field. Python stays plain source data during planning; explicit runtime reads
qualify its safe_eval behavior. ORM `depends` paths and Stateman `dependsOn` XML
IDs have different purposes. Arbitrary Python dependencies cannot be inferred.

MIS Builder is an explicit installed prerequisite. Templates own stable named
query/KPI/subreport/sub-KPI children; instances own periods and sum terms. Adoption
is explicit through `_ref`, scoped to the parent. Scalar KPI expressions are
managed expression children, avoiding the destructive native expression inverse.
Unmanaged children are preserved; conflicting scalar expressions are refused.

Instances accept either `company` or `companies`. Multi-company membership uses
`exact()` and requires the complete authorized-company context. Native MIS intersects
companies with the user's allowed companies. This does not elevate privileges or
perform intercompany elimination. Supply an explicit reporting currency when the selected companies use different currencies.

Generic queries receive their date and configured company filters, but do not
inherit `targetMove` or analytic filters. Their results are flat search_read values.
JSON query fields cannot use numeric aggregation. Expressions/domains remain
opaque strings with explicit resource dependencies. Literal domain builders avoid
AEP bracket parsing traps; raw native strings remain an escape hatch.

Relative YTD starts January 1 and ends at the selected period end, not necessarily
the pivot date. Fiscal YTD uses explicit dates/ranges. Sum and comparison operands
initially reference actual columns in the same instance. Native sum columns include
only KPIs using `accumulation: 'sum'`; ratios and period-dependent results should
recompute over a wider actual period instead. Temporal annotations expose intent
without inferring accounting policy. Styles retain native inheritance flags and
conditional style names; export parity and query-backed drilldown are not implied.

## Expressions, dimensions and adoption

`mis.template(id, values, options?)` lowers to `mis.report`; child keys become
`<id>.query.<key>`, `<id>.kpi.<key>`, `<id>.subkpi.<key>` and
`<id>.subreport.<key>`. Names and labels can change without changing those IDs.
KPI and sub-KPI sequences are explicit integers. Reordering arrays never renames
records. Passing resource definitions as relations includes their graph.

For an existing scalar KPI, explicitly adopt its single native expression:

```ts
const existing = mis.template('example.existing', {
  _ref: lookup('mis.report', { name: 'Existing report' }), name: 'Existing report',
  kpis: [mis.kpi('value', {
    _ref: lookup('mis.report.kpi', { name: 'value' }),
    name: 'value', label: 'Value', sequence: 10,
    expression: mis.expression('value', {
      _ref: lookup('mis.report.kpi.expression', { subkpi_id: false }), value: '100',
    }),
    type: 'num', accumulation: 'none', compare: 'diff', temporal: 'period-dependent',
  })],
});
```

Each lookup is scoped to its actual parent; zero matches default to error. Use
`{ onMissing: 'create' }` on that helper to permit creation. The scalar string
form creates `<kpi-id>.expression.value`; an explicit expression can choose its
stable key. Multi-expression KPIs use `expressions: { debit: '...', credit: '...' }`
with matching `subKpis: [mis.subKpi('debit', { name: 'debit', label: 'Debit',
sequence: 10 }), ...]`. Each expression is its own resource and may use the explicit
`mis.expression` form for adoption. Subreports use
`mis.subreport('benchmark', { name: 'benchmark', report: otherTemplate })` and
expressions such as `benchmark.target`, with explicit `dependsOn`.

KPI `style`, `styleExpression` and `expandAccounts` lower to native fields.
`styleExpression` returns a style name; declare opaque dependencies in `dependsOn`.
`mis.style(id, nativeValues, options?)` keeps native property/inheritance names:
`{ name: 'Total', font_weight: 'bold', font_weight_inherit: false }`.
Omitted style properties remain unmanaged. A raw KPI `expression` write and a raw
instance `comparison_mode` write are refused because their native inverses can
unlink records. Changing a KPI between scalar/multi modes or reparenting an
existing child is an explicit migration outside these helpers.

## Periods and accounting domains

`mis.instance` maps `pivotDate` to native `date`; omitted dates use Odoo's current
date. Each `mis.period(key, values, options?)` has `label`, `sequence` and a source:

```ts
const january = mis.period('jan', { label: 'January', sequence: 10,
  source: 'actuals', dates: { mode: 'fixed', from: '2026-01-01', to: '2026-01-31' } });
const february = mis.period('feb', { label: 'February', sequence: 20,
  source: 'actuals', dates: { mode: 'relative', unit: 'month', offset: 0, duration: 1 } });
const ytd = mis.period('ytd', { label: 'Calendar YTD', sequence: 30,
  source: 'actuals', dates: { mode: 'relative', unit: 'month', offset: 0, duration: 1, ytd: true } });
const change = mis.period('change', { label: 'Change', sequence: 40,
  source: 'compare', from: 'jan', to: 'feb', normalizeFactor: 1 });
const sum = mis.period('sum', { label: 'January + February', sequence: 50,
  source: 'sum', terms: [{ key: 'jan', period: 'jan', sign: '+' },
                       { key: 'feb', period: 'feb', sign: '+' }] });
```

All operands must be sibling actual periods. Missing operands, empty sums,
duplicate keys/labels, invalid fixed dates and invalid relative durations fail
offline. Relative units are `day`, `week`, `month`, `year` and `dateRange`; the last
also requires `rangeType` pointing to an existing `date.range.type`.
Sum term IDs are `<instance-id>.period.<key>.term.<term-key>`. Retained sum terms
must be explicitly adopted through each term's `_ref` (and optional `options`) or
removed with ordinary reviewed ownership; they are never silently discarded.

```ts
const ledger = mis.aep({ field: 'balance', mode: 'variation',
  accounts: [['account_type', 'in', ['income', 'expense']]],
  domain: [['journal_id.type', '=', 'sale']] });
// balp[("account_type", "in", ("income", "expense"))][("journal_id.type", "=", "sale")]
```

AEP fields also include `debit`, `credit`, `positiveBalance`, `negativeBalance`;
modes include `initial`, `ending`, `unallocated`. `accounts` accepts code patterns
such as `['70%', '60%']` or literal domains. Nested collections become tuples so
native AEP parsing/hashing works. Literal strings containing `]` cannot be expressed
by that parser and fail in the helper. Query domains use `mis.queryDomain` and
Python literal booleans. Neither builder evaluates arbitrary Python; use a raw
native string for context expressions.
