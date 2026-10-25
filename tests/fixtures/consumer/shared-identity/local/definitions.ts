import { children, resource } from '@godoo-dev/stateman';
export const ready = resource('stage', 'ready', { name: 'Ready' });
export const zProject = resource('project', 'fixture.project', {
  stages: children('stage', 'project_ids', [ready]),
  default_stage_id: ready,
});
