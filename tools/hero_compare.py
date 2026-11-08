"""Place the reference hero (design sheet 2) next to the matching viewer render."""
import sys
from PIL import Image
ref = Image.open('reference/ref-02-design-annotations.jpg').convert('RGB').crop((280, 180, 1900, 1000))
mine = Image.open(sys.argv[1]).convert('RGB')
h = 560
ref = ref.resize((int(ref.width * h / ref.height), h), Image.LANCZOS)
mine = mine.resize((int(mine.width * h / mine.height), h), Image.LANCZOS)
out = Image.new('RGB', (ref.width + mine.width + 8, h), (255, 255, 255))
out.paste(ref, (0, 0)); out.paste(mine, (ref.width + 8, 0))
out.save(sys.argv[2])
print('wrote', sys.argv[2])
