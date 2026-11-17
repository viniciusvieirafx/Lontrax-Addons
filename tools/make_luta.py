"""Sprites for the otter vs murloc skirmish (pixel art, same palette as the otter).

    python tools/make_luta.py

Writes into src/ui (all are picked up by the lontrinha-*.png glob in the .csproj):
  lontrinha-luta.png    otter swinging a sword, 4 frames of 36x28 (otter at x+8, sword on the left)
  lontrinha-murloc.png  murloc walking to the right, 4 frames of 28x28
  lontrinha-poof.png    smoke puff, 4 frames of 28x28
Original drawings, no game art.
"""
import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UI = os.path.join(ROOT, "src", "ui")

# otter palette (from lontrinha-parada.png)
O = (26, 18, 12, 255)        # outline
GOLD = (226, 186, 80, 255)
GOLD_LO = (154, 116, 36, 255)
STEEL = (180, 190, 210, 255)
STEEL_HI = (232, 238, 248, 255)
STEEL_LO = (112, 122, 146, 255)
FUR = (138, 90, 52, 255)
FUR_LO = (104, 66, 36, 255)
CREAM = (236, 217, 176, 255)

# murloc palette
M_OUT = (14, 36, 26, 255)
M_G = (70, 160, 92, 255)
M_GLO = (42, 112, 66, 255)
M_GHI = (120, 200, 120, 255)
M_BELLY = (186, 222, 150, 255)
M_FIN = (236, 120, 52, 255)
M_FINLO = (176, 70, 34, 255)
WHITE = (255, 255, 255, 255)
BLACK = (14, 12, 12, 255)
MOUTH = (120, 30, 44, 255)


def outline(im, color):
    """Dark 1px outline around everything opaque (4-neighbourhood)."""
    w, h = im.size
    src = im.load()
    out = im.copy()
    px = out.load()
    for y in range(h):
        for x in range(w):
            if src[x, y][3]:
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < w and 0 <= ny < h and src[nx, ny][3] and src[nx, ny] != color:
                    px[x, y] = color
                    break
    return out


def ellipse(px, cx, cy, rx, ry, color, w=28, h=28):
    for y in range(h):
        for x in range(w):
            if ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1:
                px[x, y] = color


def line(px, pts, color):
    for x, y in pts:
        px[x, y] = color


# ---------------------------------------------------------------- murloc
def murloc_frame(step):
    bob = 1 if step in (1, 3) else 0
    im = Image.new("RGBA", (28, 28), (0, 0, 0, 0))
    px = im.load()
    oy = bob
    # legs (alternate)
    lx = [(9, 11), (14, 16)]
    if step == 1:
        lx = [(8, 10), (15, 17)]
    if step == 3:
        lx = [(10, 12), (13, 15)]
    for a, b in lx:
        for x in range(a, b + 1):
            for y in range(23, 26):
                px[x, y] = M_GLO
        px[b + 1, 25] = M_GLO
    # body + head (one pear)
    ellipse(px, 12.5, 19 + oy, 6.5, 5.5, M_G)
    ellipse(px, 13.5, 11 + oy, 8.5, 7.5, M_G)
    # shade on the back (left), highlight on the forehead
    for y in range(28):
        for x in range(28):
            if px[x, y] == M_G and x <= 7:
                px[x, y] = M_GLO
    for x, y in ((11, 5), (12, 5), (13, 5), (10, 6), (11, 6)):
        px[x, y + oy] = M_GHI
    # belly
    ellipse(px, 13, 19.5 + oy, 4, 4, M_BELLY)
    # head fin (spiky crest from the top of the head down the back)
    fins = [(7, 3), (9, 2), (11, 2), (13, 2), (6, 5), (5, 7)]
    for i, (x, y) in enumerate(fins):
        px[x, y + oy] = M_FIN
        px[x, y + 1 + oy] = M_FINLO if i % 2 else M_FIN
    # side fin (fan behind the eye, striped)
    for i, (x, y0, y1) in enumerate(((10, 8, 12), (9, 7, 13), (8, 8, 14), (7, 9, 13))):
        for y in range(y0, y1 + 1):
            px[x, y + oy] = M_FINLO if i % 2 else M_FIN
    # spots on the back
    for x, y in ((6, 11), (8, 16), (5, 14), (14, 4)):
        if px[x, y + oy][3]:
            px[x, y + oy] = M_GLO
    # eye (big, facing right)
    for x in range(17, 21):
        for y in range(6, 10):
            px[x, y + oy] = WHITE
    px[19, 7 + oy] = BLACK
    px[20, 7 + oy] = BLACK
    px[19, 8 + oy] = BLACK
    px[20, 8 + oy] = BLACK
    # mouth: wide, opens and closes while walking ("mrglgl")
    open_ = step in (0, 2)
    my = 12 + oy
    for x in range(14, 23):
        px[x, my] = MOUTH
        if open_:
            px[x, my + 1] = MOUTH
            if x >= 17:
                px[x, my + 2] = MOUTH
    if open_:
        for x in (15, 17, 19, 21):
            px[x, my] = WHITE  # teeth
        px[19, my + 2] = (220, 90, 110, 255)  # tongue
        px[20, my + 2] = (220, 90, 110, 255)
    # arms: one forward (toward the otter), one back
    arm_y = 17 + oy + (1 if step % 2 else 0)
    for x in range(20, 24):
        px[x, arm_y] = M_G
    px[24, arm_y - 1] = M_G
    px[24, arm_y] = M_G
    for x in range(4, 6):
        px[x, 18 + oy] = M_GLO
    return outline(im, M_OUT)


# ---------------------------------------------------------------- otter with sword
def otter_base():
    src = Image.open(os.path.join(UI, "lontrinha-parada.png")).convert("RGBA")
    return src.crop((0, 0, 28, 28))


def sword(px, hand, tip, blade=True):
    """Blade from hand to tip (Bresenham), guard at the hand."""
    (x0, y0), (x1, y1) = hand, tip
    dx, dy = abs(x1 - x0), -abs(y1 - y0)
    sx = 1 if x0 < x1 else -1
    sy = 1 if y0 < y1 else -1
    err = dx + dy
    pts = []
    x, y = x0, y0
    while True:
        pts.append((x, y))
        if (x, y) == (x1, y1):
            break
        e2 = 2 * err
        if e2 >= dy:
            err += dy
            x += sx
        if e2 <= dx:
            err += dx
            y += sy
    for i, (x, y) in enumerate(pts):
        if i < 2:
            px[x, y] = GOLD_LO
        else:
            px[x, y] = STEEL_HI if i % 3 == 0 else STEEL
    return pts


def otter_frame(kind):
    W = 36
    im = Image.new("RGBA", (W, 28), (0, 0, 0, 0))
    im.alpha_composite(otter_base(), (8, 0))
    px = im.load()
    # paw at the left side of the body, holding the hilt
    hands = {"up": (13, 13), "swing": (12, 16), "down": (12, 18), "ready": (13, 15)}
    tips = {"up": (4, 2), "swing": (0, 15), "down": (2, 26), "ready": (5, 7)}
    hx, hy = hands[kind]
    pts = sword(px, (hx, hy), tips[kind])
    # guard: small gold bar across the blade near the hand
    gx, gy = pts[2]
    for ox, oy in ((0, -1), (0, 1), (-1, 0), (1, 0)):
        if 0 <= gx + ox < W and 0 <= gy + oy < 28 and px[gx + ox, gy + oy][3] == 0:
            px[gx + ox, gy + oy] = GOLD
    # paw
    for x, y in ((hx, hy), (hx + 1, hy), (hx, hy + 1), (hx + 1, hy + 1)):
        px[x, y] = FUR
    px[hx + 1, hy + 1] = CREAM
    im = outline(im, O)
    px = im.load()
    # swing trail (drawn after the outline so it stays light)
    if kind == "swing":
        for x, y in ((2, 8), (1, 10), (1, 12), (3, 19), (2, 21)):
            px[x, y] = (255, 246, 210, 200)
    if kind == "down":
        for x, y in ((0, 12), (0, 15), (1, 18), (1, 21)):
            px[x, y] = (255, 246, 210, 200)
    return im


# ---------------------------------------------------------------- smoke puff
def poof_frame(step):
    im = Image.new("RGBA", (28, 28), (0, 0, 0, 0))
    px = im.load()
    r = [4, 7, 9, 10][step]
    a = [255, 235, 170, 90][step]
    light = (232, 226, 210, a)
    mid = (180, 172, 160, a)
    blobs = [(14, 16, r), (9, 18, r * 0.7), (19, 18, r * 0.7), (14, 11, r * 0.6)]
    for cx, cy, rr in blobs:
        ellipse(px, cx, cy, rr, rr * 0.8, mid)
    for cx, cy, rr in blobs:
        ellipse(px, cx - 1, cy - 1, rr * 0.7, rr * 0.55, light)
    if step >= 1:  # little stars
        for x, y in ((4, 6), (23, 5), (25, 22))[: step + 0]:
            px[x, y] = GOLD
    return im


def strip(frames):
    w, h = frames[0].size
    out = Image.new("RGBA", (w * len(frames), h), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        out.alpha_composite(f, (i * w, 0))
    return out


if __name__ == "__main__":
    strip([otter_frame(k) for k in ("ready", "up", "swing", "down")]).save(os.path.join(UI, "lontrinha-luta.png"))
    strip([murloc_frame(i) for i in range(4)]).save(os.path.join(UI, "lontrinha-murloc.png"))
    strip([poof_frame(i) for i in range(4)]).save(os.path.join(UI, "lontrinha-poof.png"))
    print("ok")
