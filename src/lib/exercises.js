// Free exercise library (873 exercises w/ images + instructions) — yuhonas/free-exercise-db via jsDelivr CDN.
let CACHE = null, loading = null;
export async function loadExercises() {
  if (CACHE) return CACHE;
  if (!loading) loading = fetch('https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@main/dist/exercises.json')
    .then(r => r.json()).then(d => { CACHE = d; return d; });
  return loading;
}
export const exImg = p => 'https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@main/exercises/' + p;
// Epley estimated 1-rep-max
export const est1RM = (w, r) => (Number(w) || 0) * (1 + (Number(r) || 0) / 30);
