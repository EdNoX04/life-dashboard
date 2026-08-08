// The pure half of the news fetch — parsing and categorising, no network.
//
// Three faults in scripts/daily-brief.mjs put this here, and each is a data
// problem rather than a rendering one. The News tab has always drawn a summary
// when a row carries one; the rows did not carry one.
//
// 1. THE FINANCE TAB WAS EMPTY BY CONSTRUCTION. Nothing anywhere wrote
//    category: 'finance'. Finnhub's general market feed and the "stock market
//    finance" RSS search were both filed under 'stocks', so the Finance filter
//    matched zero rows every single day. The tab was not broken; it was never
//    populated.
//
// 2. RSS ITEMS CARRIED summary: ''. The Google News <description> was never
//    read, so every tech headline arrived with nothing behind it. Google wraps
//    that description in HTML and appends its own "View Full Coverage" anchor,
//    which is why it needs stripping rather than passing through.
//
// 3. THE TICKER WAS SMUGGLED INTO THE TITLE as "[NVDA] Headline". A prefix in a
//    display string is not a field: it cannot be filtered, styled or counted,
//    and it reads as noise in the headline. It is parsed back out here so the
//    UI can show it as what it is.
//
// A fourth thing, less a bug than a mis-sizing: the whole run was capped at 8
// items across four tabs, so a busy day for one category emptied the others.
// Balancing is per-category now.

export const CATEGORIES = ['stocks', 'finance', 'tech'];

const ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
  '&apos;': "'", '&nbsp;': ' ', '&#8217;': '’', '&#8216;': '‘',
  '&#8220;': '“', '&#8221;': '”', '&#8211;': '–', '&#8212;': '—',
};

export function decodeEntities(s) {
  return String(s == null ? '' : s)
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39|#8217|#8216|#8220|#8221|#8211|#8212);/g, m => ENTITIES[m] || m)
    // Numeric escapes beyond the named set above. Done after, so a &amp;#39;
    // double-encoding resolves in the right order.
    .replace(/&#(\d+);/g, (_, d) => {
      const n = Number(d);
      return n > 0 && n < 0x10ffff ? String.fromCodePoint(n) : '';
    });
}

// Decode BEFORE stripping as well as after. Google News double-encodes its
// descriptions - the payload arrives as `&lt;p&gt;text&lt;/p&gt;`, so a single
// strip-then-decode leaves the literal tags sitting in the gist. Decoding first
// turns them back into real tags for the stripper to remove; decoding again
// afterwards catches entities that were only singly encoded.
export function stripHtml(s) {
  const once = decodeEntities(String(s == null ? '' : s).replace(/<!\[CDATA\[|\]\]>/g, ''));
  return decodeEntities(once.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

// Google News packs a <description> full of markup plus a trailing
// "View Full Coverage on Google News" link, and often repeats the headline as
// the first sentence. A gist that restates the title tells the reader nothing,
// so the repetition is dropped rather than shown.
export function cleanSummary(raw, title = '', max = 260) {
  let s = stripHtml(raw);
  s = s.replace(/View Full Coverage on Google News\s*$/i, '').trim();
  const t = stripHtml(title);
  // Only a substantial headline is worth stripping as a repeat. A short title
  // ("Fed") is frequently a legitimate first word of the gist, and lopping it
  // off mangles the sentence rather than de-duplicating it.
  const MIN_REPEAT = 12;
  if (t.length >= MIN_REPEAT && s.toLowerCase().startsWith(t.toLowerCase())) s = s.slice(t.length).trim();
  s = s.replace(/^[-–—·:|,\s]+/, '').trim();
  if (!s) return '';
  if (t && s.toLowerCase() === t.toLowerCase()) return '';
  if (s.length <= max) return s;
  // Cut on a word boundary rather than mid-word, and only fall back to a hard
  // slice when there is no space to cut on.
  const cut = s.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).trim() + '…';
}

// "[NVDA] Nvidia beats" -> { ticker: 'NVDA', title: 'Nvidia beats' }
export function splitTicker(title) {
  const s = String(title == null ? '' : title).trim();
  const m = s.match(/^\[([A-Z][A-Z0-9.\-]{0,6})\]\s*(.+)$/);
  if (!m) return { ticker: null, title: s };
  return { ticker: m[1], title: m[2].trim() };
}

// Google appends " - Reuters" to its titles. Stripping it matters because the
// source is already shown as its own chip, so leaving it duplicates it.
export function stripSourceSuffix(title, source) {
  const t = String(title == null ? '' : title).trim();
  const s = String(source == null ? '' : source).trim();
  if (!s) return t;
  const suffix = ` - ${s}`;
  return t.endsWith(suffix) ? t.slice(0, -suffix.length).trim() : t;
}

const tag = (block, name) => {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? m[1] : '';
};

export function parseRss(xml, category, now = 0) {
  const blocks = String(xml == null ? '' : xml).split('<item>').slice(1);
  const out = [];
  for (const b of blocks) {
    const source = stripHtml(tag(b, 'source'));
    const rawTitle = stripHtml(tag(b, 'title'));
    const url = stripHtml(tag(b, 'link'));
    if (!rawTitle || !url) continue;
    const title = stripSourceSuffix(rawTitle, source);
    const pub = stripHtml(tag(b, 'pubDate'));
    const at = pub ? Date.parse(pub) : NaN;
    out.push({
      title,
      url,
      source: source || 'Google News',
      category,
      summary: cleanSummary(tag(b, 'description'), title),
      published_at: new Date(Number.isFinite(at) ? at : now).toISOString(),
    });
  }
  return out;
}

// Dedupe on URL as well as title: the same story syndicated under two headlines
// is still the same story, and two outlets rewriting one headline are not.
export function dedupe(items = []) {
  const seenT = new Set(), seenU = new Set(), out = [];
  for (const n of items) {
    if (!n?.title || !n?.url) continue;
    const kt = n.title.toLowerCase(), ku = n.url.split('?')[0];
    if (seenT.has(kt) || seenU.has(ku)) continue;
    seenT.add(kt); seenU.add(ku);
    out.push(n);
  }
  return out;
}

// One busy category must not starve the others, which is what a single global
// cap did. Each category gets its own allowance, newest first.
export function balance(items = [], perCategory = 8) {
  const kept = [];
  for (const c of CATEGORIES) {
    const inCat = items
      .filter(n => n.category === c)
      .sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)));
    kept.push(...inCat.slice(0, perCategory));
  }
  return kept.sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)));
}

export function countByCategory(items = []) {
  const c = {};
  for (const n of items) c[n.category] = (c[n.category] || 0) + 1;
  return c;
}
