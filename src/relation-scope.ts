import { assertId, equal, fail, record } from './state-utils.js';
import type { FieldMetadata, Row } from './state-types.js';

export type ObservedSearch = (model: string, domain: any[], fields: string[], limit?: number, context?: Row) => Promise<Row[]>;

/** Conservative read-only audit: arbitrary record rules cannot prove exact membership.
 * Odoo 18 Many2many.read applies target rules and field domains. The caller
 * audits numeric-ID membership independently of the filtered field read.
 */
export async function validateExactScope(field: FieldMetadata, context: Row, userId: number, search: ObservedSearch, source: { externalId: string; model: string; field: string; major: number }): Promise<number[]> {
  if (field.type !== 'many2many' || !field.relation || field.readonly || field.store !== true || field.company_dependent) fail('EXACT_UNSUPPORTED', 'exact() requires a writable stored ordinary M2M field');
  if (field.context && !record(field.context)) fail('EXACT_VISIBILITY', `${source.externalId} (${source.model}.${source.field}): unsupported non-object relation field context`);
  if (field.context && Object.keys(field.context).length) {
    // Odoo 18 core account.tax uses this flag only in _compute_display_name.
    // Qualify the complete source/target tuple and exact value, never the key
    // alone. Metadata stays in schema observations for stale-plan validation.
    const standardDisplay = source.major === 18 && source.model === 'account.account' && source.field === 'tax_ids'
      && field.relation === 'account.tax' && Object.keys(field.context).length === 1 && field.context.append_type_to_tax_name === true;
    if (!standardDisplay) {
      // Report keys and the supported display flag's scalar value, not arbitrary
      // context payloads (which can contain private application data).
      const details = Object.keys(field.context).sort().map(key => `${key}=${key === 'append_type_to_tax_name' && ['boolean', 'number'].includes(typeof field.context![key]) ? String(field.context![key]) : '<redacted>'}`).join(', ');
      fail('EXACT_VISIBILITY', `${source.externalId} (${source.model}.${source.field}): unsupported relation field context {${details}}; only Odoo 18 account.account.tax_ids -> account.tax with exactly append_type_to_tax_name=true is qualified`);
    }
  }
  if ('force_company' in context || 'company_id' in context) fail('EXACT_VISIBILITY', 'exact() requires allowed_company_ids without competing company context keys');
  const companies = context.allowed_company_ids;
  if (!Array.isArray(companies) || !companies.length) fail('EXACT_VISIBILITY', 'exact() requires explicit context.allowed_company_ids containing all authorized companies');
  companies.forEach(id => assertId(id, 'Exact company scope'));
  if (new Set(companies).size !== companies.length) fail('EXACT_VISIBILITY', 'Duplicate allowed_company_ids');
  const users = await search('res.users', [['id', '=', userId]], ['company_ids']);
  const authorized = users[0]?.company_ids;
  if (users.length !== 1 || !Array.isArray(authorized) || !equal([...companies].sort((a, b) => a - b), [...authorized].sort((a, b) => a - b))) fail('EXACT_VISIBILITY', 'exact() requires the complete authorized company set, not a company-filtered subset');
  const visible = await search('res.company', [['id', 'in', companies]], []);
  if (visible.length !== companies.length) fail('EXACT_VISIBILITY', 'Exact company scope contains missing or inaccessible companies');
  // Audit all read rules, including group rules. Rejecting an irrelevant custom
  // group rule is conservative; silently missing a relevant rule is unsafe.
  const rules = await search('ir.rule', [['model_id.model', '=', field.relation], ['active', '=', true], ['perm_read', '=', true]], ['name', 'domain_force']);
  for (const rule of rules) {
    if (!completeCompanyRule(rule.domain_force, field.relation)) fail('EXACT_VISIBILITY', `Cannot prove complete relation visibility under rule ${String(rule.name)} on ${field.relation}`);
  }
  return [...companies].sort((a, b) => a - b);
}

function completeCompanyRule(value: unknown, relation?: string): boolean {
  if (typeof value !== 'string') return false;
  const expression = value.replace(/\s/g, '').replace(/"/g, "'");
  if (['[]', "[(1,'=',1)]"].includes(expression)) return true;
  // Core res.company rules expose exactly the fully authorized set audited above.
  if (relation === 'res.company' && expression === "[('id','in',company_ids)]") return true;
  // Core accounting uses parent_of: every authorized company is included, plus
  // ancestors. The caller preserves any ancestor outside the explicit scope.
  return ['in', 'parent_of'].some(operator => {
    const company = `('company_id','${operator}',company_ids)`;
    return [`[${company}]`, `['|',('company_id','=',False),${company}]`, `['|',${company},('company_id','=',False)]`].includes(expression);
  });
}
