#!/usr/bin/env python3
"""Render tmux captured ANSI frames to a GIF demo for pi-btw. v2 — honest font routing."""
import glob, re, os
from PIL import Image, ImageDraw, ImageFont

FRAMES = sorted(glob.glob("/tmp/btw-vhs/frames/[ab]_*.txt")) + ["/tmp/btw-vhs/frames/z_final.txt"]
OUTDIR = "/tmp/btw-vhs/pngs"
COLS, ROWS = 190, 44
KEEP_ROWS = 32
BG = (40, 42, 54)
FG = (248, 248, 242)

MENLO = "/System/Library/Fonts/Menlo.ttc"
CJK = "/System/Library/Fonts/Hiragino Sans GB.ttc"

menlo = ImageFont.truetype(MENLO, 15)
cjk = ImageFont.truetype(CJK, 15)
CELL_W = 9   # menlo advance at 15px = 0.6em
CELL_H = 19

_probe_cache = {}

def draw_mask(font_path, size, ch):
    f = ImageFont.truetype(font_path, size)
    img = Image.new("L", (44, 32), 0)
    ImageDraw.Draw(img).text((2, 2), ch, font=f, fill=255)
    a = np.asarray(img, dtype=int)
    return a

import numpy as np

def honest_has(font_path, ch):
    key = (font_path, ch)
    if key in _probe_cache:
        return _probe_cache[key]
    try:
        a = draw_mask(font_path, 15, ch)
        ink = (a > 100).mean()
        # tofu test: a missing glyph renders identical to any other missing glyph
        ref = "鑽" if ch != "鑽" else "疆"
        b = draw_mask(font_path, 15, ref)
        ok = ink > 0.004 and not np.array_equal(a, b)
    except Exception:
        ok = False
    _probe_cache[key] = ok
    return ok

def font_for(ch):
    c = ord(ch)
    if c < 0x2500:
        return menlo if honest_has(MENLO, ch) else None
    if 0x2500 <= c <= 0x259F:  # box drawing & blocks
        return menlo if honest_has(MENLO, ch) else (cjk if honest_has(CJK, ch) else None)
    return cjk if honest_has(CJK, ch) else None

def parse(text):
    rows = []
    for line in text.split("\n"):
        cells, color, bold = [], FG, False
        i = 0
        while i < len(line):
            ch = line[i]
            if ch == "\x1b":
                m = re.match(r"\x1b\[([0-9;]*)m", line[i:])
                if m:
                    p = m.group(1).split(";") if m.group(1) else ["0"]
                    j = 0
                    while j < len(p):
                        c = p[j]
                        if c == "0": color, bold = FG, False
                        elif c == "1": bold = True
                        elif c in ("22", "21"): bold = False
                        elif c == "39": color = FG
                        elif c == "38" and j + 1 < len(p):
                            if p[j+1] == "5" and j + 2 < len(p): color = xterm256(int(p[j+2])); j += 2
                            elif p[j+1] == "2" and j + 4 < len(p):
                                color = (int(p[j+2]), int(p[j+3]), int(p[j+4])); j += 4
                        j += 1
                    i += m.end(); continue
                m2 = re.match(r"\x1b.|[\x00-\x1f]", line[i:])
                i += m2.end() if m2 else 1
                continue
            wide = unicodedata.east_asian_width(ch) in ("W", "F")
            cells.append((ch, color, bold, 2 if wide else 1))
            i += 1
        rows.append(cells)
    while len(rows) < ROWS: rows.append([])
    return rows[-KEEP_ROWS:]

import unicodedata
def xterm256(n):
    if n < 16:
        base = [(0,0,0),(205,0,0),(0,205,0),(205,205,0),(0,0,238),(205,0,205),(0,205,205),(229,229,229),
                (127,127,127),(255,0,0),(0,255,0),(255,255,0),(92,92,255),(255,0,255),(0,255,255),(255,255,255)]
        return base[n]
    if n < 232:
        n -= 16; v = lambda x: 0 if x == 0 else 55 + x * 40
        return (v(n//36), v((n%36)//6), v(n%6))
    g = 8 + (n - 232) * 10
    return (g, g, g)

def render(rows):
    W, H = COLS * CELL_W, KEEP_ROWS * CELL_H
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    for r, cells in enumerate(rows):
        col = 0
        for ch, color, bold, wdt in cells:
            if col >= COLS or ch == " ":
                col += wdt; continue
            f = font_for(ch)
            if f is None:
                col += wdt; continue
            x, y = col * CELL_W + 2, r * CELL_H + 2
            d.text((x, y), ch, font=f, fill=color, stroke_width=1 if bold else 0)
            col += wdt
    return img

os.makedirs(OUTDIR, exist_ok=True)
for f in glob.glob(OUTDIR + "/*.png"): os.remove(f)
pngs, keys = [], []
for path in FRAMES:
    rows = parse(open(path, encoding="utf-8", errors="replace").read())
    key = tuple(tuple((c[0], c[1]) for c in row) for row in rows)
    if keys and key == keys[-1]:
        continue
    keys.append(key)
    pngs.append(render(rows))
for i, p in enumerate(pngs):
    p.save(f"{OUTDIR}/f{i:02d}.png")
print(f"frames: {len(pngs)} -> {OUTDIR}")
