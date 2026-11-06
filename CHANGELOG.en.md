# Changelog — LuoWen (络纹)

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Product package `luowen/`: pure-frontend link-routing extension (minimal `WEB_DIRECTORY` server; registers no nodes)
- Three wire styles: orthogonal (A* routed) / smooth rounded (same orthogonal skeleton) / native rendering
- Node avoidance with low / standard / high clearance (8 / 16 / 24 graph px); obstacle-hash versioning + route cache invalidation
- Per-pin lane staggering for multiple links (default pitch 8 graph px, base 24)
- Master switch and per-link degradation: off restores ComfyUI native rendering instantly; per-link failures or A* budget exhaustion degrade to native
- 95 frontend unit tests (`node --test tests/unit/*.test.mjs`): orthogonality, avoidance, reverse connections, lanes, cache, trace geometry, trunks and crossing enumeration
- Multi-target trunks (phase 2): output-port grouping into fully merged / partially merged / fully independent; the port emits one shared trunk, then each connection branches independently
- Merge decisions with per-link detour protection and two-threshold hysteresis; falls back to independent paths when members or space are insufficient
- Latest legal fork: the fork point is placed as late as possible without entering the nearest target, hitting a card, or losing a visible separation before the pins
- Shared corridor after the fork; input-side multi-pin corridors nest by approach direction so pins of the same node never share a line
- Large bevel at outer obstacle corners (orthogonal style only; T-junctions, forks, shared corridors and pin segments stay square)
- Drag alignment snap (P1 enhancement): while dragging a single node, snaps to pin rows of connected neighbours, 10 graph px to enter / 15 graph px to leave, with a DOM guide-line overlay
- Crossing enumeration and offline cross cleanup (P1 enhancement, off by default): after 400 ms idle, re-solves only crossing link pairs; accepted only when the crossing count strictly decreases and total length grows by ≤15%
- Port stubs shrink with connection distance (short links no longer fold back)
- Trunk diagnostics: `LuoWen.status().trunks` / `trunkDebug`
- `docs/routing-algorithm.md`; MIT-reused Cable Management geometry kernel registered in `THIRD_PARTY_NOTICES.md`

### Changed

- Settings panel expanded to six entries: enable, alignment snap, wire style, node avoidance, obstacle-corner bevel, offline cross cleanup (experimental)

### Fixed

- Wrong obstacle rectangles (`getBounding()` already returns absolute coordinates; `pos` was added twice), which let links run underneath nodes
- Strict routing mode: node boxes are impassable; links without a clear path degrade to native instead of crossing nodes
- Links stay orthogonal while dragging a node (two-bend preview) instead of reverting to Bezier curves
- Hovering anywhere on a link now highlights the whole line (previously only the centre dot responded)
- Link mid-sections no longer pass underneath their own endpoint cards; overlapping nodes no longer fall back to Bezier curves (strict→semi→loose orthogonal tiers)

[Unreleased]: https://github.com/ErgeAIA/Comfyui-Luowen/commits/main
