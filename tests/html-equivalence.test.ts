import { describe, expect, it } from 'vitest';
import { apply, equivalentHtml, plan, resource, translated } from '../src/index.js';
import type { Row } from '../src/index.js';
import { FakeClient } from './fake-client.js';

describe('bounded HTML storage comparison', () => {
  it.each([
    ['<p>A<br>B<img src="/a?x=1&amp;y=2"></p>', '<p>A<br/>B<img src="/a?x=1&amp;y=2"/></p>'],
    ['<t t-set="partner" t-value="object.partner_id"></t>\n<br>', '<t t-set="partner" t-value="object.partner_id"/>\n<br/>'],
    ['<p>End</p><p style="margin:0px 0 16px 0', '<p>End</p><p style="margin:0px 0 16px 0"/>'],
    ['<p>End</p><p style="ma', '<p>End</p><p style="ma"/>'],
    ['<a t-att-href="\'/?q=%s\' % object.name" title="x > y"><br></a>', '<a t-att-href="\'/?q=%s\' % object.name" title="x > y"><br/></a>'],
  ])('accepts only storage syntax changes: %s', (before, after) => {
    expect(equivalentHtml(before, after)).toBe(true);
    expect(equivalentHtml(after, before)).toBe(true);
  });

  it.each([
    ['<p>A B<br></p>', '<p>AB<br/></p>'],
    ['<p>A\nB<br></p>', '<p>A B<br/></p>'],
    ['<p>&nbsp;<br></p>', '<p> <br/></p>'],
    ['<p>&amp;<br></p>', '<p>&#38;<br/></p>'],
    ['<pre>A  B<br></pre>', '<pre>A B<br/></pre>'],
    ['<t t-out="object.name"></t>', '<t t-out="object.email"/>'],
    ['<t t-if="object.active">A</t>', '<t t-if="object.active"/>'],
    ['<a href="/a"><br></a>', '<a href="/b"><br/></a>'],
    ['<img alt="A" src="/a">', '<img alt="B" src="/a"/>'],
    ['<img alt="A" src="/a">', '<img src="/a" alt="A"/>'],
    ['<p>Hola<br></p>', '<p>Hello<br/></p>'],
    ['<p>A<p>B</p>', '<p>A</p><p>B</p>'],
    ['<div></div>', '<div/>'],
    ['<p style="ma', '<p style="margin:0px"/>'],
    ['<p style="ma\n', '<p style="ma"/>'],
    ['<p style="ma', '<p style="ma">Missing text</p>'],
    ['<p t-out="object.na', '<p t-out="object.na"/>'],
    ['<p style="{{ object.na', '<p style="{{ object.na"/>'],
    ['<p style="url(/a', '<p style="url(/a"/>'],
    ['<p class="x" style="ma', '<p class="x" style="ma"/>'],
    ['<div>Content<p style="ma', '<div>Content<p style="ma"/>'],
    ['<p>Text', '<p>Text</p>'],
    ['<!-- <br> -->', '<!-- <br/> -->'],
    ['<script>"<br>"</script>', '<script>"<br/>"</script>'],
    ['<textarea><br></textarea>', '<textarea><br/></textarea>'],
    ['{{ "<br>" }}', '{{ "<br/>" }}'],
    ['<img src=/a/>', '<img src=/a>'],
  ])('preserves content or refuses unrelated repair: %s', (before, after) => {
    expect(equivalentHtml(before, after)).toBe(false);
    expect(equivalentHtml(after, before)).toBe(false);
    expect(equivalentHtml(before, before)).toBe(true);
  });
});

class TemplateClient extends FakeClient {
  languages = new Map<string, string>();
  writes: { values: Row; lang: unknown }[] = [];
  constructor() {
    super(); this.schema['mail.template'] = { body_html: { type: 'html' }, subject: { type: 'char' } };
  }
  override async searchRead(model: string, criteria: any[] = [], options: { fields?: string[]; limit?: number; context?: Row } = {}): Promise<Row[]> {
    const rows = await super.searchRead(model, criteria, options);
    const language = options.context?.lang;
    if (model === 'mail.template' && typeof language === 'string' && options.fields?.includes('body_html')) {
      for (const row of rows) row.body_html = this.languages.get(language) ?? row.body_html;
    }
    return rows;
  }
  override async write(model: string, ids: number | number[], values: Row, context?: Row): Promise<boolean> {
    if (model !== 'mail.template') return super.write(model, ids, values);
    this.writes.push({ values: structuredClone(values), lang: context?.lang });
    // Independent fixed write/read fixture, not the comparison implementation.
    const observed: Row = { ...values };
    if (values.body_html === '<p>Updated<br></p>') observed.body_html = '<p>Updated<br/></p>';
    if (typeof context?.lang === 'string') {
      this.languages.set(context.lang, observed.body_html as string); return true;
    }
    return super.write(model, ids, observed);
  }
}

describe('HTML reconciliation through planning and apply', () => {
  it('uses the same bounded comparison for base and separate fresh language reads', async () => {
    const client = new TemplateClient();
    client.seed('mail.template', { body_html: '<p>Base<br/></p>', subject: 'Subject<br/>' }, 'test.mail');
    client.languages.set('ca_ES', '<p>Català<br/></p>'); client.languages.set('en_GB', '<p>English<br/></p>');
    const definitions = [resource('mail.template', 'test.mail', {
      body_html: translated('<p>Base<br></p>', { ca_ES: '<p>Català<br></p>', en_GB: '<p>English<br></p>' }),
      subject: 'Subject<br>',
    })];
    const options = { context: { lang: false } }, connection = client.connection();
    const first = await plan(definitions, connection, options);
    expect(first.operations.map(op => op.values)).toEqual([{ subject: 'Subject<br>' }]);
    expect((await apply(first, connection)).ok).toBe(true);
    client.languages.set('en_GB', '<p>Català<br/></p>');
    const changed = await plan(definitions, connection, options);
    expect(changed.operations).toHaveLength(2);
    expect(changed.operations[0]).toMatchObject({ values: { body_html: '<p>English<br></p>' }, context: { lang: 'en_GB' } });
    expect(changed.operations[1]).toMatchObject({ key: 'test.mail:translation-defaults', values: { body_html: '<p>Base<br></p>' }, context: { lang: false } });
    expect((await apply(changed, connection)).ok).toBe(true);
    expect(client.languages.get('ca_ES')).toBe('<p>Català<br/></p>');
  });

  it('writes authored bytes and converges; a second apply commits nothing', async () => {
    const client = new TemplateClient(); client.seed('mail.template', { body_html: '<p>Old</p>' }, 'test.mail');
    const definitions = [resource('mail.template', 'test.mail', { body_html: '<p>Updated<br></p>' })];
    const connection = client.connection(), first = await plan(definitions, connection);
    expect(first.input.resources[0].values.body_html).toBe('<p>Updated<br></p>');
    expect((await apply(first, connection)).ok).toBe(true);
    expect(client.writes[0].values.body_html).toBe('<p>Updated<br></p>');
    const again = await apply(await plan(definitions, connection), connection);
    expect(again.ok).toBe(true); expect(again.committed).toBe(0); expect(client.writes).toHaveLength(1);
  });

  it.each([false, 'en_GB'])('keeps exact observed HTML in stale-plan validation (lang %s)', async language => {
    const client = new TemplateClient();
    const id = client.seed('mail.template', { body_html: '<p>Base<br></p>' }, 'test.mail');
    client.languages.set('en_GB', '<p>English<br></p>');
    const definitions = [resource('mail.template', 'test.mail', { body_html: translated('<p>Base<br/></p>', { en_GB: '<p>English<br/></p>' }) })];
    const connection = client.connection(), options = { context: { lang: false } };
    const reviewed = await plan(definitions, connection, options);
    expect(reviewed.operations).toEqual([]);
    if (typeof language === 'string') client.languages.set(language, '<p>English<br/></p>');
    else client.data['mail.template'].find(row => row.id === id)!.body_html = '<p>Base<br/></p>';
    const fresh = await plan(definitions, connection, options);
    expect(fresh.operations).toEqual([]); expect(fresh.digest).not.toBe(reviewed.digest);
    await expect(apply(reviewed, connection)).rejects.toMatchObject({ code: 'STALE_PLAN' });
    expect(client.writes).toEqual([]);
  });
});
