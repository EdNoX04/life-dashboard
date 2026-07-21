// Open Food Facts (free, no key, CORS-ok) — barcode + name lookup, incl. Indian products.
// Plus NLM Clinical Tables for the conditions/symptoms search (thousands of entries).
const OFF = 'https://world.openfoodfacts.org';
const r1 = n => Math.round(n * 10) / 10;

// pick a nutriment value, preferring the per-serving field, else per-100g
function val(n, base) {
  if (n[base + '_serving'] != null && n[base + '_serving'] !== '') return { v: Number(n[base + '_serving']), per: 'serving' };
  if (n[base + '_100g'] != null && n[base + '_100g'] !== '') return { v: Number(n[base + '_100g']), per: '100g' };
  return null;
}

function toItem(p, code) {
  const n = p.nutriments || {};
  const kcalO = val(n, 'energy-kcal');
  const per = (kcalO && kcalO.per) || 'serving';
  const g = b => { const o = val(n, b); return o ? o.v : 0; };
  const mg = b => { const o = val(n, b); return o ? o.v * 1000 : 0; };   // OFF stores minerals in grams
  const ug = b => { const o = val(n, b); return o ? o.v * 1e6 : 0; };
  let sodium = mg('sodium');
  if (!sodium) { const salt = val(n, 'salt'); if (salt) sodium = (salt.v * 1000) / 2.5; }
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
