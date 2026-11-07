---
title: 主干组交互 Tasks
type: tasks
project: 络纹（LuoWen）
status: completed
created: 2026-11-07
updated: 2026-11-07
spec: ./spec.md
---

# 主干组交互 Tasks

> 顺序执行；每完成一段立即向用户回报，不攒到最后。编码前不得跳过文档落定。

## T0 前置验证（已完成）

- [x] 验证 Reroute 包裹成员可按真实 link id 批量删除。
- [x] 结论写入 Spec §2.4；无需从删除范围排除 Reroute 成员。

## T1 文档与 PRD

- [x] `docs/comfyui-dev-conventions.md` 新增 §2.8 链路命中 / 选中 / 删除 / 悬停契约。
  - 验收：含命中链路、无 link 选中、删除入口、悬停需自绘、Vue 模式五组结论；每条附 file:line；交叉验证表 ≥2 证据。
- [x] `docs/prd/luowen-prd-v1.0.md` 修订 AT-013/015/017。
  - 验收：口径为「组高亮 + 组删除」；写明偏离原因与源码依据。
- [x] `docs/agents/decision-log.md` 新增 DEC-021 置顶。
  - 验收：旧口径 → 新口径 → 依据三段齐全；只追加。
- [x] `docs/routing-algorithm.md` §4.1 / §8 同步。
- [x] `docs/agents/project-progress.md` 插入本轮进展。
- [x] `GLOSSARY.md` 新术语入表（如用户确认使用「主干组悬停」「整组删除」）。
- [x] 所有改动文件 frontmatter `updated` 改为 `2026-11-07`。

## T2 纯函数 classifyHover

- [x] `luowen/web/routing/trunkPlan.js` 新增导出 `classifyHover(routes, trunks, point, tol)`。
  - 复用 `sharedPrefixLength` / `splitAt`。
  - 返回 `null | { linkId, part, groupPts, memberIds }`。
- [x] 不改动 `planTrunk` 现有行为；关闭/无 trunk 时与旧命中结果一致。

## T3 适配器悬停

- [x] `renderLinkAdapter.js`：`state.hoverLinkId` → `state.hover = { linkId, part, memberIds, groupPts } | null`。
- [x] `onPointerMove` 改用 `classifyHover`；`onPointerLeave` 清空。
- [x] 绘制：trunk 高亮全员；branch 仅高亮该条；不高亮对端节点。
- [x] 主干 tooltip 显示「N 条连接」（已排除：原生 tooltip 由 canvas 内部在 `drawConnections` 内生成，插入需改渲染结构或自建覆盖层，超出本轮最小补丁范围，砍掉并在此说明）。

## T4 菜单注入与组删除

- [x] 安装期用 `Proxy(LiteGraph.ContextMenu, { construct })` 注入菜单项。
  - 仅 trunk 位置出现「删除这一组（N 条）」；branch/单例只有单条删除。
  - 不改键盘 Delete 语义；不弹二次确认。
- [x] 组删除事务：`emitBeforeChange + graph.beforeChange … graph.afterChange + emitAfterChange`。
  - 逐成员 `graph.removeLink(id)`；`layoutStore.deleteLinkLayout` 由 `LLink.disconnect` 内部完成（`LLink.ts:582-584`），未重复显式调用。
  - 跳过不存在与 floating link；删除后清 hover。
- [x] 卸载时恢复原始 `ContextMenu` 与 pointer 监听。

## T5 index.js 调试

- [x] `LuoWen.status()` / 内部调试输出适配新 hover 结构。
- [x] 不新增用户可见设置项。

## T6 单测

- [x] 新增 `classifyHover` 用例：主干中点 → 全组；分叉后 → 仅该分支；无 trunk → 单例；阈值外 → null。
- [x] 组删除事务可测部分：成员集合、事务边界、空/越界成员跳过（适配器依赖 `window.comfyAPI`，node 单测无法加载，由 T7 宿主实测覆盖等价断言）。
- [x] 全量 `node --test tests/unit/*.test.mjs` 通过，fail 0。

## T7 宿主实测

- [x] 悬停主干高亮全组；悬停分支只亮该分支。
- [x] 右键菜单项按位置出现/不出现。
- [x] 整组删除后连线与节点数据正确。
- [x] 撤销一次整组恢复。
- [x] `LuoWen.verify()` ok。
- [x] 未删除成员 Link ID 与 origin/target slot 不变。
- [x] 删除后无悬空 hover。

## T8 截图与回报

- [x] 截图：主干悬停整组高亮、分支悬停单条、组删除菜单。
- [x] 保存至 `.verify/`。
- [x] 回报结论，等用户确认；不提交 git。

## 边界

- 不改 `geometry/*`、`routing/laneAssign.js`、`routing/crossings.js`、`routing/crossCleanup.js`、`snap/*`。
- 不改已验收几何行为（单主干、输入走廊嵌套、大斜切、最晚分叉、磁吸）。
- 不删除既有文件，不整文件重写，不提交 git。
