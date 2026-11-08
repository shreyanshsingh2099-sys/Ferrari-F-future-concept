"""Side-by-side + overlay comparison of orthographic renders against the reference sheet.

Usage: python3 tools/compare.py <render_dir> <out_dir>
Expects ortho_side.png, ortho_top.png, ortho_front.png, ortho_rear.png rendered by
tools/shoot.mjs at 1376x768 (ortho half-heights: side/top 2.6 m, front/rear 1.25 m).
"""
import sys, os
from PIL import Image, ImageDraw, ImageFilter, ImageChops
import numpy as np

REF = 'reference/ref-01-orthographic-views.png'
W, H = 1376, 768
OUT_S = 260  # output pixels per metre

# mapping functions world(a,b) -> pixel for reference and for my renders.
# side: a = X, b = Y   | top: a = X, b = Z | front/rear: a = Z, b = Y
VIEWS = {
    'side': dict(win=((2.62, -2.30), (-0.05, 1.32)),
                 ref=lambda a, b: (720.5 - a * 126.26, 222 - b * 126.26),
                 mine=lambda a, b: (W / 2 - (a - 0.17) * (H / 5.2), H / 2 - (b - 0.58) * (H / 5.2))),
    'top': dict(win=((2.62, -2.30), (-1.25, 1.25)),
                ref=lambda a, b: (64 + (2.465 - a) * 135.65, 426 - b * 131.7),
                mine=lambda a, b: (W / 2 - (a - 0.17) * (H / 5.2), H / 2 - b * (H / 5.2))),
    'front': dict(win=((1.15, -1.15), (-0.05, 1.32)),
                  ref=lambda a, b: (212.5 - a * 148.0, 225 - b * 135.0),
                  mine=lambda a, b: (W / 2 - a * (H / 2.5), H / 2 - (b - 0.58) * (H / 2.5))),
    'rear': dict(win=((-1.15, 1.15), (-0.05, 1.32)),
                 ref=lambda a, b: (1171.5 + a * 142.5, 225 - b * 128.0),
                 mine=lambda a, b: (W / 2 + a * (H / 2.5), H / 2 - (b - 0.58) * (H / 2.5))),
}


def resample(img, fmap, win):
    (a0, a1), (b0, b1) = win
    ow = int(abs(a1 - a0) * OUT_S); oh = int(abs(b1 - b0) * OUT_S)
    # affine: out pixel (i,j) -> world (a,b) -> src pixel
    pa = fmap(a0, b1); pb = fmap(a1, b1); pc = fmap(a0, b0)
    sx = (pb[0] - pa[0]) / ow; sy = (pc[1] - pa[1]) / oh
    # PIL affine maps output->input: x_in = a*x + b*y + c ; y_in = d*x + e*y + f
    return img.transform((ow, oh), Image.AFFINE, (sx, 0, pa[0], 0, sy, pa[1]), resample=Image.BICUBIC)


def silhouette(img):
    a = np.asarray(img.convert('RGB')).astype(float) / 255
    mx = a.max(-1); mn = a.min(-1)
    sat = (mx - mn) / (mx + 1e-6)
    m = (sat > 0.22) | (mx < 0.45)
    return Image.fromarray((m * 255).astype(np.uint8))


def main():
    rd, od = sys.argv[1], sys.argv[2]
    os.makedirs(od, exist_ok=True)
    ref = Image.open(REF).convert('RGB')
    for name, v in VIEWS.items():
        f = os.path.join(rd, f'ortho_{name}.png')
        if not os.path.exists(f):
            continue
        mine = Image.open(f).convert('RGB')
        r = resample(ref, v['ref'], v['win'])
        m = resample(mine, v['mine'], v['win'])
        # overlay: my silhouette edges in green on the reference
        sm = silhouette(m).filter(ImageFilter.FIND_EDGES)
        ov = r.copy()
        ov.paste((0, 255, 0), mask=sm)
        sr = silhouette(r).filter(ImageFilter.FIND_EDGES)
        ov2 = m.copy(); ov2.paste((255, 0, 255), mask=sr)
        out = Image.new('RGB', (r.width, r.height * 3 + 8), (255, 255, 255))
        out.paste(r, (0, 0)); out.paste(m, (0, r.height + 4)); out.paste(ov2, (0, 2 * r.height + 8))
        out.save(os.path.join(od, f'cmp_{name}.png'))
        ov.save(os.path.join(od, f'ovl_{name}.png'))
        print('wrote', name)


if __name__ == '__main__':
    main()
