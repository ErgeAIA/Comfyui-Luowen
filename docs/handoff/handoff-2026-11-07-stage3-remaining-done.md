---
title: 交接 · 待办 2 完成（阶段 3 剩余验收 · 四类真实鼠标）
type: handoff
project: 络纹（LuoWen）
updated: 2026-11-07
description: >
  待办 2（节点折叠、复制粘贴、真实鼠标拖拽与菜单、crossCleanup=true）已用 Playwright
  真实鼠标/键盘事件在宿主实测通过，未改任何功能代码，未提交 git。本文件只写别处读不到的：
  下轮开工第一件事、本轮踩过的坑、验收状态。进度细节见 project-progress.md 本轮条目，
  数据见 compatibility-matrix.md §4.5 与 `.verify/p3/stage3r-run3.json`。
---

# 交接 · 2026-11-07 · 待办 2 完成

## 工作区状态

- 仓库 HEAD = `origin/main` = `cd1ecc6`，工作区**有未提交改动**：本轮新增 `.verify/p3/stage3-remaining.mjs`（测试脚本，按忽略规则 `.verify/` 不入库）与四份文档改动（matrix §4.5/§5.2/§6、debug-log BUG-006/007 复测小节、progress 本轮条目、经验 process P7 + experience changelog、本文件）。**功能代码零改动**，单测 99/99。
- 交接链：上一份 [handoff-2026-11-07-stage3-closure.md](./handoff-2026-11-07-stage3-closure.md) 的待办表仍然有效，其中第 2 项（阶段 3 剩余验收）本轮完成。

## 下次开工第一件事

1. `git status --short` 确认上述文档改动仍在工作区；等用户验收本轮四类结果后再决定提交（文档一笔即可，`.verify/` 不入库）。
2. **待用户验收清单**（用户可手工复核，步骤已当面给出）：
   - BUG-006：删一条线 → `LuoWen.status().routed == app.canvas.graph.links.size`（不拖节点）。
   - BUG-007：`LuoWen.rebase()` 后写 `graph.extra.probe_vendor` / `node.properties['fake.vendor']` → `verify()` 应报 `extra-added` / `node-prop(*)-added`；删除后恢复 ok。
   - 本轮四类：矩阵 §4.5 表格逐行，或直接复跑 `node .verify/p3/stage3-remaining.mjs`（需宿主 8188 在线）。
3. 用户验收通过后按原待办表继续：待办 1（第三方运行时共存验证）**仍需用户单独批准安装**；待办 3（发布材料）在其后。

## 本轮踩过的坑（别再踩）

- **图→屏坐标**：真实鼠标打链路必须用适配器 `eventGraphPoint`（`renderLinkAdapter.js:1130-1136`）的反演式 `client=(graph+ds.offset)·scale+rect`。旧 probe4 式 `graph·scale+offset` 只在 scale=1 成立；`.lg-node` 的 DOM 矩形也不能当画布坐标基准（Y 向锚点差约 30px，画布链路与 DOM 节点层锚点不同）。判据：移动后 `status().hover` 命中目标再操作，hover 为 null 就不要右键。
- **undo 自动 rebase**：Ctrl+Z = `loadGraphData` → `afterConfigureGraph`（`index.js:333-336`）重建基线。undo 后 `verify ok:true` 只证明「与撤销后状态一致」；自动化脚本里 undo 还会复活已删除的粘贴节点，终态必须孤儿清扫 + `rebase()`（见 `stage3-remaining.mjs` finalSweep）。
- **crossCleanup 构造布局**：`setPos` 移动 68/71/63 造出的 6 对交叉可能整轮不采纳（`pairs-not-decreased`，总长增幅 >15% 拒绝）——这是 DEC-017 的保守语义，不是失效；生命周期判定看 epoch/runs 推进与删线后无幽灵，不看是否采纳。

## 哪些结论仍属推断 / 未覆盖

- 本轮四类只在**根图 + Vue 节点模式**验证；子图内四类、经典画布四类、多选粘贴未做（matrix §5.2 已注）。
- crossCleanup 的采纳路径（`pairs-not-decreased` 之外的成功消交叉）本轮未在真实构造中触发，历史证据仍是 2026-11-06 的 3B-2 实测。
- 第三方 19 条冲突面仍是纯源码级；BUG-006/007 的真实第三方写入时序仍待待办 1。
