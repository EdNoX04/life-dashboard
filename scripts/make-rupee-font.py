#!/usr/bin/env python3
"""Draw ₹ as a pixel glyph and emit TWO one-codepoint webfonts, base64-inlined.

Why a generated font rather than a component.

The rupee sign appears in this app in two quite different places. Some of them
are elements — <span className="rupee">₹</span> — and those could have been a
hand-drawn SVG component. But most of them are not: they are '₹' + n built
inside plain strings in lib/ and in money() in components/ui.jsx, where there is
no element to hang anything on and no sensible way to introduce one without
threading JSX through a dozen pure functions that currently return strings.

So the fix has to live at the font layer, the way the earlier size fix did. The
difference is that the earlier fix borrowed the glyph from Menlo / Helvetica /
Segoe UI. That got the SIZE right — which is what it was for — but it drew a
smooth, modern, anti-aliased rupee sitting next to blocky VT323 digits, and it
read as a glyph pasted in from another typeface, because it was one.

This draws the sign on a 7x7 pixel grid, the same idiom as the rest of the UI,
and ships it as the only glyph in fonts restricted to U+20B9. Everything else
still renders in the pixel faces; only this one codepoint is claimed.


TWO FIXES, both found by measuring a screenshot of the live stat tiles rather
than by reading the drawing.

1. THE DRAWING WAS A LATIN R, NOT A RUPEE. The previous ART had a stem running
   the full height down the left side, a closed bowl, and a leg off the bowl —
   which is the construction of R, and rendered as one. ₹ has NO left stem. It
   is two horizontal bars, a short stroke between them, and then a single
   stroke that leaves the second bar, bulges out to the LEFT, and returns to
   run down to the bottom RIGHT. The left edge of the glyph is touched at
   exactly one height, about halfway down, and nowhere else. Checked against a
   rasterisation of DejaVu Sans Bold's U+20B9 rather than from memory, because
   the previous drawing was also "checked against DejaVu" and still came out as
   an R — reading a glyph and reproducing its skeleton are different jobs.

2. ONE SET OF METRICS CANNOT SERVE BOTH STACKS. The app has two font stacks and
   they do not agree about where text sits:

     --font-body  -> VT323, an ordinary-baseline face: digits rest ON the
                     baseline and reach about 700/1000 of the em.
     --font-pixel -> Press Start 2P, which does NOT rest on the baseline: its
                     caps and digits float about 125/1000 above it and reach
                     1000, so they are both TALLER and HIGHER than VT323's.

   The old font shipped one face at 0..700, which is right for VT323 and wrong
   for Press Start 2P — and the stat tiles, the most prominent money on the
   dashboard, are Press Start 2P. There the sign came out at 29px beside 36px
   digits and sat five device-pixels lower. Measured off the rendered page: at
   font-size 20px on a 2x display, 1em = 40 device px, the digits spanned 36px
   with their feet 5px clear of the baseline, i.e. 125..1000 in font units.

   So two faces are generated from the same drawing, differing only in the size
   of a pixel and the height of the bottom row. Nothing is scaled with
   size-adjust: each face is drawn at the size it needs to be, so the pixel
   grid stays square in both and neither gets resampled.

Run:  python3 scripts/make-rupee-font.py
It rewrites the @font-face block in src/theme.css in place.
"""

import base64
import io
import os

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

# The glyph, as a picture, read off DejaVu Sans Bold's U+20B9:
#
#   row 0   the upper bar, full width
#   row 1   the short connecting stroke, right of centre
#   row 2   the lower bar, full width
#   rows 3-4 the stroke leaving the bar and bulging LEFT — row 4 is the only
#           row that reaches column 0, which is what stops this reading as an R
#   rows 5-6 the same stroke turning back and running down to the right
#
# Kept as ASCII art on purpose: the next person who wants a thicker stem should
# be able to edit the drawing, not the geometry.
ART = [
    '#######',
    '...##..',
    '#######',
    '..##...',
    '###....',
    '..###..',
    '....###',
]
# Every step of the descending stroke overlaps its neighbour by a full pixel of
# shared edge (row 3 cols 2-3 into row 4 cols 0-2 into row 5 cols 2-4 into row 6
# cols 4-6). That is a rendering requirement rather than a weight preference: a
# staircase that touches only at its corners is not a connected region, every
# rasteriser is entitled to drop those junctions, and at 15px the previous leg
# came out as four detached dots.

UPM = 1000
COLS = len(ART[0])
ROWS = len(ART)

# (family, pixel size in font units, height of the bottom row above the
# baseline). See fix 2 above — these are measured, not chosen.
#
#   RupeeFix   : 7 rows x 100 = 700, sitting on the baseline. VT323.
#   RupeePixel : 7 rows x 125 = 875, lifted 125 clear. Press Start 2P.
#
# 875 and 125 are not a rounding of anything convenient; they are what the
# screenshot measured, and 875/7 landing exactly on 125 is luck that saves a
# fractional pixel grid.
FACES = [
    ('RupeeFix', 100, 0),
    ('RupeePixel', 125, 125),
]


def runs(row):
    """Contiguous lit spans in a row, as (start, end) column pairs.

    Emitting one rectangle per run rather than one per pixel is not an
    optimisation for its own sake: a seven-pixel bar drawn as seven abutting
    squares has six interior edges that a rasteriser can seam along at small
    sizes, and the top bar of this glyph is exactly where that would show.
    """
    out, i = [], 0
    while i < COLS:
        if row[i] == '#':
            j = i
            while j < COLS and row[j] == '#':
                j += 1
            out.append((i, j))
            i = j
        else:
            i += 1
    return out


def build_glyph(px, yoff, bearing):
    pen = TTGlyphPen(None)
    for r, row in enumerate(ART):
        # Row 0 is the top of the drawing, so it is the HIGHEST y in the font's
        # y-up coordinate system. Getting this inversion wrong produces a glyph
        # that is upside down but perfectly plausible-looking in a hex dump.
        y0 = yoff + (ROWS - 1 - r) * px
        y1 = y0 + px
        for c0, c1 in runs(row):
            x0 = bearing + c0 * px
            x1 = bearing + c1 * px
            # Clockwise in y-up coords, which is the filled direction TrueType
            # expects for an outer contour.
            pen.moveTo((x0, y0))
            pen.lineTo((x0, y1))
            pen.lineTo((x1, y1))
            pen.lineTo((x1, y0))
            pen.closePath()
    return pen.glyph()


def build_face(family, px, yoff):
    # The side bearing is a third of a pixel either side, so the sign keeps the
    # same optical gap from the digit next to it in both faces rather than
    # looking tighter in the larger one.
    bearing = px // 3
    advance = COLS * px + 2 * bearing
    top = yoff + ROWS * px

    fb = FontBuilder(UPM, isTTF=True)
    fb.setupGlyphOrder(['.notdef', 'rupee'])
    fb.setupCharacterMap({0x20B9: 'rupee'})
    fb.setupGlyf({'.notdef': TTGlyphPen(None).glyph(),
                  'rupee': build_glyph(px, yoff, bearing)})
    fb.setupHorizontalMetrics({'.notdef': (advance, 0), 'rupee': (advance, bearing)})
    # Ascent follows the drawing rather than a fixed 800: the lifted face draws
    # up to 1000, and an ascent below the ink is how a line box ends up clipping
    # the very glyph this font exists to show.
    fb.setupHorizontalHeader(ascent=max(800, top), descent=-200)
    fb.setupNameTable({
        'familyName': family,
        'styleName': 'Regular',
        'psName': f'{family}-Regular',
        'fullName': f'{family} Regular',
        'version': 'Version 2.000',
        'uniqueFontIdentifier': f'{family}-Regular-2.000',
    })
    fb.setupOS2(sTypoAscender=max(800, top), sTypoDescender=-200,
                usWinAscent=max(800, top), usWinDescent=200)
    fb.setupPost()

    buf = io.BytesIO()
    fb.save(buf)
    raw = buf.getvalue()
    print(f'{family}: {len(raw)} bytes, ink {yoff}..{top}')
    return base64.b64encode(raw).decode('ascii')


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    faces = ''.join(
        FACE_ONE.replace('@@FAMILY@@', fam).replace('@@B64@@', build_face(fam, px, yoff))
        for fam, px, yoff in FACES
    )
    block = HEADER + faces

    css_path = os.path.join(root, 'src', 'theme.css')
    css = open(css_path).read()
    start = css.index('/* ---- The rupee sign, everywhere at once.')
    end = css.index('/* ============ retro color themes')
    css = css[:start] + block + '\n' + css[end:]
    open(css_path, 'w').write(css)
    print(f'wrote {css_path}')


HEADER = """/* ---- The rupee sign, everywhere at once. GENERATED - see scripts/make-rupee-font.py
   Press Start 2P has no U+20B9 at all and VT323's is drawn small in its own em,
   so every '\\u20b9' + n in the app - and there are dozens, most of them built
   inside plain strings in lib/ where no element exists to hang a class on -
   silently font-fell-back and rendered smaller and lower than the $ it mirrors.

   An earlier version of this fix claimed the codepoint for a local face that
   actually carries it (Menlo, Segoe UI, DejaVu Sans) and corrected the metric
   mismatch with size-adjust. That got the size right, and it was wrong anyway:
   those are smooth modern faces, so the sign came out as an anti-aliased curve
   sitting between blocky digits. It looked pasted in from another typeface,
   which is precisely what it was.

   So the glyph is drawn here instead, on a 7x7 grid.

   TWO faces, because the app's two stacks do not sit at the same height.
   VT323 rests on the baseline and reaches ~700/1000 of the em; Press Start 2P
   floats ~125 above the baseline and reaches 1000. A single face fits one and
   is visibly short and low in the other, which is exactly what the stat tiles
   were showing. RupeeFix is drawn 0..700 for the body stack, RupeePixel
   125..1000 for the pixel stack. Neither is size-adjusted - each is drawn at
   its own size, so the pixel grid stays square in both.

   unicode-range is what keeps this safe: the browser consults these faces for
   U+20B9 and nothing else, so the pixel families still render all other text.
   Each is listed first in its own stack because the first matching family wins
   per-codepoint, not per-run. ---- */
"""

FACE_ONE = """@font-face {
  font-family: '@@FAMILY@@';
  src: url(data:font/ttf;base64,@@B64@@) format('truetype');
  unicode-range: U+20B9;
  font-display: block;
}
"""

if __name__ == '__main__':
    main()
