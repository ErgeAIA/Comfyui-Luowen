# LuoWen 自动布局：可执行研究与实施计划 v1.0

> 来源：用户提供的《Luowen 自动布局：深度研究与方案设计任务书》（`luowen-auto-layout-research-brief.md`，2026-11-08，另一 AI 起草）。
> 本文件 = 对该任务书的**核实评估结论**（§1）+ **修正后的事实基线**（§2）+ **可执行阶段计划**（§3）+ **需用户决策清单**（§4）。
> 纪律沿用：研究阶段不改生产代码；每阶段完成即停、交对照表等验收（DEC-037）；性能结论先量后改入 performance.md。
> 决策依据：PRD F-015（DEC-038 纳入范围，实现殿后——本计划即其排期启动件）。

---

## 1. 任务书核实评估结论

总体判定：**结构合格、边界纪律正确，可作为研究蓝图；但含 3 处事实性预设错误与 2 处重要遗漏，执行前必须按 §2 修正。**

### 1.1 核实为正确/有效的部分

| 任务书内容 | 核实结果 |
|---|---|
| §1 约束清单（端口感知、Group、局部固定未选节点、确定性幂等、不增删重连、版本核对） | 与 PRD F-015（用户主动触发/单条 undo/不在热路径/仅 pos/快照回退，DEC-038）一致，属合理扩展 |
| §2.4 局部布局=约束布局、不得后处理偷移未选节点 | 正确，采纳 |
| §2.5 几何整齐≠可读、多目标冲突显式化 | 正确，采纳 |
| §2.6 布局=非破坏性编辑操作、不得认定 `node.pos` 直赋为正确写入方式 | 正确，且已核实：1.55.18 存在宿主布局变更子系统（见 §2.3） |
| §3.1 「旧 PRD 不等于当前代码事实」 | 正确（其自身 §1 即违反此条，见 1.2） |
| §4 ELK/elkjs/Dagre 对照 + 「不得把 ELK Java 能力等同 elkjs」 | 正确，采纳 |
| §6 硬约束一票否决 + 三类独立证据 | 正确，采纳；结构不变量检查器可直接复用本项目 `LuoWen.verify()`（已覆盖 extra/properties/pos，BUG-007） |
| §9 反方审查 + 双向钢人论证 | 正确，采纳 |
| 「研究阶段不直接修改生产代码」 | 正确，沿用 |

### 1.2 必须修正的事实错误

| # | 任务书原文 | 事实（2026-11-08 核实） | 处置 |
|---|---|---|---|
| F1 | 「Luowen 长期包含三个独立引擎：Layout / Theme / Routing」 | **Layout 引擎不存在**（F-015 仅 PRD 立项）；「Theme」仅为连线配色 token（`luowen/web/colors/`，DEC-039），不是视觉主题引擎；Routing 存在（`luowen/web/{geometry,routing,adapters,snap}`） | 现状审计以「Routing 现状 + Layout 从零」为基线；三引擎为**目标架构**而非现状 |
| F2 | §3.1/§10 暗示按官方主分支路径审计 | 项目锁定宿主前端 **1.55.18**（requirements 声明 1.57.4 未重装，沿用既有口径）；已逐文件取证：`layout/operations/layoutMutations.ts`、`layout/store/layoutStore`、`layout/types.ts`、`layout/operations/graphLayoutAttachment.ts` **在 1.55.18 均已存在**（sourcemap 取证）；但 `LayoutSource` 枚举仅 `Canvas='canvas'`/`Vue='vue'` 两值——**扩展无专属 source 标签** | 审计以 1.55.18 sourcemap 为准（file: 级证据入 conventions）；主分支路径仅作演进对照 |
| F3 | §5 工具假设「Vitest（若项目使用）」 | 本项目测试框架 = **node:test**（`node --test tests/unit/*.test.mjs`，124 项） | 计划统一按 node:test 表述 |

### 1.3 任务书遗漏、必须补入的重要事实

| # | 事实 | 对布局方案的影响 |
|---|---|---|
| G1 | **宿主自带「整理」功能**：`useArrangeNodes.ts`（1.55.18）提供 vertical/horizontal/grid 三模式 + gap 0–48（默认 12），内部走 `useLayoutMutations().batchMoveNodes` | 任务书未提。自动布局必须回答与原生整理的关系：差异化定位=**拓扑/端口感知**（宿主纯几何排列不做）；同时原生实现是「宿主认可写入路径」的一手范例，MVP 可对照其行为 |
| G2 | 本项目已有结构不变量资产：`LuoWen.verify()` 快照（nodes/links/extra/properties/pos 全覆盖）、`graphRead`（graphNodes/linkTuples）、Reroute 判定 `carriesReroute()`（DEC-033）、fixture14 测试范式、`.verify/p*` 探针协议、i18n 架构（新功能文案双语直出） | §6 硬约束 A 类证据可大部分复用现成机制，成本大幅降低；新 UI 文案按 i18n 流程走 |
| G3 | 撤销机制事实：1.55.18 撤销 = `changeTracker` 快照（Vue 拖动 `captureState`；Ctrl+Z = `loadGraphData` 重建，触发我方 `afterConfigureGraph`） | 「单条 undo」实现候选 = 布局前单次 `captureState`（或 `graph.beforeChange/afterChange` 事务）；Phase A 实测定案 |
| G4 | `layoutStore` 与 `node.pos` 的同步语义未完全取证（moveNode 写 store 后 node.pos 是否同步、渲染以谁为准） | **Phase A 必查项**：决定写入路径（layoutMutations vs setPos vs batchMoveNodes），直接决定 Routing 层是否无感 |

---

## 2. 修正后的事实基线（研究输入）

### 2.1 本仓库（2026-11-08，HEAD 4859a18）

- 引擎现状：**Routing 完整**（正交路由/主干/等距带/避障/缓存，533 行级单测覆盖）；**Layout 无**；「Theme」=配色 token（非布局相关）。
- 图读取：`graphRead.graphNodes/linkTuples`；快照/校验：`index.js snapshotGraph/diffSnapshot` + `LuoWen.verify()`（含 `extra`/`node.properties`/`nodePos`，宿主自有 extra 键排除 10 项）。
- Reroute：挂在单条 Link（`link.parentId`），`carriesReroute()` 判定；含链连接不参与主干合并（DEC-033）。
- Group：`LGraphGroup`，其 bounding/plate 操作已有实测记录（阶段 3 组生命周期）。
- 写入路径候选（1.55.18 取证）：`node.setPos`/`pos` 直赋（Vue 拖动走 `batchMoveNodes` useNodeDrag 路径）；`useLayoutMutations(source).moveNode/batchMoveNodes`（source 仅 canvas/vue）；原生整理 `arrangeNodes(mode, gap)`。
- 撤销：`changeTracker.captureState` 单条快照；事务 `graph.beforeChange/afterChange`。
- 测试：node:test 124 项；几何/主干/fixture14 结构断言范式可复用。
- 热路径禁令（AGENTS.md/PRD §10.1）：布局计算**不得**进入渲染热路径——用户主动触发、一次性计算。

### 2.2 宿主前端 1.55.18（sourcemap 取证）

- `renderer/core/layout/`：`store/layoutStore`（NodeLayout: position/size/zIndex/visible/bounds；`applyOperation(moveNode|setNodeZIndex)`、`batchUpdateNodeBounds`、`getNodeLayout`、`allocateZIndex`）；`operations/layoutMutations.ts`（`useLayoutMutations(source)` → moveNode/batchMoveNodes/setNodeZIndex/bringNodeToFront/setNodeOrder）；`operations/graphLayoutAttachment.ts`（17KB，作用待 Phase A 详读）；`transform/useTransformSettling.ts`。
- `LayoutSource = { Canvas, Vue }`——扩展无专属来源标签；若走该路径须评估以 'canvas' 之外是否影响宿主遥测/同步（Phase A）。
- 原生整理：`composables/graph/useArrangeNodes.ts`——vertical/horizontal/grid + `DEFAULT_ARRANGE_GAP=12`（0–48），`ArrangeLayout` 类型导出。
- 撤销/序列化：changeTracker 快照、`loadGraphData` 重建、工作流 serialize 不含布局专有位（`extra` 白名单见 BUG-007）。

### 2.3 明确不属于事实的（防止再犯）

- 「三引擎现状」、Vitest、ELK Java 能力=elkjs 能力、任何仅来自主分支源码的结论。

---

## 3. 可执行阶段计划

> 每阶段一轮会话、完成即停交验收；A/B 为研究产出（文档+探针数据），C 为带 vendoring 依赖决策的原型对照，D/E 为宿主实测。总产出 = 任务书 §8 的《自动布局 PRD/技术方案》。

### 阶段 A：现状与宿主审计（1 轮，纯取证）

1. 本仓库审计：按任务书 §3.1 输出「已实现 / 部分实现 / 未实现 / 文档-代码不一致」清单（以本文件 §2 为起点，逐条 file:line 落证）。
2. **宿主写入路径定案**（G4）：`layoutStore.moveNode` 与 `node.pos` 的同步关系（读 graphLayoutAttachment.ts 全文 + 运行时探针：经 layoutMutations 改位后 `node.pos`/渲染/我方路由是否无感）→ 产出写入路径裁决（三选一：layoutMutations / setPos / batchMoveNodes 式批量），含撤销行为实测（captureState 时序）。
3. 原生整理对照：`arrangeNodes` 三模式在同一真实工作流上的输出（作为自动布局的「宿主基线」与差异化定位证据）。
4. 前端版本核对声明：结论只对 1.55.18 负责；主分支差异（若有）单列「演进对照」小节。
5. 真实样本征集（§4 用户决策 ①）：向用户征集 3–5 份真实工作流（脱敏可选），建立样本清单（节点/边/Group/Reroute/Note 数量、分量数、尺寸极差）。
6. 产出：`docs/specs/auto-layout/audit.md` + 探针脚本 `.verify/p7/`。

验收：清单逐条 file:line；写入路径裁决附运行时证据；样本清单落地或明确标注「样本不足」。

### 阶段 B：图模型与约束模型（1 轮，纯设计+纯函数代码）

1. 五类模型分离定义（拓扑/几何/约束/意图/输出），纯计算接口——算法不触碰 ComfyUI UI 对象（任务书 §5 阶段 B）。
2. 端口感知图模型：节点→输入/输出端口（序、类型）→边；Reroute 链折叠规则（含 DEC-033 手动意图保护：含 Reroute 链的连接在布局中的固定语义）；Group 成员/Note/孤立节点/多分量建模。
3. 布局指标实现（§2.5 软指标可计算版）：crossings/total length/bends/backward edges/port alignment/group cohesion/area/位移——独立纯函数模块 + node:test 单测（复用 crossings.js 经验）。
4. 图模型单测：以 fixture14 范式构造拓扑样例（含 Reroute/Group/Note/多分量）。
5. 产出：`docs/specs/auto-layout/model.md` + `luowen/web/layout/` 纯函数模块（不接宿主）+ 单测。

验收：模型接口冻结评审（交用户）；指标全部可复现。

### 阶段 C：算法对照实验（1–2 轮，最小适配层 + 样本实验）

1. 候选：elkjs（Layered）vs Dagre vs 自研分层后处理；力导向仅作对照（任务书 §4 立场采纳）。
2. **依赖政策先决**（§4 用户决策 ②）：仓库无打包器——若引 elkjs 需 vendor 预构建产物进 `luowen/web/vendor/`（体积/许可证 MIT/更新策略写入决策）；若否决外部库则自研为唯一路径。
3. 统一适配层：图输入（阶段 B 模型）→ 候选算法 → 输出 pos 方案；固定节点/障碍/端口约束按候选能力如实标注。
4. 同样本对照：全图/局部选区/端口感知/分支汇合/Group/Reroute/固定障碍/大图 8 类场景 × 每样本，输出指标表 + 布局前后 JSON/截图。
5. 钢人论证（任务书 §9）：为最强替代方案构造反对论据，样本数据裁决。
6. 产出：`docs/specs/auto-layout/algorithms.md`（决策矩阵+淘汰理由）+ 对照数据 `.verify/p7/`。

验收：决策矩阵 + ≥3 个复杂案例前后对照 + 失败案例如实列出。

### 阶段 D：真实画布与写入路径集成（1 轮，宿主原型——仍不改生产代码）

1. 原型以页面级注入实现（`.verify` 探针模式，不动 `luowen/`）：阶段 B/C 的布局输出经阶段 A 裁决的写入路径落盘，Playwright 前后对照（同取景截图 + verify() + 撤销实测）。
2. 硬约束逐条机检：拓扑不变（verify()）、未选节点零位移、固定节点不动、无重叠、保存/重载/undo/redo 往返。
3. 认知任务小测（可随缘招募 1–2 人，不足则标注未验证）：入口/出口识别、路径追踪、分支汇合追踪。
4. 产出：`docs/specs/auto-layout/prototype-report.md` + 录屏/截图。

验收：硬约束全绿；失败案例与回退路径如实记录。

### 阶段 E：性能与最终 PRD（1 轮）

1. 端到端计时（任务书 §5 阶段 E）：图转换/尺寸读取/布局计算/批量写入/画布刷新分桶，p50/p95/max，10/50/200/500 节点梯度 + 局部布局对照；重复执行稳定性；台账口径入 performance.md。
2. 撰写《自动布局 PRD/技术方案》（任务书 §8 十六项 + 三类证据分级标注）。
3. 产出实施拆分（MVP：**流向布局（全图）+ 选区局部布局**；功能分组/入口出口组织列为后续——证据不足不做预设），含每步验收点。
4. 不实施生产改动——实施轮另行启动（届时按 DEC-042 先例逐项对照表验收）。

验收：PRD 评审通过 = 研究任务结案。

---

## 4. 需用户决策清单（开工前/途中）

| # | 决策点 | 建议 |
|---|---|---|
| ① | 真实工作流样本提供（3–5 份，可脱敏） | 必需；缺失则部分结论降级为合成样本 |
| ② | 是否允许 vendor 第三方布局库（elkjs ~1MB 级）进 `luowen/web/vendor/` | Phase C 前定；倾向「先 elkjs 对照实验、终选可自研」 |
| ③ | MVP 范围确认（流向全图 + 选区局部） | 建议采纳 |
| ④ | 与宿主原生「整理」的共存口径（我们不动其 UI，仅差异化定位） | 建议采纳 |
| ⑤ | Group 自动创建/调整默认关闭（任务书 §7.7 默认不得擅改语义结构） | 建议采纳 |
| ⑥ | 功能分组若引入 AI 分类（可选增强）是否接受其隐私/成本/不可重复性 | 默认不做，留待 MVP 后 |

## 5. 禁止事项（沿任务书 §9 + 项目规则）

不动拓扑/不增删重连节点；不动 `LuoWen.ColorTheme` 等 theme 面；不在渲染热路径布局计算；不后处理偷移未选节点；不用未验证推断充当事实（每条结论带证据等级）；不越过阶段停等验收；生产实施须另行启动并逐项对照表验收。
