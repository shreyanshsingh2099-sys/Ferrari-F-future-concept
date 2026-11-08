#!/usr/bin/env bash
# Regenerate the QA gallery in qa/ (orthographic comparisons + feature renders).
set -e
cd "$(dirname "$0")/.."
T=qa/tmp
node tools/shoot.mjs $T ortho:side,ortho:top,ortho:front,ortho:rear "quality=balanced"
python3 tools/compare.py $T $T
for v in side top front rear; do cp $T/cmp_$v.png qa/compare_$v.png; done
node tools/shoot.mjs $T hero "quality=high" && cp $T/hero.png qa/render_hero.png
node tools/shoot.mjs $T reference "quality=high" && cp $T/reference.png qa/render_reference_angle.png
node tools/shoot.mjs $T view:rearQuarter "quality=high&open=wing" && cp $T/view_rearQuarter.png qa/render_rear_quarter_wing_active.png
node tools/shoot.mjs $T hero "quality=high&open=doorL,doorR" && cp $T/hero.png qa/render_butterfly_doors.png
node tools/shoot.mjs $T mode:interior "quality=high" && cp $T/mode_interior.png qa/render_cockpit.png
node tools/shoot.mjs $T mode:engine "quality=high" && cp $T/mode_engine.png qa/render_v12.png
node tools/shoot.mjs $T mode:engineering "quality=high&ui=1" && cp $T/mode_engineering.png qa/render_engineering_ui.png
node tools/shoot.mjs $T hero "quality=high&theme=dark&ui=1" && cp $T/hero.png qa/render_dark_studio_ui.png
python3 tools/hero_compare.py qa/render_reference_angle.png qa/compare_hero.png
