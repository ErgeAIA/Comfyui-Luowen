# Changelog — LuoWen (络纹)

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Product package `luowen/`: pure-frontend link-routing extension (minimal `WEB_DIRECTORY` server; registers no nodes)
- Three wire styles: orthogonal (A* routed) / smooth rounded / native rendering
- Node avoidance with low / standard / high clearance; automatic re-route after node moves (obstacle-hash versioning + route cache invalidation)
- Per-pin lane staggering for multiple links (upward links hug the pin; 5px pitch)
- Master switch: off restores ComfyUI native link rendering instantly; per-link failures or A* budget exhaustion degrade to native
- 17 frontend unit tests (`node --test tests/unit/*.test.mjs`): orthogonality, avoidance, reverse connections, lanes, cache, trace geometry
- Multi-target trunks (phase 2): shared trunk per output port, then per-link branches; ribbon strands (fan 14px / pitch 4px) keep an independent hit area per connection
- Merge decisions with per-link detour protection and two-threshold topology hysteresis; falls back to independent paths when members or space are insufficient
- Port stubs shrink with connection distance (short links no longer fold back)
- Trunk diagnostics: `LuoWen.status().trunks` / `trunkDebug`
- `docs/routing-algorithm.md`; MIT-reused Cable Management geometry kernel registered in `THIRD_PARTY_NOTICES.md`

### Fixed

- Wrong obstacle rectangles (`getBounding()` already returns absolute coordinates; `pos` was added twice), which let links run underneath nodes
- Strict routing mode: node boxes are impassable; links without a clear path degrade to native instead of crossing nodes
- Links stay orthogonal while dragging a node (two-bend preview) instead of reverting to Bezier curves
- Hovering anywhere on a link now highlights the whole line (previously only the centre dot responded)
- Link mid-sections no longer pass underneath their own endpoint cards; overlapping nodes no longer fall back to Bezier curves (strict→semi→loose orthogonal tiers)

[Unreleased]: https://github.com/ErgeAIA/Comfyui-Luowen/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ErgeAIA/Comfyui-Luowen/releases/tag/v0.1.0
