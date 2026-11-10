# Changelog — LuoWen

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-11-10

Initial public release.

### Added

- Three link styles: `orthogonal` (A* orthogonal routing), `smooth` (true Bezier corners on the same skeleton), `native` (host rendering)
- Three node-avoidance clearance tiers (low 8 / standard 16 / high 24 graph px), degrading strictly → semi-strict → loose without crossing node bodies
- Large chamfers on avoidance corners (orthogonal style only); corner radius 0–24 graph px (`smooth` only, default 10)
- Trunk merging: one line per output port up to the latest legal fork, shared corridor after the fork; input-side lane nesting; equal-spacing bands per target
- Drag alignment snapping: aligns a dragged node to connected neighbours' pin rows/rectangles with guide lines; snap distance 2–20 graph px (step 2, default 20)
- Flow animation: travelling light pulse / dashes; selected / executing / all scopes; paused while a workflow runs; idle self-stop; auto-off under reduced motion or ≤ 40% zoom
- Link themes: Night Light (default) / Dawn / Cyberpunk / JellyFish / Solarized, colouring 62 link data types; slot sync scope links+slots or links-only, restoring host colours on off/switch
- Auto-layout ("Arrange"): full graph or selection; ELK Layered + main-chain detection + port alignment; unselected and pinned nodes do not move, no overlaps, one undo per run; adjustable column alignment, multi-workflow arrangement and three gaps; optional note collapsing
- Floating logo button: draggable, position remembered, hideable; canvas context menu with arrange, animation toggle and line-style switch
- Settings panel: 8 groups, 29 items, Chinese / English following the host or set manually
- Debug API `window.LuoWen`: `status` / `verify` / `autoLayout` / `snapDebug` / `crossDebug` / `colorDebug`, etc.

### Other

- MIT licensed; reuses the ComfyUI Cable Management geometry kernel (MIT), elkjs (EPL-2.0) and dagre (MIT); full licence texts ship with the plugin package
