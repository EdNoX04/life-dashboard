// Generates src/data/worldmap.js — the world, as a TopoJSON topology.
//
// Run:  cd mapgen && npm i world-atlas topojson-simplify topojson-client && node gen.mjs
//
// Why TopoJSON rather than expanded GeoJSON: it shares the arcs between
// neighbouring countries, so a border is stored once instead of twice. That is
// both smaller AND how we get a clean border mesh with no doubled lines.
//
// Simplified with a weight that keeps all 177 countries — going further starts
// dropping small island states, and "your country vanished" is a worse defect
// than a slightly coarser coastline. Re-quantized afterwards because
// presimplify turns the integer arcs into floats and triples the file.
import fs from 'node:fs';
import { presimplify, simplify } from 'topojson-simplify';
import { quantize, feature } from 'topojson-client';

const SIMPLIFY_WEIGHT = 0.15;
const QUANTIZE = 1e4;

const raw = JSON.parse(fs.readFileSync('node_modules/world-atlas/countries-110m.json', 'utf8'));
const simplified = simplify(presimplify(raw), SIMPLIFY_WEIGHT);
const topo = quantize(simplified, QUANTIZE);

const countries = feature(topo, topo.objects.countries).features;
let points = 0;
topo.arcs.forEach(a => { points += a.length; });

const out = `// GENERATED — do not edit. Regenerate with mapgen/gen.mjs.
//
// Natural Earth 110m country polygons, via the world-atlas package (public
// domain), simplified to weight ${SIMPLIFY_WEIGHT} and quantized to ${QUANTIZE}.
// ${countries.length} countries, ${points} points.
//
// Kept as a TopoJSON topology rather than expanded GeoJSON: neighbouring
// countries share their border arcs, so each border is stored once, and the
// shared-arc structure is what lets topojson-client build a border mesh with
// no doubled lines.
export const WORLD = ${JSON.stringify(topo)};
export const OBJECT_KEY = 'countries';
`;
fs.writeFileSync('worldmap.js', out);
console.log(`countries: ${countries.length}  points: ${points}  bytes: ${fs.statSync('worldmap.js').size.toLocaleString()}`);
