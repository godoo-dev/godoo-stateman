import { isResourceRef } from './dsl/types.js';
import { digest, equal } from './state-utils.js';
import { equivalentHtml } from './html-equivalence.js';
import type { FieldMetadata } from './state-types.js';

export const multiple = (field: FieldMetadata): boolean => ['one2many', 'many2many'].includes(field.type);
export const sortedIds = (value: unknown): number[] => Array.isArray(value) ? [...new Set(value as number[])].sort((a, b) => a - b) : [];

export function normalized(value: unknown, field: FieldMetadata): unknown {
  if (field.type === 'many2one') return Array.isArray(value) ? value[0] : value === null ? false : value;
  if (field.type === 'reference' && value === null) return false;
  if (multiple(field)) return sortedIds(value);
  return value;
}
export function companyScalar(value: unknown, field: FieldMetadata): boolean {
  if (field.type === 'many2one') return value === false || typeof value === 'number' || isResourceRef(value);
  if (field.type === 'boolean') return typeof value === 'boolean';
  if (field.type === 'integer') return typeof value === 'number' && Number.isSafeInteger(value);
  if (['float', 'monetary'].includes(field.type)) return typeof value === 'number' && Number.isFinite(value);
  return value === false || typeof value === 'string';
}
export function fieldEqual(a: unknown, b: unknown, field: FieldMetadata): boolean {
  return field.type === 'html' && typeof a === 'string' && typeof b === 'string'
    ? equivalentHtml(a, b) : equal(normalized(a, field), normalized(b, field));
}

export const exactKey = (id: string, name: string): string => digest({ id, name });
export const translationKey = (id: string, field: string, lang: string): string => digest({ id, field, lang });
