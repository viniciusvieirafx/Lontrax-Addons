"""Christmas sprites for the app (pixel art, same palette and outline as the otter).

    python tools/make_natal.py

Writes into src/ui (picked up by the lontrinha-*.png and natal-*.png globs in the .csproj):
  lontrinha-<anim>-natal.png  the otter's sheets with the helmet turned into a Santa hat
  natal-caixa.png / natal-tampa.png   gift box body and lid (the lid flies off when it opens)
  natal-arvore.png, natal-estrela.png, natal-presentes.png, natal-boneco.png,
  natal-bengala.png, natal-sino.png, natal-gorrinho.png, natal-guirlanda.png
Original drawings, no game art.
"""
import math
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UI = os.path.join(ROOT, "src", "ui")

O = (26, 18, 12, 255)  # outline (same as the otter)
RED, RED_HI, RED_LO = (200, 40, 58, 255), (236, 88, 96, 255), (138, 22, 38, 255)
WHITE, WHITE_LO = (246, 246, 246, 255), (196, 204, 220, 255)
GREEN, GREEN_HI, GREEN_LO = (47, 138, 74, 255), (92, 184, 106, 255), (29, 90, 51, 255)
GOLD, GOLD_HI, GOLD_LO = (226, 186, 80, 255), (246, 224, 138, 255), (154, 116, 36, 255)
BLUE, BLUE_LO = (64, 120, 220, 255), (36, 72, 150, 255)
BROWN, BROWN_LO = (122, 78, 42, 255), (86, 52, 28, 255)
ORANGE = (232, 122, 48, 255)
BLACK = (14, 12, 12, 255)
SNOW, SNOW_LO = (238, 244, 255, 255), (184, 200, 224, 255)
NONE = (0, 0, 0, 0)


def outline(im):
    """Adds the 1px dark outline around every filled shape (like the otter's)."""
    px = im.load()
    w, h = im.size
    add = []
    for y in range(h):
        for x in range(w):
            if px[x, y][3]:
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < w and 0 <= ny < h and px[nx, ny][3] and px[nx, ny] != O:
                    add.append((x, y))
                    break
    for x, y in add:
        px[x, y] = O
    return im


def save(im, name):
    im.save(os.path.join(UI, name))
    print("ok", name, im.size)


# ---------- the otter with a Santa hat ----------
STEEL = {(180, 190, 210): RED, (232, 238, 248): RED_HI, (112, 122, 146): RED_LO}
GOLDS = {(226, 186, 80), (154, 116, 36)}
FUR = {(138, 90, 52), (104, 66, 36)}


def santa(sheet, frame_w, ox):
    im = Image.open(os.path.join(UI, sheet)).convert("RGBA")
    px = im.load()
    for f in range(im.size[0] // frame_w):
        x0 = f * frame_w + ox
        cols = range(x0 + 5, x0 + 23)
        eye = next((y for y in range(28) if any(px[x, y][:3] in FUR for x in cols)), 9)
        for y in range(eye):
            for x in cols:
                c = px[x, y]
                if not c[3]:
                    continue
                rgb = c[:3]
                if rgb in STEEL and y == eye - 1:  # brim right above the eyes: white fur trim
                    px[x, y] = WHITE_LO if rgb == (112, 122, 146) else WHITE
                elif rgb in STEEL:
                    px[x, y] = STEEL[rgb]
                elif rgb in GOLDS:
                    # the gold band right above the face is the hat's fur trim; the plume on top, the pompom
                    px[x, y] = WHITE if rgb == (226, 186, 80) else WHITE_LO
    out = sheet.replace(".png", "-natal.png")
    save(im, out)


for s in ("parada", "avisando", "trabalhando", "comemorando"):
    santa(f"lontrinha-{s}.png", 28, 0)
santa("lontrinha-luta.png", 36, 8)


# ---------- gift box: body + lid with a bow ----------
def caixa():
    body = Image.new("RGBA", (22, 15), NONE)
    d = ImageDraw.Draw(body)
    d.rectangle((1, 1, 20, 13), fill=RED)
    d.line((1, 1, 1, 13), fill=RED_HI)
    d.line((19, 1, 20, 13), fill=RED_LO)
    d.rectangle((9, 1, 12, 13), fill=GOLD)
    d.line((12, 1, 12, 13), fill=GOLD_LO)
    d.line((9, 1, 9, 13), fill=GOLD_HI)
    d.line((1, 1, 20, 1), fill=RED_LO)  # shadow under the lid
    save(outline(body), "natal-caixa.png")

    lid = Image.new("RGBA", (26, 13), NONE)
    d = ImageDraw.Draw(lid)
    d.rectangle((1, 7, 24, 11), fill=RED)
    d.line((1, 7, 24, 7), fill=RED_HI)
    d.line((1, 11, 24, 11), fill=RED_LO)
    d.rectangle((11, 7, 14, 11), fill=GOLD)
    d.line((14, 7, 14, 11), fill=GOLD_LO)
    # bow: two loops and a knot
    d.ellipse((5, 1, 12, 7), fill=GOLD)
    d.ellipse((13, 1, 20, 7), fill=GOLD)
    d.ellipse((7, 3, 10, 5), fill=GOLD_LO)
    d.ellipse((15, 3, 18, 5), fill=GOLD_LO)
    d.rectangle((11, 3, 14, 7), fill=GOLD_HI)
    save(outline(lid), "natal-tampa.png")


caixa()


# ---------- Christmas tree (the star is separate so it can light up) ----------
def arvore():
    w, h = 30, 40
    im = Image.new("RGBA", (w, h), NONE)
    d = ImageDraw.Draw(im)
    c = 15
    d.rectangle((12, 33, 17, 38), fill=BROWN)
    d.line((16, 33, 17, 38), fill=BROWN_LO)
    tiers = [(2, 13, 6), (7, 23, 10), (13, 33, 13)]
    for top, base, half in tiers:
        d.polygon([(c, top), (c - half, base), (c + half, base)], fill=GREEN)
        d.polygon([(c + 1, top + 1), (c + half, base), (c + 1, base)], fill=GREEN_LO)  # shade on the right
        d.line((c - half + 1, base, c + half - 1, base), fill=GREEN_LO)
        d.line((c - 1, top + 2, c - half + 2, base - 1), fill=GREEN_HI)
    px = im.load()
    # gold garland zig-zags
    for y0, x_from, x_to in ((10, 11, 19), (19, 8, 22), (29, 5, 25)):
        for x in range(x_from, x_to + 1):
            y = y0 + (x - x_from) // 3
            if px[x, y][3]:
                px[x, y] = GOLD if (x % 2) else GOLD_HI
    # baubles
    for (x, y, col) in ((13, 8, RED), (17, 12, BLUE), (10, 16, GOLD), (19, 18, RED), (14, 22, BLUE),
                        (8, 25, RED), (21, 27, GOLD), (12, 30, GOLD), (18, 31, RED), (25, 31, BLUE), (5, 31, BLUE)):
        if px[x, y][3]:
            px[x, y] = col
            if px[x + 1, y][3]:
                px[x + 1, y] = col
            if px[x, y + 1][3]:
                px[x, y + 1] = col
            if px[x + 1, y + 1][3]:
                px[x + 1, y + 1] = WHITE if col != GOLD else GOLD_HI
    save(outline(im), "natal-arvore.png")

    st = Image.new("RGBA", (11, 11), NONE)
    d = ImageDraw.Draw(st)
    pts = []
    for i in range(10):
        a = -math.pi / 2 + i * math.pi / 5
        r = 5 if i % 2 == 0 else 2.2
        pts.append((5 + r * math.cos(a), 5.3 + r * math.sin(a)))
    d.polygon(pts, fill=GOLD)
    st.load()[5, 4] = GOLD_HI
    st.load()[4, 5] = GOLD_HI
    save(outline(st), "natal-estrela.png")


arvore()


# ---------- pile of presents ----------
def presentes():
    im = Image.new("RGBA", (38, 18), NONE)
    d = ImageDraw.Draw(im)
    boxes = [  # x0, y0, x1, y1, color, shade, ribbon
        (1, 6, 14, 16, BLUE, BLUE_LO, GOLD),
        (12, 2, 23, 16, GREEN, GREEN_LO, RED),
        (22, 8, 36, 16, RED, RED_LO, WHITE),
    ]
    for x0, y0, x1, y1, col, sh, rib in boxes:
        d.rectangle((x0, y0, x1, y1), fill=col)
        d.line((x1, y0, x1, y1), fill=sh)
        mx = (x0 + x1) // 2
        d.line((mx, y0, mx, y1), fill=rib)
        d.line((x0, y0 + (y1 - y0) // 2, x1, y0 + (y1 - y0) // 2), fill=rib)
        d.point((mx - 1, y0 - 1), fill=rib)
        d.point((mx + 1, y0 - 1), fill=rib)
    save(outline(im), "natal-presentes.png")


presentes()


# ---------- snowman ----------
def boneco():
    w, h = 22, 30
    im = Image.new("RGBA", (w, h), NONE)
    px = im.load()

    def ball(cx, cy, r):
        for y in range(h):
            for x in range(w):
                dd = (x - cx) ** 2 + (y - cy) ** 2
                if dd <= r * r:
                    px[x, y] = SNOW_LO if (x - cx) > r * 0.35 and (y - cy) > -r * 0.2 else SNOW

    ball(11, 21, 7.5)
    ball(11, 10.5, 5.2)
    d = ImageDraw.Draw(im)
    # top hat
    d.rectangle((6, 4, 16, 5), fill=BLACK)
    d.rectangle((8, 0, 14, 4), fill=BLACK)
    d.line((8, 3, 14, 3), fill=RED)
    # face
    d.point((9, 9), fill=BLACK)
    d.point((13, 9), fill=BLACK)
    d.line((11, 11, 14, 11), fill=ORANGE)
    d.point((10, 13), fill=BLACK)
    d.point((12, 13), fill=BLACK)
    # scarf
    d.rectangle((6, 15, 16, 16), fill=RED)
    d.rectangle((14, 16, 15, 20), fill=RED)
    d.point((14, 18), fill=WHITE)
    # buttons
    for y in (19, 22, 25):
        d.point((11, y), fill=BLACK)
    # stick arms
    d.line((4, 17, 0, 13), fill=BROWN)
    d.line((18, 17, 21, 13), fill=BROWN)
    save(outline(im), "natal-boneco.png")


boneco()


# ---------- candy cane ----------
def bengala():
    w, h = 11, 22
    im = Image.new("RGBA", (w, h), NONE)
    px = im.load()
    path = []
    cx, cy, r = 4.0, 4.5, 2.6
    for i in range(0, 41):
        a = math.radians(200 - i * 5)  # from lower-left, over the top, to the right
        path.append((cx + r * math.cos(a), cy - r * math.sin(a)))
    x_end = path[-1][0]
    y = path[-1][1]
    while y < h - 2:
        y += 0.25
        path.append((x_end, y))
    length = 0.0
    prev = path[0]
    marks = []
    for p in path:
        length += math.dist(prev, p)
        prev = p
        marks.append((p, length))
    for yy in range(h):
        for xx in range(w):
            best = None
            for (p, L) in marks:
                dd = (xx - p[0]) ** 2 + (yy - p[1]) ** 2
                if dd <= 1.25 ** 2 and (best is None or dd < best[0]):
                    best = (dd, L)
            if best:
                px[xx, yy] = RED if int((best[1] + xx * 0.5) // 2.2) % 2 == 0 else WHITE
    save(outline(im), "natal-bengala.png")


bengala()


# ---------- bell ----------
def sino():
    im = Image.new("RGBA", (13, 13), NONE)
    d = ImageDraw.Draw(im)
    d.ellipse((5, 0, 7, 2), outline=GOLD_LO)
    d.pieslice((2, 2, 10, 12), 180, 360, fill=GOLD)
    d.rectangle((2, 7, 10, 9), fill=GOLD)
    d.rectangle((1, 9, 11, 10), fill=GOLD)
    d.line((9, 4, 10, 9), fill=GOLD_LO)
    d.line((4, 4, 3, 8), fill=GOLD_HI)
    d.rectangle((5, 11, 7, 12), fill=GOLD_LO)
    d.point((7, 3), fill=GOLD_HI)
    # red bow on top
    d.point((4, 2), fill=RED)
    d.point((8, 2), fill=RED)
    save(outline(im), "natal-sino.png")


sino()


# ---------- small Santa hat (friends' level coin) ----------
def gorrinho():
    im = Image.new("RGBA", (18, 14), NONE)
    d = ImageDraw.Draw(im)
    d.polygon([(2, 10), (14, 10), (11, 3), (16, 4)], fill=RED)
    d.polygon([(8, 10), (14, 10), (12, 5)], fill=RED_LO)
    d.line((5, 6, 10, 3), fill=RED_HI)
    d.rectangle((1, 10, 15, 12), fill=WHITE)
    d.line((1, 12, 15, 12), fill=WHITE_LO)
    d.ellipse((14, 2, 17, 5), fill=WHITE)
    save(outline(im), "natal-gorrinho.png")


gorrinho()


# ---------- wreath (around the crest) ----------
def guirlanda():
    s = 34
    im = Image.new("RGBA", (s, s), NONE)
    px = im.load()
    c = (s - 1) / 2
    for y in range(s):
        for x in range(s):
            r = math.hypot(x - c, y - c)
            if 11.2 <= r <= 15.6:
                a = math.atan2(y - c, x - c)
                leaf = math.sin(a * 14 + r * 1.3)
                px[x, y] = GREEN_HI if leaf > 0.55 else (GREEN_LO if leaf < -0.45 else GREEN)
    for i in range(10):
        a = i * math.pi / 5 + 0.3
        bx, by = round(c + 13.4 * math.cos(a)), round(c + 13.4 * math.sin(a))
        if by < c + 8:  # berries everywhere but under the bow
            px[bx, by] = RED
            px[bx + 1, by] = RED_HI
    d = ImageDraw.Draw(im)
    # red bow at the bottom
    b = round(c) + 13
    d.polygon([(c - 6, b - 3), (c, b), (c - 6, b + 3)], fill=RED)
    d.polygon([(c + 6, b - 3), (c, b), (c + 6, b + 3)], fill=RED)
    d.line((c - 1, b, c - 3, b + 4), fill=RED_LO)
    d.line((c + 1, b, c + 3, b + 4), fill=RED_LO)
    d.rectangle((c - 1, b - 1, c + 1, b + 1), fill=RED_HI)
    save(outline(im), "natal-guirlanda.png")


guirlanda()
