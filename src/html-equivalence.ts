// SPDX-License-Identifier: LGPL-3.0-only

const voidElements = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const rawElements = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'plaintext']);
const attributes = /^(?:\s+[A-Za-z_:][A-Za-z0-9_.:-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*\s*$/;

interface Scan { source: string; offset: number; result: string[]; stack: string[]; balanced: boolean }

/** A lexical comparison key, deliberately without DOM parsing or error recovery. */
function storageKey(source: string): string | undefined {
  const scan: Scan = { source, offset: 0, result: [], stack: [], balanced: true };
  while (scan.offset < source.length) {
    const step = source[scan.offset] !== '<' ? scanText(scan)
      : source.startsWith('<!--', scan.offset) ? scanComment(scan)
      : scanTail(scan) ?? scanTag(scan);
    if (step === 'invalid') return undefined;
    if (step === 'done') break;
  }
  return scan.result.join('');
}

type Step = 'next' | 'done' | 'invalid';
function scanText(scan: Scan): Step {
  const end = scan.source.indexOf('<', scan.offset);
  const text = scan.source.slice(scan.offset, end < 0 ? scan.source.length : end);
  // Do not mistake markup inside a text expression for a real element.
  // Attribute expressions are consumed intact by the quoted-tag scanner.
  if (/\{\{|#\{|\$\{/.test(text)) return 'invalid';
  scan.result.push(text); scan.offset += text.length;
  return 'next';
}
function scanComment(scan: Scan): Step {
  const end = scan.source.indexOf('-->', scan.offset + 4);
  if (end < 0) return 'invalid';
  scan.result.push(scan.source.slice(scan.offset, end + 3)); scan.offset = end + 3;
  return 'next';
}
// Observed Odoo 18 EOF completion: only an empty final p with one
// double-quoted literal style. No expressions, URLs or other truncation.
function scanTail(scan: Scan): Step | undefined {
  const tail = scan.source.slice(scan.offset).match(/^<p style="([A-Za-z0-9 .:;#%_+-]*)$/);
  if (!tail || tail[0].length !== scan.source.length - scan.offset || !scan.balanced || scan.stack.length !== 0) return undefined;
  scan.result.push(`<p style="${tail[1]}"/>`);
  return 'done';
}
function scanTag(scan: Scan): Step {
  const { source, offset } = scan;
  const head = source.slice(offset).match(/^<(\/?)([a-z][a-z0-9:-]*)(?=[\s/>])/);
  if (!head || rawElements.has(head[2])) return 'invalid';
  const end = tagEnd(source, offset + head[0].length);
  if (end === undefined) return 'invalid';
  const raw = source.slice(offset, end + 1), name = head[2];
  const closing = head[1] === '/', selfClosing = !closing && raw.endsWith('/>');
  const attrs = source.slice(offset + head[0].length, end - (selfClosing ? 1 : 0));
  if (closing ? attrs !== '' : !attributes.test(attrs)) return 'invalid';
  if (closing) {
    if (scan.stack.pop() !== name) scan.balanced = false;
    scan.result.push(raw);
  } else {
    if (!selfClosing && !voidElements.has(name)) scan.stack.push(name);
    scan.result.push(openingTag(raw, name, selfClosing));
  }
  scan.offset = end + 1;
  return 'next';
}
/** Index of the closing '>' outside quotes, or undefined for unterminated or nested markup. */
function tagEnd(source: string, start: number): number | undefined {
  let quote = '';
  for (let end = start; end < source.length; end++) {
    const char = source[end];
    if (quote) { if (char === quote) quote = ''; }
    else if (char === '"' || char === "'") quote = char;
    else if (char === '>') return end;
    else if (char === '<') return undefined;
  }
  return undefined;
}
function openingTag(raw: string, name: string, selfClosing: boolean): string {
  if (selfClosing && voidElements.has(name)) return raw.slice(0, -2) + '>';
  if (selfClosing && name === 't') return raw.slice(0, -2) + '></t>';
  return raw;
}

/**
 * Compare HTML using bounded Odoo 18 storage serialization rules. Text,
 * whitespace, entities and attributes stay exact; unsupported syntax falls
 * back to exact equality. This neither renders nor sanitizes either input.
 */
export function equivalentHtml(a: string, b: string): boolean {
  if (a === b) return true;
  const left = storageKey(a), right = storageKey(b);
  return left !== undefined && right !== undefined && left === right;
}
