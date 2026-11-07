---
title: CLIP 主干线拖动抖动诊断与修复 Spec
type: spec
project: 络纹（LuoWen）
status: pending-approval
created: 2026-11-07
updated: 2026-11-07
scope: 诊断「拖动任意节点时 加载CLIP→两个 CLIP文本编码 的连线逐帧抖动」，给出最小修复方案
---

# CLIP 主干线拖动抖动诊断与修复 Spec

> 本轮只诊断，不改代码、不提交。本文只做「已证实事实 + 待拍板方案」，不包含任何已实施的代码改动。
> 事实基线全部来自本机宿主（ComfyUI 0.43.2 / 前端 1.55.18 / Vue 节点模式）实测，以及 `luowen/web/adapters/renderLinkAdapter.js`、`luowen/web/routing/laneAssign.js` 源码。

## 1. 现象

- 拖动任意节点时，「加载CLIP」→「正向条件 CLIP文本编码」的那一束连线（红框：加载CLIP 右侧到两个 CLIP文本编码 左侧）持续抖动，观感为「每帧都在重算路径」；其余连线稳定。
- 当前宿主为默认 10 节点布局；该束链路为中心主干组 `2:0`：
  - link 9：origin `2/0` → target `4/0`，type `CLIP`（正向条件 CLIP文本编码）
  - link 10：origin `2/0` → target `5/0`，type `CLIP`（负向条件 CLIP文本编码）
- 稳定态几何（`state.routes`，即倒角后最终绘制折线），version=3，fork T=107：

| link | 折线（图坐标） |
| ---- | -------------- |
| 9 | `[-440,139.000017] → [146,139.000017] → [146,302.000003] → [170,302.000003]` |
| 10 | `[-440,139.000017] → [-333,139.000017] → [-333,677.000020] → [-309,677.000020]` |

## 2. 已复现的事实（证据）

### 2.1 逐帧移动无关节点：折线逐点不变

- 合成 `setPos` 扫掠：SaveImage（node 10）连续 30 帧，每帧 `+3px x`、`±6px y`，样品帧均在 2 rAF 后取。
  - `obstacleVersion` 4 → 33（每帧 +1）。
  - 每一帧 `LuoWen.status().trunks` 为空（fork 为空串）。
  - link 9 / link 10 的 `state.routes` 与稳定态**逐点完全一致**，`diffCount = 0`。
- 单步矩阵：依次把 node 1/3/7/8/9/10 各 `+8px`，A 帧（版本变更当帧）与 B 帧（次帧）的 link 9/10 折线均未变化（A_changed=false、B_changed=false）。

### 2.2 真实指针拖拽：同样逐点不变

- 用合成 PointerEvent（`pointerdown` 于 `[data-node-id="8"]`，`pointermove` 带 `buttons=1`，`pointerup`）驱动一次真实 Vue 拖拽，18 步。
  - `obstacleVersion` 35 → 69（每步 +2）。
  - 18 个采样帧的 `trunks` 全为空，link 9/10 折线与稳定态一致（changedCount = 0）。
  - `state.hover` 全程为空，`canvas.over_link_center` 全程 false。

### 2.3 拖动期状态机（每帧必然发生）

`beginFrame`（renderLinkAdapter.js:470-523）与 `planTrunks`（:154-230）组合出的拖动期语义：

1. Vue 节点模式下 `canvas.pointer.isDown === false`（Vue 拖拽由 DOM 层驱动，不进 LiteGraph 指针状态），因此 `beginFrame` 的「拖拽期冻结」分支（:473）**从不生效**。
2. 任一点位变化使 `obstacleHash` 变化 → `frame.version += 1`，并**清空** `state.routes`、`frame.prevRoutes`、`frame.baseRoutes`、`frame.effectiveRoutes`、`frame.trunks`、`frame.trunkShared`（:480-491）。
3. 版本变更瞬间 `state.endpointsVer` 仍滞后一帧，`planTrunks` 在 :199-203 直接 `return`，并主动 `canvas.setDirty(true, true)` 再要一帧。
4. 所有线路的缓存键含 `state.frame.version`（:698/715），版本一变即全部失效 → **本帧全部线路逐条重解 A\***。
5. 结果：拖动期间 `trunks` 恒为空，整幅图在「有主干计划」与「无主干计划」两态之间逐帧翻转；同时 `canvas.setDirty` 自请求与拖拽本身的 dirty 叠加，形成持续整帧重绘。

### 2.4 该状态的放大效应（意外复现的实测）

一次 x 映射失真的合成拖拽把 node 8 停在 x=130790，并留下**每帧 -16.666667px 的漂移**；在此期间：

- `obstacleVersion` 每帧 +1 无限增长（实测 4.6 万+）；
- `planTrunks` 永远失败、`fork` 恒为空；
- 3 个空闲 rAF 内 `drawConnections` 调用数为 0（说明稳定后不空转，但漂移期间会持续空转）。

结论：只要有任何一点位置在动，「逐帧全图重解 + 主干态翻转」是必然结果，与拖动哪个节点无关。

### 2.5 测量口径修正

- 2D canvas 像素回读不可靠：空闲状态下连续两次 `drawImage + getImageData` 差异达 191506 像素，因此**像素级 diff 不能作为抖动证据**，本文只采用 `state.routes` 几何与状态字段。

## 3. 已排除项

1. **不是 A* 等代价路径切换**：同输入下多帧重复求解结果逐点一致（2.1/2.2）。
2. **不是 `nearFlatPath` 2–3px 捷径**：link 9 的 |dy| = 163、link 10 的 |dx| = 131，均不满足 `STRAIGHT_TOL=3` 条件。
3. **不是 lane/stub 变化**：本组 `stubOut=24` 恒定；`stubIn` 24 且 `laneBlocked` 在该位置不成立；扫掠中折线未变即为间接证据。
4. **不是运行期浮点阈值反复跨过**：link 9/10 的折点均远离阈值（无 ≤3px 段）。
5. **不是 hover/高亮逐帧切换**：拖拽 18 帧内 `state.hover` 恒为 null，`over_link_center` 恒为 false。
6. **不是拖动期 `previewPath` 与静态路径不一致**（对这两条线）：`pointer.isDown` 恒为 false，未进入 preview 分支。

## 4. 根因（一句话）

**拖动期 `beginFrame` 因 Vue 模式下 `pointer.isDown=false` 从不冻结，每个指针位移都让 `obstacleVersion++`，于是每帧清空 `trunks / trunkShared / prevRoutes` 并让所有线路缓存失效；`planTrunks` 又因端点版本滞后一帧而提前返回并自行 `setDirty`，导致全图逐帧重解、主干态在「有/无」之间逐帧翻转——某条线的「主干合并路径」与「独立路径」只要不同，就会在两态之间逐帧跳变。**

## 5. 尚未闭合的一点（必须拍板前确认）

在本机默认布局中，link 9/10 的**主干合并路径与独立路径逐点完全相同**（T=107 恰好等于 link 10 的自然转弯点，且两条分支在分叉后都继续共线），因此 2.1/2.2 的复现**没有观察到折线变化**，与用户肉眼所见不一致。可能的剩余差异来源（按可能性排序）：

1. `chamferPolyline` 的 `skip`（`frame.trunkShared`，:781）与 `others`（`frame.prevRoutes`，:783-785）在两态下不同，导致倒角 `cutA/cutB` 在两态之间切换；本机这对线恰好不受影响。
2. 主干态翻转时，另一条（被遮住的）成员线确实在动，用户看到的是两条线叠加后的效果。
3. 用户宿主与当前会话宿主的节点位置/缩放不同，T 不等于成员自然转弯点，两种路径确实不同。

## 6. 修复方案（待拍板，未实施）

### 方案 A（推荐）：取消「主干态翻转」，保留逐帧重解

- 变更点：`beginFrame` 版本变更分支**不再清空 `trunks` / `trunkShared` / `prevRoutes`**；让 `planTrunks` 的 `sig`（含 version，:215-217）自然触发重算。
- 效果：拖拽期间未移动的线继续用上一版主干计划（端点未变，`tryCustomRender` :703-712 的 0.5px 端点校验会拒绝已移动的线），主干态不再在「有/无」之间翻转；拖动只影响被拖节点自己的线。
- 风险：被拖节点可能压到「旧主干几何」，拖拽期间该束线会穿过被拖节点，松手后一帧内恢复。需要接受这个过渡态。

### 方案 B：同帧算出端点，去掉一帧滞后

- 变更点：`planTrunks` 不再依赖上一帧的 `state.endpoints`，改为在本帧直接读引脚位置（`getConnectionPos`），并删除 :201 的 `setDirty` 自请求。
- 效果：主干计划每帧都成立，拖拽期也始终走主干路径，彻底消除两态差异。
- 风险：改动阶段 2 的时序契约（端点来源由「上一帧观测」改为「本帧读取」），需要重新验证已验收几何（单主干、输入走廊嵌套、大斜切、最晚分叉、磁吸）逐点不变；工作量大于 A。

### 方案 C：拖动期冻结（补齐 Vue 模式判断）

- 变更点：`beginFrame` 的冻结条件补上「Vue 节点拖拽中」（前端 1.55.18 有 `layoutStore.isDraggingVueNodes`），并在 `tryCustomRender` 用同一条件走预览分支。
- 效果：拖拽期完全不重算，代价最低。
- 风险：需依赖宿主内部 store（非稳定公共契约，`comfyui-dev-conventions.md` 需新增可复核条目）；若判断失败会退回当前缺陷；被拖节点自己的线必须走预览，否则会滞后于节点。

**默认倾向：A（改动最小、不改已验收几何、不依赖宿主内部 store）。若拍板前能确认「倒角 skip/others 差异」是唯一可见差异，则 A 即可闭环。**

## 7. 验证口径（任何方案都必须满足）

1. 静止态 link 9/10 折线与本文 §1 表格**逐点一致**。
2. 拖拽任意无关节点 30 帧：`trunks` 每帧都有（fork=107），link 9/10 折线逐帧一致。
3. 拖拽被拖节点自身连线仍实时跟随，不出现穿越节点的滞留超过 1 帧。
4. `node --test tests/unit/*.test.mjs` 全绿（当前 97/97）。
5. 单主干 / 输入走廊嵌套 / 大斜切 / 最晚分叉 / 磁吸 五项已验收几何逐点不变。
6. 宿主 `LuoWen.verify()` ok；不动 Link ID、origin/target slot、节点数据。

## 8. 约束

- 本轮不写任何代码；`luowen/web/index.js` 正被另一会话修改，禁止写入。
- 文档侧：修复方案获批前只允许追加 `docs/agents/debug-log.md` 的 BUG 条目；本 Spec 与 Tasks 即方案本身，批准后才落其它文档。
