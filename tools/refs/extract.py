"""Extract car silhouettes from the reference sheets and calibrate their scale.

Each view region is segmented from the light sheet background; side views are
scaled by the 2.70 m wheelbase (wheel centres found from the dark tyre discs),
plan/front/rear views by the 2.00 m body width.
"""
import json, sys
import numpy as np
from PIL import Image

def load(path):
    return np.asarray(Image.open(path).convert('RGB')).astype(float) / 255

def car_mask(a, bg_thresh=0.13):
    # background = light, low-saturation; estimate from region border
    border = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]])
    bg = np.median(border, axis=0)
    d = np.sqrt(((a - bg) ** 2).sum(-1))
    mx, mn = a.max(-1), a.min(-1)
    sat = (mx - mn) / (mx + 1e-6)
    return (d > bg_thresh) & ((sat > 0.18) | (mx < 0.55))

def clean(m, min_run=3):
    # remove thin grid lines: require a pixel to have neighbours in both axes
    from scipy import ndimage
    m = ndimage.binary_opening(m, structure=np.ones((3, 3)))
    lab, n = ndimage.label(m)
    if n == 0: return m
    sizes = ndimage.sum(m, lab, range(1, n + 1))
    keep = np.argmax(sizes) + 1
    m = lab == keep
    return ndimage.binary_fill_holes(m)

def tyres(a, m):
    """Find the two wheel centres in a side view: darkest disc-like blobs in the lower half."""
    from scipy import ndimage
    h, w = m.shape
    dark = (a.max(-1) < 0.32) & m
    dark[: int(h * 0.45)] = False
    lab, n = ndimage.label(ndimage.binary_closing(dark, np.ones((5, 5))))
    blobs = []
    for i in range(1, n + 1):
        ys, xs = np.where(lab == i)
        if len(xs) < 80: continue
        blobs.append((len(xs), xs.mean(), ys.mean(), xs.min(), xs.max(), ys.min(), ys.max()))
    blobs.sort(reverse=True)
    return blobs[:4]

if __name__ == '__main__':
    cfg = json.load(open(sys.argv[1]))
    out = {}
    for name, v in cfg.items():
        a = load(v['file'])[v['box'][1]:v['box'][3], v['box'][0]:v['box'][2]]
        m = clean(car_mask(a, v.get('bg', 0.13)))
        ys, xs = np.where(m)
        out[name] = {'bbox': [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())], 'size': [int(m.shape[1]), int(m.shape[0])]}
        if v['kind'] == 'side':
            out[name]['tyres'] = [[round(float(b[1]), 1), round(float(b[2]), 1)] + [int(t) for t in b[3:7]] + [int(b[0])] for b in tyres(a, m)]
        Image.fromarray((m * 255).astype(np.uint8)).save(f"{v['outdir']}/mask_{name}.png")
    print(json.dumps(out, indent=1))

def wheel_centres(a, m):
    """Tyre contact patches: the lowest very-dark pixels per column form two runs."""
    h, w = m.shape
    dark = (a.max(-1) < 0.30) & m
    yb = np.full(w, -1)
    for c in range(w):
        r = np.where(dark[:, c])[0]
        if len(r): yb[c] = r.max()
    ymax = yb.max()
    good = yb >= ymax - 3
    runs, start = [], None
    for c in range(w + 1):
        g = c < w and good[c]
        if g and start is None: start = c
        if not g and start is not None: runs.append((c - start, start, c - 1)); start = None
    runs.sort(reverse=True)
    runs = sorted(runs[:2], key=lambda r: r[1])
    return [(r[1] + r[2]) / 2 for r in runs], int(ymax)
