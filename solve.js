// SPDX-License-Identifier: MIT
// makefun-site 1.0.0 drop-in, written from the competition spec (README) alone.
// build(input) returns the output tree makefun-site 1.0.0 returns for the site.

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function esc(s) {
  if (!/[&<>"']/.test(s)) return s;
  return s.replace(/[&<>"']/g, (c) => ESC_MAP[c]);
}

function slugify(text) {
  let s = text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  s = s.replace(/[^a-z0-9]+/g, '-');
  s = s.replace(/^-+|-+$/g, '');
  if (s.length > 64) {
    s = s.slice(0, 64);
    if (s.endsWith('-')) s = s.slice(0, -1);
  }
  return s === '' ? 'untitled' : s;
}

function dateLong(ds) {
  const day = parseInt(ds.slice(8, 10), 10);
  const month = parseInt(ds.slice(5, 7), 10);
  return day + ' ' + MONTHS[month - 1] + ' ' + ds.slice(0, 4);
}

function isRealDay(y, mo, d) {
  if (mo < 1 || mo > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const dim = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
  return d <= dim;
}

function dirOf(path) {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

// ---------- front matter ----------

const FM_KEYS = new Set(['title', 'summary', 'date', 'tags', 'draft', 'layout', 'slug']);

function parseFmValue(k, v) {
  if (k === 'title' || k === 'summary') {
    if (v[0] === '"') {
      const m = /^"((?:\\["\\]|[^"\\])*)"$/.exec(v);
      if (!m) return { error: 'key "' + k + '": a quoted string is not closed' };
      return { value: m[1].replace(/\\(["\\])/g, '$1') };
    }
    if (v[0] === '[') return { error: 'key "' + k + '": a bare string opens on [' };
    return { value: v };
  }
  if (k === 'date') {
    const bad = { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return bad;
    const y = +v.slice(0, 4);
    const mo = +v.slice(5, 7);
    const d = +v.slice(8, 10);
    if (!isRealDay(y, mo, d)) return bad;
    if (v < '1970-01-01' || v > '2099-12-31') return bad;
    return { value: v };
  }
  if (k === 'tags') {
    if (v[0] !== '[' || v[v.length - 1] !== ']') return { error: 'key "tags": not a list [a, b]' };
    const inner = v.slice(1, -1);
    if (inner === '') return { value: [] };
    const names = inner.split(',').map((s) => s.trim());
    for (const n of names) {
      if (n === '' || n.includes('"') || n.includes('[') || n.includes(']')) {
        return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
      }
    }
    return { value: names };
  }
  if (k === 'draft') {
    if (v === 'true') return { value: true };
    if (v === 'false') return { value: false };
    return { error: 'key "draft": true or false' };
  }
  if (k === 'layout') {
    if (!/^[a-z0-9-]+$/.test(v)) return { error: 'key "layout": not a template name' };
    return { value: v };
  }
  if (k === 'slug') {
    if (v.length > 64 || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(v)) {
      return { error: 'key "slug": not a slug' };
    }
    return { value: v };
  }
  return { error: 'unknown key' };
}

function parseFrontMatter(content) {
  const lines = content.split('\n');
  if (lines.length === 0 || lines[0] !== '---') return { error: 'no front matter' };
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') { close = i; break; }
  }
  if (close < 0) return { error: 'the front matter is not closed' };
  const fm = {};
  for (let j = 1; j < close; j++) {
    const line = lines[j];
    if (/^[ \t]*$/.test(line)) continue;
    if (line[0] === '#') continue;
    const m = /^([a-z_]+): ?(.*)$/.exec(line);
    if (!m) return { error: 'line ' + (j + 1) + ' is not "key: value"' };
    const k = m[1];
    const v = m[2].replace(/[ \t]+$/, '');
    if (!FM_KEYS.has(k)) return { error: 'unknown key "' + k + '"' };
    if (Object.prototype.hasOwnProperty.call(fm, k)) {
      return { error: 'key "' + k + '" is given twice' };
    }
    if (v === '') return { error: 'key "' + k + '" has no value' };
    const val = parseFmValue(k, v);
    if (val.error) return { error: val.error };
    fm[k] = val.value;
  }
  if (fm.title === undefined) return { error: 'no title' };
  return { fm, bodyLines: lines.slice(close + 1) };
}

function uniqueSlug(base, used) {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let n = 2;
  while (used.has(base + '-' + n)) n++;
  const s = base + '-' + n;
  used.add(s);
  return s;
}

// ---------- markdown ----------

const ESCAPABLES = new Set(['\\', '`', '*', '_', '[', ']', '(', ')', '#', '+', '-', '.', '!', '>']);
const FENCE_RE = /^```([A-Za-z0-9_+\-]*)[ \t]*$/;
const FENCE_CLOSE_RE = /^```[ \t]*$/;
const HEADING_RE = /^(#{1,6})[ \t]+(.*)$/;
const BREAK_RE = /^---[ \t]*$/;
const BREAK_RE2 = /^\*\*\*[ \t]*$/;
const BLANK_RE = /^[ \t]*$/;

function trimEnds(s) {
  return s.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
}

function resolveLink(target, lx) {
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(target)) return target;
  if (target[0] === '/' || target[0] === '#') return target;
  let pathPart = target;
  let frag = '';
  const hi = target.indexOf('#');
  if (hi >= 0) {
    pathPart = target.slice(0, hi);
    frag = target.slice(hi);
  }
  const parts = lx.sourceDir ? lx.sourceDir.split('/') : [];
  for (const seg of pathPart.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length) parts.pop();
      continue;
    }
    parts.push(seg);
  }
  const resolved = parts.join('/');
  const url = lx.pagesBySource.get(resolved);
  if (url !== undefined) return url + frag;
  if (lx.staticPaths.has(resolved)) return lx.base + '/' + resolved + frag;
  lx.broken.add('broken-link ' + lx.sourcePath + ' -> ' + target);
  return target;
}

function findCodeClose(text, from) {
  for (let j = from; j < text.length; j++) {
    if (text[j] === '\\' && j + 1 < text.length) { j++; continue; }
    if (text[j] === '`') return j;
  }
  return -1;
}

function findStrongClose(text, from) {
  for (let j = from; j < text.length; j++) {
    if (text[j] === '\\' && j + 1 < text.length) { j++; continue; }
    if (text[j] === '*' && text[j + 1] === '*') {
      if (j === from) { j++; continue; }
      return j;
    }
  }
  return -1;
}

function findEmClose(text, from) {
  for (let j = from; j < text.length; j++) {
    if (text[j] === '\\' && j + 1 < text.length) { j++; continue; }
    if (text[j] === '*') {
      // a `**` pair is a strong delimiter, not an emphasis closer: skip it
      if (text[j + 1] === '*') { j++; continue; }
      if (j === from) continue;
      return j;
    }
  }
  return -1;
}

function tryLink(text, i, lx) {
  let j = i + 1;
  while (j < text.length) {
    if (text[j] === '\\' && j + 1 < text.length) { j += 2; continue; }
    if (text[j] === ']') break;
    j++;
  }
  if (j >= text.length || text[j] !== ']') return null;
  if (text[j + 1] !== '(') return null;
  const k = text.indexOf(')', j + 2);
  if (k < 0) return null;
  const target = text.slice(j + 2, k);
  if (target === '' || /\s/.test(target)) return null;
  const label = renderInline(text.slice(i + 1, j), lx);
  const href = resolveLink(target, lx);
  return { html: '<a href="' + esc(href) + '">' + label + '</a>', next: k + 1 };
}

function renderInline(text, lx) {
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    // copy a run of plain text up to the next special char in one go
    let j = n;
    const k1 = text.indexOf('\\', i);
    if (k1 >= 0 && k1 < j) j = k1;
    const k2 = text.indexOf('`', i);
    if (k2 >= 0 && k2 < j) j = k2;
    const k3 = text.indexOf('*', i);
    if (k3 >= 0 && k3 < j) j = k3;
    const k4 = text.indexOf('[', i);
    if (k4 >= 0 && k4 < j) j = k4;
    if (j > i) {
      out += esc(text.slice(i, j));
      i = j;
      continue;
    }
    const c = text[i];
    if (c === '\\' && i + 1 < n && ESCAPABLES.has(text[i + 1])) {
      const ch = text[i + 1];
      out += ch === '>' ? '&gt;' : ch;
      i += 2;
      continue;
    }
    if (c === '`') {
      const j = findCodeClose(text, i + 1);
      if (j > i + 1) {
        out += '<code>' + esc(text.slice(i + 1, j)) + '</code>';
        i = j + 1;
        continue;
      }
      out += '`';
      i++;
      continue;
    }
    if (c === '*' && text[i + 1] === '*') {
      if (!(text[i + 2] === '*' && text[i + 3] === '*')) {
        const j = findStrongClose(text, i + 2);
        if (j >= 0) {
          out += '<strong>' + renderInline(text.slice(i + 2, j), lx) + '</strong>';
          i = j + 2;
          continue;
        }
      }
      // a `**` that does not open strong is itself, both stars at once
      out += '**';
      i += 2;
      continue;
    }
    if (c === '*' && text[i + 1] !== '*') {
      const j = findEmClose(text, i + 1);
      if (j >= 0) {
        out += '<em>' + renderInline(text.slice(i + 1, j), lx) + '</em>';
        i = j + 1;
        continue;
      }
      out += '*';
      i++;
      continue;
    }
    if (c === '[') {
      const r = tryLink(text, i, lx);
      if (r) {
        out += r.html;
        i = r.next;
        continue;
      }
      out += '[';
      i++;
      continue;
    }
    out += ESC_MAP[c] || c;
    i++;
  }
  return out;
}

function renderMarkdown(lines, lx) {
  const blocks = [];
  const toc = [];
  const headingIds = new Set();
  let i = 0;
  const n = lines.length;
  while (i < n) {
    const line = lines[i];
    if (BLANK_RE.test(line)) { i++; continue; }
    let m = FENCE_RE.exec(line);
    if (m) {
      const lang = m[1];
      const buf = [];
      i++;
      while (i < n && !FENCE_CLOSE_RE.test(lines[i])) { buf.push(lines[i]); i++; }
      if (i < n) i++;
      let code = '<pre><code';
      if (lang) code += ' class="language-' + lang + '"';
      code += '>';
      for (const bl of buf) code += esc(bl) + '\n';
      code += '</code></pre>';
      blocks.push({ html: code, isPara: false });
      continue;
    }
    m = HEADING_RE.exec(line);
    if (m) {
      const text = m[2].replace(/[ \t]+$/, '');
      if (text !== '') {
        const level = m[1].length;
        const id = uniqueSlug(slugify(text), headingIds);
        const inner = renderInline(text, lx);
        blocks.push({ html: '<h' + level + ' id="' + id + '">' + inner + '</h' + level + '>', isPara: false });
        if (level === 2 || level === 3) toc.push({ level, id, html: inner });
        i++;
        continue;
      }
    }
    if (BREAK_RE.test(line) || BREAK_RE2.test(line)) {
      blocks.push({ html: '<hr>', isPara: false });
      i++;
      continue;
    }
    if (line[0] === '>') {
      const qlines = [];
      while (i < n && lines[i][0] === '>') {
        let t = lines[i].slice(1);
        if (t[0] === ' ') t = t.slice(1);
        t = trimEnds(t);
        if (t !== '') qlines.push(t);
        i++;
      }
      if (qlines.length === 0) {
        blocks.push({ html: '<blockquote>\n</blockquote>', isPara: false });
      } else {
        blocks.push({ html: '<blockquote>\n<p>' + renderInline(qlines.join('\n'), lx) + '</p>\n</blockquote>', isPara: false });
      }
      continue;
    }
    let lm = /^([-*]) (.*)$/.exec(line);
    let ordered = false;
    let startNum = 0;
    if (lm) {
      ordered = false;
    } else {
      lm = /^(\d+)\. (.*)$/.exec(line);
      if (lm) {
        ordered = true;
        startNum = parseInt(lm[1], 10);
      }
    }
    if (lm) {
      const items = [lm[2]];
      i++;
      while (i < n) {
        const l = lines[i];
        let im;
        if (!ordered && (im = /^([-*]) (.*)$/.exec(l))) { items.push(im[2]); i++; continue; }
        if (ordered && (im = /^(\d+)\. (.*)$/.exec(l))) { items.push(im[2]); i++; continue; }
        if (/^ {2,}\S/.test(l)) {
          items[items.length - 1] += '\n' + trimEnds(l);
          i++;
          continue;
        }
        break;
      }
      const open = ordered ? (startNum !== 1 ? '<ol start="' + startNum + '">' : '<ol>') : '<ul>';
      const closeTag = ordered ? '</ol>' : '</ul>';
      let html = open + '\n';
      for (let k = 0; k < items.length; k++) {
        html += '<li>' + renderInline(items[k], lx) + '</li>';
        html += k + 1 < items.length ? '\n' : '\n';
      }
      html += closeTag;
      blocks.push({ html, isPara: false });
      continue;
    }
    const plines = [trimEnds(line)];
    i++;
    while (i < n) {
      const l = lines[i];
      if (BLANK_RE.test(l)) break;
      if (FENCE_RE.test(l)) break;
      const hm = HEADING_RE.exec(l);
      if (hm && hm[2].replace(/[ \t]+$/, '') !== '') break;
      if (BREAK_RE.test(l) || BREAK_RE2.test(l)) break;
      plines.push(trimEnds(l));
      i++;
    }
    const inner = renderInline(plines.join('\n'), lx);
    blocks.push({ html: '<p>' + inner + '</p>', isPara: true, inner });
  }
  let html = '';
  for (const b of blocks) html += b.html + '\n';
  let excerpt = '';
  for (const b of blocks) {
    if (b.isPara) { excerpt = b.inner; break; }
  }
  return { html, toc, excerpt };
}

// ---------- templates ----------

const PATH_RE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;

function isPath(p) {
  return PATH_RE.test(p);
}

function stripTagLines(src) {
  // A {% %} tag alone on its line takes the whole line with it (its \n
  // included) -- the surrounding spaces and the newline go, the tag itself
  // stays and still runs.
  const lines = src.split('\n');
  const parts = [];
  const tagLineRe = /^[ \t]*(\{%(?:[^%]|%(?!\}))*?%\})[ \t]*$/;
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const m = tagLineRe.exec(line);
    if (m) {
      parts.push(m[1]);
    } else {
      parts.push(line);
      if (li < lines.length - 1) parts.push('\n');
    }
  }
  return parts.join('');
}

function parseTag(c) {
  if (c === 'endfor') return { t: 'endfor' };
  if (c === 'endif') return { t: 'endif' };
  if (c === 'else') return { t: 'else' };
  let m = /^for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+(.+)$/.exec(c);
  if (m) {
    const p = m[2].trim();
    if (!isPath(p)) return { error: 'bad path' };
    return { t: 'for', v: m[1], path: p, parts: p.split('.') };
  }
  m = /^if\s+(not\s+)?(.+)$/.exec(c);
  if (m) {
    const p = m[2].trim();
    if (!isPath(p)) return { error: 'bad path' };
    return { t: 'if', neg: !!m[1], path: p, parts: p.split('.') };
  }
  m = /^include\s+"([^"]*)"$/.exec(c);
  if (m) return { t: 'include', name: m[1] };
  if (/^(for|if|include)\b/.test(c)) return { error: 'bad tag' };
  return { error: 'unknown tag' };
}

function tokenize(src) {
  const toks = [];
  let i = 0;
  const n = src.length;
  let textStart = 0;
  while (i < n) {
    if (src.startsWith('{{{', i)) {
      const j = src.indexOf('}}}', i + 3);
      if (j < 0) return { error: 'unclosed tag' };
      if (i > textStart) toks.push({ t: 'text', s: src.slice(textStart, i) });
      const p = src.slice(i + 3, j).trim();
      if (!isPath(p)) return { error: 'bad path' };
      toks.push({ t: 'var', path: p, parts: p.split('.'), raw: true });
      i = j + 3;
      textStart = i;
    } else if (src.startsWith('{{', i)) {
      const j = src.indexOf('}}', i + 2);
      if (j < 0) return { error: 'unclosed tag' };
      if (i > textStart) toks.push({ t: 'text', s: src.slice(textStart, i) });
      const p = src.slice(i + 2, j).trim();
      if (!isPath(p)) return { error: 'bad path' };
      toks.push({ t: 'var', path: p, parts: p.split('.'), raw: false });
      i = j + 2;
      textStart = i;
    } else if (src.startsWith('{%', i)) {
      const j = src.indexOf('%}', i + 2);
      if (j < 0) return { error: 'unclosed tag' };
      if (i > textStart) toks.push({ t: 'text', s: src.slice(textStart, i) });
      const tag = parseTag(src.slice(i + 2, j).trim());
      if (tag.error) return tag;
      toks.push(tag);
      i = j + 2;
      textStart = i;
    } else {
      i++;
    }
  }
  if (textStart < n) toks.push({ t: 'text', s: src.slice(textStart) });
  return { toks };
}

function parseSeq(toks, i, stops) {
  const nodes = [];
  while (i < toks.length) {
    const tk = toks[i];
    if (tk.t === 'endfor' || tk.t === 'endif' || tk.t === 'else') {
      if (stops.indexOf(tk.t) >= 0) return { nodes, i, end: tk.t };
      return { error: 'unexpected ' + tk.t };
    }
    if (tk.t === 'for') {
      const r = parseSeq(toks, i + 1, ['endfor']);
      if (r.error) return r;
      nodes.push({ t: 'for', v: tk.v, path: tk.path, parts: tk.parts, body: r.nodes });
      i = r.i + 1;
      continue;
    }
    if (tk.t === 'if') {
      const r = parseSeq(toks, i + 1, ['else', 'endif']);
      if (r.error) return r;
      let elseBody = null;
      let ni = r.i;
      if (r.end === 'else') {
        const r2 = parseSeq(toks, r.i + 1, ['endif']);
        if (r2.error) return r2;
        elseBody = r2.nodes;
        ni = r2.i;
      }
      nodes.push({ t: 'if', neg: tk.neg, path: tk.path, parts: tk.parts, then: r.nodes, els: elseBody });
      i = ni + 1;
      continue;
    }
    nodes.push(tk);
    i++;
  }
  if (stops.length) {
    return { error: stops[0] === 'endfor' ? 'unclosed for' : 'unclosed if' };
  }
  return { nodes, i, end: null };
}

function parseTemplate(src) {
  const cleaned = stripTagLines(src);
  const tk = tokenize(cleaned);
  if (tk.error) return { error: tk.error };
  const r = parseSeq(tk.toks, 0, []);
  if (r.error) return { error: r.error };
  return { ast: r.nodes };
}

function resolvePath(parts, ctx, frames) {
  const first = parts[0];
  let v;
  let found = false;
  for (let fi = frames.length - 1; fi >= 0; fi--) {
    const fr = frames[fi];
    if (first === 'loop') {
      v = fr.loop;
      found = true;
      break;
    }
    if (Object.prototype.hasOwnProperty.call(fr.vars, first)) {
      v = fr.vars[first];
      found = true;
      break;
    }
  }
  if (!found) {
    if (Object.prototype.hasOwnProperty.call(ctx, first)) v = ctx[first];
    else return undefined;
  }
  for (let pi = 1; pi < parts.length; pi++) {
    if (v === null || v === undefined) return undefined;
    if (!Object.prototype.hasOwnProperty.call(v, parts[pi])) return undefined;
    v = v[parts[pi]];
  }
  return v;
}

function writeValue(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return v.map(writeValue).join(', ');
  return '';
}

function isTruthy(v) {
  if (v === undefined || v === null || v === false || v === '' || v === 0) return false;
  if (Array.isArray(v) && v.length === 0) return false;
  return true;
}

function renderNodes(nodes, ctx, frames, depth, templates, out) {
  for (const nd of nodes) {
    if (nd.t === 'text') {
      out.push(nd.s);
    } else if (nd.t === 'var') {
      const w = writeValue(resolvePath(nd.parts, ctx, frames));
      out.push(nd.raw ? w : esc(w));
    } else if (nd.t === 'for') {
      const arr = resolvePath(nd.parts, ctx, frames);
      if (Array.isArray(arr)) {
        for (let k = 0; k < arr.length; k++) {
          const loop = {
            index: k + 1,
            first: k === 0,
            last: k === arr.length - 1,
            length: arr.length,
          };
          const vars = {};
          vars[nd.v] = arr[k];
          frames.push({ vars, loop });
          renderNodes(nd.body, ctx, frames, depth, templates, out);
          frames.pop();
        }
      }
    } else if (nd.t === 'if') {
      let truthy = isTruthy(resolvePath(nd.parts, ctx, frames));
      if (nd.neg) truthy = !truthy;
      renderNodes(truthy ? nd.then : nd.els || [], ctx, frames, depth, templates, out);
    } else if (nd.t === 'include') {
      if (depth + 1 <= 8 && templates[nd.name]) {
        renderNodes(templates[nd.name], ctx, frames, depth + 1, templates, out);
      }
    }
  }
}

function renderTemplate(ast, ctx, templates) {
  const out = [];
  renderNodes(ast, ctx, [], 0, templates, out);
  return out.join('');
}

// ---------- build ----------

function build(input) {
  const site = input.site;
  const templates = input.templates;
  const files = input.files;
  const base = String(site.base_url).replace(/\/+$/, '');
  const report = [];
  const broken = new Set();

  // 1. sources, sorted by path in code-unit order
  const sorted = files.slice().sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const sources = [];
  const statics = [];
  for (const f of sorted) {
    if (f.path.endsWith('.md')) {
      sources.push({ path: f.path, content: f.content.replace(/\r\n?/g, '\n') });
    } else {
      statics.push(f);
    }
  }

  // 2. templates, parsed in code-unit order of name
  const parsed = {};
  const names = Object.keys(templates).sort();
  for (const name of names) {
    const r = parseTemplate(templates[name]);
    if (r.error) report.push('template "' + name + '": ' + r.error);
    else parsed[name] = r.ast;
  }

  // 3. front matter and checks, in source order
  const pages = [];
  for (const src of sources) {
    const fmRes = parseFrontMatter(src.content);
    if (fmRes.error) {
      report.push('refused ' + src.path + ': ' + fmRes.error);
      continue;
    }
    const fm = fmRes.fm;
    if (src.path.startsWith('tags/')) {
      report.push('refused ' + src.path + ': tags/ is the generator\'s own');
      continue;
    }
    if (src.path.startsWith('page/')) {
      report.push('refused ' + src.path + ': page/ is the generator\'s own');
      continue;
    }
    const isPost = src.path.startsWith('posts/');
    if (isPost && fm.date === undefined) {
      report.push('refused ' + src.path + ': a post needs a date');
      continue;
    }
    const layout = fm.layout !== undefined ? fm.layout : isPost ? 'post' : 'page';
    if (!parsed[layout]) {
      report.push('refused ' + src.path + ': layout "' + layout + '" is no template that parses');
      continue;
    }
    if (fm.draft === true) {
      report.push('draft ' + src.path);
      continue;
    }
    const dir = isPost ? 'posts' : dirOf(src.path);
    pages.push({ sourcePath: src.path, dir, isPost, fm, layout, bodyLines: fmRes.bodyLines });
  }

  // 4. permalinks
  const taken = new Map();
  taken.set('', new Set(['posts', 'tags', 'page']));
  for (const p of pages) {
    let set = taken.get(p.dir);
    if (!set) {
      set = new Set();
      taken.set(p.dir, set);
    }
    const baseSlug = p.fm.slug !== undefined ? p.fm.slug : slugify(p.fm.title);
    p.slug = uniqueSlug(baseSlug, set);
    p.outPath = (p.dir ? p.dir + '/' : '') + p.slug + '/index.html';
    p.url = base + '/' + (p.dir ? p.dir + '/' : '') + p.slug + '/';
  }

  const pagesBySource = new Map();
  for (const p of pages) pagesBySource.set(p.sourcePath, p.url);
  const staticPaths = new Set();
  for (const f of statics) staticPaths.add(f.path);

  // 5. markdown
  for (const p of pages) {
    const lx = {
      sourcePath: p.sourcePath,
      sourceDir: dirOf(p.sourcePath),
      pagesBySource,
      staticPaths,
      base,
      broken,
    };
    const res = renderMarkdown(p.bodyLines, lx);
    p.content = res.html;
    p.toc = res.toc;
    p.excerpt = res.excerpt;
    let wc = 0;
    const wordRe = /\S+/g;
    for (const line of p.bodyLines) {
      wordRe.lastIndex = 0;
      while (wordRe.exec(line) !== null) wc++;
    }
    p.readingMinutes = Math.max(1, Math.ceil(wc / 200));
  }

  // 6. collections
  const posts = pages.filter((p) => p.isPost);
  posts.sort((a, b) => {
    if (a.fm.date !== b.fm.date) return a.fm.date < b.fm.date ? 1 : -1;
    return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  });
  for (let i = 0; i < posts.length; i++) {
    posts[i].newer = i > 0 ? posts[i - 1] : null;
    posts[i].older = i + 1 < posts.length ? posts[i + 1] : null;
  }

  // 7. tags
  const tagMap = new Map();
  for (const post of posts) {
    const seen = new Set();
    const plist = [];
    for (const name of post.fm.tags || []) {
      const s = slugify(name);
      if (seen.has(s)) continue;
      seen.add(s);
      let t = tagMap.get(s);
      if (!t) {
        t = { name, slug: s, url: base + '/tags/' + s + '/', count: 0, posts: [] };
        tagMap.set(s, t);
      }
      t.posts.push(post);
      t.count++;
      plist.push({ name: t.name, slug: s, url: t.url });
    }
    post._tags = plist;
  }
  for (const p of pages) {
    if (p.isPost) continue;
    const seen = new Set();
    const plist = [];
    for (const name of p.fm.tags || []) {
      const s = slugify(name);
      if (seen.has(s)) continue;
      seen.add(s);
      const t = tagMap.get(s);
      plist.push({ name: t ? t.name : name, slug: s, url: t ? t.url : '' });
    }
    p._tags = plist;
  }
  const tags = Array.from(tagMap.values());
  tags.sort((a, b) => {
    if (a.count !== b.count) return b.count - a.count;
    return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  });
  const tagsCtx = tags.map((t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.count }));

  function card(p) {
    if (p._card) return p._card;
    const c = {
      title: p.fm.title,
      url: p.url,
      date: p.fm.date || '',
      date_long: p.fm.date ? dateLong(p.fm.date) : '',
      summary: p.fm.summary || '',
      excerpt: p.excerpt,
      reading_minutes: p.readingMinutes,
      tags: p._tags,
    };
    p._card = c;
    return c;
  }

  function pageCtx(p) {
    const c = card(p);
    const newer = p.isPost && p.newer
      ? {
          title: p.newer.fm.title,
          url: p.newer.url,
          date: p.newer.fm.date || '',
          date_long: p.newer.fm.date ? dateLong(p.newer.fm.date) : '',
        }
      : null;
    const older = p.isPost && p.older
      ? {
          title: p.older.fm.title,
          url: p.older.url,
          date: p.older.fm.date || '',
          date_long: p.older.fm.date ? dateLong(p.older.fm.date) : '',
        }
      : null;
    return {
      title: c.title,
      url: c.url,
      date: c.date,
      date_long: c.date_long,
      summary: c.summary,
      excerpt: c.excerpt,
      reading_minutes: c.reading_minutes,
      tags: c.tags,
      slug: p.slug,
      content: p.content,
      toc: p.toc,
      newer,
      older,
      is_post: p.isPost,
    };
  }

  // 8. layouts
  const out = {};
  let nPages = 0;
  let nPosts = 0;
  let nTags = 0;
  let nStatic = 0;
  const siteCtx = { title: site.title, base_url: base };
  const recent = posts.slice(0, site.recent).map(card);

  for (const p of pages) {
    const ctx = { site: siteCtx, tags: tagsCtx, recent, page: pageCtx(p) };
    out[p.outPath] = renderTemplate(parsed[p.layout], ctx, parsed);
    if (!p.isPost) nPages++;
    if (p.isPost) nPosts++;
  }

  if (parsed['index']) {
    const perPage = site.per_page;
    const totalPages = Math.max(1, Math.ceil(posts.length / perPage));
    for (let k = 1; k <= totalPages; k++) {
      const slice = posts.slice((k - 1) * perPage, k * perPage);
      const pager = {
        number: k,
        total: totalPages,
        url: k === 1 ? base + '/' : base + '/page/' + k + '/',
        newer_url: k > 1 ? (k - 1 === 1 ? base + '/' : base + '/page/' + (k - 1) + '/') : '',
        older_url: k < totalPages ? base + '/page/' + (k + 1) + '/' : '',
      };
      const ctx = { site: siteCtx, tags: tagsCtx, recent, posts: slice.map(card), pager };
      out[k === 1 ? 'index.html' : 'page/' + k + '/index.html'] = renderTemplate(parsed['index'], ctx, parsed);
    }
  }

  if (parsed['tag']) {
    for (const t of tags) {
      const ctx = {
        site: siteCtx,
        tags: tagsCtx,
        recent,
        tag: { name: t.name, slug: t.slug, url: t.url, count: t.count, posts: t.posts.map(card) },
      };
      out['tags/' + t.slug + '/index.html'] = renderTemplate(parsed['tag'], ctx, parsed);
      nTags++;
    }
  }

  if (parsed['tags']) {
    const ctx = { site: siteCtx, tags: tagsCtx, recent };
    out['tags/index.html'] = renderTemplate(parsed['tags'], ctx, parsed);
  }

  for (const f of statics) {
    if (out[f.path] !== undefined) {
      report.push('shadowed ' + f.path + ': a built page has its path');
    } else {
      out[f.path] = f.content;
      nStatic++;
    }
  }

  // 9. report
  const lines = report.slice();
  for (const b of broken) lines.push(b);
  lines.sort();
  lines.push('built ' + nPages + ' pages, ' + nPosts + ' posts, ' + nTags + ' tags and ' + nStatic + ' static files');
  out['build-report.txt'] = lines.map((l) => l + '\n').join('');

  return out;
}

export function run(input) {
  return build(input);
}
