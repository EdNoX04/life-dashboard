#!/usr/bin/env python3
"""Draw ₹ as a pixel glyph and emit a one-codepoint webfont, base64-inlined.

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

This draws the sign on a 7x8 pixel grid, the same idiom as the rest of the UI,
and ships it as the only glyph in a font restricted to U+20B9. Everything else
still renders in the pixel faces; only this one codepoint is claimed.

Run:  python3 scripts/make-rupee-font.py
It rewrites the @font-face block in src/theme.css in place.
"""

import base64
import io
import os
import re

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

# The glyph, as a picture. ₹ is structurally an R with two horizontal bars
# across it: a stem down the LEFT, a bowl closed by the second bar, and the leg
# running down-RIGHT. It is worth stating because the obvious guess — bars, a
# stem on the right, a diagonal down-left — is the mirror image, and it renders
# as something between a 7 and a ₹ that looks almost right at small sizes. This
# was drawn against DejaVu Sans Bold's ₹ rather than from memory.
#
# Kept as ASCII art on purpose: the next person who wants a thicker stem should
# be able to edit the drawing, not the geometry.
ART = [
    '######.',
    '#....#.',
    '######.',
    '#..##..',
    '#...##.',
    '#....##',
    '#.....#',
]
# The leg is two pixels wide rather than one, and that is a rendering
# requirement rather than a weight preference: a one-pixel staircase touches
# only at its corners, and corner-touching squares are not a connected region.
# Every rasteriser is entitled to drop those junctions, so at 15px the leg came
# out as four detached dots. Two-wide makes each step share a full edge with the
# next, which is the same reason the bars are emitted as runs.

PX = 100                     # one pixel, in font units
UPM = 1000
COLS = len(ART[0])
ROWS = len(ART)
# Baseline sits at the bottom row. The bars therefore top out at 7*100 = 700,
# which is where VT323's digits and Press Start 2P's caps also land — that
# agreement is the whole point, and it is why PX is 100 and ROWS is 7.
ADVANCE = COLS * PX + 2 * 35  # 35 units of side bearing either side


def runs(row):
    """Contiguous lit spans in a row, as (start, end) column pairs.

    Emitting one rectangle per run rather than one per pixel is not an
    optimisation for its own sake: a six-pixel bar drawn as six abutting squares
    has five interior edges that a rasteriser can seam along at small sizes, and
    the top bar of this glyph is exactly where that would show.
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


def build_glyph():
    pen = TTGlyphPen(None)
    for r, row in enumerate(ART):
        # Row 0 is the top of the drawing, so it is the HIGHEST y in the font's
        # y-up coordinate system. Getting this inversion wrong produces a glyph
        # that is upside down but perfectly plausible-looking in a hex dump.
        y0 = (ROWS - 1 - r) * PX
        y1 = y0 + PX
        for c0, c1 in runs(row):
            x0 = 35 + c0 * PX
            x1 = 35 + c1 * PX
            # Clockwise in y-up coords, which is the filled direction TrueType
            # expects for an outer contour.
            pen.moveTo((x0, y0))
            pen.lineTo((x0, y1))
            pen.lineTo((x1, y1))
            pen.lineTo((x1, y0))
            pen.closePath()
    return pen.glyph()


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    names = ['.notdef', 'rupee']
    fb = FontBuilder(UPM, isTTF=True)
    fb.setupGlyphOrder(names)
    fb.setupCharacterMap({0x20B9: 'rupee'})

    empty = TTGlyphPen(None).glyph()
    fb.setupGlyf({'.notdef': empty, 'rupee': build_glyph()})
    fb.setupHorizontalMetrics({'.notdef': (ADVANCE, 0), 'rupee': (ADVANCE, 35)})
    fb.setupHorizontalHeader(ascent=800, descent=-200)
    fb.setupNameTable({
        'familyName': 'RupeeFix',
        'styleName': 'Regular',
        'psName': 'RupeeFix-Regular',
        'fullName': 'RupeeFix Regular',
        'version': 'Version 1.000',
        'uniqueFontIdentifier': 'RupeeFix-Regular-1.000',
    })
    fb.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200)
    fb.setupPost()

    buf = io.BytesIO()
    fb.save(buf)
    raw = buf.getvalue()
    b64 = base64.b64encode(raw).decode('ascii')
    print(f'font: {len(raw)} bytes, {len(b64)} base64 chars')

    block = FACE_TEMPLATE.replace('@@B64@@', b64)

    css_path = os.path.join(root, 'src', 'theme.css')
    css = open(css_path).read()
    start = css.index('/* ---- The rupee sign, everywhere at once.')
    end = css.index('/* ============ retro color themes')
    css = css[:start] + block + '\n' + css[end:]
    open(css_path, 'w').write(css)
    print(f'wrote {css_path}')


FACE_TEMPLATE = """/* ---- The rupee sign, everywhere at once. GENERATED - see scripts/make-rupee-font.py
   Press Start 2P has no U+20B9 at all and VT323's is drawn small in its own em,
   so every '\\u20b9' + n in the app - and there are dozens, most of them built
   inside plain strings in lib/ where no element exists to hang a class on -
   silently font-fell-back and rendered smaller and lower than the $ it mirrors.

   The first version of this fix claimed the codepoint for a local face that
   actually carries it (Menlo, Segoe UI, DejaVu Sans) and corrected the metric
   mismatch with size-adjust. That got the size right, and it was wrong anyway:
   those are smooth modern faces, so the sign came out as an anti-aliased curve
   sitting between blocky digits. It looked pasted in from another typeface,
   which is precisely what it was.

   So the glyph is drawn here instead, on a 7x7 grid at 100 units a pixel, which
   puts its bars at y=700 - the same height VT323's digits and Press Start 2P's
   caps reach. No size-adjust is needed because nothing is being borrowed.

   unicode-range is what keeps this safe: the browser consults this face for
   U+20B9 and nothing else, so the pixel families still render all other text.
   It is listed first in both stacks because the first matching family wins
   per-codepoint, not per-run. ---- */
@font-face {
  font-family: 'RupeeFix';
  src: url(data:font/ttf;base64,@@B64@@) format('truetype');
  unicode-range: U+20B9;
  font-display: block;
}
"""

if __name__ == '__main__':
    main()
