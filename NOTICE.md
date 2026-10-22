# Source attribution and rights

This TypeScript foundation derives from `@marcfargas/odoo-state-manager` 0.4.1,
by Marc Fargas, in https://github.com/marcfargas/odoo-toolbox at immutable commit
`01512004814df8887a457e5ed9d6c5769fe3b730` (verified 2026-10-22).
The upstream package declares LGPL-3.0; its license text is retained verbatim as
LICENSE, accompanied by GPL v3 as COPYING. Adapted code retains those obligations.
The metadata uses the explicit SPDX spelling LGPL-3.0-only for these source rights;
this does not decide a different product license or authorize publication.

Adapted on 2026-10-22:

- `src/dsl/*.ts` from upstream `src/dsl/*.ts`: preserved authoring factories/types,
  adjusted ESM imports and source notice comments.
- `src/content.ts` from upstream `src/engine/transform.ts`: retained Markdown,
  frontmatter, CSS, sanitization heuristics and translation extraction. Omitted
  instance-language probing and resolved-engine orchestration.
- `src/loader.ts` from `src/engine/evaluate.ts`: retained sorted discovery and
  exported-array collection, replaced module loading with scoped TS/ESM imports,
  deduplicated aliases and added array-cycle checks and discovery exclusions.
- `src/inspect.ts` recursively adapts the child-prefixing approach from
  `src/engine/flatten.ts`, retaining relations, detecting collisions/cycles and
  generating stable field-based inline identities. The review correction discovers
  explicit child declarations and assigns canonical definition identities before
  emitting ordinary relation references; it preserves declaration inverse scope
  and rejects ambiguous ownership. It is offline normalization,
  not the predecessor's shallow flatten/resolve/scheduling engine.
- `tests/dsl/*.test.ts`, `tests/predecessor/*.test.ts` and
  `tests/fixtures/predecessor/*.ts` retain the corresponding DSL, evaluation,
  content and sanitization tests. Imports/fixture locations were adapted; the
  instance-language tests were omitted along with that unsupported feature.

`src/{index,cli,runtime}.ts`, recursive normalization and additional tests are
foundation integration work. No predecessor apply, resolve, plan, clone/export or
model-only scheduling engine is shipped. Existing Python source is untouched.

The minimal synthetic corpus under `tests/fixtures/consumer` was authored for this
foundation, informed only by composition patterns observed read-only in bgbl-odoo
at `85dcedbce566d2ca24e84a20108cf551b81e0695`: project children, cron/action nesting,
KB arrays/relations, Markdown and prelude concatenation. No private articles,
pipeline bodies, customer data or secrets were copied. These fixtures are not
consumer deployment or business-behavior acceptance evidence.

The tarball includes the corresponding TypeScript source and build configuration
alongside JavaScript/declarations. No registry publication has been performed.
