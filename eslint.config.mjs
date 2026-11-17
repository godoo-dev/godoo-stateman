import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // Flat config does not read .gitignore; list generated and local paths explicitly.
  { ignores: ['dist/', 'node_modules/', '.scratch/', '.serena/', '.venv/', '.pytest_cache/', '.ruff_cache/', '.odoo-testcontainers/', 'site/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: globals.node },
    rules: {
      complexity: ['error', 20],
      // Best-effort cleanup and readiness polling deliberately ignore errors.
      'no-empty': ['error', { allowEmptyCatch: true }],
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }],
      // StoredPlanOptions is a published interface narrowing PlanOptions.
      '@typescript-eslint/no-empty-object-type': ['error', { allowInterfaces: 'with-single-extends' }],
    },
  },
);
