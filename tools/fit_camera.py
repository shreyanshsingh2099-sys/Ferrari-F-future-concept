"""Recover the camera of the reference hero render (ref-02) from visible landmarks.

Landmarks: (image px in the 2576x1438 original) <-> (model coordinates, metres).
Solves position, yaw, pitch, roll and focal length of a pinhole camera with the
principal point at the image centre, then prints a viewer URL fragment.
"""
import numpy as np
from scipy.optimize import least_squares

W, H = 2576, 1438
L = [  # (u, v), (x, y, z)
    ((1204, 695), (1.35, 0.336, -0.96)),    # front-left hub cap
    ((1736, 566), (-1.35, 0.352, -0.98)),   # rear-left hub cap
    ((490, 669), (2.445, 0.405, 0.0)),      # nose badge
    ((753, 403), (0.555, 0.866, 0.99)),     # right (far) mirror head
    ((1425, 448), (0.555, 0.866, -0.99)),   # left (near) mirror head
    ((1825, 331), (-2.10, 1.06, -0.872)),   # near wing tip (top)
    ((1751, 682), (-1.35, 0.0, -0.93)),     # rear-left tyre contact
    ((1232, 840), (1.35, 0.0, -0.95)),      # front-left tyre contact
    ((1038, 573), (2.08, 0.585, -0.92)),    # left headlight outer end
    ((1280, 518), (0.985, 0.705, -0.96)),   # left fender badge
]

def project(p, pts):
    cx, cy, cz, yaw, pitch, roll, f = p
    C = np.array([cx, cy, cz])
    # camera forward from yaw (around y) and pitch
    fwd = np.array([np.cos(pitch) * np.cos(yaw), np.sin(pitch), np.cos(pitch) * np.sin(yaw)])
    up0 = np.array([0, 1, 0.0])
    right = np.cross(fwd, up0); right /= np.linalg.norm(right)
    up = np.cross(right, fwd)
    cr, sr = np.cos(roll), np.sin(roll)
    right, up = cr * right + sr * up, -sr * right + cr * up
    out = []
    for P in pts:
        d = np.array(P) - C
        x, y, z = d @ right, d @ up, d @ fwd
        out.append((W / 2 + f * x / z, H / 2 - f * y / z))
    return np.array(out)

uv = np.array([l[0] for l in L], float)
P3 = [l[1] for l in L]
def resid(p): return (project(p, P3) - uv).ravel()

best = None
for yaw0 in np.linspace(2.0, 3.6, 9):
    for d in (5, 7, 9):
        tgt = np.array([0.2, 0.5, 0])
        C0 = tgt - d * np.array([np.cos(yaw0), 0, np.sin(yaw0)]) + np.array([0, 1.2, 0])
        p0 = [*C0, yaw0, -0.12, 0.0, 2500]
        lo = [-15, 0.2, -15, -10, -0.8, -0.15, 900]; hi = [15, 5, 15, 10, 0.3, 0.15, 9000]
        p0 = np.clip(p0, np.array(lo) + 1e-6, np.array(hi) - 1e-6)
        r = least_squares(resid, p0, bounds=(lo, hi), loss='soft_l1', f_scale=40, max_nfev=20000)
        if best is None or r.cost < best.cost: best = r
p = best.x
err = np.sqrt((resid(p).reshape(-1, 2) ** 2).sum(1))
cx, cy, cz, yaw, pitch, roll, f = p
fwd = np.array([np.cos(pitch) * np.cos(yaw), np.sin(pitch), np.cos(pitch) * np.sin(yaw)])
tgt = np.array([cx, cy, cz]) + fwd * 4
vfov = np.degrees(2 * np.arctan(H / 2 / f))
print('residuals px:', np.round(err, 1), 'rms', round(float(np.sqrt((err ** 2).mean())), 1))
print('camera', np.round([cx, cy, cz], 3), 'target', np.round(tgt, 3), 'roll(deg)', round(float(np.degrees(roll)), 2), 'vfov', round(float(vfov), 2))
print(f'cam={cx:.3f},{cy:.3f},{cz:.3f}&target={tgt[0]:.3f},{tgt[1]:.3f},{tgt[2]:.3f}&fov={vfov:.2f}&roll={np.degrees(roll):.2f}')
