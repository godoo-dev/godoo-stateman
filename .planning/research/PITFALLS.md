# Pitfalls Research

**Domain:** Declarative Odoo state reconciliation over jsonrpc (Python CLI)
**Researched:** 2026-05-23
**Confidence:** HIGH (Odoo facts source-verified; reconciliation patterns from v1 post-mortem + IaC community)

---

## Critical Pitfalls

### Pitfall 1: Whole-Plan Atomicity Is Impossible — EXEC-02 Is Dead

**What goes wrong:**
Each jsonrpc call to `/jsonrpc` is its own SQL transaction, committed immediately on success. There is no way to chain multiple `execute_kw` calls inside a single database transaction from outside Odoo. A plan with 20 steps that fails on step 14 has already committed steps 1-13 with no rollback path.

**Why it happens:**
Engineers coming from Terraform or SQL tools expect transactional semantics. The Odoo external API documentation (19.0) explicitly confirms: "it is not possible to chain multiple calls inside a single transaction." This is a protocol constraint, not a missing feature in godoo-stateman. EXEC-02 was already ruled out in PROJECT.md — the pitfall is forgetting this and designing features that imply rollback (e.g., "undo last apply").

**How to avoid:**
- Stop-on-first-failure is the correct and only safe strategy for apply. Document this explicitly in user-facing output.
- Post-failure output must clearly state *which steps committed* and *which were skipped* — this is the recovery surface.
- Never advertise "transactional apply" in docs or help text.
- The `verify` command (post-apply re-plan) is the partial-failure recovery tool: it surfaces the delta between committed state and intended state so the operator can re-apply.
- Do not attempt compensating writes ("undo") — they compound partial failure into worse inconsistency.

**Warning signs:**
- Any code path that wraps multiple `client.write()`/`client.create()` calls in a try/except expecting to rollback.
- Any design doc mentioning "atomic plan" or "rollback on failure" without flagging EXEC-02.
- Plan steps that depend on a later step succeeding (inverted dependency order).

**Phase to address:**
Apply layer (core reconciliation capability). The stop-on-first-failure contract and partial-progress reporting must be designed in from the first apply implementation, not retrofitted.

---

### Pitfall 2: False vs. None — Odoo's Type-Mangled Empty Values

**What goes wrong:**
Odoo's jsonrpc layer returns `False` (Python boolean) for any unset scalar field — not `None`, not `""`, not `[]`. This includes: unset Many2one fields (return `False` instead of `None`), unset date/datetime fields (return `False`), unset char fields (return `False`), unset binary fields (return `False`). The normalize pass must handle this or diffs become non-deterministic — a field that the DSL leaves unset (Python `None`) will always appear to differ from Odoo's `False`, triggering spurious updates on every run.

**Why it happens:**
XML-RPC does not support `null`/`None` as a wire type. Odoo adopted a convention of using `False` as a universal sentinel for "absent" across all field types, even in the jsonrpc endpoint which *could* encode `null`. This is a 10+ year Odoo convention that will not change. The `godoo-py` `read_binary` already handles this (`raw is False or raw is None` returns `b""`), confirming the pattern is real.

**How to avoid:**
- In the normalize stage: convert `False` → `None` for all scalar fields (char, integer, date, datetime, float, binary, Many2one).
- For relation fields: `False` → `[]` for Many2many/One2many; `False` → `None` (or `(False, False)`) for Many2one.
- After normalization, use a canonical sentinel (e.g., always `None`, never `False`) throughout the diff/plan pipeline.
- Add a unit test suite for the normalize pass that covers `False`-to-canonical conversions for every field type.

**Warning signs:**
- Diff output shows `field: None → False` or `field: False → None` on a re-run where nothing changed.
- Any comparison in the diff layer using `if live_val != desired_val` without prior normalization.
- `fields_get` attributes include `type` but normalization doesn't branch on it.

**Phase to address:**
Normalize stage. This must be correct before the diff stage can produce stable output. VAL-01 and VAL-02 will catch this if the "no-op on second apply" invariant is tested.

---

### Pitfall 3: Many2many Write Format — Tuple Command Protocol

**What goes wrong:**
Reading a Many2many field from Odoo returns a flat list of integer IDs (e.g., `[1, 5, 9]`). Writing a Many2many field requires Odoo's command tuple protocol: `(6, 0, [IDs])` to replace the set, `(4, ID)` to add one, `(3, ID)` to remove one. Passing the flat list directly to `write()` raises a validation error. If the normalize pass stores the live state as a list of IDs and the diff computes a new list of IDs, the apply layer must convert those IDs into the correct write command, not pass them through verbatim.

**Why it happens:**
The read shape and write shape for relation fields are asymmetric in Odoo's ORM by design. Developers read the field, diff it, then naively pass the desired list back to write — it fails. The v1 Go prototype hit this for m2m relations to data sources (the "structurally blocked" lesson in SEED.md).

**How to avoid:**
- The normalize pass must produce a canonical representation of m2m that can be diffed (sorted list of IDs or sorted list of xmlid-addresses).
- The apply layer must translate canonical m2m representation into write commands: use `(6, 0, [resolved_ids])` for full replacement (simplest and most robust).
- For m2m fields referencing data sources (not managed resources), the apply layer must resolve the data-source address to a remote integer ID before building the write command — this is the "cross-apply m2m remote-id resolution" requirement from SEED.md.
- Never pass a raw list of IDs to `write()` for a m2m field.

**Warning signs:**
- `write()` raising `ValidationError` mentioning "invalid command" or "expected list of commands."
- Any `apply` code path that passes `field_value` directly from the plan step to `write()` without going through a relation-command encoder.
- m2m fields to data sources that are resolved at DSL-eval time (before the apply stage knows remote IDs).

**Phase to address:**
Apply layer, specifically the address→remote_id resolver and the relation-command encoder. This must be designed before the first m2m field is applied.

---

### Pitfall 4: Module Install/Upgrade Is Not Atomic and Blocks the Odoo Worker

**What goes wrong:**
`button_immediate_install` (and `button_immediate_upgrade`, `button_immediate_uninstall`) are long-running RPC calls that hold the Odoo worker. They can fail mid-way (dependency not found, cron lock, migration error) and leave the module in a partial state (`to install`, `to upgrade`). There is no rollback. A cron lock on `ir_cron` during install is a known Odoo 17 race condition that fails the RPC call but may leave the module partially installed. The `godoo-py` `ModuleManager` already handles the cron-lock retry pattern — godoo-stateman must rely on that behavior and additionally treat module-related plan steps as the highest-risk step class.

**Why it happens:**
Module install/upgrade triggers Odoo's internal migration and data-loading machinery inside the same HTTP request. If that machinery fails, the jsonrpc error is raised back to the caller but the database may be in a partially-migrated state. This is an Odoo architectural constraint.

**How to avoid:**
- Module install/upgrade steps must be the **last** steps in any plan (or explicitly sequenced to run after all config steps they depend on, and before any steps that depend on the new module's models).
- Thread cancellation/interrupt handling through module steps so Ctrl-C during a module install does not leave the UI in an ambiguous state.
- After a module step fails, the verify pass must re-read module state (not use a cached plan).
- Use `godoo-py`'s `ModuleManager._call_with_ir_cron_retry` (already implemented) — do not re-implement the retry logic.
- Emit explicit warnings in plan output: "Module install is not atomic. If this step fails, inspect ir.module.module.state before re-running."

**Warning signs:**
- Module step placed before records that reference the new module's models (wrong ordering in the dependency DAG).
- Module steps not retried on `ir_cron` errors.
- Post-apply verify that checks module state using cached (pre-apply) state.
- Any code that assumes module install either fully succeeds or leaves the database clean.

**Phase to address:**
Apply layer (module step handling), Dependency graph (module step ordering), Verify (post-apply module state re-read).

---

### Pitfall 5: Missing `store` Flag in Schema Snapshot (BUG-07-B)

**What goes wrong:**
Odoo's `fields_get` returns field metadata including whether a field is stored (`store: True/False`). Computed non-stored fields (`store=False`) cannot be written via the external API — writing them either silently succeeds (write is ignored) or raises an error. If the schema snapshot omits the `store` flag, the engine cannot distinguish writable fields from computed read-only fields. The diff may produce a plan step that tries to write a non-stored computed field, which fails at apply time. BUG-07-B in the Go v1 confirmed this is a real failure mode.

**Why it happens:**
`fields_get` returns many attributes; early implementations capture `type`, `relation`, `readonly` but skip `store`. Non-stored fields are not always `readonly=True` in `fields_get` — for example, fields with an inverse function are `store=False` but *are* writable. The `store` flag is the correct discriminator for "will Odoo persist this value."

**How to avoid:**
- The schema snapshot **must** capture `store` (boolean) for every field, from day one.
- In the introspection pass: call `fields_get` with `attributes=['string', 'type', 'store', 'readonly', 'required', 'relation', 'relation_field', 'compute']`.
- During normalize/diff: skip fields where `store=False AND compute is set AND no inverse`. Only allow writing fields that are either `store=True` or have an explicit inverse.
- Unit-test the schema snapshot against a real Odoo 17 instance for a known computed/non-stored field.

**Warning signs:**
- Schema snapshot JSON without a `store` key at the field level.
- `fields_get` call that requests only `['type', 'relation', 'readonly']`.
- Apply errors of the form "Field X is not stored and cannot be set."
- No test that verifies a computed non-stored field is excluded from the write plan.

**Phase to address:**
Schema snapshot capability (earliest infrastructure phase). The `store` flag must be in the schema snapshot spec before any field introspection code is written.

---

### Pitfall 6: xmlid Identity Model — Duplicate Adoption and Silent Overwrite

**What goes wrong:**
godoo-stateman's identity model relies on writing an xmlid into `ir.model.data` to claim ownership of a record. Two failure modes: (a) plan/apply silently adopts an existing unmanaged record by writing its xmlid — this violates SAFE-03 and is invisible in the diff output. (b) Two godoo-stateman instances running concurrently against the same database, with no shared lock, both try to create a record with the same xmlid — one succeeds, the other fails with a uniqueness constraint, but the successful one may have created a duplicate.

**Why it happens:**
`ir.model.data` enforces uniqueness on `(module, name)`. The create-then-claim pattern (create the record, then write the xmlid) has a TOCTOU window: between the create and the xmlid write, another process can create a record with the same intended xmlid. The check-then-create pattern has the same window.

**How to avoid:**
- `import` is the explicit, user-invoked adoption path (SAFE-03). `plan/apply` must never claim unmanaged records without explicit import.
- Before creating a record, check for an existing xmlid with the same address; if found and not owned by this module, raise an error rather than overwriting.
- Document explicitly that concurrent godoo-stateman runs against the same database are not safe — this is a known limitation of the jsonrpc-over-no-shared-lock model.
- In `plan` output, flag any record where the desired xmlid already exists in `ir.model.data` pointing to a different record.

**Warning signs:**
- `create()` followed by `write({'external_id': ...})` with no check in between.
- Plan output that shows "Create" for a record whose xmlid already exists in Odoo.
- No test for the "import rejects if xmlid already exists" invariant.

**Phase to address:**
Identity and import capability. The SAFE-03 invariant must be part of the plan-stage validation, not just the apply-stage guard.

---

### Pitfall 7: Cross-Apply m2m Remote-ID Resolution Not Consulting Global LiveState

**What goes wrong:**
When a plan step writes a Many2many field that references another managed resource (not a data source), the apply layer needs the remote integer ID of that resource. In the Go v1, this lookup did not consult the global `LiveState` — it used only the local plan step context. If resource A creates record #42 and resource B's m2m field references A, but A's step runs first and the result ID is not propagated into the LiveState before B's step executes, B's m2m write uses a stale/missing ID and either fails or silently writes an empty set.

**Why it happens:**
The plan is serialized before apply starts. At plan time, managed resources don't yet have remote IDs (they don't exist yet). The apply loop must maintain a mutable "resolved ID registry" that is updated after each successful create/update step and consulted by subsequent m2m-write steps.

**How to avoid:**
- The apply loop must maintain a mutable `address → remote_id` registry, initialized from LiveState (existing records) and updated after every create/update step with the newly returned ID.
- All relation-field write-command encoding must go through this registry, not through the pre-serialized plan.
- For resources that already exist (Update path), the LiveState pre-populates the registry before apply starts.
- Test with a plan that creates both A and B (where B references A in a m2m) in a single apply — the IDs must resolve correctly.

**Warning signs:**
- Apply code that reads relation IDs from the serialized plan step without consulting a mutable registry.
- m2m write commands that contain `0` or `-1` as placeholder IDs.
- No test for "create A, create B referencing A, in one apply."

**Phase to address:**
Apply layer. The address→remote_id resolver must be designed before the first m2m apply is implemented.

---

### Pitfall 8: Schema Snapshot Staleness — Field Assumptions Without Version Seam

**What goes wrong:**
godoo-stateman captures schema snapshots for introspection. If the snapshot is taken from Odoo 16 and applied against Odoo 17 (or vice versa), field availability differs. Concretely: `project.project.member_ids` exists in some older versions and Odoo Enterprise but not in Odoo 17 CE (confirmed: CE 17 uses `favorite_user_ids`). A schema snapshot without an explicit Odoo-version dimension allows silently wrong field plans.

**Why it happens:**
Developers test against one Odoo version and forget that field availability is version- and edition-dependent. Odoo CE and EE share the model name but have different field sets (EE adds fields via inheritance). There is no runtime check that the snapshot version matches the target Odoo version.

**How to avoid:**
- The schema snapshot format must carry an explicit `odoo_version` field from day one (PROJECT.md requirement confirmed).
- On startup, godoo-stateman must compare the snapshot's `odoo_version` against the live Odoo instance's `service_id.server_version` and warn if they differ.
- Never hardcode field names in the engine code — all field-level decisions must go through the schema snapshot.
- For `project.project`: always use `favorite_user_ids`, never `member_ids`. Verified: Odoo 17.0 CE source code (`addons/project/models/project_project.py`) defines `favorite_user_ids = fields.Many2many('res.users', ...)` with no `member_ids`.

**Warning signs:**
- Schema snapshot JSON files without an `odoo_version` key.
- Any hardcoded field name in engine code outside of the schema snapshot layer.
- No test that verifies a snapshot taken from one Odoo version fails gracefully against another.
- CI tests that don't pin the Odoo version via testcontainers.

**Phase to address:**
Schema snapshot capability (earliest infrastructure phase). Version seam must be in the schema format spec before any snapshot code ships.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Skipping the `store` flag in schema snapshot | Simpler first snapshot | All apply steps risk writing non-stored computed fields; apply errors at runtime | Never |
| Assuming `False == None` in normalize | Simpler normalize pass | Spurious diffs on every re-run; idempotency broken | Never |
| Hardcoding field names (e.g., `favorite_user_ids`) in engine code | Faster first pass | Breaks on Odoo version change or custom module that removes the field | Never; use schema snapshot |
| Skipping cross-apply remote-ID registry | Simpler apply loop for single-resource tests | m2m relations between managed resources silently write empty sets | Never |
| No stop-on-first-failure enforcement | Simpler apply error handling | Cascading failures; operator has no clean partial-progress record | Never |
| Reusing schema snapshot across Odoo versions without version check | Avoids re-introspection | Silently wrong field plans when Odoo is upgraded | MVP-acceptable only with an explicit "snapshot is stale" warning |
| Detecting drift only for touched resources (not all managed resources) | Faster verify pass | Drift in unrelated managed resources goes undetected until next full apply | Acceptable default; offer `--full` flag for full-scope drift check |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Odoo jsonrpc / `godoo-py` | Passing flat list `[id1, id2]` to `write()` for m2m field | Encode as `(6, 0, [id1, id2])` write command tuple |
| Odoo jsonrpc | Assuming `None` is a valid wire value for unset fields | Normalize all `False` from Odoo reads to canonical sentinel before diffing |
| `ir.module.module` / `ModuleManager` | Not retrying on `ir_cron` lock errors | Use `ModuleManager._call_with_ir_cron_retry`; never call `button_immediate_*` directly |
| `ir.model.data` xmlid | Creating xmlid for record that already has a different xmlid | Check existing xmlid ownership before create; surface conflict in plan output |
| `fields_get` | Requesting only `['type', 'relation', 'readonly']` attributes | Also request `['store', 'compute', 'required']`; `store` is mandatory per BUG-07-B |
| `project.task.type` | Treating task stages as non-archivable | `active` field exists and is a plain writable Boolean on Odoo 17 CE; archiving a stage also archives its tasks (ORM side effect — verify in test) |
| Odoo 17 jsonrpc endpoint | Designing for long-term stability | `/jsonrpc` is deprecated since Odoo 19; scheduled removal Odoo 22 (fall 2028) / Online 21.1 (winter 2027). Plan a migration seam to JSON-2 API when targeting Odoo 19+. |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| N+1 LiveState reads (one RPC per resource per field) | Slow plan/apply for configs with 50+ resources | Batch `search_read` per model; read all managed resources for a model in one call | At ~20 resources the latency becomes noticeable; at 100+ it dominates |
| No pagination on LiveState reads | Memory/timeout error on large Odoo instances | Use `iter_search_read` (keyset pagination, already in `godoo-py`) for model reads exceeding ~500 records | At ~1000 managed records; sooner on slow instances |
| Schema snapshot fetched on every run | Adds 1-5 seconds on cold path for large models | Cache snapshot to disk (`.godoo-snapshot.json`); re-fetch only on explicit `--refresh-schema` | Every run against a remote Odoo |
| m2m resolution looping (one RPC per m2m field per resource) | Apply very slow for configs with many m2m relations to data sources | Batch data-source resolution; resolve all data-source addresses for a model in one `search_read` at the plan stage | At ~10 m2m fields across 20 resources |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Storing Odoo password in the DSL config file | Credentials in version control | Read credentials from env vars or a separate secrets file that is gitignored; never from the `.py` DSL |
| Using admin credentials for all apply operations | Any validation error leaks admin session | Support per-operation credentials; document minimum required access rights |
| No TLS verification on jsonrpc calls | MITM attack intercepts credentials and plan mutations | Enforce TLS by default; warn if `http://` URL is used |
| Logging full RPC payloads at DEBUG level | Passwords or sensitive field values in logs | Redact `password`, `api_key`, and binary fields from debug logs in the transport layer |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| "Apply failed" with no partial progress report | Operator doesn't know which steps committed; unsafe to re-run | Always emit step-by-step progress; on failure, print "Committed: [list]" and "Skipped: [list]" |
| Plan output that doesn't distinguish NoOp from unchanged-unmanaged | Operator thinks all records are under management | Color/label NoOp (managed, no change) vs. untracked (not in DSL); SAFE-03: never silently adopt |
| verify/re-plan after partial apply that reads from cached LiveState | Shows wrong delta; operator re-applies already-committed steps | Always re-fetch LiveState from Odoo in the verify pass |
| Cryptic jsonrpc error messages | Operator cannot diagnose without Odoo source access | Map known Odoo error patterns (ValidationError, MissingError, AccessError) to actionable messages in `godoo-py` error hierarchy — already started in `_categorize_error` |
| `build` command (lockfile) that includes resolved remote IDs | Lockfile is machine- and state-dependent; breaks reproducibility | Lockfile captures desired state addresses only; remote IDs are resolved at apply time |

---

## "Looks Done But Isn't" Checklist

- [ ] **Normalize pass:** Handles `False`-to-canonical conversion for every field type (scalar, Many2one, Many2many, One2many, binary, date, datetime).
- [ ] **Schema snapshot:** Every field entry includes `store`, `compute`, `readonly`, `type`, `relation`.
- [ ] **Schema snapshot:** File-level `odoo_version` field present and validated against live Odoo on load.
- [ ] **Apply loop:** Address→remote_id registry is mutable and updated after every create step before the next step executes.
- [ ] **Apply loop:** m2m write commands use `(6, 0, [ids])` tuple protocol, never a plain list.
- [ ] **Apply loop:** Module install/upgrade steps are the last in their dependency tier and use `ModuleManager` retry logic.
- [ ] **Plan stage:** Any plan step that would write to a non-stored computed field is rejected with an explicit error.
- [ ] **Plan stage:** Existing unmanaged records with the same desired address surface as conflicts, not silent adopts.
- [ ] **Verify command:** Always re-fetches LiveState from Odoo; never uses apply-time cache.
- [ ] **VAL-01 / VAL-02:** Second apply of same config produces zero plan steps (idempotency gate).
- [ ] **project.project:** Uses `favorite_user_ids`, not `member_ids` (source-verified on Odoo 17.0 CE).
- [ ] **project.task.type:** Archiving via `active=False` tested; verify that associated tasks also archive (ORM side-effect).

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Partial apply (EXEC-02 / no rollback) | MEDIUM | Run `verify` to get current delta; fix root cause; re-apply the remaining steps |
| Spurious diffs from False/None mismatch | LOW | Fix normalize pass; re-run plan; confirm zero-diff on second run |
| m2m write format error | LOW | Fix relation-command encoder in apply layer; re-run the failed step |
| Module install partial failure | HIGH | Manually inspect `ir.module.module.state` in Odoo; may require Odoo restart or manual migration; re-run apply after confirming state |
| Schema snapshot staleness (version mismatch) | LOW | Delete cached snapshot; run `godoo snapshot refresh`; re-plan |
| xmlid collision (SAFE-03 violation) | MEDIUM | Use `import` command to explicitly claim the conflicting record; then re-plan |
| Cross-apply m2m resolution failure | LOW | Fix remote-ID registry; re-run apply; the m2m step is idempotent if using `(6, 0, [ids])` |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Whole-plan atomicity impossible (EXEC-02) | Apply layer — stop-on-first-failure design | Acceptance test: inject failure mid-plan; verify committed steps are listed, skipped steps are listed |
| False vs. None normalization | Normalize stage | Unit test: `normalize({"field": False}) == {"field": None}`; VAL-01 second-apply is zero-diff |
| m2m tuple command protocol | Apply layer — relation-command encoder | Unit test: m2m encoder produces `(6, 0, [...])` for replacement; integration test: m2m field applies correctly |
| Module install non-atomicity | Apply layer — module step ordering + retry | VAL-02: module install step completes; test cron-lock retry path |
| Missing `store` flag in schema snapshot | Schema snapshot (first infrastructure phase) | Schema snapshot JSON contains `store` for every field; test against real Odoo 17 |
| xmlid duplicate adoption (SAFE-03) | Identity / import capability | Plan test: detect existing unmanaged record; assert error not silent adopt |
| Cross-apply m2m remote-ID resolution | Apply layer — address→remote_id registry | Integration test: create A then B referencing A in one apply; B's m2m resolves to A's new ID |
| Schema snapshot version staleness | Schema snapshot (version seam design) | Startup check: snapshot version vs. live Odoo version; test version mismatch raises warning |

---

## Verified Odoo 17 CE Facts

These were grounded against Odoo 17.0 CE source code (GitHub `odoo/odoo` branch `17.0`) during this research pass.

| Claim | Source | Confidence | Status |
|-------|--------|------------|--------|
| `project.project` has NO `member_ids` in Odoo 17 CE | `addons/project/models/project_project.py` — only `favorite_user_ids` defined | HIGH | CONFIRMED |
| `project.project.favorite_user_ids` is a Many2many to `res.users` via `project_favorite_user_rel` | Same file: `fields.Many2many('res.users', 'project_favorite_user_rel', 'project_id', 'user_id', ...)` | HIGH | CONFIRMED |
| `project.task.type.active` is a plain writable Boolean (not computed) | `addons/project/models/project_task_type.py`: `active = fields.Boolean('Active', default=True)` | HIGH | CONFIRMED |
| Archiving a task stage also archives its tasks (ORM side-effect) | Same file: `write()` override calls `project.task.search([('stage_id', 'in', self.ids)]).write({'active': False})` when `active=False` | HIGH | CONFIRMED |
| m2m relations to data sources were structurally blocked in v1 | Go v1 post-mortem (SEED.md) | HIGH (design doc) | CARRIED FORWARD — fix in rebuild |
| Cross-apply m2m remote-ID resolution did not consult global LiveState in v1 | Go v1 post-mortem (SEED.md) | HIGH (design doc) | CARRIED FORWARD — fix in rebuild |
| `store` flag must be in schema snapshot (BUG-07-B) | Go v1 post-mortem (SEED.md + PROJECT.md) | HIGH (design doc) | CARRIED FORWARD — mandatory in schema spec |
| `/jsonrpc` endpoint deprecated; removal in Odoo 22 / Online 21.1 | Odoo 19.0 external RPC API docs | HIGH | NEW FINDING — plan migration seam for Odoo 19+ |

---

## Sources

- Odoo 17.0 CE source: `addons/project/models/project_project.py` — `favorite_user_ids` confirmed, `member_ids` absent
- Odoo 17.0 CE source: `addons/project/models/project_task_type.py` — `active` field confirmed writable
- Odoo 19.0 External RPC API docs: deprecation of `/jsonrpc` and `/xmlrpc` endpoints
- Odoo 19.0 External JSON-2 API docs: per-call transaction semantics (no cross-call atomicity)
- `godoo-py` source: `module_manager.py` — `ir_cron` retry pattern (real Odoo 17 failure mode)
- `godoo-py` source: `client.py` `read_binary` — `False`-as-absent pattern confirmed
- `godoo-py` source: `field_cache.py` — schema introspection via `ir.model.fields` (note: `store` not yet captured here — this is the BUG-07-B gap to fix in godoo-stateman)
- godoo-stateman SEED.md §2 — Go v1 hard-won lessons (primary source for v1 pitfalls)
- godoo-stateman PROJECT.md — requirement cross-references
- Terraform partial-apply post-mortems — IaC reconciliation stop-on-failure rationale
- Odoo forum: `False` instead of `None` for unset fields over XML-RPC/JSON-RPC (community-confirmed)

---
*Pitfalls research for: declarative Odoo state reconciliation over jsonrpc (Python CLI)*
*Researched: 2026-05-23*
