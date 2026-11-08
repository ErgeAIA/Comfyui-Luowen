# 络纹自动布局 PRD / 技术方案 v1.0（草案，待用户批准）

> 对应 PRD §4.2 F-015（DEC-038 纳入）。任务书：`luowen-auto-layout-research-brief.md`；阶段产出：audit.md（A）/ model.md（B）/ algorithms.md（C）/ prototype-report.md（D）/ performance.md 台账（E）。
> 证据分级：**已实测**（本机探针/单测）/ **代码静态推断**（1.55.18 sourcemap file 级）/ **设计假设**（待验证）。实施轮启动以本 PRD 批准为前提。

## 1. 用户问题与产品目标

复杂工作流（本批真实样本 176–230 节点）手工整理成本高：现状基线 116–187 处连线交叉、20 处节点重叠、74 条反向边（已实测）。目标：一键把图整理成**流向清晰、无重叠、保持用户语义结构（Group/折叠意图）、完全可撤销**的布局，且整理结果由 Routing 引擎自动获得更好路由输入。

## 2. 用户场景与布局意图（MVP 边界）

- **MVP-1 全图流向布局**：输入→输出阅读方向（LR 分层），全图重排、单条 undo。
- **MVP-2 选区局部布局**：选中子图重排，未选节点/固定节点零位移并作障碍。
- **MVP-3（可选开关，默认关）整理时折叠说明节点**：Note/Markdown 类自动折叠（需 §15 决策项 D1 批准边界修订）。
- 非目标（本版）：功能语义分组（证据不足）、入口/出口组织预设、Group 自动创建/重组、力导向、子图内部布局。

## 3. 架构审计

见 audit.md。要点：Routing 引擎完整可复用；Layout 从零；1.55.18 宿主已有 layoutStore/mutations 子系统但扩展无专属 source 标签且组合式工厂不可达（audit §2）。

## 4. 图模型与约束模型

见 model.md。五类分离（拓扑/几何/约束/意图/输出）；Reroute 链折叠（DEC-033 手动意图保护引申：manualIntent 标记、分叉/环保守不折叠）；Group 成员几何包含推导；非 DAG 返 null；指标 9 项可计算（cohesion v1.1 紧凑度口径）。

## 5. 算法对比

见 algorithms.md（六真实样本 × 三算法 × 三场景矩阵 + 决策矩阵 + 钢人论证）。

## 6. 方案选择与淘汰理由

**选定：ELK Layered（vendor elkjs@0.9.3）为主引擎 + 自研障碍规避后处理 + 自研参考分层为 fallback。**
- 实测：六样本交叉 −60~93%、反向边全归零、局部场景三算法 0 违规、确定性成立。
- 淘汰 dagre：交叉系统性落后 2 倍（无端口约束）；钢人论证后不推翻。
- 淘汰自研主算法：交叉最小化环节缺失（参考实现交叉爆炸 1585–2930），MVP 时间盒内不可行。
- 力导向：未实验（任务书预判不适合数据流方向性；ELK 数据已足够裁决）。

## 7. 算法流程与关键数据结构

1. 快照：`graphRead` 扩展出布局快照（节点尺寸/端口/折叠态 + 链接 + Group bounding）。
2. `buildModel` → Reroute 折叠 → `buildConstraints`（fixed/movable/obstacles/notes）。
3. movable 子图 → ELK（LR、端口 FIXED_SIDE、节点间距 40/层间 80）→ 绝对坐标。
4. 后处理：Group bounds 随成员重算（MVP flat 方案）；障碍规避（movable 与 fixed 矩形重叠时列平移，Phase E/实施轮首项）；折叠节点 size 写入（若 D1 批准）。
5. 应用：pos（+size/collapsed）批量写入 → 单条 undo（§11）→ Routing 缓存自动失效（障碍版本机制，现有架构）。

## 8. 全图与局部布局规则

- 全图：全部非 Note 节点 movable；Note 类按 D1 开关处理。
- 局部：selectedIds 之外**一律 fixed + 障碍**（实测违规 0）；movable 子图布局；位移仅发生选中集。
- 固定节点（pinned）：恒 fixed，任何场景不移动。

## 9. Group / Reroute / Note 规则

- Group：成员随布局移动后 bounds **重算为成员新包围盒+边距**（MVP；compound 实测面积 ×3 不采纳）；锁定 Group（lockedGroupIds）成员并入 fixed（默认不启用）。
- Reroute：链折叠为直连边（manualIntent）；Reroute 节点位置在 MVP 随端点对相对固定策略布置（不参与分层）；分叉/环链保守不折叠（如实 dropped）。
- Note：布局参与物（占位）；折叠行为见 §2 MVP-3（待 D1）。

## 10. Layout / Routing 接口边界

布局只写 pos（+D1 批准后的 size/collapsed）；**不触碰任何连接/图数据**。Routing 侧：障碍版本/laneHash 自动失效（现有架构）→ 布局结束一帧后全图重路由，无需 Layout 层调用 Routing API。`LuoWen.verify()` 快照即布局正确性检查器（拓扑/extra/properties 不变量）。

## 11. 撤销 / 预览 / 幂等 / 回滚（已实测）

- **单条 undo**：布局前 + 布局后各一次 `captureCanvasState()`（activeState 模型，Pinia workflow store 路径）；`tracker.undo()` 实测 23/23 恢复。整次布局=一条 undo。
- 预览：MVP 不做实时预览（直接应用 + undo 兜底）；预览列为后续增强。
- 幂等：ELK 确定性 + 输入规范化（排序）——同图二次布局 23/23 同位（实测）。
- 回滚：失败（ELK 异常/超时）→ 不写入任何 pos（纯函数先算后写）；写入中断由 undo 覆盖。

## 12. 性能预算（研究期实测，实施轮补 500 节点梯度）

端到端 ≤300ms@230 节点（build 15 + eval 5 + ELK 95–261）；写入+刷新帧耗实施轮补测。预算线：500 节点端到端 ≤1s、主线程单段阻塞 ≤300ms（超则分帧写入）。

## 13. 验收标准

- **硬约束（一票否决，全部可机检）**：拓扑/属性零差异（verify）；不增删重连；未选/pinned 零位移；无节点重叠；Group/Reroute/Note 规则符合 §9；单条 undo 精确恢复；幂等；保存/重载一致。
- **软指标对照**：交叉/边长/反向边相对基线的下降率（同口径 evaluateLayout 输出表）；不设总分。
- **三类证据**：A 结构正确性（自动化测试+verify）=已实测路径；B 算法质量（六样本对照表）=已实测；C 人类可读性=**尚未验证**（盲测协议见 motion-research §六，实施后执行）。

## 14. MVP 与后续阶段

MVP = MVP-1 + MVP-2 + 触发 UI（菜单/快捷键）+ 障碍规避后处理。后续：折叠开关（D1 批准后）、Group 锁定 UI、语义分组、预览、子图布局、compound Group 布局（实测面积 ×3，仅当用户要求语义保持优先）。

## 15. 风险 / 未决 / 需用户决策

| # | 决策项 | 建议 |
|---|---|---|
| D1 | **折叠写入边界修订**：允许布局写 collapsed 标志+折叠尺寸（超 F-015「仅 pos」） | 建议批准（PRD §4.2 F-015 同步修订「pos 与折叠状态」），默认关 |
| D2 | MVP 范围确认（MVP-1+MVP-2） | 建议采纳 |
| D3 | Group 自动重组 | 默认不做（语义结构不动） |
| D4 | 认知盲测（≥5 用户）实施时机 | **A/B 文件已备**（.verify/p7/blind-A/B.json，默认模板原布局 vs 自动布局），待参与者 |
| 风险 | ELK 断环边的视觉流向（本批样本无环，未测）；障碍规避后处理未实现；folded Reroute 节点定位策略 | 实施轮首项/原型补测 |

## 16. 原始资料与实验数据索引

- 快捷键：Ctrl+Shift+L（全图）/ Ctrl+Alt+L（选区）；1.55.18 无公开命令注册 API，画布菜单挂接待 Vue 组件取证。

- 任务书与评估：`luowen-auto-layout-research-brief.md`（用户提供）→ plan.md §1 核实表。
- 阶段产出：audit.md / model.md / algorithms.md / prototype-report.md；性能：performance.md §2026-11-08 自动布局条目。
- 探针与数据：`.verify/p7/`（algos/results.json、prototype/proto-result.json、host-ga.js、host-layoutStore.js、samples/）。
- 宿主取证：1.55.18 sourcemap（layoutMutations.ts / layoutStore.ts / graphLayoutAttachment.ts / useArrangeNodes.ts / changeTracker.ts），关键行号见 audit.md/prototype-report.md。
- vendor：`luowen/web/vendor/`（elkjs 0.9.3 EPL-2.0 / dagre 0.8.5 MIT，THIRD_PARTY_NOTICES.md 登记）。
- 决策记录：DEC-043（含补记 A–D）。

## 17. 实施拆分（批准后的生产改动顺序，每步对照表验收）

1. **布局快照适配器**：graphRead 扩展（尺寸/端口/折叠态/Group bounds）→ 快照（纯函数，单测）。
2. **ELK 编排**：vendor 加载（script/import 兼容）+ movable 子图 + 端口 FIXED_SIDE + 应用写入（§11 撤销链）。
3. **障碍规避后处理**：fixed 矩形碰撞 → 列平移（实现+宿主实测）。
4. **触发 UI**：设置项（`LuoWen.AutoLayout.*`，i18n 双语）+ 画布菜单「整理（流向）」+ 快捷键；折叠开关（D1）。
5. **验收**：六样本前后对照 + verify/undo/幂等机检 + 性能台账（500 节点梯度）+ 盲测（D4）。
