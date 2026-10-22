import { resource } from '@godoo-dev/stateman';
import { ready } from './definitions.js';
export { ready as readyAlias } from './definitions.js';
export const aTask = resource('task', 'fixture.task', { stage_id: ready, stages: [ready] });
