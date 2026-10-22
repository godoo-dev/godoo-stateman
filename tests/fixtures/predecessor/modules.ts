// Adapted from Marc Fargas, odoo-toolbox at 01512004814df8887a457e5ed9d6c5769fe3b730.
// SPDX-License-Identifier: LGPL-3.0-only. See NOTICE.md.
import { resource } from '../../../src/dsl/index.js';
export default ['project', 'sale'].map((name) => resource('ir.module.module', { name }));
