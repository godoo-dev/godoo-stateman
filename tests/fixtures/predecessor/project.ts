// Adapted from Marc Fargas, odoo-toolbox at 01512004814df8887a457e5ed9d6c5769fe3b730.
// SPDX-License-Identifier: LGPL-3.0-only. See NOTICE.md.
import { resource, lookup } from '../../../src/dsl/index.js';
const marc = lookup('res.users', { email: 'marc@example.com' });
export const censos = resource('project.project', {
  _ref: lookup('project.project', { name: 'Censos' }),
  name: 'Censos',
  user_id: marc,
});
