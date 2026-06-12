---
name: MapLibre map robustness (sales-outreach map page)
description: Why the map "shows nothing" and how the map page guards against it
---

# MapLibre map robustness

The sales-outreach map page (`artifacts/sales-outreach/src/pages/map/index.tsx`)
renders a MapLibre GL map. Several failure modes make it "show nothing" even when
the business data loaded fine (the legend / "N not geocoded" text still renders
because it is an absolutely-positioned overlay, independent of the canvas).

## Failure modes seen / guarded
1. **WebGL context creation fails** — `new maplibregl.Map()` *throws*. In a
   `useEffect` with no try/catch this crashes the component (blank screen in prod,
   Vite runtime-error overlay in dev). The Replit screenshot sandbox has **no GPU**,
   so it ALWAYS throws here — do not mistake that for the real bug, but DO handle it.
2. **Zero-size container at init** — `dvh` heights / mobile browser chrome / layout
   settling can leave the canvas 0px → blank until a resize. Fix: `map.resize()` on
   `load` + a `ResizeObserver` on the container.
3. **Style/tiles never finish loading** — map inits but `load` never fires → blank
   forever. Fix: an 8s `setTimeout` that flips to the fallback if `load` hasn't fired.

4. **Map container collapses to 0px height even when its parent has real height** —
   MapLibre adds the `.maplibregl-map` class to the container element, and the bundled
   `maplibre-gl.css` sets `position: relative` on that class. This **overrides** a
   `absolute inset-0` utility on the container (same specificity, MapLibre's rule wins
   by source order), so `top/bottom:0` no longer size it → `clientHeight` becomes 0 and
   the canvas is invisible. Tell-tale: the absolutely-positioned fallback/legend (no
   MapLibre class) render fine while the map area is blank. **Fix:** size the map
   container with **flex-grow**, not absolute positioning. Make the map-page root a flex
   column (`relative flex flex-col grow min-h-0 w-full`) and the container
   `grow min-h-0 w-full`. flex-grow height applies regardless of the `position` MapLibre
   forces. Also avoid relying on `dvh`/percentage heights up the chain — some in-app
   webviews (e.g. dpr=3 mobile) collapse both `100dvh` and `height:100%`-through-flex to
   0; a pure flex-grow chain from a `h-screen`/`100dvh`-fallback shell is what holds.

## The pattern
Wrap init in try/catch → on failure set `mapError` and render a **usable fallback**
(tappable list of located businesses that opens the same quick-log drawer), never a
blank canvas. Clean up: `clearTimeout`, `ResizeObserver.disconnect()`, `map.remove()`.

**Why:** a field-sales app is used on varied mobile devices/browsers where WebGL or
tile loading can fail; a blank map is useless, a fallback list keeps the user working.
