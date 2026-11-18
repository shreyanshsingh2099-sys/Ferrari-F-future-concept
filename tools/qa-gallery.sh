#!/usr/bin/env bash
# Regenerate the QA gallery in qa/ (orthographic comparisons + feature renders).
set -e
cd "$(dirname "$0")/.."
T=qa/tmp
node tools/shoot.mjs $T ortho:side,ortho:top,ortho:front,ortho:rear "quality=balanced"
python3 tools/compare.py $T $T
for v in side top front rear; do cp $T/cmp_$v.png qa/compare_$v.png; done
python3 tools/refs/compare2.py $T $T
for v in s06 t06 f06 r06; do cp $T/cmp2_$v.png qa/compare_sheet06_$v.png; done
node tools/shoot.mjs $T hero "quality=high" && cp $T/hero.png qa/render_hero.png
W=1288 H=719 node tools/shoot.mjs $T hero "quality=high&cam=7.037,1.174,-4.610&target=3.657,0.641,-2.539&fov=25" && cp $T/hero.png qa/render_reference_angle.png
python3 tools/hero_overlay.py qa/render_reference_angle.png $T/refcam && cp $T/refcam_stack.png qa/compare_hero.png
node tools/shoot.mjs $T view:rearQuarter "quality=high&open=wing" && cp $T/view_rearQuarter.png qa/render_rear_quarter_wing_active.png
node tools/shoot.mjs $T hero "quality=high&open=doorL,doorR" && cp $T/hero.png qa/render_butterfly_doors.png
node tools/shoot.mjs $T mode:interior "quality=high" && cp $T/mode_interior.png qa/render_cockpit.png
node tools/shoot.mjs $T mode:engine "quality=high" && cp $T/mode_engine.png qa/render_v12.png
node tools/shoot.mjs $T mode:engineering "quality=high&ui=1" && cp $T/mode_engineering.png qa/render_engineering_ui.png
node tools/shoot.mjs $T hero "quality=high&theme=dark&ui=1" && cp $T/hero.png qa/render_dark_studio_ui.png
# fun features: one composite sheet (wind tunnel, exploded view, paint, frunk duck, exhaust flames, cockpit)
SHOTS='{"wind":{"cam":[4.2,1.9,-4.6],"target":[0,0.6,0],"fov":30,"js":"q.fun.set(\"wind\",true,true)"},"explode":{"cam":[4.6,2.6,-5.2],"target":[0,0.9,0],"fov":32,"js":"q.fun.set(\"wind\",false);q.fun.set(\"explode\",true,true)"},"paint":{"cam":[4.6,1.5,-3.4],"target":[0.3,0.5,0],"fov":30,"js":"q.fun.set(\"explode\",false,true);q.fun.setPaint(\"blu\",true)"},"duck":{"cam":[2.9,1.25,-0.9],"target":[1.72,0.42,-0.12],"fov":30,"open":["hood"],"js":"q.fun.setPaint(\"rosso\",true)"},"flames":{"cam":[-4.4,0.8,-1.9],"target":[-1.9,0.45,0],"fov":30,"js":"q.fun.set(\"engine\",true);q.fun.redline();q.step(1.5)"},"wheel":{"cam":[1.55,0.42,-2.5],"target":[1.35,0.34,-0.9],"fov":26,"js":"q.fun.set(\"engine\",false)"}}' W=900 H=560 node tools/dev/contact.mjs $T/fun
python3 - <<PY
from PIL import Image
S='$T/fun/'
ims=[Image.open(S+n+'.png') for n in ['wind','explode','paint','duck','flames','wheel']]
w,h=ims[0].size; c=Image.new('RGB',(w*2+6,h*3+12),'white')
for i,im in enumerate(ims): c.paste(im,((i%2)*(w+6),(i//2)*(h+6)))
c=c.resize((c.width*2//3,c.height*2//3),Image.LANCZOS); c.save('qa/render_fun_features.png'); print('wrote qa/render_fun_features.png')
PY

