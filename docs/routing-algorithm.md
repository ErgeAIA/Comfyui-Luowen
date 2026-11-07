---
title: Routing Algorithm
type: algorithm-doc
project: 络纹（LuoWen）
updated: 2026-11-07
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
  └─ beginFrame(canvas)                      # renderLinkAdapter.js:62
       ├─ pointer.isDown → 冻结（不更新版本/lanes）
       ├─ nodeRects(graph) → obstacleHash     # graphRead.js:20, obstacles.js:6
       │    哈希变化 → frame.version += 1，缓存/主干失效
       ├─ laneHash(links, rects) 变化 → allocateLanes(links, rects)
       └─ planTrunks(graph)                   # 同源多目标主干（阶段 2）
            端点缓存版本不一致 → 请求下一帧（setDirty）后返回
            按 origin_id:origin_slot 分组 → planTrunk()（trunkPlan.js）
  └─ originalDrawConnections → 逐线 renderLink
       └─ tryCustomRender(...)               # renderLinkAdapter.js
            ├─ 直通条件：禁用/native/预览线(id<0)/disabled/reroute/非 app.canvas → 原生
            ├─ 本帧主干计划命中且端点一致 → 主干/分支路径
            ├─ cache.get(key, version) 命中 → 直接绘制
            ├─ 拖拽期（pointer.isDown）且未命中 → 正交预览（preview.js，无 A*，不进缓存）
            ├─ 直线捷径：近共线（|Δy|≤3 或 |Δx|≤3，DEC-011）且 corridorClear → 端点钉死的正交近直线（必要时 ≤3px 极短转折）
            ├─ 否则按三档求解（障碍含两端节点自身）：
            │    strict（全部节点框禁行）→ 无解 → semi（仅两端卡片禁行）→ 无解 → loose（正交，可穿卡）
            │    仍无解 → 原生降级
            └─ 绘制：smooth→emit 圆角；orthogonal→chamferPolyline（仅绕障外角大斜切）后 sharpPath；
               path/_pos/state.routes 均用实际折线（含斜边），命中随实际几何
```

三档取舍：**strict** 保证线不压任何卡片；**semi** 保证线不被自己连接的卡片压住（允许穿过压在引脚上的第三方卡片，8× 代价）；**loose** 只保证横平竖直。引脚被深埋（两张卡片互相覆盖）时几何上无解，此时 loose 仍保持正交，不出现曲线。

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
| **定向禁行**（LuoWen 修改项） | `blockRects:[i,...]` 只让指定障碍下标禁行，其余硬框仍为 8× 代价（semi 档用） | router.js:66-75, 195 |
| 输出 | 图坐标折线 `[start, ...bends, end]`，全程正交；平凡情形返回 null | router.js:38 |
| 圆角描边 | `emit(path, pts, cornerRadius)`，半径上限来自 `LuoWen.CornerRadius`（0–24px，默认 10px），实际半径取上限与相邻两段各 1/3 的较小值；`0` 为直角 | trace.js |
| 中点/命中锚 | `measure(pts)` → 弧长；`pointAt(pts, m, 0.5)` → `{x,y,angle}` | trace.js |

`route()` 的输入由适配层提供：`start/end` 为引脚端点，`startDir/endDir` 由 `renderLink` 的 `start_dir/end_dir`（0-5）经 `DIR_NAME` 映射（`renderLinkAdapter.js:27`），障碍为 `toRawRects(nodeRects, [origin_id, target_id])`（`obstacles.js:13`，两端节点自身排除）。

## 4. lane 分配（原创）

`luowen/web/routing/laneAssign.js` `allocateLanes(links, nodes, {base:24, pitch:DEFAULT_LANE_PITCH=8})`：

- **输出侧（DEC-011）**：同一 `origin_id:origin_slot` 统一 `stubOut = base(24)`，不做 rank 阶梯——DEC-009 单主干后同一端口只应有一条出线，阶梯会让同一 fork 后的首个转折点错开，在仍需共用的走廊上长出平行双线。
- **输入侧（DEC-013 补记 2）**：按 `target_id` 聚合后，再按「线从哪一侧接近」分组（`dy = originNodeY - targetNodeY`，`|dy|<=1` 为平走）：上方来源按 `target_slot` 升序（引脚越高越贴节点），下方来源按降序（镜像：引脚越高越远），平走来源最外层；跨组按「上→下→平」一次由近到远编号，走廊 x = `pinX -（base + k × pitch）`。因此同节点任意两条不同引脚的竖直走廊不共线、且在凹/凸嵌套布局下不相交；同一引脚多源沿用旧序（上组越顶越贴、下组越底越贴）。默认 `pitch=8`，`LuoWen.setLanePitch(v)` 仅内存态对照（5px 只用于同取景截图，不持久化）。
- **净空顺延**：若某条线分配到的近端走廊被第三方节点（hard 箱 ±4px）占住，A* 会绕到更外侧导致嵌套反转；`laneBlocked(pinX-stub, y0, y1, nodes, skipIds)` 检出后把 `k` 加一顺延下一个空位，游标不回退。只影响走廊序号，不改 A* 成本项。
- `laneHash(links, nodes)`（`laneAssign.js`）把排序键与节点矩形（x/y/w/h）折成指纹，节点移动、缩放或拓扑变化才重算；pitch 变化由 adapter 附在指纹后，保证对照切换立即生效。

缓存 key 含 stub 长度（`renderLinkAdapter.js:101`），lane 变化自然使旧路径失效。

## 4.1 多目标主干（阶段 2）

对象：同一输出端口（`origin_id:origin_slot`）≥2 条可路由连线。实现分两层：

- **规划层** `routing/trunkPlan.js`（纯函数，可单测）
- **接线层** `renderLinkAdapter.js` 的 `planTrunks()`：按 origin 分组 → 取独立路径基准（缓存）→ `planTrunk()` → 本帧绘制改用计划路径

### 分叉长度 T（DEC-012：合法最晚分叉）

1. 独立路径基准已存在（每成员一条 A* 路由）。
2. 共同前缀：所有成员第一段方向一致，且长度 ≥ 16px。
3. 上限不再使用固定 72px，改为「合法的最晚分叉」：
   - **最近目标投影 − stub**：分叉点不得越过最近的目标，否则该目标必须先倒退；
   - **正前方最近卡片 − stub − 6**：分叉点+出线 stub 不得顶进迎面卡片（实测：CLIP 组在卡片前必须收短，否则分支 stub 进卡导致折返）。
4. `T = max(16, min(约束))`；约束不全时回到共同前缀长度；不满足则整组回到独立路径。
5. 主干延长不会改变合并准入（ratio 双阈值）与绕行保护：分叉变晚后分支重新求解，`ratio = (T + 分支长度) / 独立长度` 仍按原规则判定。

### 单主干（DEC-009：主干段共用几何）

- 端口到分叉点之间只有**一条主干**：同组所有成员共用同一几何 `pin → fork`，渲染上重叠在同一条路径；不在端口处分股（不再使用 fan/pitch 的平行 Ribbon）。
- 每成员路径 = `pin → fork → 分支`；分支从 fork 用同一 strict→semi→loose 求解器重新 A*；
- 分支 stub 按 PRD §7.2 动态收缩：`min(stub, dist/3)`，短连接不折返；
- router 对 canonical 直连返回 null 时，用共线直线补一条 `fork → 目标` 分支，该成员仍参与合流；
- 这是**真实共享几何**（同一路径被多个逻辑连接共用），不属于 PRD §7.3 禁止的“零间距重叠冒充合并”。

### 分叉后公共走廊（DEC-010）

- **分支起点统一 stub**：输出侧 `laneAssign` 已把整组 `stubOut` 统一为 24（DEC-011），`solveBranchFor` 不再覆盖，stub 只有一个来源；否则同一 fork 后首个转折点错开 5px，在仍需共用的走廊上长出两条平行竖线（实测 `x=-573` / `x=-568`）。仍保留 PRD §7.2 的 `min(stub, dist/3)` 收缩。
- **公共前缀合并**：分支求解后，用 `sharedPrefixLength(a, b)`（同轴/同向/共线才计入，短的一段转向处即停）取所有 merged 分支的公共前缀，再用 `splitAt` 按弧长切分；前缀绘制成一条共用折线，剩余段才各自走线。公共前缀为 0 时退回“fork 后直接各自分支”。
- 计算量不变：仍是每分支一次 strict→semi→loose 求解，不引入候选树或全图重规划（PRD §10.1）。
- 效果：无论源节点远近，端口出来只有一条线，竖直/水平走廊只有一条；只有目标真正分开的高度/位置才分叉。

### 合并决策与绕行保护（PRD §6.5）

- 对每个成员：`ratio = (T + 分支长度) / 独立路径长度`；
- 双阈值滞回：首次 `ratio≤1.25` 合流；上一轮已合并者 `≤1.35` 才踢出；上一轮独立者 `≤1.15` 才重新纳入；
- 合流成员 < 2、或 T 不满足（共同前缀 < 16px / 越过最近目标 / 顶进迎面卡片）→ 完全独立；
- 每次规划结果按组签名（几何版本 + lane 指纹 + 成员端点）缓存；节点移动导致版本变化时全部重算，静止时零 A*。

### 命中与选择语义（DEC-021 口径）

- **目标口径**：悬停共享主干段高亮整组（主干 + 全部分支）；悬停分支段只高亮该分支，主干保持常态；共享主干段右键出现「删除这一组（N 条）」并保留单条删除，分支段只有单条删除；整组删除一次事务、一条 undo。
- **命中归属**：原生命中读渲染产物（`hitTesting.ts:41-55`），络纹写 `link.path` 后命中跟随实际折线；同一坐标落在共享主干上时，原生按遍历顺序返回其中一条，不表达组。组语义由 `classifyHover(routes, trunks, point, tol)` 按弧长判定（`trunkPlan.js`）：落在分叉前共享前缀 → `part='trunk'`，落在分歧后 rest → `part='branch'`；无 trunk 回退单例。
- **为什么不做组选中**：宿主前端可选中类型不含 link（`selectionState.ts:7`），`selectedItems` 为 `Set<Positionable>`（`LGraphCanvas.ts:746`），`deleteSelected()` 不处理链路（`:4787-4821`），且无批量链路删除接口（`:6760-6775`）。组高亮与组删除由络纹自建，不改 Link 数据。
- **删除**：整组删除逐成员 `graph.removeLink(id)` + `layoutStore.deleteLinkLayout(id)`，用 `emitBeforeChange + graph.beforeChange … graph.afterChange + emitAfterChange` 包住（与 `deleteSelected` 同型），只留一条 undo；Reroute 包裹成员按真实 link id 删除，reroute 仅在 `totalLinks===0` 时回收（`LLink.ts:582-590`）。
- **未实现**：键盘 Delete 的组语义（保持原生单条）；对端节点联动高亮（不做）。

调试：`LuoWen.status().trunks` / `trunkDebug`（endpoints、版本、组数、候选数）、`LuoWen.routes()`。
调试对照：`LuoWen.setTrunkCap(72)` 可临时回到旧上限口径（默认 `null` = 合法最晚分叉），仅用于截图对照。

### 绕障外角大斜切（DEC-012 补记 / PRD §5.2 书面例外）

> 取代原「4px 局部 45° 倒角」：几像素微倒角与直角无视觉差别，用户否决。

- **模块**：`geometry/chamfer.js`（纯函数，可单测）。常量：`DEFAULT_BEVEL_RATIO=0.6`、`MIN_LEG=24`、`MIN_CUT=24`、`NODE_PAD=6`、`LINE_PAD=10`、`SAMPLE_STEP=4`；绕障间隙 `GAP_NEAR_MAX=64` / `GAP_FAR_MAX=200`。
- **适用对象**：只有「为绕开第三方节点而形成的那个外凸转角」才切角。`wrapsNode()` 判据：转角内侧象限完整包住某节点矩形；两臂分别贴其两条垂直边（`gapX/gapY ≥0`）；较近边距 ≤64、较远边距 ≤200；臂长越过节点角点。本连接 origin/target 节点排除（`excludeIndices`），保证端口出/入引脚段直角。
- **共享点直角**：`findSharedPoints(paths)` 把「同一坐标出现在 ≥2 条成员路径上」判为共享点，写入 `state.frame.trunkShared`；`chamferPolyline` 先查 `skip`，命中即直角。覆盖主干 T 点、分叉点、同向分叉点、公共走廊、引脚出入段。普通正交阶梯（无绕障语义）同样不切。
- **独立 cutA/cutB**：每腿可用长度 = 段长 − `MIN_LEG`（两端均候选时再折半，保留中间直段）；`cut = round(ratio * usable)` 各自独立；等长时接近 45°，一近一远时形成浅/陡角。任一腿 `cut < MIN_CUT` 或切后无直段则退回直角。
- **净空与缩短**：斜边按 `SAMPLE_STEP` 采样内部点；命中节点矩形（含 `nodePad`）或距其他线路 `< linePad` 即失败。失败按 `t=1.00→0.05`（20 档）比例缩短双腿，仍 `cut < MIN_CUT` 则整体退回直角。其他线路参照上一帧实际折线（`state.frame.prevRoutes`，几何版本变化时清空）。
- **互斥**：仅 `style=orthogonal` 且 `LuoWen.Chamfer` 开启时生效；smooth 仍走 `trace.js` 圆角，二者不叠加。
- **命中语义**：`link.path`、`link._pos`、`state.routes` 全部使用含斜边的 `drawPts`；悬停/删除按实际折线。斜边中点可命中（实测 link 74）。
- **热路径**：每帧 O(顶点数 × 候选 × 采样档) 的局部计算，不引入搜索；结果不回写 `plan.paths` 缓存。

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
| A* strict 无解（端点被其他节点覆盖等） | 先 semi（端点卡片禁行），再 loose（正交可穿卡）；全失败才原生 | :208-230 |
| A* 预算超限 | 同上层级联，最终可原生（degraded, alive） | :208-230 |
| 单线渲染抛异常 | 捕获→该线原生；不中断整帧 | :265 |
| 未安装/能力检测失败 | 设置页可见、保持原生 | index.js:99-100 |

## 7. 实测记录（2026-11-06，宿主 0.43.2 / 前端 1.55.18）

- 正交/平滑/原生三样式切换正常；平滑与正交共享同一骨架，仅描边不同。
- **节点避障（返修后）**：程序化逐段采样 7 条路由 × 全部非端点节点，穿透数为 **0**；关键场景（加载VAE → VAE解码 跨越 K采样器 区域）在 strict 下绕行，而旧版（错误矩形 + 8× 穿行）会从 K采样器 底下穿过。
- **节点拖动**：拖动中 preview 计数持续增长（一次拖拽 400+ 帧线更新），折线保持横平竖直；松手后 A* 重算，`verify` 数据不变性 ok。
- **整线悬停**：鼠标停在折线中段（非中心点）→ `status().hovered` = 对应 link id，线体白色柔光高亮；中心点 8×8 原生命中保持不变。
- **主干**：`62:0` 组（加载CLIP → 两个 CLIP文本编码，links 79/81）规划为 T≈49 的**单条共享主干**：两条路径共用 `(91,434)→(156,434)`，之后分别在 y=364 / 534 分叉；主干段悬停命中其中一条（81），分支段悬停准确命中 79；移动目标节点 +60px 后仍保持单主干与两成员合流；`verify` 数据不变性 ok（10 nodes / 10 links，diffs 空）。截图 `.verify/p2_trunk_single-2026-11-06T04-29-22-497Z.png` / 放大 `p2_trunk_single_zoom2.png`。
- 总开关关→原生贝塞尔、开→正交折线（截图 `.verify/p1_master_off.png`、`p1_after_switch_on.png`）。
- 单元测试 50/50：`node --test tests/unit/*.test.mjs`（正交性、严格避障、反向连接、输出侧统一 stub / 输入侧 lane 阶梯、输入侧按目标节点分道（DEC-013）、缓存版本化、trace 几何、预览路径、getBounding 绝对坐标、主干规划/滞回/单主干共用几何/分叉后公共走廊/走廊上限）。

## 7.1 返修记录（2026-11-06，用户验收反馈）

| 反馈 | 根因 | 修复 |
| ---- | ---- | ---- |
| 节点绕行不达标、线条从节点身上穿过 | ① `nodeRects` 把 `getBounding()` 的绝对坐标又加了一次 `pos`，所有障碍矩形整体平移；② 上游路由器把穿节点当 8× 代价而非禁行 | ① 改绝对坐标（`graphRead.js:20-47`，契约见 conventions §2.6）；② router 增加 `strict`（`router.js:189`），适配器默认启用 |
| 拖节点时连线变曲线 | `pointer.isDown` 期间直接回退原生 | 拖拽期改用 `preview.js` 正交两折预览，不进缓存、不跑 A* |
| 只有中心圆点会亮 | 1.55.18 原生 `over_link_center` 只覆盖 `_pos` 周围 8×8；整线命中只用于 shift/alt 与右键 | 新增 pointermove 监听 + 折线距离判定，整线悬停高亮；中心点原生命中不变 |
| 线被所连接的卡片压住；节点重叠时一端仍变曲线 | ① A* 障碍集合排除了两端节点，中段可从自己卡片底下穿；② strict 无解直接回退原生 | ① 障碍包含两端节点（`renderLinkAdapter.js:190-193`）；② 三档求解 strict→semi→loose（`:208-230`），loose 仍为正交，不再出曲线 |

实测（无重叠干净布局）：第三方卡片穿透 0、自身卡片穿透 0；第三方卡片压住引脚时：自身卡片穿透 0、路由为正交（semi）；两端卡片互相覆盖的极端重叠：loose 保持正交（几何上无法完全避开，但不再出现曲线）。单元测试 26/26。

## 7.2 返修记录 2：源节点移远后主干退化为两条竖线（2026-11-06）

- **现象**：`62:0` 组在源节点（加载CLIP，62）靠近时是单线三通；移远后端口附近竖直段变成两条几乎并排的竖线（`x=-573` 与 `x=-568`，相差 5px），各自竖走再各自横进目标。
- **根因**：`laneAssign` 按目标 rank 给 link 分 `stubOut = 24 + rank*5`；两个分支从同一 fork 重新 A*，首个转折点 x 相差 5px，在仍需共用的竖直走廊上各画一条。T=72 上限与共同前缀 ≥16px 约束不是主因。
- **修复**：① `renderLinkAdapter.js` 的 `solveBranchFor` 增加 `stubOut` 覆盖，`planTrunks` 传组共享 `DEFAULT_STUB`；② `trunkPlan.js` 增加 `sharedPrefixLength`/`splitAt`，把 merged 分支的几何公共前缀合并为一条共用折线，直到真正分歧。
- **实测**（源节点 62 取 6 个位置，links 79/81）：

| 源节点位置 | 主干 T | merged | 竖直段 x（79 / 81） |
| ---- | ---- | ---- | ---- |
| `-240,420`（近，原布局） | 49 | 79,81 | 156 / 156 |
| `-1000,900`（远） | 72 | 79,81 | -573 / -573 |
| `-1400,700` | 72 | 79,81 | -973 / -973 |
| `-700,1100` | 72 | 79,81 | -273 / -273 |
| `-1000,260` | 72 | 79,81 | -573 / -573 |
| `0,420`（源在目标右侧，反向） | —（不规划） | — | 355 / 355（首段 stub 仍重合） |

  远端 `-1000,900` 实测路径：`79 = [[-669,914],[-573,914],[-573,304],[180,304]]`、`81 = [[-669,914],[-573,914],[-573,534],[180,534]]`——共用 `(-669,914)→(-573,914)→(-573,534)` 单一走廊后才分叉。`verify` ok（10 nodes / 10 links，diffs 空），links 79/81 的 origin/target slot 未变。截图 `.verify/p2_trunk_corridor_far-2026-11-06T05-18-55-115Z.png`。
- **未覆盖**：源在目标右侧的反向连接（目标投影 ≤0 时本就不规划主干）；两目标 `stubIn` 不同导致接缝处 5px 内小折返的极端布局。

## 7.3 返修记录 3：端口双竖线与近共线折线（DEC-011，2026-11-06）

- **现象**：源节点「加载CLIP」（62）位于两个左对齐「CLIP文本编码」**下方**时，端口出口竖线变成两条并排（`170,1000` 实测 x=525/530；`290,900` 实测 x=645/650）；另有「UNet加载器 → 采样算法」在 Δy≈2px 时出现无必要折线。
- **修复**：输出侧 `laneAssign` 整组统一 `stubOut=24`（取消 rank 阶梯）；删除 `solveBranchFor` 的 stub 覆盖（单一来源）；`renderLinkAdapter.js` 增加 `STRAIGHT_TOL=3` 与 `nearFlatPath`——端点钉死在引脚中心，偏移 ≤3px 时只允许一段极短转折，且走廊必须净空；大高差折线（竖直段贴目标）维持现状。
- **实测**（links 79/81，源节点 62；"竖直段 x"为端口后 stub 转折的横坐标）：

| 源节点位置 | 场景 | 主干 | 79 竖直段 x | 81 竖直段 x |
| ---- | ---- | ---- | ---- | ---- |
| `170,1000` | 下方（用户反馈） | 不规划（投影 ≤0） | 525 | 525 |
| `290,900` | 下方偏右 | 不规划（投影 ≤0） | 645 | 645 |
| `-240,420` | 近距原布局 | T=49 merged | 156 | 156 |
| `-1000,900` | 远端 | T=72 merged | -573 | -573 |
| `-1400,700` | 远端 | T=72 merged | -973 | -973 |
| `-700,1100` | 远端 | T=72 merged | -273 | -273 |
| `-1000,260` | 远端 | T=72 merged | -573 | -573 |
| `0,420` | 反向（源在目标右侧） | 不规划 | 355 | 355 |

  下方场景 `170,1000` 实测两条路径共用 `(501,1014)→(525,1014)→(525,938)→(156,938)` 后才按目标高度分叉；`290,900` 共用 `(621,914)→(645,914)→(645,482)→(156,482)` 后分叉。远端与近距的 merged 几何与返修 2 一致，无回归。
- **近共线实测**（节点 69 上下移动，link 72）：
  - 原位置 `(220,110)`：`[[131,124],[230,124]]`（两点直线）；
  - 下移 2px：`[[131,124],[206,124],[206,126],[230,126]]`——端点严格在引脚中心，转折段 2px（≤3px），位于目标侧 stub 处；
  - 下移 20px：`[[131,124],[206,124],[206,144],[230,144]]`——正常台阶，行为与修复前一致。
- **数据不变性**：`verify` ok（10 nodes / 10 links，diffs 空）；links 79/81 origin/target slot 未变。截图 `.verify/p2_below_single_stub-2026-11-06T06-09-56-837Z.png`、`.verify/p2_near_after_dec011-2026-11-06T06-10-20-761Z.png`。
- **未覆盖**：`nearFlatPath` 无独立单测（adapter 内部函数）；反向 `0,420` 的 link 79 因绕开自身卡片出现较大折线（未改，属主干规划边界）；`STRAIGHT_TOL` 仅覆盖近乎水平/垂直的引脚对；对称台阶未实现。

## 7.4 返修记录 4：B 倒角 + 合法最晚分叉（DEC-012，2026-11-06）

- **实现**：`geometry/chamfer.js` 与 `trunkPlan.chooseForkLength` 去 72 上限；adapter 仅在正交样式绘制倒角，`link.path` 保持正交。
- **实测**（links 79/81，源节点 62；同一布局用于三组截图）：

| 源节点位置 | trunkCap | T | merged | 79 竖直段 x | 说明 |
| ---- | ---- | ---- | ---- | ---- | ---- |
| `-240,420`（默认） | null | 49 | 79,81 | 156 | 与旧版一致（49<72，最晚分叉未改变现布局） |
| `-1000,900`（对照布局） | 72 | 72 | 79,81 | -573 | ①/② 截图口径（旧上限） |
| `-1000,900`（对照布局） | null | 825 | 79,81 | 156 | ③ 截图口径（合法最晚分叉） |

- **倒角观感**：320% 特写显示同一转角由直角变为 45° 斜切（c=4 world px ≈ 8 屏px）；长主干末端只有一个转角，未出现多倒角碎片化。未发现 B 与最晚分叉互相打架的视觉现象。
- **命中/悬停**：同布局 320% 下，正交直线段与倒角斜边中点均命中 link 81，移开为空；`routes()` 全部正交；`verify` ok（10 nodes / 10 links）。
- **截图**（`.verify/`）：`p2_pcb_01_straight_cap72...png`、`p2_pcb_02_chamfer_cap72...png`、`p2_pcb_03_chamfer_latefork...png`；特写 `p2_pcb_01z_straight_zoom...png`、`p2_pcb_02z_chamfer_zoom...png`、`p2_pcb_03z_latefork_elbow...png`、`p2_pcb_03wide_chamfer_latefork...png`。
- **未覆盖**：原生点击选中/删除未单独实测（合成事件未触发选择；代码层 `link.path` 仍正交）；凸角采用净空采样而非严格多边形凸性判定；倒角未回写主干缓存，每帧重算。

## 7.5 返修记录 5：绕障外角大斜切取代 4px 倒角（DEC-012 补记，2026-11-06）

- **背景**：用户验收指出倒角「处处都有」，三通/分叉处也倒，看着不干净；几像素倒角与直角无差别。目标语义是：大节点右、下都有节点时，连线绕过其右下角，把这个大直角整块削掉，腾出可放节点的三角空间；其余一律直角。
- **实现**：`geometry/chamfer.js` 重写为绕障外角大斜切（判据/净空/共享点见 §4.1「绕障外角大斜切」）；adapter 中 `link.path` / `link._pos` / `state.routes` 改用含斜边的实际折线；`setBevelRatio()` 为三档调试入口，设置面板未暴露。
- **布局与实测**（`加载VAE → VAE解码` 绕 `采样器`，link 74；`cutA/cutB` 为两腿切掉的 world px）：
  - 布局 A（两卡片与采样器间距接近）：63 `485,700`、65 `1180,320`、68 `310,1000`、9 `1450,900`。
  - 布局 B（一近一远）：65 下移到 `1180,460`，其余同 A。

| 档位 | 布局 A 折线（`796,714` 起） | A cutA/cutB | 布局 B 折线 | B cutA/cutB |
| ---- | ---- | ---- | ---- | ---- |
| 直角 | `→1166,714→1166,354→1190,354` | — | `→1166,714→1166,494→1190,494` | — |
| 0.35 | `→1045,714→1166,596→1166,354` | 121 / 118 | `→1045,714→1166,645→1166,494` | 121 / 69 |
| 0.6 | `→958,714→1166,512→1166,354` | 208 / 202 | `→958,714→1166,596→1166,494` | 208 / 118 |
| 0.85 | `→931,714→1166,485→1166,354` | 235 / 229 | `→901,714→1166,564→1166,494` | 265 / 150 |

- **档位与目标边界**（用户已确认：**视觉省位**，不是「把节点塞进三角区」；`0.6` 已固化为默认）：
  - 三角缺口内可放的轴对齐矩形上界 ≈ `(cutA/2)×(cutB/2)`，仅供体感参照：0.35 → A 约 `60×59`、B 约 `60×34`；0.6 → A 约 `104×101`、B 约 `104×59`；0.85 → A 约 `118×115`、B 约 `132×75`。
  - 0.35 切得最克制；0.6 浅角明显但不吃掉整条腿，观感与省位平衡最好（默认）；0.85 缺口最大，但布局 B 横腿只剩 105px 直段，正交可读性开始变弱。三档都保留 ≥24px 正交段。
  - **不放宽**腿长、`GAP_NEAR_MAX=64` / `GAP_FAR_MAX=200` 与净空阈值；**不承诺**三角区能容纳常规 225px 宽卡片（参照 VAE解码 `225×96`）。本能力的价值是减少一条正交线在角部同时占用的两个方向空间，腾出视觉呼吸区，而非提供可放置节点的画布。
  - `0.35 / 0.85` 仅保留为 `window.LuoWen.setBevelRatio()` 调试对照（内存态，不持久化）；重载后自动回到 0.6。
- **命中/悬停**：斜边中点（world `1062,655`）悬停命中 link 74，移开返回 `null`；`routes()` 返回实际折线（含斜边）。删除沿用上一轮用户真实鼠标验收结论，本轮未重测。
- **截图**（`.verify/`）：
  - 布局 A：`p3_A_0_rightangle-2026-11-06T08-00-01-666Z.png`、`p3_A_1_r035-2026-11-06T08-00-32-589Z.png`、`p3_A_2_r060-2026-11-06T08-00-47-054Z.png`、`p3_A_3_r085-2026-11-06T08-00-58-041Z.png`。
  - 布局 B：`p3_B0_rightangle_clean-2026-11-06T08-07-34-782Z.png`、`p3_B1_r035_clean-2026-11-06T08-07-43-842Z.png`、`p3_B2_r060_clean-2026-11-06T08-07-50-652Z.png`、`p3_B3_r085_clean-2026-11-06T08-07-57-377Z.png`。
  - 绕障外角特写（240%，0.6 档）：`p3_corner_r060-2026-11-06T08-06-29-176Z.png`。
- **单测**：48/48（`tests/unit/chamfer.test.mjs` 13 项，见 DEC-012 补记）。
- **未覆盖**：0.6 已固化（0.35 / 0.85 仅调试）；净空失败按统一比例缩短双腿，未做「保长腿切角」的 Pareto 策略；几何版本首帧无 `prevRoutes`，斜切可能偏大、第二帧收敛；本机原始布局横腿仅 35px 无斜切空间，对比截图通过临时移动节点构造、拍后已还原；删除未本轮重测。

## 7.6 返修记录 6：输入侧多引脚共用走廊（DEC-013，2026-11-06）

- **背景**：用户指出一个节点多个输入时左侧入线被收拢成一根，并明确「目标不是美化，首要让工作流清晰可读」。实测 K采样器（node 70）四条入线竖直段同在 `x=646`，75↔76 在 y 304–334、82↔78 在 y 394–534 完全共线。
- **根因**：`laneAssign` 输入侧按 `target_id:target_slot` 分组，每个引脚一组且组内通常仅一条线 → rank 恒 0 → `stubIn` 全为 24 → 走廊 x 相同；`trunkPlan` 只按输出端口分组，输入侧没有合并逻辑（属分道粒度缺陷）。
- **实现**：`laneAssign.js` 输入侧按 `target_id` 聚合、`target_slot` 升序分层；每 slot 起点 = `base + 之前 slot 线数累计 × pitch`；slot 内 up/down/flat 排序与相对间距不变；`DEFAULT_LANE_PITCH=8`（用户拍板），`LuoWen.setLanePitch()` 为内存态对照入口；输出侧 `stubOut` 分支不动。
- **实测坐标**（同取景 `scale=1.5` / `offset=-413.33,-40`）：
  - 8px：75 `x=646`、76 `x=638`、82 `x=630`、78 `x=622`；任意两条同轴线段（水平同 y / 竖直同 x）的重叠检查为空（`conflicts=[]`）。
  - 5px 对照：`646/641/636/631`，重叠检查同样为空。
  - 默认主干组 `62:0`（links 79/81）：`fork=825`，`stubIn` 仍 24，折线与改前逐点一致（`[[-669,914],[156,914],[156,304/534],[180,304/534]]`）。
- **观察（本轮不改）**：8px 档走廊左移后，link 82/78 的拐角命中 node 67 的绕障判据并触发大斜切（5px 档因与其他线路净空不足退回直角）；斜切判定按要求未动。
- **截图**：`.verify/p3_input_lanes_8px-2026-11-06T10-18-41-489Z.png`、`.verify/p3_input_lanes_5px-2026-11-06T10-20-04-731Z.png`。
- **单测**：50/50；新增「同节点多引脚走廊 x 互不相同」「slot 起点按之前 slot 线数累计顺延 / 默认 pitch=8」两项。
- **未覆盖**：`stubCap = dist/3` 压缩短连接 stub 后仍可能共线；同一引脚多源本轮不改；「合法最晚分叉收窄」未做；斜切绕障间隙（`GAP_FAR_MAX=200`）是否偏松另立。

## 8. 已知限制（阶段 2/3 处理）

1. **reroute 共享段**仍走原生（`opts.reroute` 直通）；绕行 Reroute 节点本身是阶段 2 目标。
2. **手动意图**（创建 Reroute、拖动线路）尚未接入；当前为全自动绕行，阶段 2 引入 manual intent 优先。
3. **smooth 样式**直接用圆角折线近似，未做原生贝塞尔式的张力参数。
4. **两个节点互相重叠**时，被盖住的引脚在几何上无净空路径：semi 仍保证不穿自己卡片；若两端卡片互相覆盖，loose 保持正交但可能从卡片下穿过（不再出现曲线）。这是刻意取舍：正交一致性优先于几何上不可能的净空。
5. 拖拽预览不考虑障碍（每帧只做两次折线），可能短暂压过节点；松手即恢复 A* 结果。这是为守住 PRD §10.1 的取舍。
6. **主干组选择未实现（口径已按 DEC-021 修订）**：宿主前端不支持链路选中，故不做“选中整组”；改为组高亮（悬停主干段整组、分支段单条）与共享主干段右键整组删除，分支段保留原生单条删除。键盘 Delete 仍为原生单条语义。
7. 主干仅对**同输出端口且同帧可见**的连线生效；离屏成员不参与规划（视口外不渲染）。
6. 命中测试跟随依赖前端 1.55.18 的「读渲染产物」实现；升级前端须重跑 `docs/phase0/drawing-api-notes.md` 的验证清单。
8. **近共线容差仅 3px**：超过 3px 的引脚高差仍走 A* 台阶，竖直段贴近目标侧；「对称台阶」美学规则与磁吸对齐未实现（阶段 3 候选）。
9. **反向/下方场景不规划主干**（目标投影 ≤0）：仅靠输出侧统一 stub 保证端口单线；分支若需绕开自身卡片可能出现较大折线（实测 `0,420` 的 link 79）。