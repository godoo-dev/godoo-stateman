import type { LookupRef, ResourceDefinition, ResourceRef } from './types.js';

export type RelationTarget = number | LookupRef | ResourceRef | ResourceDefinition;
export interface ExactRelation {
  readonly __type: 'exact';
  readonly targets: readonly RelationTarget[];
}
export interface CompanyValue {
  /** An existing authorized res.company; managed refs must resolve before writes. */
  readonly company: RelationTarget;
  readonly value: unknown;
}
export interface CompanyValues {
  readonly __type: 'companyValues';
  readonly entries: readonly CompanyValue[];
}

/** Own M2M membership within the explicitly validated authorized-company scope. */
export function exact(targets: readonly RelationTarget[]): ExactRelation {
  return Object.freeze({ __type: 'exact', targets: Object.freeze([...targets]) });
}

/** Manage effective company-dependent values; omitted companies are unmanaged. */
export function companyValues(entries: readonly CompanyValue[]): CompanyValues {
  return Object.freeze({ __type: 'companyValues', entries: Object.freeze(entries.map(entry => Object.freeze({ ...entry }))) });
}
export function isExact(value: unknown): value is ExactRelation {
  return !!value && typeof value === 'object' && (value as ExactRelation).__type === 'exact';
}
export function isCompanyValues(value: unknown): value is CompanyValues {
  return !!value && typeof value === 'object' && (value as CompanyValues).__type === 'companyValues';
}
