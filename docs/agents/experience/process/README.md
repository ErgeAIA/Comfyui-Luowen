---
title: 过程协作经验
type: experience-domain
project: comfyui-luowen
updated: 2026-11-06
description: >
  阶段记账、可复核事实与文档同步纪律的可复用经验。
  AI 在本文件新增或修改任何条目后，必须同步更新 frontmatter 的 updated 字段为当日日期（YYYY-MM-DD）。
---

# process · 过程协作经验

## P1 · PRD 阶段编号与 P1 增强必须分开记账

- **主张**：PRD 的阶段编号只承载阶段交付；P1 增强单独标记为「增强」，不得计入阶段完成度，也不得新增「阶段 4」。
- **适用**：PRD 只定义阶段 0–3、但开发中穿插了增强项（磁吸、交叉清理、顺序抽头）的项目。
- **Why**：把 3A/3B 写成阶段 3 已完成，会让接管者误判阶段 3 只剩收尾，实际兼容性、生命周期、冲突、性能、发布一项未做。
- **How**：进度文档固定两行——「阶段：已完成到 N / 未开始」与「P1 增强：已实现 / 默认开关」；CHANGELOG 条目显式标注「P1 增强」。
- **反例**：README 写「阶段 3 已完成（3A/3B）」导致兼容性与发布材料被忽略。
- **事实源**：DEC-020；`docs/agents/project-progress.md` 2026-11-06 状态行；提交 `8614a8a`、`b6dab5c`、`603a1b5`。

## P2 · 文档里的测试数与参数只能来自实跑或源码常量

- **主张**：测试数、间距、阈值、默认值只能写实跑输出或源码常量，旧文档不得沿用。
- **适用**：任何 README / CHANGELOG / 进度文档；尤其是迭代快、参数经常调的项目。
- **Why**：单测从 17 增至 95、lane pitch 从 5 改为 8、Ribbon 已移除，但文档三处仍写旧值，外部读者会据此判断错误。
- **How**：写前实跑 `node --test tests/unit/*.test.mjs` 取通过数；参数搜源码常量（如 `DEFAULT_LANE_PITCH`）；每次文档改动在 `agents-changelog.md` 留「旧值 → 处置 → 去处」。
- **反例**：照抄旧 CHANGELOG 的「17 项测试 / 5px 间距 / Ribbon 平行股道」。
- **事实源**：2026-11-06 实跑 95/95；`luowen/web/routing/laneAssign.js` `DEFAULT_LANE_PITCH = 8`；`luowen/web/index.js` 设置项。

## P3 · 文档与代码冲突时先列清单再改，不做静默择一

- **主张**：发现冲突先输出「冲突项 / 判定依据 / 改哪一边」，再落笔；不得只挑一边悄悄改掉。
- **适用**：接手的项目存在多份口径文档（PRD、进度、README、CHANGELOG）。
- **Why**：静默择一会丢掉另一半事实，后续会话无法判断哪边是当前真值。
- **How**：以代码与 git 历史为事实源；PRD 只作产品边界依据；把冲突项列入交付报告的「偏差清单」，已消除/仍剩余分栏列出。
- **反例**：直接按记忆把 README 改「开发尚未开始」为「已发布」，不经 git 核对。
- **事实源**：DEC-020 决策第 4 条；2026-11-06 文档对齐轮次。

## 🟢 参数（仅本项目）

- 验证宿主 ComfyUI 0.43.2 + 前端 1.55.18 + Node 24.22.1（Windows portable）。
- 单测命令必须显式 glob：`node --test tests/unit/*.test.mjs`，Windows 上传目录会 `MODULE_NOT_FOUND`。
