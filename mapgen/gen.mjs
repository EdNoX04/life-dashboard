import fs from 'node:fs';
import { mesh } from 'topojson-client';

const topo = JSON.parse(fs.readFileSync('node_modules/world-atlas/countries-110m.json', 'utf8'));
const obj = topo.objects.countries;
const coast   = mesh(topo, obj, (a, b) => a === b);
const borders = mesh(topo, obj, (a, b) => a !== b);

const P = 1;
const round = n => Math.round(n * 10 ** P) / 10 ** P;
function pack(ml) {
  const out = [];
  for (const line of ml.coordinates) {
    const pts = []; let px = null, py = null;
    for (const [lon, lat] of line) {
      const x = round(lon), y = round(lat);
      if (x === px && y === py) continue;
      pts.push(x, y); px = x; py = y;
    }
    if (pts.length >= 4) out.push(pts);
  }
  return out;
}
const C = pack(coast), B = pack(borders);
const stat = a => `${a.length} lines, ${a.reduce((n,l)=>n+l.length/2,0)} points`;
console.log('coast  :', stat(C));
console.log('borders:', stat(B));
const body = `// GENERATED — do not edit by hand. Regenerate with mapgen/gen.mjs.
//
// Natural Earth 110m coastlines and country borders, via the world-atlas npm
// package (public domain). Coordinates are flat [lon,lat,lon,lat,...] arrays
// rounded to ${P} decimal place: the source is only ~11 km accurate, so a
// second decimal would be storing noise at full byte cost.
//
// Coast and borders are separate because they are drawn differently — the
// silhouette of the land reads brighter, the internal borders sit quieter
// behind it.
export const COAST = ${JSON.stringify(C)};
export const BORDERS = ${JSON.stringify(B)};
`;
fs.writeFileSync('worldmap.js', body);
console.log('bytes  :', fs.statSync('worldmap.js').size.toLocaleString());
