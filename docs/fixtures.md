# Portable fixtures

Use sanitized desired state to seed a disposable Odoo instance without exporting
staging records. A fixture contains rendered values, qualified XML IDs and symbolic
relations. It contains no source-file locations or executable TS modules. Ordinary
Stateman planning still validates its schema, lookups, dependencies and target.

The proposed public interface is:

```ts
import { loadResources, createFixture, serializeFixture, parseFixture } from '@godoo-dev/stateman';
import { readFile, writeFile } from 'node:fs/promises';

const inspection = await loadResources('./test-resources');
const fixture = createFixture(inspection, {
  namespaces: ['seed'],
  excludeFields: { 'res.partner': ['email', 'phone'] },
  maxResources: 100,
  maxDepth: 24,
});
await writeFile('state.fixture.json', serializeFixture(fixture));
const desired = parseFixture(await readFile('state.fixture.json', 'utf8'));
// Review plan(desired, connection), then use the ordinary apply/recovery path.
```

Only package sanitized inputs. Exclusions omit named direct fields per model;
they do not discover personal data in nested JSON or HTML. Namespace coverage is
explicit: out-of-scope resources reject instead of disappearing. Missing managed
parents and explicit dependencies reject; external XML-ID references remain for
live planning to validate. Legacy blanket removal and field-translation policies
reject. Represent separate language pages as separate resources.

The default limits are 1,000 resources, depth 24 and 5 MB, with hard ceilings of
10,000 resources, depth 64 and 50 MB. Both parsing and serialization enforce the
limits. Loading trusted TS remains executable code; parsing the JSON fixture
does not evaluate code. Neither operation grants mutation authority.

This deliberately replaces the predecessor's live `exportData`/`importData` smoke
path. It is not a database snapshot, clone or restore. It does not discover or
remap numeric IDs from another database. Author portable relations with XML-ID
references or explicit unambiguous lookups. Seeding returns the target bindings
from the ordinary reconciliation result, rather than a numeric source `idMap`.

Compose it after `startOdoo()` readiness in a TS test fixture. Testcontainers keeps
its existing convenience data helpers and has no dependency on Stateman. Python
callers can invoke the installed CLI as a checked subprocess with fixture/plan
files; do not embed TS evaluation in Python or treat the retained Python reference
as a second supported engine. CLI fixture integration and seed result details
remain proposed until reconciliation is integrated and verified.
