// Adapted from Marc Fargas, odoo-toolbox at 01512004814df8887a457e5ed9d6c5769fe3b730.
// SPDX-License-Identifier: LGPL-3.0-only. See NOTICE.md.
export { lookup } from './lookup.js';
export { resource } from './resource.js';
export { model } from './model.js';
export { children, isChildrenRef } from './children.js';
export type { ChildrenRef } from './children.js';
export * from './types.js';
export { md, mdFile, translated, withCss, html } from './markers.js';
export type {
  MdMarker,
  MdFileMarker,
  TranslatedMarker,
  CssMarker,
  HtmlMarker,
  ContentMarker,
} from './markers.js';
export {
  isMdMarker,
  isMdFileMarker,
  isTranslatedMarker,
  isCssMarker,
  isHtmlMarker,
  isContentMarker,
} from './markers.js';
