# 自动布局 Phase B：图模型与约束模型规格 v1.0

> 分支 `auto-layout`，2026-11-08。代码：`luowen/web/layout/`（graph-model.js / metrics.js / constraints.js）；单测 `tests/unit/layoutModel.test.mjs`（11 项）+ `layoutMetrics.test.mjs`（9 项）。
> 纪律：**纯计算层**——三模块零 import（无宿主对象、无 window/app 引用，grep 已证），输入 plain-data 快照，输出 plain-data 模型。算法（阶段 C）只消费本层。

## 1. 五类模型分离（任务书 §5 阶段 B）

| 类别 | 载体 | 说明 |
|---|---|---|
| 拓扑 | `LayoutModel.nodes/edges/reroutes` | 节点（含端口序/类型）、边（含折叠链）、Reroute 透明路径点 |
| 几何 | `node.pos/size` + positions（Map<id,[x,y]>） | 布局算法的输入位置与输出位置同构，便于位移统计 |
| 约束 | `buildConstraints()` 约束视图 | fixed/movable/obstacles/lockedGroups/Reroute 手动意图 |
| 意图 | Phase C 算法参数（direction/preset） | 本层只定义 direction 字段（'LR' 默认），意图预设留算法层 |
| 输出 | positions Map + metrics 报告 | 输出即「每节点新位置」；应用（写入宿主）不在本层（Phase D 裁决路径） |

## 2. 构建与折叠规则

- `buildModel(snapshot)`：引用缺失/自环的边剔除并记 `dropped`（不静默）；Note 节点 `kind:'note'`；Reroute 节点进 `reroutes` 表（透明路径点）。
- **Reroute 折叠**（DEC-033 手动意图保护引申）：
  - 进入 Reroute 的边沿「唯一出边」链前向折叠为直连边，`rerouteChain` 保留被吞段 id，被吞边从模型移除；
  - 折叠后的边标记 `manualIntent=true`——布局算法对其端点对施加相对固定（MVP 口径，见 constraints notes）；
  - **保守边界**：分叉/汇合/成环的 Reroute 不折叠，原边保留 + `dropped` 如实报告（`cyclic-or-branching-reroute`）；
  - Reroute 节点不计入连通分量与拓扑序（透明路径点），但保留在 nodes 中（位置仍需布置）。
- **Group 成员推导**：快照无显式成员时按「节点中心落在 bounds 内」几何包含推导（serialize 格式无成员列表）。
- `topoOrder`：Kahn 序（确定性：同层 id 排序）；**有环返回 null**（宿主允许非 DAG——算法层须处理 null，不得假设 DAG）。

## 3. 指标定义（可计算、可复现）

| 指标 | 定义（本层口径） | 已知限制（Phase D 校准项） |
|---|---|---|
| crossings | 端口中心直连线段两两相交对数（共享端点不计、平行不计） | 真实 Routing 折线交叉 ≠ 本口径 |
| totalEdgeLength | 端口中心直连距离求和 | 同上 |
| backwardEdges | 目标口 x < 源口 x 的边数及总长 | 以端口坐标为准 |
| estimatedBends | dx 与 dy 均非零的边数（L 形曼哈顿路径转角估算） | 真实折线弯折数待对照 |
| portAlignment | dx 或 dy ≈0 的边占比 | — |
| groupCohesion（v1.1） | 每组 = 成员面积和 / 成员包围盒面积（≤1，钳制），≥2 成员的组取平均；与 bounds 无关，全图/局部两用 | 原始 bounds 口径在全图布局下失效，v1.0→v1.1 已改（2026-11-08） |
| canvasFootprint | 节点包围盒 w/h/area/aspect | — |
| nodeOverlaps | 包围盒相交对数 | — |
| displacement | 基线→输出逐节点欧氏位移 {mean,max} | 硬约束机检也用它（未选=0） |

端口坐标 MVP 口径：输入口左缘按序均分、输出口右缘按序均分（`portPos`）——与宿主真实插槽布局有偏差，Phase D 以真实渲染坐标校准（接口不变，只换投影）。

## 4. 约束模型（`buildConstraints`）

- 局部布局（`selectedIds` 给定）：**未选节点一律 fixed 并入 obstacles**（PRD F-015）；pinned 恒 fixed（即使被选中）。
- `lockedGroupIds`：成员并入 fixed（默认不启用——用户语义结构不动，plan §4⑤）。
- Reroute 手动意图：含链连接进入 `notes`（policy='pair-relative-fixed (MVP)'），算法层消费。
- 输出：`{ fixedIds:Set, movableIds, obstacles, direction, spacing, local, notes }`。

## 5. 真实样本清单与冒烟统计（Phase C 实验输入）

样本库：`%ComfyUIPortable%\...\workflows` 递归扫描 **207 份 JSON**；六维选样副本在 `.verify/p7/samples/`（gitignored，不入库）。冒烟（`sample-smoke.mjs`，`sample-smoke.json`）：

| 样本 | 节点 | 原始边 | 折叠后边 | Reroute | 分量 | dropped | build+eval |
|---|---|---|---|---|---|---|---|
| largest（图生视频流） | 230 | 248 | 173 | 90 | 34 | 15 | 19.0ms |
| mostGroups（flux+klein 多合一） | 176 | 209 | 201 | 9 | 21 | 1 | 4.4ms |
| mostReroute（WanAnimate 长视频循环） | 193 | 226 | **114** | **116** | 3 | 6 | 2.9ms |

- Reroute 折叠在重链工作流上把边数减半（226→114），验证折叠口径有效。
- 现状基线指标（用户手工布局）：largest=116 交叉/9 重叠/9 反向边；mostGroups=187 交叉/35 反向边——自动布局有真实改进空间。
- build+eval ≤20ms@230 节点：指标与建模成本可忽略，Phase C 可放开实验规模。
- 全部样本 `topoOrderValid=true`——真实 ComfyUI 工作流在本折叠口径下为 DAG（任务书 §2.1 的非 DAG 关注点保留 null 处理路径）。

## 6. 阶段 C 输入契约

- 算法输入：`(model, constraints, {direction, spacing, preset})`；输出：`positions: Map<id,[x,y]>`（仅 movable 节点可变）。
- 对照实验统一走 `evaluateLayout(model, positions, baseline)` 出表——同一口径，禁止算法自带指标。
- 已知待定项（进 Phase C）：elkjs 的端口约束表达力、固定节点（interactive layout）能力、包体积；Dagre 无 Group/固定能力清单化。
