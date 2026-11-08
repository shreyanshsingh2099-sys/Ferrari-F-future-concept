# Overlay the generated body's side silhouette and plan outline on the reference sheet.
import json, sys
from PIL import Image, ImageDraw
prof = json.load(open(sys.argv[1]))
out = sys.argv[2]
im = Image.open('reference/ref-01-orthographic-views.png').convert('RGB')
d = ImageDraw.Draw(im)
S = 0.00792
keys = sorted(int(k) for k in prof)
side_top = []; side_bot = []; plan_a = []; plan_b = []
# top view mapping: X -> x_top = 64 + (2.465 - X)/0.007372 ; halfwidth -> px/0.007372/1.03 around centre 426
for k in keys:
    o = prof[str(k)]; X = k / 100
    px = 720.5 - X / S
    side_top.append((px, 222 - o['top'] / S)); side_bot.append((px, 222 - o['bot'] / S))
    xt = 64 + (2.465 - X) / 0.007372
    hw = o['w'] / 1.03 / 0.007372
    plan_a.append((xt, 426 - hw)); plan_b.append((xt, 426 + hw))
for pts in (side_top, side_bot, plan_a, plan_b):
    d.line(pts, fill=(0, 255, 0), width=1)
im.crop((380, 50, 1010, 240)).resize((630 * 2, 190 * 2), Image.LANCZOS).save(out.replace('.png', '_side.png'))
im.crop((50, 260, 710, 580)).resize((660 * 2, 320 * 2), Image.LANCZOS).save(out.replace('.png', '_top.png'))
