import { lookup, resource } from '@godoo-dev/stateman';
import { buildCode } from './helpers/build-code.js';
export const cron = resource('ir.cron', 'example.example_cron', {
  name: 'Example inactive automation', active: false, interval_number: 1, interval_type: 'days',
  model_id: lookup('ir.model', { model: 'ir.actions.server' }),
  ir_actions_server_id: resource('ir.actions.server', 'action', {
    name: 'Example action', state: 'code', code: buildCode(new URL('./action.py', import.meta.url)),
  }),
});
