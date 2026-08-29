// Content-block builders. These are the vocabulary every subject file is
// written in, so the visual language stays identical across all three (and will
// stay identical for the major-exam subjects added later).
//
// Nothing here escapes its input. The content is authored by me, in these data
// files, not taken from a user or the network — so the strings are trusted and
// may contain intentional inline markup (<b>, <code>). If this ever renders
// third-party text, that assumption breaks and these need escaping.

export const card = (o) => {
  const tags = (o.tags || []).map(t => {
    const cls = t === 'high-yield' ? 't-hi' : t === 'added' ? 't-add' : t === 'past-paper' ? 't-past' : '';
    const label = t === 'high-yield' ? '★ high yield' : t === 'added' ? '+ added' : t === 'past-paper' ? 'past paper' : t;
    return `<span class="tag ${cls}">${label}</span>`;
  }).join('');
  const cram = o.cram ? ' no-cram' : '';   // 'cram:false' → hide the whole card in cram mode
  const cls = o.cramOnly ? 'card' + cram : 'card' + cram;
  return `<div class="${cls}">
  <h3>${o.n ? `<span class="n">${o.n}</span>` : ''}${o.title}${tags}</h3>
  ${o.body}
</div>`;
};

export const def = (label, html) => `<div class="def"><b>${label}</b>${html}</div>`;
export const edge = (html, label = 'Extra marks') => `<div class="edge"><b>${label}</b>${html}</div>`;
export const trap = (html, label = 'Exam trap') => `<div class="trap"><b>${label}</b>${html}</div>`;
export const ask = (html, label = 'Likely question') => `<div class="ask"><b>${label}</b>${html}</div>`;

export const ul = (items) => `<ul>${items.map(i => `<li>${i}</li>`).join('')}</ul>`;
export const ol = (items) => `<ol>${items.map(i => `<li>${i}</li>`).join('')}</ol>`;
export const p = (...xs) => xs.map(x => `<p>${x}</p>`).join('');

/** A table. head = array of column names, rows = array of arrays. */
export const table = (head, rows) => `<div class="tw"><table>
  <thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead>
  <tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>
</table></div>`;

/** Code block. Pass already-highlighted HTML (use the span helpers) or plain text. */
export const code = (html) => `<pre><code>${html}</code></pre>`;
export const cm = (s) => `<span class="cm">${s}</span>`;   // comment
export const kw = (s) => `<span class="kw">${s}</span>`;    // keyword
export const st = (s) => `<span class="st">${s}</span>`;    // string
export const fn = (s) => `<span class="fn">${s}</span>`;    // function name

export const fig = (svg, caption) => `<figure>${svg}${caption ? `<figcaption>${caption}</figcaption>` : ''}</figure>`;
