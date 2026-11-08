"""Pixel-aligned comparison with the reference hero render (camera from tools/fit_camera.py).
Usage: python3 tools/hero_overlay.py render.png out_prefix"""
import sys
from PIL import Image, ImageChops, ImageFilter
import numpy as np
ref = Image.open('reference/ref-02-design-annotations.jpg').convert('RGB')
mine = Image.open(sys.argv[1]).convert('RGB').resize((ref.width // 2, ref.height // 2), Image.LANCZOS)
ref = ref.resize(mine.size, Image.LANCZOS)
box = (60, 60, 1000, 520)
r, m = ref.crop(box), mine.crop(box)
out = Image.new('RGB', (r.width, r.height * 2 + 6), 'white'); out.paste(r, (0, 0)); out.paste(m, (0, r.height + 6))
out.save(sys.argv[2] + '_stack.png')
# edges of my render over the reference
e = np.asarray(m.convert('L').filter(ImageFilter.FIND_EDGES)).astype(float)
mask = Image.fromarray(((e > 40) * 255).astype(np.uint8))
ov = r.copy(); ov.paste((0, 255, 120), mask=mask); ov.save(sys.argv[2] + '_edges.png')
Image.blend(r, m, 0.5).save(sys.argv[2] + '_blend.png')
print('ok')
