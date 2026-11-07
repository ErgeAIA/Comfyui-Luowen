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
- 99 frontend unit tests (`node --test tests/unit/*.test.mjs`): orthogonality, avoidance, reverse connections, lanes, cache, trace geometry, trunks, equal-spacing bands and crossing enumeration
- Multi-target trunks (phase 2): output-port grouping into fully merged / partially merged / fully independent; the port emits one shared trunk, then each connection branches independently
- Merge decisions with per-link detour protection and two-threshold hysteresis; falls back to independent paths when members or space are insufficient
- Latest legal fork: the fork point is placed as late as possible without entering the nearest target, hitting a card, or losing a visible separation before the pins
- Shared corridor after the fork; input-side multi-pin corridors nest by approach direction so pins of the same node never share a line
- Large bevel at outer obstacle corners (orthogonal style only; T-junctions, forks, shared corridors and pin segments stay square)
- Drag alignment snap (P1 enhancement): while dragging a single node, snaps to pin rows of connected neighbours, 10 graph px to enter / 15 graph px to leave, with a DOM guide-line overlay
- Crossing enumeration and offline cross cleanup (P1 enhancement, off by default): after 400 ms idle, re-solves only crossing link pairs; accepted only when the crossing count strictly decreases and total length grows by ≤15%
- Equal-spacing bands for links sharing a target: each link is solved independently, then ordered into a band by target-pin y with a constant 8 graph px spacing; violating links are re-solved with constraints, otherwise the previous frame is frozen and `orderDegraded` is reported
- Trunk group interaction (DEC-021): hovering a trunk highlights the whole group and lists its members; the link menu offers "delete this group" on trunk segments but not on branches
- Corner-radius setting: `smooth` corner radius 0–24 graph px, default 10
- Port stubs shrink with connection distance (short links no longer fold back)
- Trunk diagnostics: `LuoWen.status().trunks` / `trunkDebug`
- `docs/routing-algorithm.md`; MIT-reused Cable Management geometry kernel registered in `THIRD_PARTY_NOTICES.md`

### Changed

- Settings panel expanded to seven entries: enable, alignment snap, wire style, corner radius, node avoidance, obstacle-corner bevel, offline cross cleanup (experimental)
- Links that traverse native Reroute chains no longer join trunk merging or equal-spacing bands, preserving manual intent (F-010 / AT-018)
- `verify()` snapshots now include `graph.extra` and `node.properties`; node position changes are reported in `moved` and do not affect `ok`
- Performance: trunk cache limit raised from 64 to 4096, preventing full-table clears from triggering whole-graph replanning every frame on large graphs; bevel candidates are pre-filtered with unchanged output geometry

### Fixed

- Wrong obstacle rectangles (`getBounding()` already returns absolute coordinates; `pos` was added twice), which let links run underneath nodes
- Strict routing mode: node boxes are impassable; links without a clear path degrade to native instead of crossing nodes
- Links stay orthogonal while dragging a node (two-bend preview) instead of reverting to Bezier curves
- Hovering anywhere on a link now highlights the whole line (previously only the centre dot responded)
- Link mid-sections no longer pass underneath their own endpoint cards; overlapping nodes no longer fall back to Bezier curves (strict→semi→loose orthogonal tiers)
- Link jitter from trunk/independent state flipping every frame while dragging (BUG-002): fixed the empty node-table cache that kept endpoint prediction from ever taking effect
- Silent failure of equal-spacing bands (BUG-003): eligibility no longer depends on the solution result of the links being admitted; links are solved independently first, then ordered into a band by target-pin y
- Equal-spacing bands misjudged direction when upper and lower pins are interleaved; candidates now follow the y-step direction of target pins
- Ghost entries left in the routing state table after deleting only a link (BUG-006): stale entries are pruned by diffing against existing links, and hover references are invalidated

[Unreleased]: https://github.com/ErgeAIA/Comfyui-Luowen/commits/main
