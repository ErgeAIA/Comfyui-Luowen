---
title: 交接 · 阶段 3 收尾（提交闭环 · 共存分析 · 性能基线）
type: handoff
project: 络纹（LuoWen）
updated: 2026-11-07
description: >
  `origin/main` = `ebbc038`，工作区干净。本文件只写别处读不到的内容：开工第一件事、
  待办顺序与判据、验证入口、易踩的坑，以及哪些结论只是源码级推断。
  进度与历史见 docs/agents/project-progress.md，决策见 decision-log.md 的 DEC-031 至 DEC-036。
---

# 交接 · 2026-11-07 · 阶段 3 收尾

## 下次开工第一件事

1. 跑 `git status --short` 与 `git log --oneline -3`，确认仍在 `ebbc038` 且工作区干净；若宿主也需部署，核对仓库与宿主文件的 SHA256 一致再动。
2. 读 `docs/agents/compatibility-matrix.md` §5.4 与 `docs/agents/performance.md` 的热点表——当前所有待办的判据都落在这两处，不要凭印象排期。
3. 先问用户要「第三方运行时共存验证」的安装批准；未批准前，任何安装动作都不能做，只可继续源码级或单机验收。

## 待办顺序与判据

| 顺序 | 事项 | 开工前提 | 完成判据 |
|---|---|---|---|
| 1 | 第三方运行时共存验证 | 用户单独批准安装；先备份工作流，逐装逐卸 | 19 条冲突面逐条落到「无影响 / 有影响 / 需规避」；`verify()` 保持 `ok`，几何与无第三方时逐点一致 |
| 2 | 阶段 3 剩余验收 | 无需安装 | 节点折叠、复制粘贴、真实鼠标拖拽与菜单、`crossCleanup=true` 四类均有宿主记录；失败项入 debug-log |
| 3 | 发布材料 | 第 2 项完成 | 安装说明、版本号、已知限制与性能数据齐全，且不宣称未实测的兼容性 |
| 4 | `smooth` 改真 Bezier | P0 欠账清空 | 对齐 PRD §5.1；与 chamfer 互斥口径不变；性能不劣于圆角折线 |
| 5 | 连线配色 token 接入代码 | 阶段 3 完成 | `docs/specs/link-color-tokens/` 的三级 token 落到渲染层，验收材料可复跑 |

性能当前不达标：500 节点 ortho 131.09ms，距 30fps（33.4ms/帧）仍远。第 1–3 项不要求先达标，但任何「性能已改善」的表述必须附同页面 A/B 数据。

## 验证入口与命令

- 单测：`node --test tests/unit/*.test.mjs`（必须带 glob，Windows 传目录会 `MODULE_NOT_FOUND`）；当前 99/99。
- 宿主验证券：`window.LuoWen.verify()` 必须 `ok:true`；改布局前先 `rebase()` 重建基线。坐标变化只出现在 `moved`，不要拿它当失败。
- 合成写入 A/B：`.verify/p4/verify-ab.mjs`（验证 `graph.extra` / `node.properties` 盲区已修）；该目录按忽略规则不入库，换机器需重新生成。
- 几何回归：`.verify/p3/suite.mjs`，覆盖斜切、等距带、组交互等 16 项；日志与截图同样在 `.verify/`。
- 性能：`docs/agents/performance.md` 有 A/B 原始数据与热点排序，复现脚本入口也在该文件；换环境必须重测，禁止跨环境比较。
- 等距带目测：拖动 VAE 从 x=841 到 300，看 24 个关键点间距恒 8 图 px、交叉计数 0、`LuoWen.status().orderDegraded` 全程为空。

## 容易踩的坑

- **源码级结论不是实测**：19 条冲突面全部来自读源码，没有任何一条在宿主里跑过；不要把「挂载点不重叠」写成「已兼容」。
- **`rgthree-comfy` 目录存在但服务未加载**：矩阵里这条是环境事实，不是「已安装」；改动宿主前先确认实际加载状态。
- **lane pitch 改小不会让等距带变窄**：带内间距取 `min(brotherSpacing, 相邻引脚 y 差)`，5px 对照仍会看到 8px。
- **trunkCache 4096 不是性能修复的全部**：它只消除「每帧整表清空」这一项，500 节点仍 47/48 帧超 33.4ms；下一步候选是帧内复用（`nodesById` / `obstacles` / endpoint 索引），未测量前不要提前写结论。
- **`verify()` 的宿主白名单**：`graph.extra` 十个宿主自有键已排除（`ds` / `frontendVersion` / `linkExtensions` / `linkPresentation` / `reroutes` / `workflowRendererVersion` / `BlueprintDescription` / `BlueprintSearchAliases` / `linearMode` / `linearData`）；新增排除项必须先有宿主证据，否则会把宿主写入误报成第三方写入。
- **等距带准入不要再依赖成员自身结果**：见 `docs/agents/experience/routing/README.md` R4；BUG-003 就是靠收紧阈值修不回来的典型。
- 改 `docs/agents/*` 或本文件后，必须同步 frontmatter `updated`；`project-progress.md` / `decision-log.md` / `debug-log.md` 只追加，不改历史条目。

## 哪些结论仍属推断

- **第三方共存 19 条**：全部为源码级推断（NKD 双路由引擎、NKD Shift 双磁吸、Zip Ties 分段重绘列为「确定冲突」也只是静态分析结论）。无运行时证据。
- **rgthree-comfy 的加载状态**：只观测到目录存在与服务未加载，未做启用后的实测。
- **性能数据**：仅当前宿主（0.43.2 + 前端 1.55.18）与当前页面布局；换前端版本或换布局均需重测，不能外推。
- **BUG-006 / BUG-007 的修复效果**：宿主合成写入与 16 项套件已通过，但真实第三方写入时序、真实鼠标删除操作仍未在宿主复测；用户尚未验收。
- **手动意图保护**：Reroute 链排除合并与成带已实现并提交（`01d8df7`），手动锚点仍未做，用户尚未验收。
