import type { OdooClient } from '@godoo-dev/client';
import { Introspector } from '@godoo-dev/introspection';

/** Bind the selected godoo libraries to an already supplied client.
 * Construction makes no RPC calls, loads no credentials and authenticates nothing.
 * This is a schema seam for future planning, not prerequisite or target validation.
 */
export function createSchemaContext(client: OdooClient): { client: OdooClient; introspector: Introspector } {
  return { client, introspector: new Introspector(client) };
}
