// Open Food Facts (free, no key, CORS-ok) — barcode + name lookup, incl. Indian products.
// Plus NLM Clinical Tables for the conditions/symptoms search (thousands of entries).
const OFF = 'https://world.openfoodfacts.org';
const r1 = n => Math.round(n * 10) / 10;

// ONE BASIS PER ITEM. This is not a style preference — it was a bug.
//
// The old `val()` picked per-serving if present and fell back to per-100g,
// INDEPENDENTLY for every nutrient, while the item's `per` label was decided by
// the energy field alone. Open Food Facts is patchily populated, so a product
// with `energy-kcal_serving` but only `proteins_100g` produced calories for a
// 30g serving beside protein for 100g, in one row, labelled "serving". The
// protein was 3.3× too high and nothing on screen could have told you.
//
// So the basis is chosen ONCE, for the whole item: per-serving only if the four
// numbers that matter are all there per serving, otherwise everything per 100g.
// A consistent 100g row that says 100g is useful. A mixed row is worse than no
// row, because it looks like data.
const RAW = ['energy-kcal', 'proteins', 'carbohydrates', 'fat'];
const has = (n, base, per) => n[`${base}_${per}`] != null && n[`${base}_${per}`] !== '';

export function basisOf(n) {
  return RAW.every(b => has(n, b, 'serving')) ? 'serving' : '100g';
}

function pick(n, base, per) {
  const v = n[`${base}_${per}`];
  return v == null || v === '' ? null : Number(v);
}

export function toItem(p, code) {
  const n = p.nutriments || {};
  const per = basisOf(n);
  // Every field now comes from the SAME column. A nutrient missing on that
  // basis is 0 rather than silently borrowed from the other one.
  const val = b => { const v = pick(n, b, per); return v == null ? null : { v, per }; };
  const kcalO = val('energy-kcal');
  const g = b => { const o = val(b); return o ? o.v : 0; };
  const mg = b => { const o = val(b); return o ? o.v * 1000 : 0; };   // OFF stores minerals in grams
  const ug = b => { const o = val(b); return o ? o.v * 1e6 : 0; };
  let sodium = mg('sodium');
  if (!sodium) { const salt = val('salt'); if (salt) sodium = (salt.v * 1000) / 2.5; }
  const brand = (p.brands || '').split(',')[0].trim();
  return {
    name: [brand, p.product_name].filter(Boolean).join(' ').trim() || p.product_name || 'Food',
    code: code || p.code, serving: p.serving_size || '', per,
    kcal: Math.round(kcalO ? kcalO.v : 0),
    protein: r1(g('proteins')), carbs: r1(g('carbohydrates')), fat: r1(g('fat')),
    micros: {
      fiber: r1(g('fiber')), sugar: r1(g('sugars')), satfat: r1(g('saturated-fat')),
      sodium: Math.round(sodium), calcium: Math.round(mg('calcium')), iron: r1(mg('iron')),
      potassium: Math.round(mg('potassium')), zinc: r1(mg('zinc')), magnesium: Math.round(mg('magnesium')),
      vitc: r1(mg('vitamin-c')), vita: Math.round(ug('vitamin-a')), vitd: r1(ug('vitamin-d')), vitb12: r1(ug('vitamin-b12')),
    },
  };
}

export async function lookupBarcode(code) {
  const r = await fetch(`${OFF}/api/v2/product/${encodeURIComponent(code)}?fields=code,product_name,brands,serving_size,nutriments`);
  if (!r.ok) throw new Error(`OFF ${r.status}`);
  const j = await r.json();
  if (j.status !== 1 || !j.product || !j.product.product_name) return null;
  return toItem(j.product, code);
}

export async function searchFood(q) {
  const url = `${OFF}/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=14&fields=code,product_name,brands,serving_size,nutriments`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`OFF search ${r.status}`);
  const j = await r.json();
  return (j.products || []).filter(p => p.product_name).map(p => toItem(p, p.code));
}

// NLM Clinical Tables — conditions autocomplete (free, CORS-ok, thousands of entries)
export async function searchConditions(q) {
  if (!q || q.length < 2) return [];
  const r = await fetch(`https://clinicaltables.nlm.nih.gov/api/conditions/v3/search?terms=${encodeURIComponent(q)}&maxList=15`);
  if (!r.ok) return [];
  const j = await r.json(); // [total, codes, extra, [[name], ...]]
  return (j[3] || []).map(row => row[0]).filter(Boolean);
}
