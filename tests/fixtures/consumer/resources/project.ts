import { children, lookup, resource } from '@godoo-dev/stateman';
export const project = resource('project.project', 'example.example_project', {
  _ref: lookup('project.project', { name: 'Example project' }),
  name: 'Example project',
  type_ids: children('project.task.type', 'project_ids', [
    resource('project.task.type', 'ready', { name: 'Ready', sequence: 1 }),
    resource('project.task.type', 'done', { name: 'Done', sequence: 2, fold: true }),
  ]),
});
