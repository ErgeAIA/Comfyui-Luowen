---
title: 第三方扩展共存分析（源码级）
type: spec
project: 络纹（LuoWen）
updated: 2026-11-07
description: >
  对 Cable Management、NKD Reroutes、Zip Ties、rgthree 四个扩展做源码级接管点取证，
  产出「冲突面 × 判定 × 依据」清单，落盘 docs/agents/compatibility-matrix.md §5.4。
  本轮不做运行时验证；运行时验证方案单列，需用户批准后才可安装。
---

# 第三方扩展共存分析（源码级）

## 1. 目标与边界

- 目标：查清四个扩展各自在哪里接管连线绘制（patch `drawConnections` / `onDrawForeground` / `renderLink`、link 渲染钩子、改写 link 数据、自建 canvas overlay），再判定与我方 `renderLinkAdapter`、磁吸 overlay、组悬停菜单的冲突面。
- 边界：受 `AGENTS.md` 目标环境锁定约束，**不在 `%ComfyUIPortable%` 安装任何第三方扩展、不改宿主依赖**。本轮只做源码级分析。
- 取证方式：四个仓库浅克隆到 `%TEMP%\luowen-coexist\`（临时目录，非宿主 `custom_nodes`），只读源码与官方文档。
- 判定口径：无交集 / 可能冲突 / 确定冲突。全部结论均标注「未做运行时验证」。

## 2. 我方钩子基线（判定参照）

| 钩子 | 位置 | 行为 |
|---|---|---|
| `LGraphCanvas.prototype.renderLink` | `luowen/web/adapters/renderLinkAdapter.js:1537-1547` | 安装时保存 original，原型级 wrap，`__luowenWrapped` 防双包 |
| 自绘主路径 | `renderLinkAdapter.js:1364-1396` | 自建 `Path2D` 并 stroke；覆写 `link.path` / `link._pos`；写 `state.routes` |
| 自绘成功后 | `renderLinkAdapter.js:1399-1409` | 直接返回，**不调用** `originalRenderLink` |
| 回退原生 | `renderLinkAdapter.js:1244`、`:1297` | `opts.reroute` / `opts.disabled` / 严格无解时调 original |
| `drawConnections` | `renderLinkAdapter.js:1412` 起 | 前置 `beginFrame`（拓扑指纹 `:996-1004`），再调 original |
| 磁吸 overlay | `luowen/web/snap/dragSnap.js:16-20` | DOM overlay `luowen-snap-overlay`，z-index 500 |
| 磁吸事件 | `dragSnap.js:345-350` | `window` 冒泡阶段 pointermove/pointerup；pointerup 内同步写位 |
| 组悬停菜单 | `renderLinkAdapter.js:1205-1223` | `Proxy` 包装 `LiteGraph.ContextMenu` 构造，仅链路菜单注入 |
| 数据不变性快照 | `luowen/web/index.js:47-57` | 只比 `nodeCount` / `nodeIds` / `linkTuples`，**不含 `extra` / `properties`** |

## 3. 四个扩展的接管点取证

### 3.1 Cable Management（`vtokic/comfyui-cable-management`）

| 接管位置 | 行为 | 证据 |
|---|---|---|
| `web/ledger.js:115-147` | patch `LGraphCanvas.prototype.drawConnections`，O(1) 重建台账 | 源码 |
| `web/ledger.js:150-235` | patch `_renderAllLinkSegments`，替换 start/end 或 `SUPPRESS` 提前 return | `:211-216`、`:230` |
| `web/ledger.js:34` | `passActive` 默认 `true` | 源码 |
| `web/pathing.js:57-88` | patch `drawConnections`：`beginFrame` + `drawGates`（gate 画在连线层/选中 gate 走 overlay） | `:81-84` |
| `web/pathing.js:90-113` | patch pathRenderer `drawLink`，写 `linkData.__route` | 源码 |
| `web/pathing.js:115-147` | patch `drawLinkPath` / `calculateCenterPoint` / `computeConnectionPoint` | 源码 |
| `web/pathing.js:153-165` | patch `Reroute.prototype.draw` / `drawSlots`（隐藏 teeth 外观） | 源码 |
| `web/routes.js:300-337` | 再次 patch `drawConnections`，叠加 ghost edges | 源码 |
| 数据面 | 写 `graph.extra`（`cablemanagement_routes` / `cablemanagement_routefrom` 等、combs） | `web/routestore.js:22-37`、`web/unpack.js:143`、`web/drag.js:401` |
| 复制粘贴 | patch `_serializeItems` / `_deserializeItems` | `web/pathing/combclipboard.js:42-56` |
| 节点/子图交互 | patch `convertToSubgraph`、`connectFloatingReroute`、`Reroute.findTargetInputs/findSourceOutput` | `web/convert.js:34-38`、`web/drag.js:436-439`、`web/pathing.js:387-395` |
| link 数据改写 | 未发现改写 Link ID / origin / target slot；改写仅发生在绘制参数层与 `graph.extra` | grep 无 `links.set` / Link ID 写入 |
| 自建 overlay | gate 画在连线层；选中 gate 走独立 overlay canvas | `web/pathing.js:81-84` |

### 3.2 NKD Reroutes（`Nekodificador/ComfyUI-NKD-Reroutes`）

| 接管位置 | 行为 | 证据 |
|---|---|---|
| `js/rerouteSplines.js:587-681` | patch legacy `LGraphCanvas.prototype.drawLink` | 源码 |
| `js/rerouteSplines.js:686-730` | patch `renderLink`，改 `startControl/endControl` 并画 stub | 源码 |
| `js/rerouteSplines.js:768-836` | patch pathRenderer `drawLink` / `drawLinkPath` / `calculateCenterPoint`，写 `linkData.__nkdRoute` | 源码 |
| `js/rerouteSplines.js:858-882` | patch `drawConnections`：`beginFrame` + 懒 patch Reroute 原型 | 源码 |
| `js/magnet/dragAdapter.js:275-286` | **实例级** patch `canvas.drawFrontCanvas` | 源码 |
| `js/magnet/dragAdapter.js:307-362` | canvas 元素注册 pointermove（冒泡）；window capture pointerup；`setTimeout(0)` 最终吸附 | `:332-355` |
| `js/magnet/dragAdapter.js:595-647` | **实例级** `canvas.onDrawForeground` 画 guides/ghost（canvas 2D） | 源码 |
| `js/magnet/dragAdapter.js:545` | 磁吸仅在 Shift 按住时启用 | 源码 |
| `js/groupCorners.js:16-20` | patch `LGraphGroup.prototype.draw` | 源码 |
| 数据面 | 未发现 `graph.extra` / `serialize` / `links.set` 写入；磁吸释放后写 `node.pos`（用户拖动语义） | grep 无命中 |

### 3.3 Zip Ties（`safzanpirani/comfyui-zip-ties`）

| 接管位置 | 行为 | 证据 |
|---|---|---|
| `web/zip_ties.js:1094-1135` | patch `renderLink`：按 tie 分段重绘，多段调用 `origRenderLink`；`state.rendering` 防递归 | `:1100-1135` |
| `web/zip_ties.js:1137-1148` | patch `_renderAllLinkSegments`：视口剔除补偿，直调 `this.renderLink` | 源码 |
| `web/zip_ties.js:1151-1161` | patch `drawConnections`：清端点 → `syncTies` → `followMoves` → 原绘制 → `drawTies` | 源码 |
| 数据面 | 写 `graph.extra.zipTies`，随工作流序列化 | `:11-12` |
| 手势 | window capture 阶段 keydown / pointerdown，Z 键+拖动，多处 `preventDefault + stopImmediatePropagation` | `:791-851` |

### 3.4 rgthree（`rgthree/rgthree-comfy`）

| 接管位置 | 行为 | 证据 |
|---|---|---|
| 连线绘制 | **未发现** `drawConnections` / `renderLink` / `_renderAllLinkSegments` patch | grep 无命中 |
| `web/comfyui/rgthree.js:274-279` | patch `LGraph.prototype.serialize`，仅记录副本，不改数据 | 源码 |
| `web/comfyui/rgthree.js:280-314` | patch `processMouseDown` / `adjustMouseEvent` / copy-paste / `onGroupAdd` | 源码 |
| `web/comfyui/feature_group_fast_toggle.js:85-132` | patch `drawGroups` 画组标题按钮 | 源码 |
| `web/comfyui/label.js:133-134` | patch `drawNode` | 源码 |
| `web/comfyui/reroute.js:326-344` | **节点级** `onDrawForeground`（Power Reroute 标签），非 canvas 级 | 源码 |
| `web/comfyui/menu_auto_nest.js:9-10`、`:106-108` | **替换** `LiteGraph.ContextMenu` 为普通函数（子菜单自动嵌套），改写 `menu.constructor` | 源码 |
| `web/comfyui/utils.js:148-154` | patch `getConnectionPos` / `getInputPos` / `getOutputPos` | 源码 |
| 数据面 | 未见改写 Link ID / slot / `graph.extra` | grep 无命中 |

## 4. 冲突面 × 判定 × 依据

| # | 冲突面 | 判定 | 依据 | 说明 |
|---|---|---|---|---|
| C1 | `renderLinkAdapter` × Cable Management 端点替换 | 可能冲突 | `ledger.js:211-216`、`renderLinkAdapter.js:1251-1254` | CM 在 `_renderAllLinkSegments` 替换 start/end，我方用收到的 a/b 规划，端点会跟随；仅在启用 combs/ribbon 时 |
| C2 | `renderLinkAdapter` × Cable Management `SUPPRESS` | 可能冲突 | `ledger.js:230`、`renderLinkAdapter.js:996-1004` | 被 SUPPRESS 的链路该帧不进 renderLink，我方 `state.routes` 保留旧条目（清理仅拓扑变化触发）→ 悬停可能命中不可见旧线 |
| C3 | `renderLinkAdapter` × Cable Management 路由引擎 | 可能冲突 | `pathing.js:90-113`、`renderLinkAdapter.js:1399-1409` | CM 的 PCB 路由在 pathRenderer 内生效；我方自绘成功后不回原函数 → 两套避障参数互斥，谁生效取决于我方 `style` 开关 |
| C4 | 磁吸 overlay × Cable Management | 无交集 | `pathing.js` 无拖动/overlay 接管 | CM 不监听节点拖动、不画 DOM overlay |
| C5 | 组悬停菜单 × Cable Management | 无交集 | grep 无 `ContextMenu` 命中 | CM 不包装 `LiteGraph.ContextMenu` |
| C6 | `verify()` × Cable Management 写 `extra` | 可能冲突（验收盲区） | `routestore.js:22-37`、`index.js:47-57` | CM 写 `graph.extra`，我方快照不含 `extra`，检测不到工作流字节变化 |
| N1 | `renderLinkAdapter` × NKD 路由引擎 | 确定冲突（语义重叠） | `rerouteSplines.js:686-730`、`:768-836`、`renderLinkAdapter.js:1399-1409` | 两套正交路由接管同一批线；我方自绘线完全不进 NKD pathRenderer，反之 native 模式我方不绘制 → 只能一套生效 |
| N2 | 磁吸 overlay × NKD Shift 磁吸 | 确定冲突（手势重叠） | `dragAdapter.js:545`、`:595-647`、`:332-355`、`dragSnap.js:345-350` | Shift 拖动时两套提示线同时出现；我方 pointerup 同步写位，NKD `setTimeout(0)` 后最终写位 → 落点由 NKD 决定，与提示线不一致；非 Shift 无交集 |
| N3 | 组悬停菜单 × NKD | 无交集 | grep 无 `ContextMenu` 命中 | NKD 不包装链路菜单 |
| N4 | 数据面 × NKD | 无交集 | grep 无 `graph.extra` / `serialize` / `links.set` | 仅用户拖动时写 `node.pos` |
| Z1 | `renderLinkAdapter` × Zip Ties 分段重绘 | 确定冲突 | `zip_ties.js:1100-1135`、`renderLinkAdapter.js:1392-1396` | 顺序 A（Zip Ties 在外层）：对我方线按 tie 断点多次调 `origRenderLink`，我方每段覆写 `link.path/_pos`，命中只剩最后一段；顺序 B（我方在外层）：我方自绘直接返回，Zip Ties 对络纹线不生效 |
| Z2 | 磁吸 overlay × Zip Ties 手势 | 可能冲突 | `zip_ties.js:791-851`、`dragSnap.js:345-350` | Zip Ties 在 window capture 阶段对 Z 键+pointerdown 执行 `preventDefault/stopImmediatePropagation`，可能吞掉我方冒泡阶段的拖动事件；仅 Z 手势场景 |
| Z3 | 组悬停菜单 × Zip Ties 右键 | 可能冲突 | `zip_ties.js:813-817`、`:825-831`、`renderLinkAdapter.js:1205-1223` | tie 上右键被 Zip Ties 抢先拦截，链路菜单不弹，我方注入不触发；tie 压在我方主干段时的行为需实测 |
| Z4 | `verify()` × Zip Ties 写 `extra` | 可能冲突（验收盲区） | `zip_ties.js:11-12`、`index.js:47-57` | Zip Ties 写 `graph.extra.zipTies`，我方快照不含 `extra` |
| R1 | `renderLinkAdapter` × rgthree | 无交集 | grep 无 `drawConnections` / `renderLink` 命中 | rgthree 不接管连线绘制；其 patch 的 `getConnectionPos` 属端点消费方，我方自然兼容 |
| R2 | 磁吸 overlay × rgthree | 无交集 | `rgthree.js:280-291` | 仅记录鼠标事件，不接管拖动或 overlay |
| R3 | 组悬停菜单 × rgthree `ContextMenu` | 可能冲突 | `menu_auto_nest.js:9-10`、`:106-108`、`renderLinkAdapter.js:1209-1219` | rgthree 把 `ContextMenu` 替换为普通函数并改写 constructor；我方用 `Proxy` + `Reflect.construct`，层叠顺序可能导致注入失效或构造异常 |
| R4 | 主干组 × rgthree 组标题按钮 / 组绘制 | 无交集 | `feature_group_fast_toggle.js:85-132` | 我方「主干组」是链路分组，不绘制 `LGraphGroup` |
| R5 | 数据面 × rgthree | 无交集 | `rgthree.js:274-279` | `serialize` patch 只记录副本，不改图数据 |

## 5. 缺口（必须显式标注）

- **未做运行时验证**：以上全部为源码级判定。Cable Management / NKD Reroutes / Zip Ties 未安装；rgthree 在宿主 `custom_nodes` 有目录，但 2026-11-07 运行中的服务未加载（`/extensions` 无其前端资源、`/object_info/Reroute` 返回 `{}`）。`LuoWen.status()/verify()/routes()` 在共存条件下没有实测数据。
- 未验证项：
  1. 实际安装顺序（扩展注册顺序）决定 renderLink / drawConnections / ContextMenu 的包装层叠，Z1、R3 的最终表现依赖该顺序。
  2. C1/C2：Cable Management combs/ribbon 启用后，我方线路端点与悬停命中的实际偏差。
  3. N1：双路由引擎同时启用时是否出现单线双画、闪烁或参数静默失效。
  4. N2：Shift 拖动同时触发两套磁吸时的落点、提示线与 undo 条数。
  5. Z2/Z3：Z 手势与 tie 右键对我方拖动、链路菜单的实际拦截范围。
  6. C6/Z4：`verify()` 对 `extra` 写入的检测盲区是否需要在验收口径中补充。
- 未覆盖：四者的两两/三三组合、经典画布与 Vue 模式分别表现、子图内表现。
- rgthree 未加载原因未确认（Manager 禁用、启动时序或导入失败均可能），R3 无法直接运行时验证；排查属宿主配置操作，需另行批准。

## 6. 运行时验证方案（需用户批准，本轮不执行）

| 项 | 内容 |
|---|---|
| 安装位置 | `%ComfyUIPortable%\ComfyUI\custom_nodes\<repo-name>\`；四个仓库独立目录，逐个安装、逐个卸载，不并行 |
| 依赖 | Cable Management / NKD Reroutes / Zip Ties 为纯前端扩展（无 pip 依赖）；rgthree-comfy 含后端自定义节点（`__init__.py` 注册），会改变节点列表与 `/object_info`，无法只装其 web 部分 |
| 对宿主影响面 | 不改 `python_embeded`、不改 requirements、不动 `extra_model_paths.yaml`；影响限于新增 `custom_nodes` 目录、页面 JS 全局钩子、`graph.extra` 写入、启动日志与节点菜单（rgthree） |
| 回滚方式 | 删除对应 `custom_nodes\<repo>` 目录 → 重启 `run_nvidia_gpu.bat` → 页面 hard reload；安装前记录 `custom_nodes` 目录清单与 mtime，卸载后逐一核对；不执行 git 操作 |
| 验证样本 | 当前 10 节点图（KSampler 四入线 + 主干组 `62:0` + 等距带），另加 1 条 Reroute 链、1 个组、1 次子图转换 |
| 每项观测 | 控制台错误；`LuoWen.status()` / `verify()` / `routes()`；截图；实际安装顺序；C1/C2/N2/Z1/Z3 对应现象 |
| 退出条件 | 单个扩展测完即卸载再装下一个；如需组合验证，另列批准清单 |

## 7. 本轮落盘改动（批准后执行）

1. `docs/agents/compatibility-matrix.md`：
   - §5.2 表格行「Cable Management / NKD Reroutes / Zip Ties / rgthree」由「未支持（环境缺失）」改为「未做运行时验证（源码级见 §5.4）」。
   - 在 §5.3 之后、`## 6. 复现入口` 之前新增 `### 5.4 第三方扩展共存（源码级，「未做运行时验证」）`，内容为本文件 §3、§4、§5 的精简版（保留 file:line 依据与判定，不复制运行时方案全文，只引用本 spec）。
   - frontmatter `updated` 保持 `2026-11-07`。
2. `docs/agents/project-progress.md`：在「当前状态」后新增本轮进展块，记录源码级结论、临时克隆位置、未做运行时验证缺口、运行时方案待批准。
3. 不提交 git；不安装任何扩展到宿主；不改宿主依赖。

## 8. 明确不做

- 不安装第三方扩展、不改宿主依赖。
- 不改 `renderLinkAdapter.js` / `dragSnap.js` 功能代码（本轮只做分析落盘）。
- 不把运行时方案执行掉；方案仅随 spec 提交审批。
