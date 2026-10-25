// SPDX-License-Identifier: LGPL-3.0-only

const voidElements = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const rawElements = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'plaintext']);
const attributes = /^(?:\s+[A-Za-z_:][A-Za-z0-9_.:-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*\s*$/;

/** A lexical comparison key, deliberately without DOM parsing or error recovery. */
function storageKey(source: string): string | undefined {
  const result: string[] = [], stack: string[] = [];
  let offset = 0, balanced = true;
  while (offset < source.length) {
    if (source[offset] !== '<') {
      const end = source.indexOf('<', offset);
      const text = source.slice(offset, end < 0 ? source.length : end);
      // Do not mistake markup inside a text expression for a real element.
      // Attribute expressions are consumed intact by the quoted-tag scanner.
      if (/\{\{|#\{|\$\{/.test(text)) return undefined;
      result.push(text); offset += text.length; continue;
    }
    if (source.startsWith('<!--', offset)) {
      const end = source.indexOf('-->', offset + 4);
      if (end < 0) return undefined;
      result.push(source.slice(offset, end + 3)); offset = end + 3; continue;
    }
    // Observed Odoo 18 EOF completion: only an empty final p with one
    // double-quoted literal style. No expressions, URLs or other truncation.
    const tail = source.slice(offset).match(/^<p style="([A-Za-z0-9 .:;#%_+\-]*)$/);
    if (tail && tail[0].length === source.length - offset && balanced && stack.length === 0) {
      result.push(`<p style="${tail[1]}"/>`); break;
    }
    const head = source.slice(offset).match(/^<(\/?)([a-z][a-z0-9:-]*)(?=[\s/>])/);
    if (!head || rawElements.has(head[2])) return undefined;
    let end = offset + head[0].length, quote = '';
    for (; end < source.length; end++) {
      const char = source[end];
      if (quote) { if (char === quote) quote = ''; }
      else if (char === '"' || char === "'") quote = char;
      else if (char === '>') break;
      else if (char === '<') return undefined;
    }
    if (end === source.length || quote) return undefined;
    const raw = source.slice(offset, end + 1), name = head[2];
    const closing = head[1] === '/', selfClosing = !closing && raw.endsWith('/>');
    const attrs = source.slice(offset + head[0].length, end - (selfClosing ? 1 : 0));
    if (closing ? attrs !== '' : !attributes.test(attrs)) return undefined;
    if (closing) {
      if (stack.pop() !== name) balanced = false;
      result.push(raw);
    } else {
      if (!selfClosing && !voidElements.has(name)) stack.push(name);
      if (selfClosing && voidElements.has(name)) result.push(raw.slice(0, -2) + '>');
      else if (selfClosing && name === 't') result.push(raw.slice(0, -2) + '></t>');
      else result.push(raw);
    }
    offset = end + 1;
  }
  return result.join('');
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
