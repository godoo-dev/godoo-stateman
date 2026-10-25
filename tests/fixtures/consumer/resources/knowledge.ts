import { fileURLToPath } from 'node:url';
import { lookup, mdFile, resource } from '@godoo-dev/stateman';
export const category = resource('document.page', 'example.example_category', { name: 'Example category', type: 'category' });
export const tags = ['ES', 'EN'].map(lang => resource('document.page.tag', `example.example_tag_${lang.toLowerCase()}`, { name: lang }));
export const articles = ['es', 'en'].map(lang => resource('document.page', `example.example_guide_${lang}`, {
  name: `Example guide (${lang})`, parent_id: category,
  content: mdFile(fileURLToPath(new URL('./content/guide.md', import.meta.url))),
  tag_ids: [lookup('document.page.tag', { name: lang }), tags[0]],
}));
export default [[category], tags, [articles]];
