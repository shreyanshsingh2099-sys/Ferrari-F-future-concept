"""Pixel-aligned comparison of orthographic renders against the newer reference sheets.

Usage: python3 tools/refs/compare2.py <render_dir> <out_dir>
Render files: ortho_side.png, ortho_top.png, ortho_front.png, ortho_rear.png (1376x768).
Each sheet view is calibrated in its own pixel frame (see tools/refs/README notes):
  side  : wheel hub centres + ground line (2.70 m wheelbase)
  top   : nose tip + centreline, scale from overall length
  front/rear: centreline + ground, scale from overall height
"""
import sys, os
import numpy as np
from PIL import Image, ImageFilter, ImageDraw
sys.path.insert(0, os.path.dirname(__file__))
from extract import car_mask, clean

W, H = 1376, 768
OUT_S = 260  # output px per metre
S_SIDE, S_PLAN, S_FR = H / 5.2, H / 5.2, H / 2.5
MINE = {
    'side': lambda a, b: (W / 2 - (a - 0.17) * S_SIDE, H / 2 - (b - 0.58) * S_SIDE),
    'top': lambda a, b: (W / 2 - (a - 0.17) * S_PLAN, H / 2 - b * S_PLAN),
    'front': lambda a, b: (W / 2 - a * S_FR, H / 2 - (b - 0.58) * S_FR),
    'rear': lambda a, b: (W / 2 + a * S_FR, H / 2 - (b - 0.58) * S_FR),
}
k06s, k06t, k06f, k06r = 317 / 2.7, 125.8, 124.6, 122.0
VIEWS = [
    ('s06', 'reference/ref-06-complete-design.png', 'side', ((2.62, -2.30), (-0.05, 1.30)), lambda a, b: (511 + (1.35 - a) * k06s, 204 - b * k06s)),
    ('t06', 'reference/ref-06-complete-design.png', 'top', ((2.62, -2.30), (-1.20, 1.20)), lambda a, b: (61 + (2.455 - a) * k06t, 395.5 - b * k06t)),
    ('f06', 'reference/ref-06-complete-design.png', 'front', ((1.20, -1.20), (-0.05, 1.30)), lambda a, b: (197.5 - a * k06f, 213 - b * k06f)),
    ('r06', 'reference/ref-06-complete-design.png', 'rear', ((-1.20, 1.20), (-0.05, 1.30)), lambda a, b: (1090 + a * k06r, 212 - b * k06r)),
]

def resample(img, fmap, win):
    (a0, a1), (b0, b1) = win
    ow, oh = int(abs(a1 - a0) * OUT_S), int(abs(b1 - b0) * OUT_S)
    pa, pb, pc = fmap(a0, b1), fmap(a1, b1), fmap(a0, b0)
    return img.transform((ow, oh), Image.AFFINE, ((pb[0] - pa[0]) / ow, 0, pa[0], 0, (pc[1] - pa[1]) / oh, pa[1]), resample=Image.BICUBIC, fillcolor=(214, 218, 223))

def edges(img):
    m = clean(car_mask(np.asarray(img.convert('RGB')).astype(float) / 255, 0.11))
    e = Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.FIND_EDGES).filter(ImageFilter.MaxFilter(3))
    return e, m

def main():
    rd, od = sys.argv[1], sys.argv[2]
    os.makedirs(od, exist_ok=True)
    scores = {}
    for name, file, kind, win, fref in VIEWS:
        f = os.path.join(rd, f'ortho_{kind}.png')
        if not os.path.exists(f): continue
        ref = resample(Image.open(file).convert('RGB'), fref, win)
        mine = resample(Image.open(f).convert('RGB'), MINE[kind], win)
        er, mr = edges(ref); em, mm = edges(mine)
        iou = (mr & mm).sum() / max(1, (mr | mm).sum())
        scores[name] = round(float(iou), 4)
        ov = mine.copy(); ov.paste((255, 0, 255), mask=er)
        ov2 = ref.copy(); ov2.paste((0, 200, 90), mask=em)
        out = Image.new('RGB', (ref.width * 2 + 6, ref.height * 2 + 6), 'white')
        out.paste(ref, (0, 0)); out.paste(mine, (ref.width + 6, 0)); out.paste(ov2, (0, ref.height + 6)); out.paste(ov, (ref.width + 6, ref.height + 6))
        out.save(os.path.join(od, f'cmp2_{name}.png'))
    print('silhouette IoU', scores)

if __name__ == '__main__':
    main()
