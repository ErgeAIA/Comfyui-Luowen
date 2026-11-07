---
title: 交接 · 第二次文档与契约对齐（含性能落点）
type: handoff
project: 络纹（LuoWen）
updated: 2026-11-07
description: >
  本轮只动文档，未改 luowen/、tests/、PRD 口径，未 commit、未 push。
  下一会话从这里接：待提交分账、下一步顺序、验证入口与仍待用户拍板的事项。
---

# 交接 · 2026-11-07

## 一句话现状

阶段 1–2 与 P1 增强（3A 吸附 / 3B 交叉清理）已落地；P0 主干组交互（DEC-021）、BUG-002 抖动、BUG-003 等距带（DEC-030 方案 A）均已由用户验收，但**代码仍在工作区未提交**。本轮完成文档二次对齐，新增性能验收落点，未跑基准。

## 待提交分账（工作区 25 改 + 2 未跟踪）

- **代码线（非本轮改动，不要和文档混提）**：`luowen/web/adapters/renderLinkAdapter.js`、`geometry/trace.js`、`index.js`、`routing/laneAssign.js`、`routing/trunkPlan.js`、`template/ComfyUI-Luowen/web/js/luowen.js`、`tests/unit/routing.test.mjs`、`tests/unit/trunkPlan.test.mjs`。
- **上游他轮已改的文档**：`GLOSSARY.md`、`THIRD_PARTY_NOTICES.md`、`docs/comfyui-dev-conventions.md`、`docs/prd/luowen-prd-v1.0.md`、`docs/routing-algorithm.md`。其中 PRD 的改动是既成事实（圆角半径项、AT-013/015 口径），本轮未碰，提交前需与用户确认归属。
- **本轮文档**：`AGENTS.md`、`README.md`、`CHANGELOG.md`、`CHANGELOG.en.md`、`docs/agents/{agents-changelog,init-report,project-progress,decision-log,debug-log}.md`、`docs/agents/experience/{README,changelog}.md`、`docs/agents/experience/routing/README.md`、本文件；新增 `docs/agents/performance.md`（`docs/specs/` 仍是未跟踪目录）。
- 已提交基线：`70daba3`（第一轮文档与协作契约对齐）；其前为 `603a1b5` / `b6dab5c` / `8614a8a`。

## 下一步顺序（用户已定稿）

1. 手动意图保护（F-010 / AT-018）：Reroute 排除合并、手动锚点。
2. `smooth` 改真 Bezier，对齐 PRD §5.1；当前圆角折线的口径不改 PRD，等实现时再同步。
3. 阶段 3：兼容性矩阵（经典画布 / Nodes 2.0）、生命周期与冲突测试、性能基准、发布材料；PRD §14.2 固定样本从 2 组补到 10 组。
4. 连线配色 token（`docs/specs/link-color-tokens/`）接入代码，排在阶段 3 之后。

## 验证入口（别靠记忆复述）

- 单测：`node --test tests/unit/*.test.mjs`，本轮实跑 99/99。
- 等距带验收：拖动 VAE，从 x=841 左拖到 300，看 24 个关键点间距恒 8 图 px、交叉计数 0、`LuoWen.status().orderDegraded` 全程为空。
- 组交互验收：悬停主干应高亮整组；右键主干有「删除这一组」，分支段没有。真实鼠标菜单操作尚未复测，已记入 README 已知限制。
- 数据不变性：`LuoWen.verify()` 必须 ok；基准用 `rebase()` 重置。

## 待用户拍板

- PRD 中圆角半径与 AT-013/015 的既有改动是否并入文档提交，或单列一笔。
- 性能基线先测哪些场景、在什么布局与节点规模上取数（当前 `docs/agents/performance.md` 全部标记「待测」，无任何数据）。
- `docs/specs/` 未跟踪目录的提交时机。

## 容易踩的坑

- 用 5px 档对照等距带会看到间距恒 8：间距取 `min(brotherSpacing, 相邻引脚 y 差)`，不是把 lane pitch 改小就能变窄。
- 等距带准入只看「同 target + 同方向」，不再看原走廊间距；若见成带失效，先查 `orderDegraded` 与障碍版本，不要回头收紧准入阈值（BUG-003 的教训，见 `docs/agents/experience/routing/README.md` R4）。
- 改 `docs/agents/*` 或本文件后必须把 frontmatter `updated` 改成当日。
