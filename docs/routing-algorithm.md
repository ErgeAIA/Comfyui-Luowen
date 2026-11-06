---
title: Routing Algorithm
type: algorithm-doc
project: 络纹（LuoWen）
updated: 2026-11-06
description: >
  阶段 1 线路绘制/路由管线说明：挂载点、每帧流程、几何内核（MIT 复用）、
  lane 分配、缓存与降级矩阵。PRD §16.1 要求的算法说明文档（seed，随阶段 2/3 扩写）。
---

# 路由算法（阶段 1 现状）

> 只描述**已实现并实测**的行为。未实现的能力见文末「已知限制」，不在本文档宣告。

## 1. 挂载点与调用链

- 挂载：`LGraphCanvas.prototype.renderLink` + `drawConnections` 原型级包裹（`luowen/web/adapters/renderLinkAdapter.js:161,170`），由 `install()`（`:181`）写入、`uninstall()`（`:200`）精确还原。
- 前置：`drawConnections` 链式回调 `beginFrame()`（`renderLinkAdapter.js:51`），每帧在逐线渲染之前完成障碍版本化与 lane 分配。
- 逐线：`tryCustomRender()`（`renderLinkAdapter.js:81`）返回 true 时完全接管该线；返回 false 一律回落 `state.originalRenderLink`（原生）。
- 命中跟随：绘制完成后覆写渲染产物 `link.path` / `link._pos`（`renderLinkAdapter.js:156-157`）。前端 1.55.18 的命中测试直接读这两个产物（`queryRenderedLinkSegmentsAtPoint` → `ctx.isPointInStroke(seg.path)`；`_getLinkCentreOnPos` → `seg._pos` 8×8），因此悬停、右键菜单、删除等交互自动跟随新形状。证据见 `docs/phase0/drawing-api-notes.md` §4。

## 2. 每帧流程

```
drawConnections(ctx, graph)
  └─ beginFrame(canvas)                      # renderLinkAdapter.js:51
       ├─ pointer.isDown → 冻结（不更新版本/lanes）
       ├─ nodeRects(graph) → obstacleHash     # graphRead.js:20, obstacles.js:6
       │    哈希变化 → frame.version += 1，缓存整体失效
       └─ laneHash(links, rects) 变化 → allocateLanes(links, rects)
  └─ originalDrawConnections → 逐线 renderLink
       └─ tryCustomRender(...)               # renderLinkAdapter.js:81
            ├─ 直通条件：禁用/native/预览线(id<0)/disabled/reroute/非 app.canvas → 原生
            ├─ cache.get(key, version) 命中 → 直接绘制
            ├─ 拖拽期（pointer.isDown）且未命中 → 正交预览（preview.js，无 A*，不进缓存）
            ├─ 直线捷径：仅共线（|Δy|<2 或 |Δx|<2）且 corridorClear → 两点直线
            ├─ 否则 route(strict:true)（A*）→ null 则原生降级
            └─ 绘制：smooth→emit 圆角；orthogonal→sharpPath；覆写 path/_pos
```

### 2.1 节点拖动期

拖动中端点每帧变化，受影响线的缓存键随之变化（未受影响的线仍命中缓存）。未命中的线用 `geometry/preview.js` 的**两折正交预览**（沿出线/入线 stub 各一段 + 一个直角），不跑 A*（PRD §10.1 禁止热路径搜索），松手后下一帧由 A* 重算。整帧不再回退成原生曲线。

## 3. 几何内核（MIT 复用，逐字未改）

`luowen/web/geometry/router.js`、`trace.js` 为 Cable Management 的逐字副本（保留 SPDX 头与版权行，登记于 `THIRD_PARTY_NOTICES.md`）。

| 要点 | 值/行为 | 位置 |
| ---- | ------- | ---- |
| 搜索空间 | 稀疏 Hanan 网格（障碍膨胀矩形边界为 lane） | router.js:38 `route()` |
| 拐弯代价 | `BEND_COST = 24` | router.js:15 |
| 硬障碍穿越 | 允许但代价 ×8（尽力而为，不硬失败） | router.js:18 `BLOCKED_MULT` |
| 软障碍（膨胀区内、实框外） | 代价 ×1.02 | router.js:27 `SOFT_MULT` |
| 展开预算 | >20000 次 → 返回 null（调用方原生降级） | router.js:148 |
| **严格模式**（LuoWen 修改项） | `strict:true` 时真实节点框**禁行**（不再按 8× 代价穿行）；只有无解才返回 null | router.js:189 |
| 输出 | 图坐标折线 `[start, ...bends, end]`，全程正交；平凡情形返回 null | router.js:38 |
| 圆角描边 | `emit(path, pts)`，圆角半径 10，钳制到相邻段 1/3 | trace.js |
| 中点/命中锚 | `measure(pts)` → 弧长；`pointAt(pts, m, 0.5)` → `{x,y,angle}` | trace.js |

`route()` 的输入由适配层提供：`start/end` 为引脚端点，`startDir/endDir` 由 `renderLink` 的 `start_dir/end_dir`（0-5）经 `DIR_NAME` 映射（`renderLinkAdapter.js:27`），障碍为 `toRawRects(nodeRects, [origin_id, target_id])`（`obstacles.js:13`，两端节点自身排除）。

## 4. lane 分配（原创）

`luowen/web/routing/laneAssign.js:19` `allocateLanes(links, nodes, {base:24, pitch:5})`：

- 按输出端 `o:${origin_id}:${origin_slot}`、输入端 `i:${target_id}:${target_slot}` 分组。
- 组内按对端节点 y 排序：上行（目标在上）升序、下行降序、平走最后；rank r 的 stub 长度 = `base + r * pitch`。
- 效果：同一引脚扇出的多条线在出线方向形成 5px 阶梯，避免首段重叠；上行线最贴引脚、越远越外。
- `laneHash(links, nodes)`（`laneAssign.js:63`）把排序键折成指纹，节点 y 或拓扑变化才重算。

缓存 key 含 stub 长度（`renderLinkAdapter.js:101`），lane 变化自然使旧路径失效。

## 5. 缓存与失效

- `createRouteCache({max:4096})`（`routeCache.js:5`）：`get(key, version)`，版本不符即失效；容量超限整体回收。
- `key = link.id|端点坐标|stubOut|stubIn|startDir>endDir|avoidance|style`（`renderLinkAdapter.js:101`）。
- `version` = 障碍哈希变化计数（节点移动/缩放/折叠 +1）。实测拖拽一个节点：version 1→2、缓存重建、数据不变性 ok。
- 拖拽期（`pointer.isDown`）冻结版本与重算，未命中线走原生——避免移动过程中每帧全图 A*（PRD §10.1）。

## 6. 降级矩阵（失败即原生，不阻塞绘制）

| 条件 | 行为 | 位置 |
| ---- | ---- | ---- |
| 总开关关 / style=native | 完全不接管 | renderLinkAdapter.js:84 |
| 拖拽预览线（link=null/id<0） | 原生 | :85 |
| `opts.disabled`（bypass） | 原生 | :86 |
| `opts.reroute` 共享段 | 原生（F-010，阶段 2 处理） | :86 |
| 非 `app.canvas` 的借用渲染（R12） | 原生 | :87 |
| A* strict 无解（端点被其他节点覆盖等） | 原生（degraded, alive）；计数 `counters.strictNull` | :205 |
| A* 预算超限 | 原生（degraded, alive） | :205 |
| 单线渲染抛异常 | 捕获→该线原生；不中断整帧 | :265 |
| 未安装/能力检测失败 | 设置页可见、保持原生 | index.js:99-100 |

## 7. 实测记录（2026-11-06，宿主 0.43.2 / 前端 1.55.18）

- 正交/平滑/原生三样式切换正常；平滑与正交共享同一骨架，仅描边不同。
- **节点避障（返修后）**：程序化逐段采样 7 条路由 × 全部非端点节点，穿透数为 **0**；关键场景（加载VAE → VAE解码 跨越 K采样器 区域）在 strict 下绕行，而旧版（错误矩形 + 8× 穿行）会从 K采样器 底下穿过。
- **节点拖动**：拖动中 preview 计数持续增长（一次拖拽 400+ 帧线更新），折线保持横平竖直；松手后 A* 重算，`verify` 数据不变性 ok。
- **整线悬停**：鼠标停在折线中段（非中心点）→ `status().hovered` = 对应 link id，线体白色柔光高亮；中心点 8×8 原生命中保持不变。
- 总开关关→原生贝塞尔、开→正交折线（截图 `.verify/p1_master_off.png`、`p1_after_switch_on.png`）。
- 单元测试 24/24：`node --test tests/unit/*.test.mjs`（正交性、严格避障、反向连接、lane 阶梯、缓存版本化、trace 几何、预览路径、getBounding 绝对坐标）。

## 7.1 返修记录（2026-11-06，用户验收反馈）

| 反馈 | 根因 | 修复 |
| ---- | ---- | ---- |
| 节点绕行不达标、线条从节点身上穿过 | ① `nodeRects` 把 `getBounding()` 的绝对坐标又加了一次 `pos`，所有障碍矩形整体平移；② 上游路由器把穿节点当 8× 代价而非禁行 | ① 改绝对坐标（`graphRead.js:20-47`，契约见 conventions §2.6）；② router 增加 `strict`（`router.js:189`），适配器默认启用 |
| 拖节点时连线变曲线 | `pointer.isDown` 期间直接回退原生 | 拖拽期改用 `preview.js` 正交两折预览，不进缓存、不跑 A* |
| 只有中心圆点会亮 | 1.55.18 原生 `over_link_center` 只覆盖 `_pos` 周围 8×8；整线命中只用于 shift/alt 与右键 | 新增 pointermove 监听 + 折线距离判定，整线悬停高亮；中心点原生命中不变 |

## 8. 已知限制（阶段 2/3 处理）

1. **reroute 共享段**仍走原生（`opts.reroute` 直通）；绕行 Reroute 节点本身是阶段 2 目标。
2. **手动意图**（创建 Reroute、拖动线路）尚未接入；当前为全自动绕行，阶段 2 引入 manual intent 优先。
3. **smooth 样式**直接用圆角折线近似，未做原生贝塞尔式的张力参数。
4. **两个节点互相重叠**时，被盖住的引脚在几何上无净空路径，strict 返回 null → 该线保持原生（fail-safe）。这是刻意取舍：宁可原生，也不穿节点。
5. 拖拽预览不考虑障碍（每帧只做两次折线），可能短暂压过节点；松手即恢复 A* 结果。这是为守住 PRD §10.1 的取舍。
6. 命中测试跟随依赖前端 1.55.18 的「读渲染产物」实现；升级前端须重跑 `docs/phase0/drawing-api-notes.md` 的验证清单。