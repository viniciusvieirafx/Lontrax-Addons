"""Lontrinha de armadura (pixel art) para o Lontrax Addons.

Desenha a mascote pixel a pixel e gera, para cada animação, uma folha de sprites
(quadros lado a lado, 28x28 cada) + um GIF de prévia ampliado.
    python tools/lontrinha.py assets/lontrinha
"""
import math, os, sys
from PIL import Image

W = H = 28
PAL = {
    'K': (26, 18, 12, 255),     # contorno
    'B': (138, 90, 52, 255),    # pelo
    'b': (104, 66, 36, 255),    # pelo sombra
    'C': (236, 217, 176, 255),  # creme (focinho/barriga)
    'N': (14, 12, 12, 255),     # olhos/nariz
    'w': (255, 255, 255, 255),  # brilho do olho
    'S': (180, 190, 210, 255),  # aço
    's': (112, 122, 146, 255),  # aço sombra
    'L': (232, 238, 248, 255),  # aço brilho
    'G': (226, 186, 80, 255),   # ouro
    'g': (154, 116, 36, 255),   # ouro sombra
    'A': (36, 71, 168, 255),    # azul real
    'a': (22, 48, 111, 255),    # azul sombra
    'R': (180, 60, 60, 255),    # bochecha
    'Y': (255, 236, 150, 255),  # brilho estrela
    'H': (120, 80, 44, 255),    # cabo do martelo
}


class Canvas:
    def __init__(self):
        self.px = {}

    def put(self, x, y, c):
        x, y = int(round(x)), int(round(y))
        if 0 <= x < W and 0 <= y < H:
            self.px[(x, y)] = c

    def ellipse(self, cx, cy, rx, ry, c, ymax=None):
        for y in range(H):
            for x in range(W):
                if ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1.0 and (ymax is None or y <= ymax):
                    self.px[(x, y)] = c

    def rect(self, x0, y0, x1, y1, c):
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                self.put(x, y, c)

    def line(self, x0, y0, x1, y1, c):
        n = int(max(abs(x1 - x0), abs(y1 - y0))) + 1
        for i in range(n):
            t = i / max(n - 1, 1)
            self.put(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, c)

    def outline(self, skip=('Y',)):
        """Contorno escuro de 1 pixel em volta de tudo (estilo pixel art)."""
        filled = {p for p, c in self.px.items() if c not in skip}
        for (x, y) in list(filled):
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                q = (x + dx, y + dy)
                if q not in self.px and 0 <= q[0] < W and 0 <= q[1] < H:
                    self.px[q] = 'K'

    def image(self):
        im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        for (x, y), c in self.px.items():
            im.putpixel((x, y), PAL[c])
        return im


def otter(dy=0, blink=False, arm_l='down', arm_r='down', mouth='smile', squash=0):
    """Lontrinha sentada de frente: elmo, tabardo da Aliança, rabinho."""
    c = Canvas()
    oy = 3 + dy  # deslocamento vertical (pulo/respiração)
    cx = 13
    # rabo (atrás, à direita)
    c.ellipse(cx + 7, oy + 19, 3.2, 1.8, 'b')
    c.put(cx + 10, oy + 18, 'b')
    # pés
    c.ellipse(cx - 3, oy + 22, 2.2, 1.1, 'b')
    c.ellipse(cx + 3, oy + 22, 2.2, 1.1, 'b')
    # corpo
    c.ellipse(cx, oy + 16 + squash * 0.5, 6.2, 6.0 - squash, 'B')
    c.ellipse(cx + 2.5, oy + 17, 3, 4.5, 'b')  # sombra lateral
    c.ellipse(cx, oy + 16 + squash * 0.5, 5.6, 5.6 - squash, 'B')
    # tabardo azul com borda dourada e o emblema
    c.rect(cx - 3, oy + 12, cx + 3, oy + 20, 'A')
    c.rect(cx + 1, oy + 12, cx + 3, oy + 20, 'a')
    c.rect(cx - 3, oy + 12, cx - 3, oy + 20, 'G')
    c.rect(cx + 3, oy + 12, cx + 3, oy + 20, 'g')
    c.rect(cx - 3, oy + 20, cx + 3, oy + 20, 'G')
    c.put(cx, oy + 21, 'G')
    c.rect(cx - 1, oy + 14, cx + 1, oy + 16, 'G')  # brasão
    c.put(cx, oy + 15, 'A')
    c.put(cx + 1, oy + 16, 'g')
    # cabeça
    c.ellipse(cx, oy + 8, 5.4, 4.6, 'B')
    c.ellipse(cx + 2.5, oy + 9, 2.5, 3, 'b')
    c.ellipse(cx, oy + 8, 4.8, 4.2, 'B')
    # orelhinhas (aparecem dos lados do elmo)
    c.put(cx - 5, oy + 6, 'b')
    c.put(cx + 5, oy + 6, 'b')
    # focinho creme
    c.ellipse(cx, oy + 10.3, 3.2, 2.0, 'C')
    c.put(cx, oy + 9, 'N')        # nariz
    c.put(cx - 1, oy + 9, 'N')
    if mouth == 'open':
        c.put(cx, oy + 11, 'N')
        c.put(cx - 1, oy + 11, 'R')
    else:
        c.put(cx - 2, oy + 11, 'b')
        c.put(cx + 1, oy + 11, 'b')
    c.put(cx - 4, oy + 10, 'R')   # bochechas
    c.put(cx + 3, oy + 10, 'R')
    # olhos
    if blink:
        c.rect(cx - 3, oy + 7, cx - 2, oy + 7, 'N')
        c.rect(cx + 1, oy + 7, cx + 2, oy + 7, 'N')
    else:
        c.rect(cx - 3, oy + 6, cx - 3, oy + 7, 'N')
        c.rect(cx + 2, oy + 6, cx + 2, oy + 7, 'N')
        c.put(cx - 3, oy + 6, 'w')
        c.put(cx + 2, oy + 6, 'w')
    # elmo de aço
    c.ellipse(cx, oy + 4.6, 5.6, 3.6, 'S', ymax=oy + 5)
    c.ellipse(cx + 2, oy + 4.6, 3, 3, 's', ymax=oy + 5)
    c.ellipse(cx, oy + 4.6, 4.8, 3.0, 'S', ymax=oy + 5)
    c.put(cx - 3, oy + 3, 'L')
    c.put(cx - 2, oy + 2, 'L')
    c.rect(cx - 6, oy + 5, cx + 6, oy + 5, 's')  # aba
    c.rect(cx - 6, oy + 5, cx + 1, oy + 5, 'S')
    c.rect(cx - 5, oy + 4, cx + 5, oy + 4, 'G')  # faixa dourada
    c.rect(cx + 2, oy + 4, cx + 5, oy + 4, 'g')
    # penacho dourado
    c.put(cx, oy + 1, 'G')
    c.put(cx, oy + 0, 'G')
    c.put(cx + 1, oy - 1, 'G')
    c.put(cx - 1, oy + 0, 'g')
    # braços
    arms = {
        'down_l': [(cx - 6, oy + 15), (cx - 6, oy + 16), (cx - 6, oy + 17)],
        'down_r': [(cx + 6, oy + 15), (cx + 6, oy + 16), (cx + 6, oy + 17)],
        'up_l': [(cx - 6, oy + 12), (cx - 7, oy + 11), (cx - 7, oy + 10), (cx - 8, oy + 9)],
        'up_r': [(cx + 6, oy + 12), (cx + 7, oy + 11), (cx + 7, oy + 10), (cx + 8, oy + 9)],
        'wave1_r': [(cx + 6, oy + 13), (cx + 7, oy + 12), (cx + 8, oy + 11), (cx + 9, oy + 10)],
        'wave2_r': [(cx + 6, oy + 13), (cx + 7, oy + 12), (cx + 7, oy + 11), (cx + 7, oy + 10)],
        'front_r': [(cx + 5, oy + 14), (cx + 6, oy + 14), (cx + 7, oy + 13)],
    }
    for key in (arm_l + '_l', arm_r + '_r'):
        pts = arms.get(key, [])
        for i, (x, y) in enumerate(pts):
            c.put(x, y, 'B')
            if i == len(pts) - 1:
                c.put(x, y, 'C')  # patinha
    return c


def frames_idle():
    out = []
    for i, (dy, blink) in enumerate([(0, False), (0, False), (1, False), (1, True)]):
        c = otter(dy=dy, blink=blink)
        c.outline()
        out.append(c)
    return out


def frames_wave():
    out = []
    for i in range(4):
        c = otter(dy=0 if i % 2 == 0 else 1, arm_r='wave1' if i % 2 == 0 else 'wave2', mouth='open')
        # "!" dourado piscando no canto
        if i != 3:
            c.rect(24, 1, 25, 5, 'G')
            c.rect(25, 1, 25, 5, 'g')
            c.rect(24, 7, 25, 8, 'G')
        c.outline()
        out.append(c)
    return out


def frames_work():
    """Martelando: o martelo sobe e desce, faíscas quando bate."""
    out = []
    for i in range(4):
        down = i % 2 == 1
        c = otter(dy=1 if down else 0, arm_r='front', squash=1 if down else 0)
        oy = 3 + (1 if down else 0)
        hx, hy = 21, oy + 13
        if down:
            c.line(hx - 2, hy, hx + 2, hy + 3, 'H')        # cabo
            c.rect(hx + 1, hy + 3, hx + 4, hy + 5, 'S')    # cabeça do martelo
            c.rect(hx + 3, hy + 3, hx + 4, hy + 5, 's')
            c.rect(hx - 1, hy + 7, hx + 6, hy + 7, 'b')    # bigorna/pedra
        else:
            c.line(hx - 2, hy, hx + 1, hy - 5, 'H')
            c.rect(hx - 1, hy - 8, hx + 2, hy - 6, 'S')
            c.rect(hx + 1, hy - 8, hx + 2, hy - 6, 's')
            c.rect(hx - 1, hy + 7, hx + 6, hy + 7, 'b')
        c.outline()
        if down:  # faíscas (sem contorno)
            for (x, y) in ((hx + 6, hy + 2), (hx + 5, hy + 1) if i == 1 else (hx + 6, hy), (hx - 1, hy + 2)):
                c.put(x, y, 'Y')
        out.append(c)
    return out


def frames_celebrate():
    out = []
    jumps = [0, -2, -3, -1]
    stars = [[], [(3, 4), (23, 6)], [(2, 9), (24, 3), (20, 0)], [(4, 2), (22, 9)]]
    for i in range(4):
        c = otter(dy=jumps[i], arm_l='up', arm_r='up', mouth='open', blink=(i == 2))
        c.outline()
        for (x, y) in stars[i]:
            c.put(x, y, 'Y')
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                c.put(x + dx, y + dy, 'G')
        out.append(c)
    return out


ANIMS = {
    'parada': (frames_idle, 500),
    'avisando': (frames_wave, 220),
    'trabalhando': (frames_work, 150),
    'comemorando': (frames_celebrate, 130),
}


def main(outdir):
    os.makedirs(outdir, exist_ok=True)
    gif_frames = []
    for name, (fn, ms) in ANIMS.items():
        frames = [f.image() for f in fn()]
        sheet = Image.new('RGBA', (W * len(frames), H), (0, 0, 0, 0))
        for i, im in enumerate(frames):
            sheet.paste(im, (i * W, 0))
        sheet.save(os.path.join(outdir, f'lontrinha-{name}.png'))
        # prévia: 3 voltas de cada animação, ampliada 8x, fundo azul do app
        for _ in range(3):
            for im in frames:
                big = Image.new('RGBA', (W * 8, H * 8), (8, 17, 41, 255))
                big.alpha_composite(im.resize((W * 8, H * 8), Image.NEAREST))
                gif_frames.append((big.convert('P', palette=Image.ADAPTIVE), ms))
    gif_frames[0][0].save(os.path.join(outdir, 'previa-lontrinha.gif'), save_all=True,
                          append_images=[f for f, _ in gif_frames[1:]],
                          duration=[d for _, d in gif_frames], loop=0, disposal=2)
    print('ok', outdir)


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'lontrinha')
