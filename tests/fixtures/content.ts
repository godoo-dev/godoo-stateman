import { md, resource, translated } from '@godoo-dev/stateman';
export const content = resource('fixture.content', 'fixture.content', {
  payload: { sections: [md('# Nested')] },
  title: translated('Example', { es_ES: md('**Ejemplo**') }),
});
