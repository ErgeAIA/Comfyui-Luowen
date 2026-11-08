# 自动布局 Phase A：现状与宿主审计报告

> 计划来源：`plan.md` §3 阶段 A。取证日期 2026-11-08；分支 `auto-layout`。
> 结论只对 **ComfyUI 0.43.2 + 前端 1.55.18** 负责（宿主 requirements 声明 1.57.4 未重装，沿用既有口径）；主分支差异单列 §4。
> 探针脚本与原始数据：`.verify/p7/`（arrange-probe.json / arrange-probe2.json / host-ga.js / host-layoutStore.js）。

---

## 1. 本仓库清单（已实现 / 部分实现 / 未实现 / 文档-代码不一致）

### 1.1 已实现（与布局相关的既有资产）

| 资产 | 位置 | 与自动布局的关系 |
|---|---|---|
| 图读取层 | `luowen/web/adapters/graphRead.js`（graphNodes / linkTuples） | 拓扑模型直接复用；节点尺寸可经 `node.size[0..1]`/`getBounding` 补齐 |
| 结构不变量检查器 | `luowen/web/index.js` snapshotGraph/diffSnapshot + `LuoWen.verify()`（含 extra/properties/nodePos，BUG-007） | **硬约束机检现成**：布局前后拓扑/属性零差异 + 位移进 `moved` 的口径与 F-015 硬约束完全同构 |
| Reroute 判定 | `renderLinkAdapter.js carriesReroute()`（DEC-033） | 含 Reroute 链连接的「手动意图保护」语义可直接引入布局约束 |
| Group 实测经验 | 阶段 3 组生命周期（新建/移动/删除后 plate 与图数据一致） | Group 边界随成员移动的更新机制已有行为记录 |
| 写入路径经验 | `setPos` 注入（性能/兼容性多轮探针）+ `LGraph.ts:2133-2141` removeLink 事务 + `beforeChange/afterChange` 事务（组删除，DEC-021） | 批量移动的事务/撤销封装有先例 |
| undo/restore 行为记录 | changeTracker：Vue 拖动单次 undo；Ctrl+Z = `loadGraphData` 重建并触发 `afterConfigureGraph`（BUG-006/007 口径注记） | 「单条 undo」实现路径明确（§3 裁决） |
| 测试与探针协议 | node:test 124 项；`.verify/p*` Playwright 探针纪律（快照/还原） | 直接沿用 |
| i18n | `luowen/web/i18n.js`（zh/en 52 对，getter 实时取词） | 布局 UI 文案按此走 |
| 布局算法基础件 | `routing/crossings.js`（交叉枚举）、`geometry/chamfer.js`（polylineBox/格网索引） | 软指标（crossings）与空间索引可直接复用 |

### 1.2 部分实现

- **无**。布局（Layout）领域为从零建设；上表资产均为可复用基础件而非布局本体。

### 1.3 未实现（F-015 全部本体）

- 图模型/约束模型（拓扑-几何-约束-意图-输出五类分离）；布局计算（分层/放置）；意图分层（流向/局部选区）；预览；批量写入编排；触发 UI；确定性/幂等保障；性能预算。清单即 plan.md §3 阶段 B–E 的建设范围。

### 1.4 文档-代码不一致（本项核查结论）

- PRD F-015（§4.2）表述与代码现状一致（未实现、殿后）——无不一致。
- plan.md §1.2 已修正外部任务书的三处事实错误（三引擎/版本路径/Vitest），此处不重复。

---

## 2. 宿主写入路径取证与裁决（Phase A 首查项）

### 2.1 静态取证（1.55.18 sourcemap，摘录存 `.verify/p7/host-*.js`）

- **layoutStore**（`renderer/core/layout/store/layoutStore.ts`，1416 行）：**Yjs 事务型布局存储**——`applyOperation` 经 `ydoc.transact` → `applyOperationInTransaction`（case `moveNode`/`resizeNode`/`setNodeZIndex`/`createNode`…）→ `finalizeOperation`；另有 `applyOperations`（批量单事务）、`batchUpdateNodeBounds`、`getNodeLayout`、`readNodeRect`、`nodeGeometryVersion`、`allocateZIndex`。
- **graphLayoutAttachment.ts**（594 行）：`node.pos`（legacy 几何）↔ layoutStore 的**双向桥**：
  - pos→store：`setNodePosition`（含 `node.pos` 直写的稳定 mutation view 收口）→ `commitNodePosition` → `moveNodeLayout` → `layoutStore.applyOperation({type:'moveNode', source:canvasOperationMeta()})`；
  - store→pos：`refreshNodeGeometry` 在 `geometryVersion !== layoutStore.nodeGeometryVersion` 时 `readNodeRect` 回读投影缓冲。
  - **结论：两条写法殊途同归**——`node.pos` 直写（= `setNodePosition` 收口）与 `useLayoutMutations(source).moveNode`（同一 store 单例）最终都落到同一个 `applyOperation('moveNode')`；区别仅在 source 标签（canvas/vue）与是否携带 rootGraphId。
- **LayoutSource** 枚举 = `{ Canvas:'canvas', Vue:'vue' }`（`layout/types.ts`）——扩展无专属标签；经 `useLayoutMutations` 写入须伪装 source，且该 composable 是 Vue 组合式工厂、**未从 window 暴露**，普通扩展（纯 ES 模块）无法直接 import `@/` 内部模块。
- **graphLayoutAttachment.ts 其余职责**：Group/Reroute 的 layout attach/detach（`attachGroupLayout/detachGroupLayout/materializeRerouteLayout`）、节点转谱系时的 attachment 转移（`transferLayoutAttachment`）——布局引擎对 Group/Reroute 的移动也应经同一桥（Reroute 在 1.55.18 已是 layout 实体）。

### 2.2 运行时探针

| 探针 | 结果 |
|---|---|
| `canvas.arrange` | **不存在**（legacy 移除）；`graph.arrange` 存在（经典执行序列分列布局，`LGraph.ts arrange(margin?, layout?)`） |
| 经典 `graph.arrange()` 实测（默认 10 节点图） | **10/10 节点重排**（执行序列分列）；我方路由自动跟随新位置（routes 8 条可见=2 条移出视口被裁剪，与既有视口裁剪口径一致）；`verify()` 结构 ok、位移如实进 `moved` |
| **撤销（Ctrl+Z）after graph.arrange** | **未恢复**——10 项位置与初始快照差保持（`moved_undoAfterGraphArrange=10`）。**经典 arrange 直写 pos 未进 changeTracker → 不可撤销** |
| 新版 ArrangeButton（vertical/horizontal/grid + gap 滑条，`ArrangeButton.vue` + `useArrangeSession.ts` 静态取证） | DOM 定位未命中（按钮在 view controls 中的确切入口待 Phase D 补测）；静态证据已足以确认其存在与三模式行为 |

### 2.3 写入路径裁决（Phase A 交付结论）

**裁决： LuoWen 自动布局采用「`node.pos`（`node.setPos`/投影直写）批量提交 + 布局前单次 `changeTracker.captureState`」组合，不试图 import `useLayoutMutations`。**

依据：
1. pos 直写已被宿主桥自动同步进 layoutStore（§2.1 pos→store 收口），store 侧版本机制保证渲染一致——**无感于 Routing 层**（本仓库全部探针/用户拖动均为该路径，行为充分验证）。
2. `useLayoutMutations` 不可达（组合式工厂未暴露）且需伪装 source；直写无此问题。
3. 撤销：宿主自带整理不可撤销（§2.2 实测）证明直写路径**不会**自动产生 undo 记录——F-015「单条 undo」必须由我方在布局前显式 `captureState`（或 `graph.beforeChange/afterChange` 事务），布局后由 changeTracker 常规快照链恢复。Phase D 原型须实测 captureState→布局→Ctrl+Z 完整还原。
4. 幂等/确定性由我方算法保证（阶段 B/C 的纯函数输入输出 + 固定排序），与写入路径解耦。

---

## 3. 原生整理对照（宿主基线）

| 维度 | 宿主经典 `graph.arrange` | 宿主新版 ArrangeButton（静态取证） | LuoWen 自动布局（目标差异化） |
|---|---|---|---|
| 依据 | 执行序列（`computeExecutionOrder`）分列 | 三模式（vertical/horizontal/grid）+ gap 滑条 | **拓扑+端口感知**分层（数据类型/端口序/Group/Reroute 约束） |
| Group/Reroute/Note | 无专门处理 | 待 Phase D 实测 | 显式建模（B 阶段） |
| 固定/选区局部 | 无 | 待实测 | 硬约束（未选零位移） |
| 撤销 | **无（实测）** | 待实测 | **有（captureState，硬约束）** |
| 与 Routing 衔接 | 无 | 无 | 布局后 Routing 缓存自动失效重路由（现架构已支持，pos 变更即 obstacle 版本失效） |

---

## 4. 前端版本声明与演进对照

- 结论仅对 1.55.18 负责。已核对：layoutMutations/layoutStore/graphLayoutAttachment/types 在本版本均存在；`operations/` 目录仅此两文件。
- 主分支演进对照（执行时再核）：任务书 §10 所列路径在新版可能重构（本版本 `LayoutSource` 仅两值，新版或增扩展来源）——实施轮若宿主升级需重跑 Phase A。

---

## 5. 样本征集状态

待用户提供 3–5 份真实工作流（plan.md §4①）。缺失期间阶段 C 的对照实验将使用：默认模板 + 既有合成梯度（LatentBlend 50/200/500）+ fixture14 拓扑样例，并明确标注「非真实工作流」。

---

## 6. Phase A 交付清单

- 本报告（audit.md）。
- 探针：`.verify/p7/arrange-probe.mjs`、`arrange-probe2.mjs` + 结果 JSON×2 + 截图（arrange-graph-classic.png）。
- 宿主源码摘录：`.verify/p7/host-ga.js`（graphLayoutAttachment 全文）、`host-layoutStore.js`（layoutStore 全文）。
- 写入路径裁决（§2.3）与撤销机制结论（G3 强化：宿主整理不可撤销的实测反例）。
