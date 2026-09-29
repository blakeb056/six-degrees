// A small Markdown renderer for the website's blog posts, pages and release notes.
// No dependencies, on purpose: the site builds with nothing but Node. It covers
// what the posts and CHANGELOG.md use, and nothing more:
//
//   # to ####### headings (with an id from their text), paragraphs, blank-line breaks
//   - and 1. lists, nested by two spaces, with continuation lines
//   > block quotes, ``` fenced code, --- rules, | tables |
//   **bold**, *italic*, `code`, [links](url), ![images](src "caption")
//
// Raw HTML is escaped, never passed through: a post can't inject markup or script.

export const escapeHtml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** "What it does, for you!" → "what-it-does-for-you" */
export function slugify(text) {
  return String(text).toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z]+;/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim().replace(/\s+/g, '-').replace(/-+/g, '-');
}

const safeUrl = (url) => (/^(https?:|mailto:|\/|#|\.\.?\/)/i.test(url) || !/^[a-z]+:/i.test(url) ? url : '#');

/** Inline marks, on text that is escaped first. */
export function inline(md) {
  let s = escapeHtml(md);
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g,
    (_, alt, src) => `<img src="${safeUrl(src)}" alt="${alt}" loading="lazy">`);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, url) => `<a href="${safeUrl(url)}">${text}</a>`);
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^\w*])\*(?!\s)(.+?)\*(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)]}</code>`);
  return s;
}

/**
 * Front matter between --- lines: `key: value`, with [a, b] lists. Returns
 * { data, body }. A file without it is all body.
 */
export function frontMatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { data: {}, body: text };
  const data = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if (/^\[.*\]$/.test(v)) v = v.slice(1, -1).split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    else v = v.replace(/^["'](.*)["']$/, '$1');
    data[kv[1]] = v;
  }
  return { data, body: text.slice(m[0].length) };
}

/** The same, for an HTML page whose first thing is a <!-- key: value --> comment. */
export function htmlFrontMatter(text) {
  const m = text.match(/^<!--\n([\s\S]*?)\n-->\n?/);
  if (!m) return { data: {}, body: text };
  return { data: frontMatter(`---\n${m[1]}\n---\n`).data, body: text.slice(m[0].length) };
}

function table(lines) {
  const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  const head = cells(lines[0]);
  const rows = lines.slice(2).map(cells);
  return `<div class="table-wrap prose-table"><table>\n<thead><tr>${head.map((h) => `<th scope="col">${inline(h)}</th>`).join('')}</tr></thead>\n<tbody>\n${
    rows.map((r) => `<tr>${r.map((c, i) => (i === 0 ? `<th scope="row">${inline(c)}</th>` : `<td>${inline(c)}</td>`)).join('')}</tr>`).join('\n')
  }\n</tbody></table></div>`;
}

/**
 * Lists: items start with "- " or "1. " at an indent; deeper indents nest. An
 * item's text, its sub-lists and any later paragraphs stay in their order.
 */
function list(lines, start) {
  const indentOf = (l) => l.match(/^(\s*)/)[1].length;
  const base = indentOf(lines[start]);
  const ordered = /^\s*\d+\.\s/.test(lines[start]);
  const items = [];
  let i = start;
  let gap = false; // a blank line: the next text inside this item is a new paragraph
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) {
      // A blank line inside a list continues it only if an indented line follows.
      const next = lines[i + 1];
      if (next && indentOf(next) > base && next.trim()) { gap = true; i += 1; continue; }
      break;
    }
    const ind = indentOf(l);
    const bullet = l.match(/^\s*(?:[-*]|\d+\.)\s+(.*)$/);
    if (ind === base && bullet) { items.push({ parts: [bullet[1]] }); gap = false; i += 1; continue; }
    if (ind < base || (!bullet && ind === base) || !items.length) break;
    const parts = items.at(-1).parts;
    if (bullet && ind > base) {
      const [html, next] = list(lines, i);
      parts.push({ html });
      gap = false;
      i = next;
      continue;
    }
    if (gap || typeof parts.at(-1) !== 'string') parts.push(l.trim());
    else parts[parts.length - 1] += ` ${l.trim()}`;
    gap = false;
    i += 1;
  }
  const tag = ordered ? 'ol' : 'ul';
  const li = (it) => it.parts.map((p, n) => (typeof p !== 'string' ? p.html : n === 0 ? inline(p) : `<p>${inline(p)}</p>`)).join('');
  const html = `<${tag}>\n${items.map((it) => `<li>${li(it)}</li>`).join('\n')}\n</${tag}>`;
  return [html, i];
}

/**
 * Markdown → HTML. `headingOffset` shifts heading levels (1 makes # an <h2>),
 * `ids` adds an id to each heading.
 */
export function markdown(md, { headingOffset = 0, ids = true } = {}) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i += 1; continue; }
    const fence = l.match(/^```(\w*)/);
    if (fence) {
      const code = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
      i += 1;
      out.push(`<pre><code${fence[1] ? ` class="lang-${fence[1]}"` : ''}>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }
    const h = l.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = Math.min(6, h[1].length + headingOffset);
      const html = inline(h[2]);
      out.push(`<h${level}${ids ? ` id="${slugify(h[2])}"` : ''}>${html}</h${level}>`);
      i += 1;
      continue;
    }
    if (/^(-{3,}|\*{3,})\s*$/.test(l)) { out.push('<hr>'); i += 1; continue; }
    if (/^\s*(?:[-*]|\d+\.)\s+/.test(l)) {
      const [html, next] = list(lines, i);
      out.push(html);
      i = next;
      continue;
    }
    if (/^>\s?/.test(l)) {
      const q = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>${markdown(q.join('\n'), { headingOffset, ids: false })}</blockquote>`);
      continue;
    }
    if (/^\|.*\|\s*$/.test(l) && /^\|?\s*:?-{2,}/.test(lines[i + 1] || '')) {
      const t = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) t.push(lines[i++]);
      out.push(table(t));
      continue;
    }
    const img = l.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)\s*$/);
    if (img) {
      out.push(`<figure><img src="${escapeHtml(safeUrl(img[2]))}" alt="${escapeHtml(img[1])}" loading="lazy">${img[3] ? `<figcaption>${inline(img[3])}</figcaption>` : ''}</figure>`);
      i += 1;
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|>\s?|\s*(?:[-*]|\d+\.)\s+|\|)/.test(lines[i])) para.push(lines[i++].trim());
    if (!para.length) { para.push(lines[i++].trim()); }
    out.push(`<p>${inline(para.join(' '))}</p>`);
  }
  return out.join('\n');
}

/** Plain words from Markdown, for descriptions and feeds. */
export function plainText(md) {
  return md
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(^|[^\w*])\*(?!\s)(.+?)\*(?!\w)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}
