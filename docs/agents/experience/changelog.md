---
title: 经验库变更日志
type: experience-changelog
project: comfyui-luowen
updated: 2026-11-07
description: >
  每轮蒸馏一条：原料、覆盖主题、产出与有意跳过；兼作蒸馏台账，用于避免重复蒸馏。
  AI 在本文件新增或修改任何条目后，必须同步更新 frontmatter 的 updated 字段为当日日期（YYYY-MM-DD）。
---

# 变更日志与蒸馏台账

> 每轮蒸馏追加一条，**兼台账**：写新条目之前先读本文件，比对本轮原料是否已蒸过。
> 只追加，不删除历史。

---

## 2026-11-06 · 文档与协作契约对齐轮

- **原料**：`git log`（`603a1b5` 为 HEAD；近三次提交 `8614a8a` / `b6dab5c` / `603a1b5`）· `node --test tests/unit/*.test.mjs` 实跑 95/95 · `docs/agents/project-progress.md`、`decision-log.md`（DEC-019/020）· `docs/routing-algorithm.md` · `luowen/web/index.js`、`routing/laneAssign.js`、`routing/trunkPlan.js`、`geometry/chamfer.js`、`snap/dragSnap.js` · 本轮 README / CHANGELOG 双语重写 · 工作区（未提交）
- **覆盖主题**：routing（R1–R3 + 🟢参数）、process（P1–P3 + 🟢参数）
- **产出**：新建经验总索引与 2 个领域 README；新增 R1/R2/R3/P1/P2/P3 共 6 条
- **有意跳过**：`docs/comfyui-dev-conventions.md`（属契约结论，不蒸馏为通用经验）；`docs/phase0/`（一次性可行性验证，结论已入正文）；GLOSSARY 术语本身（属术语表职责）；3A 吸附的阈值细节（仅 🟢 参数，已并入 routing 参数节，不单列条目）

---

## 2026-11-07 · 第二次文档与契约对齐轮

- **原料**：`docs/agents/debug-log.md`（BUG-002 / BUG-003 根因与验收）· `decision-log.md`（DEC-008–DEC-030，重点 DEC-030 方案 A）· `docs/routing-algorithm.md` · `luowen/web/routing/laneAssign.js`（`planBands` / `orderDegraded`）· `luowen/web/geometry/trace.js`、`adapters/renderLinkAdapter.js`（圆角半径常量）· 宿主实测（VAE x=841→300，24 关键点、间距 8 图 px、交叉 0、`orderDegraded` 空）· 工作区（未提交）
- **覆盖主题**：routing（新增 R4/R5，补 🟢参数）
- **产出**：新增 R4「准入门槛不能依赖待准入对象自身的求解结果」（🔴）、R5「等距带看目标引脚序，只允许受限重解 + 帧末冻结」（🟡）；routing 参数节补等距带 8 图 px 与圆角 0–24 / 默认 10
- **有意跳过**：DEC-021 组交互（属交互规格，已落 `docs/specs/trunk-group-interaction/`，不蒸馏为通用几何经验）；BUG-002 的空节点表缓存（属本项目实现缺陷，已入 debug-log，不构成可复用主张）；性能验收口径（无实测数据，不入经验库）
