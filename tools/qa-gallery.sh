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
