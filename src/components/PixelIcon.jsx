import React, { useMemo } from 'react';

// Hand-drawn pixel art for the supplement shelf.
//
// Every icon is a 16x16 character grid — one letter per pixel, '.' for empty —
// which means the art is editable as text rather than as a binary asset, and the
// whole shelf costs nothing to load. Adjacent pixels of the same colour are merged
// into single <rect> runs before drawing, so a 256-pixel icon usually renders as
// twenty-odd rectangles instead of two hundred.
//
// The shapes lean on silhouette first — tub, jar, shaker, narrow bottle, capsule —
// because at 16 pixels a shape reads long before a colour does.

const PALETTE = {
  K: '#1b1b22', // lid / cap black
  R: '#e0322f', // whey red
  D: '#8f1e1c', // shadow red
  W: '#f2f4f8', // label white
  S: '#b8bfcc', // silver lid
  B: '#2f6fd0', // creatine blue
  P: '#ff4d7e', // pre-workout / bcaa pink
  O: '#f0912b', // vitamin orange
  Y: '#ffd23f', // vitamin yellow
  N: '#1f6b46', // mineral dark green
  L: '#57c66a', // leaf green
  A: '#cfe6cf', // ashwagandha pale green
  G: '#f6c445', // omega gold
  C: '#5fd7ff', // cyan accent
  M: '#a5723c', // cork brown
  E: '#6b4423', // omega bottle brown
};

// 16 rows of 16 characters each. The loader asserts that, so a typo in the art
// fails loudly at import time instead of silently drawing a lopsided bottle.
const ART = {
  whey: [
    '................',
    '....KKKKKKKK....',
    '....KKKKKKKK....',
    '...RRRRRRRRRR...',
    '...RRRRRRRRRR...',
    '...RWWWWWWWWR...',
    '...RWWWWWWWWR...',
    '...RWWWWWWWWR...',
    '...RWWWWWWWWR...',
    '...RRRRRRRRRR...',
    '...RRRRRRRRRR...',
    '...RRRRRRRRRR...',
    '...RRRRRRRRRR...',
    '...DDDDDDDDDD...',
    '................',
    '................',
  ],
  creatine: [
    '................',
    '................',
    '...SSSSSSSSSS...',
    '...SSSSSSSSSS...',
    '..WWWWWWWWWWWW..',
    '..WWWWWWWWWWWW..',
    '..WBBBBBBBBBBW..',
    '..WBBBBBBBBBBW..',
    '..WBBBBBBBBBBW..',
    '..WWWWWWWWWWWW..',
    '..WWWWWWWWWWWW..',
    '..WWWWWWWWWWWW..',
    '..SSSSSSSSSSSS..',
    '................',
    '................',
    '................',
  ],
  preworkout: [
    '................',
    '.....KKKKKK.....',
    '.....KKKKKK.....',
    '....PPPPPPPP....',
    '....PPPPPPPP....',
    '....PPPWPPPP....',
    '....PPWWWPPP....',
    '....PPPWWPPP....',
    '....PPPPWPPP....',
    '....PPPPPPPP....',
    '....PPPPPPPP....',
    '....PPPPPPPP....',
    '....PPPPPPPP....',
    '....DDDDDDDD....',
    '................',
    '................',
  ],
  vitamins: [
    '................',
    '......KKKK......',
    '......KKKK......',
    '.....OOOOOO.....',
    '....OOOOOOOO....',
    '....OOOOOOOO....',
    '....OYYYYYYO....',
    '....OYYKYYYO....',
    '....OYYYYYYO....',
    '....OYYYYYYO....',
    '....OOOOOOOO....',
    '....OOOOOOOO....',
    '....OOOOOOOO....',
    '....OOOOOOOO....',
    '................',
    '................',
  ],
  omega3: [
    '................',
    '......KKKK......',
    '......KKKK......',
    '.....EEEEEE.....',
    '....EEEEEEEE....',
    '....EGGEEGGE....',
    '....EEEEEEEE....',
    '....EGGEEGGE....',
    '....EEEEEEEE....',
    '....EGGEEGGE....',
    '....EEEEEEEE....',
    '....EEEEEEEE....',
    '....EEEEEEEE....',
    '....EEEEEEEE....',
    '................',
    '................',
  ],
  bcaa: [
    '................',
    '...KKKKKKKKKK...',
    '...KKKKKKKKKK...',
    '..PPPPPPPPPPPP..',
    '..PPPPPPPPPPPP..',
    '..PLLLLLLLLLLP..',
    '..PLLLLLLLLLLP..',
    '..PPPPPPPPPPPP..',
    '..PPPPPPPPPPPP..',
    '..PPPPPPPPPPPP..',
    '..PPPPPPPPPPPP..',
    '..PPPPPPPPPPPP..',
    '..DDDDDDDDDDDD..',
    '................',
    '................',
    '................',
  ],
  minerals: [
    '................',
    '......KKKK......',
    '......KKKK......',
    '.....NNNNNN.....',
    '....NNNNNNNN....',
    '....NNNNNNNN....',
    '....NWWWWWWN....',
    '....NWWWWWWN....',
    '....NNNNNNNN....',
    '....NNNNNNNN....',
    '....NNNNNNNN....',
    '..CC.NNNNNN.CC..',
    '..CC.NNNNNN.CC..',
    '.....NNNNNN.....',
    '................',
    '................',
  ],
  ashwagandha: [
    '................',
    '......MMMM......',
    '......MMMM......',
    '......AAAA......',
    '.....AAAAAA.....',
    '....AAAAAAAA....',
    '....AAAAAAAA....',
    '....ALLLLLLA....',
    '....ALLLLLLA....',
    '....AAAAAAAA....',
    '....AAAAAAAA....',
    '....AAAAAAAA....',
    '....AAAAAAAA....',
    '....AAAAAAAA....',
    '................',
    '................',
  ],
  other: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '..RRRRRRWWWWWW..',
    '.RRRRRRRRWWWWWW.',
    '.RRRRRRRRWWWWWW.',
    '.RRRRRRRRWWWWWW.',
    '.RRRRRRRRWWWWWW.',
    '..RRRRRRWWWWWW..',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
};

// Merge each row's runs of identical colour into one rect. Pure geometry, so it
// is memoised per icon key and never recomputed.
const runsOf = rows => {
  const out = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      let w = 1;
      while (x + w < row.length && row[x + w] === ch) w++;
      if (ch !== '.' && PALETTE[ch]) out.push({ x, y, w, fill: PALETTE[ch] });
      x += w;
    }
  });
  return out;
};

const CACHE = {};
const runsFor = key => {
  if (!CACHE[key]) {
    const rows = ART[key] || ART.other;
    if (rows.length !== 16 || rows.some(r => r.length !== 16)) {
      console.warn(`PixelIcon "${key}" is not a 16x16 grid — check the art.`);
    }
    CACHE[key] = runsOf(rows);
  }
  return CACHE[key];
};

export const PIXEL_ICONS = Object.keys(ART);

export default function PixelIcon({ name = 'other', size = 44, glow = null, dim = false }) {
  const runs = useMemo(() => runsFor(name), [name]);
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true"
      style={{
        imageRendering: 'pixelated',
        flex: '0 0 auto',
        opacity: dim ? 0.32 : 1,
        filter: glow ? `drop-shadow(0 0 3px ${glow})` : undefined,
        transition: 'opacity .12s linear',
      }}>
      {runs.map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.w} height={1} fill={r.fill} shapeRendering="crispEdges" />
      ))}
    </svg>
  );
}
