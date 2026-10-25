import type { OdooClient } from '@godoo-dev/client';
import { Introspector } from '@godoo-dev/introspection';
import type { StateConnection } from './state-types.js';
import { fail, identity } from './state-utils.js';

/** Bind the selected godoo libraries to an already supplied client.
 * Construction makes no RPC calls, loads no credentials and authenticates nothing.
 * This is a schema seam for future planning, not prerequisite or target validation.
 */
export function createSchemaContext(client: OdooClient): { client: OdooClient; introspector: Introspector } {
  return { client, introspector: new Introspector(client) };
}

/** Bind an already authenticated direct client. URL must be that client's endpoint;
 * old client versions do not expose config, so the caller owns this binding.
 * Never authenticates, changes safety settings or reads credential files.
 */
export function createConnection(client: OdooClient, options: { url: string; serverInfo?: StateConnection['serverInfo']; inspectAddons?: StateConnection['inspectAddons'] }): StateConnection {
  return {
    client,
    async identity() {
      const session = client.getSession();
      if (!session) fail('NOT_AUTHENTICATED', 'Supply an already authenticated client');
      return identity({ url: options.url, database: session.db, uid: session.uid });
    },
    serverInfo: options.serverInfo ?? (async () => {
      const endpoint = new URL(options.url);
      endpoint.username = ''; endpoint.password = ''; endpoint.search = ''; endpoint.hash = '';
      endpoint.pathname = `${endpoint.pathname.replace(/\/$/, '')}/web/webclient/version_info`;
      const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: {}, id: 1 }), signal: AbortSignal.timeout(15000), redirect: 'error' });
      if (!response.ok) fail('VERSION_UNKNOWN', `Server version read failed with HTTP ${response.status}`);
      const body = await response.json() as { result?: { server_version?: string }; error?: unknown };
      if (body.error || !body.result?.server_version) fail('VERSION_UNKNOWN', 'Server did not expose read-only version metadata');
      return { version: body.result.server_version };
    }),
    ...(options.inspectAddons ? { inspectAddons: options.inspectAddons } : {}),
  };
}
