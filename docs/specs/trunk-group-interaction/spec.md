---
title: 主干组交互 Spec
type: spec
project: 络纹（LuoWen）
status: completed
created: 2026-11-07
updated: 2026-11-07
scope: PRD AT-013 / AT-015 / AT-017 口径修订 + 组高亮与组删除实现
---

# 主干组交互 Spec

> 本文是用户已批准方案的执行规格。事实基线均来自前端 1.55.18 源码（安装包 sourcemap 内嵌 TS，临时只读目录）与本机宿主实测；未复核的旧结论不再引用。

## 1. 目标

同一输出端口形成的主干组（trunk）需要：

1. 悬停共享主干段：整组高亮；悬停分支段：只高亮该分支。
2. 在共享主干段右键：出现「删除这一组（N 条）」并保留单条删除；在分支段右键：只有单条删除。
3. 一次整组删除只产生一条 undo。
4. 不改动任何原生 Link 数据（Link ID、origin/target slot、节点数据），不改已验收几何行为。

## 2. 事实基线（查证结论，写入 docs/comfyui-dev-conventions.md §2.8）

### 2.1 无链路选中

- 选中类型枚举只有 `node / group / reroute / io`，不含 link：`selectionState.ts:7`。
- `selectedItems` 是 `Set<Positionable>`，link 不是 `Positionable`：`LGraphCanvas.ts:746`。
- `deleteSelected()` 只处理 node / group / reroute，不处理 link：`LGraphCanvas.ts:4787-4821`。
- 结论：无法把组内 link 塞进原生选中集，也无法依赖 `deleteSelected` 删除链路。

### 2.2 命中链路

- 命中测试读渲染产物：`hitTesting.ts:41-55`，`layoutHit` 优先，其次 `ctx.isPointInStroke(segment.path, x*dpr, y*dpr)`。
- 命中线宽 `connections_width + 7`：`hitTesting.ts:39`。
- 中心 marker 仅 8×8，且只服务 `over_link_center`：`LGraphCanvas.ts:5196-5209`、`:3549-3553`。
- 结论：络纹已接管 `renderLink` 并写 `link.path`，命中跟随实际折线；主干段返回哪条 link 取决于 `state.routes` / 绘制顺序，不能表达「组」。

### 2.3 悬停

- 原生只有 `over_link_center` + tooltip（`LGraphCanvas.ts:3549-3553`、`:5268-5269`）。
- `highlighted_links` 仅由「选中节点的邻接」填充（`LGraphCanvas.ts:4556,4563,4617,4625,4749,4760,4765,4814`），无 link 级 hover 状态。
- 结论：组高亮必须由络纹自绘，不能复用原生 hover。

### 2.4 删除语义

- 右键菜单入口 `showLinkMenu`：`LGraphCanvas.ts:6674-6788`；右键调用点 `:8777`。
- 菜单 Delete 分支：`LGraphCanvas.ts:6760-6775`，`graph.removeLink(linkId)` + `layoutStore.deleteLinkLayout(linkId)`。
- 无批量删除接口；多次 `removeLink` 会各自触发删除与缓存失效，但 undo 由事务边界决定。
- Reroute 包裹成员安全：`LGraph.ts:2133-2141` → `LLink.disconnect`（`LLink.ts:549-591`）；`:582` 从 `graph.links` 移除，`:584` 删 layout，`:586-590` 仅在 `reroute.totalLinks === 0` 时回收 reroute；floating link 不在 `graph.links`，排除。第 0 步结论：可安全按真实 link id 批量删。
- 菜单项注入：`ContextMenu.ts:311-341` 先跑 global callback，再跑 item callback；可用 `Proxy` 包装 `LiteGraph.ContextMenu` 构造，临时插入组删除项。`changeTracker.ts:625-630` 对 `ContextMenu.prototype.close` 的补丁不受影响。

### 2.5 undo

- `changeTracker.ts:409-438` 全图序列化快照；`:508-513` `beforeChange/afterChange` 用 `changeCount` 抑制中间快照；`:602-607` `processMouseUp` 后 capture。
- 结论：仿 `deleteSelected` 用 `emitBeforeChange + graph.beforeChange … graph.afterChange + emitAfterChange` 包住整组删除，只留一条 undo。

### 2.6 Vue 模式

- `LGraphCanvas.ts:2784-2788` `_processNodeClick` 在 `vueNodesMode` 直接 return；`GraphCanvas.vue:93-98,342-346`、`LinkOverlayCanvas.vue:3-4`（`pointer-events-none`）。
- 结论：链路命中仍走 canvas，自绘 hover 与 canvas 重绘一致，不与 DOM overlay 冲突。

### 2.7 交叉验证

| 结论 | 证据 A | 证据 B |
| --- | --- | --- |
| 选中类型不含 link | `selectionState.ts:7` | `LGraphCanvas.ts:746`、`:4787-4821` |
| 命中读渲染产物 | `hitTesting.ts:41-55` | `hitTesting.ts:39`、`:5196-5209` |
| 无原生 link hover | `LGraphCanvas.ts:3549-3553` | `:4556-4814` 仅邻接填充 |
| 删除走 `removeLink` | `LGraphCanvas.ts:6760-6775` | `LGraph.ts:2133-2141` |
| Reroute 可安全删 | `LLink.ts:582-590` | `LGraphNode.ts:3472-3482` |
| 菜单可注入 | `ContextMenu.ts:311-341` | `changeTracker.ts:625-630` |
| Vue 不拦链路 | `LGraphCanvas.ts:2784-2788` | `LinkOverlayCanvas.vue:3-4` |

## 3. 设计

### 3.1 悬停分类（纯函数）

`luowen/web/routing/trunkPlan.js` 新增导出：

```
classifyHover(routes, trunks, point, tol)
// routes: Map<linkId, pts>
// trunks: Map<linkId, pts>（state.frame.trunks，仅 merged 成员）
// point: [x, y]（图坐标）
// tol: number
// 返回 null | { linkId, part: 'trunk'|'branch', group: pts[], memberIds: linkId[] }
```

判定规则：

1. 遍历 `trunks` 的成员路径，按弧长找最近点；最近点落在共享前缀（`sharedPrefixLength` / `splitAt` 切出的 prefix）内 → `part='trunk'`，返回整组成员与 trunk 路径。
2. 落在分歧后的 rest 段 → `part='branch'`，只返回该 `linkId`。
3. 无 trunk 命中 → 回退单例：遍历 `routes` 最近点，`part='branch'`、单成员。
4. 距离阈值统一用 `tol`（沿用现有 8/scale）。

组身份直接使用 `trunks` 中的 trunk 对象（同组多条成员路径共享前缀），不新增组 ID 表。

### 3.2 悬停状态

`renderLinkAdapter.js`：

- `state.hoverLinkId` 改为 `state.hover = { linkId, part, memberIds, groupPts } | null`。
- `onPointerMove` 调 `classifyHover`；命中后设置 `state.hover` 并 `setDirty`。
- 绘制：`part='trunk'` 时高亮 `memberIds` 全员；`part='branch'` 时只高亮该条。
- 悬停主干时 tooltip 显示「N 条连接」（仅在不引起结构改动时做；超范围则砍掉并说明）。
- 不高亮对端节点。
- `onPointerLeave` 与删除后清空 `state.hover`。
- 保持 `LuoWen.status()/getStats()` 可读的 hover 结构。

### 3.3 右键菜单

- `renderLinkAdapter.js` 安装期用 `new Proxy(LiteGraph.ContextMenu, { construct })`。
- 仅当本次右键目标为 link 菜单（`showLinkMenu` 路径）且 `classifyHover` 判定 `part='trunk'` 时，向 options 前置插入 `{ content: '删除这一组（N 条）', callback }`。
- `part='branch'` 或单例：只保留原生单条删除。
- 不改键盘 Delete 语义，不弹二次确认。

### 3.4 组删除事务

```
this.emitBeforeChange?.()
graph.beforeChange()
for (id of memberIds) {
  graph.removeLink(id)
  layoutStore.deleteLinkLayout(id)
}
graph.afterChange()
this.emitAfterChange?.()
```

- 成员删除前校验 `graph.links.get(id)` 存在；跳过 floating link。
- 删除后清 hover，`planTrunk` 自然重算，不手工改主干缓存。
- 不修改未删除成员的 Link ID / slot。

### 3.5 涉及文件

| 文件 | 改动 |
| --- | --- |
| `luowen/web/routing/trunkPlan.js` | 新增 `classifyHover` 纯函数；复用 `sharedPrefixLength` / `splitAt` |
| `luowen/web/adapters/renderLinkAdapter.js` | hover 结构改造、`classifyHover` 调用、Proxy 菜单注入、组删除事务、清 hover |
| `luowen/web/index.js` | 调试输出适配新 hover 结构（`status()` / 内部调试） |
| `tests/unit/*.test.mjs` | 新增 `classifyHover` 与可测事务部分 |

不改：`geometry/*`、`routing/laneAssign.js`、`routing/crossings.js`、`routing/crossCleanup.js`、`snap/*`。

## 4. 文档与 PRD 同步

1. `docs/comfyui-dev-conventions.md` 新增 §2.8「链路命中 / 选中 / 删除 / 悬停契约」，落本 Spec §2 全部结论，附 file:line 与交叉验证表。
2. `docs/prd/luowen-prd-v1.0.md`：AT-013/015/017 改为「组高亮 + 组删除」口径，写明偏离原因：
   - 宿主前端可选中类型不含 link（`selectionState.ts:7`）；
   - `selectedItems` 无法容纳 link（`LGraphCanvas.ts:746`）；
   - `deleteSelected` 不处理链路（`LGraphCanvas.ts:4787-4821`）；
   - 无批量删除接口（`LGraphCanvas.ts:6760-6775`）。
3. `docs/agents/decision-log.md` 新增 DEC-021（置顶）：旧口径 → 新口径 → 依据。
4. `docs/routing-algorithm.md` §4.1 命中与选择语义、§8 已知限制同步。
5. `docs/agents/project-progress.md` 插入本轮进展；`GLOSSARY.md` 如新增术语（「主干组悬停」「整组删除」）先入表再使用。
6. 所有改动同步 frontmatter `updated: 2026-11-07`。

## 5. 验收

### 5.1 单测

- `classifyHover`：主干中点 → 整组；分叉后 → 仅该分支；无 trunk → 单例；阈值外 → null。
- 组删除事务：可测部分断言成员集合、单次事务边界；宿主相关部分留实测。

### 5.2 宿主实测

- 悬停主干高亮全组；悬停分支只亮该分支；主干保持常态。
- 右键菜单项按位置出现/不出现。
- 整组删除后连线与节点数据正确；撤销一次整组恢复。
- `LuoWen.verify()` ok。
- 未删除成员 Link ID 与 origin/target slot 不变。
- 删除后无悬空 hover。

### 5.3 截图

- 主干悬停整组高亮
- 分支悬停单条
- 组删除菜单

## 6. 边界与不做

- 不改已验收几何行为：单主干、输入走廊嵌套、大斜切、最晚分叉、磁吸。
- 不新增组 ID 表、不自动布局、不做工作流语义分析。
- 不在渲染热路径做候选树搜索或全图重规划。
- 不删除任何既有文件；不整文件重写；不提交 git。

## 7. 待用户确认

- 本 Spec 与 `tasks.md` 是否可作为执行基线（第 1 步文档、第 2 步代码、第 3 步验证顺序不变）。
