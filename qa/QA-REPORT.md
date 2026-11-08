# F-Future 3D model: QA against the reference sheets

The views below were rendered headlessly (`tools/qa-gallery.sh`) and compared against
`reference/ref-01-orthographic-views.png` and `reference/ref-02-design-annotations.jpg`.
Each comparison stacks three panels top to bottom: the **reference**, **this model**, and the model with
**the reference silhouette traced on top in magenta**.

> This model does not match the reference renders 100%. The references are AI-generated concept renders and are not
> fully consistent between views. For example, the top view puts the windscreen base about 0.3 m further forward than
> the side view does. Where the views disagree, the **side view** sets the length and height dimensions and the
> **top view** sets the plan dimensions.

## Measured fidelity

`node tools/dev/fidelity.mjs` compares the generated body against points measured on the reference sheet
(1 px = 7.92 mm in the side view):

| Check | Result |
|---|---|
| Side silhouette (roofline, windscreen, hood/fender line, deck), 63 points | mean error **4.9 mm**, 90 % within **8.4 mm** |
| Plan outline (half-widths), 30 points | mean error **11 mm**, 90 % within **25 mm** |
| Overall | 4.58 m long × 2.00 m wide × 1.156 m high, wheelbase 2.70 m |
| Largest deviations | nose tip (the reference outline there includes the splitter's beak, modelled as a separate part) and a 2 cm softer windscreen header |

## View-by-view

| View | Comparison | Assessment |
|---|---|---|
| Side | ![](compare_side.png) | Roofline, fender line, wheel positions and sizes, door shut lines, mirror position, side window shape, scoop with Testarossa strakes, carbon lower body and skirts all match. **Deviation:** the reference's lower-rear sculpted carbon channel ahead of the rear wheel is shallower here. The rear face is taller and more upright than the reference's tapered tail. |
| Front | ![](compare_front.png) | Width, fender positions, the bonnet vent's location and three fins, full-width intake with blades, splitter and badge position match. **Deviations:** the headlights are slimmer and less angular than the reference's large swept units. The bumper "cheeks" below the lights are less sculpted. |
| Rear | ![](compare_rear.png) | The quad ring tail-lights, full-width LED bar, black band, centre emblem, diffuser tunnels with fins and centre lamp, and the wing span with end plates and pylons match closely. **Added detail:** twin exhaust outlets in the band centre (the reference shows no tailpipes). |
| Top | ![](compare_top.png) | Plan outline, bonnet vent, windscreen and roof, side windows, louvred engine cover, rear wing and mirrors are in place. The engine cover adds a glass section so the V12 is visible (interpretation). |
| Three-quarter (reference hero angle) | ![](compare_hero.png) | Same camera angle as the hero render. Proportions, vent, strakes, wing, wheels and carbon zones agree. **Main remaining difference:** the reference's front fenders and headlight region are more muscular and sharper-edged. The reference also shows a darker showroom with a tighter lens. |

## Requirement checklist (section 9 of the brief)

| Item | Status | How it was verified |
|---|---|---|
| Front / rear / side / top / ¾ accuracy | ✔ with the deviations listed above | Comparisons above and the `fidelity.mjs` numbers |
| Wheel placement and proportions | ✔ | Wheel centres and diameters overlay the reference circles in `compare_side.png` (front ⌀0.672 m, rear ⌀0.704 m) |
| Door opening mechanics | ✔ | `tools/dev/hinge-check.mjs` samples door points through 0.2–1.45 rad: **0 intersections** with the body. The viewer uses 66°. See `render_butterfly_doors.png` |
| Interior completeness | ✔ | Seats on rails with belts, dashboard, cluster, centre and passenger displays, wheel with paddles, console and gear gate, pedals, door cards, headliner, ambient LEDs (`render_cockpit.png`) |
| Engine visibility and detailing | ✔ | V12 visible through the engine-cover window and with the cover open (`render_v12.png`) |
| Material quality | ✔ | Clear-coat metallic paint, anisotropic carbon, tinted glass, rubber, aluminium, chrome, leather/Alcantara, emissive LEDs |
| Interactive controls | ✔ | `tools/dev/smoke-ui.mjs` clicks every control and mode at both quality levels: **no console errors** |
| GLB validity | ✔ | Khronos glTF validator (via glTF-Transform): **0 errors** |
| Blender project | ✔ | `.blend` regenerated from the GLB and rendered in Cycles (`render_blender_cycles_preview.png`) |

## Design interpretations (details the references don't show)

* Cockpit layout and trim: black leather, Alcantara and carbon with red accents; yellow-faced rev counter.
* Twin exhaust outlets placed inside the rear light band, between the wing pylons.
* Frunk, underbody venturi strakes, side radiators behind the scoops, suspension geometry.
* A glass section in the engine cover so the V12 can be seen.
* Badges: a generic yellow shield with a tricolore and a stylised "F" (no trademarked artwork).

## Other renders

| | |
|---|---|
| ![](render_hero.png) | ![](render_rear_quarter_wing_active.png) |
| ![](render_engineering_ui.png) | ![](render_dark_studio_ui.png) |
