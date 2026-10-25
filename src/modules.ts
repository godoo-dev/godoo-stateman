import type { AddonInspection, ConnectionIdentity, Row } from './state-types.js';
import { copy, digest, equal, fail, identity } from './state-utils.js';

export interface ModuleRequest { name: string; action: 'install' | 'upgrade'; }
export interface ModuleStageOptions { context?: Row; maxAttempts?: number; retryDelayMs?: number; }
export interface ModuleOutcome { name: string; state: string; changed: boolean; schemaInvalidated: boolean; }
export interface ModulePrerequisites extends AddonInspection { cycleEdges: { from: string; to: string }[]; }
/** Structural adapter to the verified godoo client lifecycle API. */
export interface ModuleStageConnection {
  identity(): Promise<ConnectionIdentity>;
  modules: {
    readonly catalogRevision: number;
    inspectPrerequisites(names: string[], options?: { context?: Row }): Promise<ModulePrerequisites>;
    installModule(name: string, options?: ModuleStageOptions): Promise<ModuleOutcome>;
    upgradeModule(name: string, options?: ModuleStageOptions): Promise<ModuleOutcome>;
  };
  invalidateSchema(): void | Promise<void>;
}
export interface ModulePlan {
  kind: 'stateman-module-plan';
  version: 1;
  target: ConnectionIdentity;
  requests: ModuleRequest[];
  prerequisites: ModulePrerequisites;
  options: ModuleStageOptions;
  catalogRevision: number;
  digest: string;
}
export interface ModuleStageResult {
  ok: boolean;
  /** Any dispatched lifecycle operation requires new schema and resource planning. */
  requiresReplan: boolean;
  results: { request: ModuleRequest; status: 'committed' | 'failed' | 'skipped'; result?: ModuleOutcome; error?: unknown; invalidationError?: unknown }[];
}

export async function planModules(connection: ModuleStageConnection, requests: readonly ModuleRequest[], options: ModuleStageOptions = {}): Promise<ModulePlan> {
  const seen = new Set<string>();
  for (const request of requests) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(request.name) || !['install', 'upgrade'].includes(request.action)) fail('INVALID_MODULE_REQUEST', 'Addon requests need a technical name and explicit install/upgrade action');
    if (seen.has(request.name)) fail('DUPLICATE_MODULE_REQUEST', `Preview each stage once for ${request.name}`);
    seen.add(request.name);
  }
  const ordered = copy([...requests]).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const target = identity(await connection.identity());
  const prerequisites = await connection.modules.inspectPrerequisites(ordered.map(request => request.name), { context: options.context });
  if (!prerequisites.closureComplete || prerequisites.diagnostics.length || prerequisites.cycleEdges.length || prerequisites.modules.some(module => !['installed', 'uninstalled'].includes(module.status))) fail('ADDON_PREREQUISITES', 'Addon preview requires complete acyclic installed/uninstalled dependency facts');
  for (const request of ordered) {
    const module = prerequisites.modules.find(module => module.name === request.name);
    if (!module || (request.action === 'upgrade' && module.status !== 'installed')) fail('ADDON_PREREQUISITES', `${request.name} is missing or not installed for upgrade`);
  }
  const body: Omit<ModulePlan, 'digest'> = { kind: 'stateman-module-plan', version: 1, target, requests: ordered, prerequisites: copy(prerequisites), options: copy(options), catalogRevision: connection.modules.catalogRevision };
  return { ...body, digest: digest(body) };
}

export async function applyModules(reviewed: ModulePlan, connection: ModuleStageConnection): Promise<ModuleStageResult> {
  if (reviewed?.kind !== 'stateman-module-plan' || reviewed.version !== 1) fail('INVALID_MODULE_PLAN', 'Apply needs a reviewed addon plan');
  const { digest: checksum, ...body } = reviewed;
  if (digest(body) !== checksum) fail('PLAN_MODIFIED', 'Addon plan changed after review');
  const original = copy(reviewed);
  const fresh = await planModules(connection, original.requests, original.options);
  if (fresh.digest !== original.digest) fail('STALE_MODULE_PLAN', 'Addon target or prerequisite state changed; review a fresh preview');
  const results: ModuleStageResult['results'] = [];
  let requiresReplan = false;
  let failed = false;
  for (const request of original.requests) {
    if (failed) { results.push({ request, status: 'skipped' }); continue; }
    const revision = connection.modules.catalogRevision;
    const result: ModuleStageResult['results'][number] = { request, status: 'committed' };
    try {
      if (!equal(identity(await connection.identity()), original.target)) fail('TARGET_CHANGED', 'Authenticated target changed during addon stage');
      result.result = await (request.action === 'install' ? connection.modules.installModule(request.name, original.options) : connection.modules.upgradeModule(request.name, original.options));
      if (result.result.name !== request.name || result.result.state !== 'installed') fail('ADDON_POSTCONDITION', `${request.name} did not reach installed state`);
    } catch (error) { result.error = error; result.status = 'failed'; }
    finally {
      if (connection.modules.catalogRevision !== revision) {
        requiresReplan = true;
        try { await connection.invalidateSchema(); }
        catch (error) { result.invalidationError = error; result.status = 'failed'; }
      }
    }
    results.push(result);
    failed = result.status === 'failed';
  }
  return { ok: !failed, requiresReplan, results };
}
