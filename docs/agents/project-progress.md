---
title: Project Progress
type: project-progress
project: 络纹（LuoWen）
updated: 2026-11-06
description: >
  项目开发进度实时记录：阶段、分支、代码状态、最近进展。每次会话更新。
  AI 在本文件新增进展或修改当前状态后，必须同步更新 frontmatter 的 updated 字段为当日日期（YYYY-MM-DD）。
---

# Project Progress

> 记录当前任务状态、分支和最近进展。每次会话更新。
> 新进展插在「当前状态」之后、旧「最后更新」之前。

---

## 当前状态

- **当前分支**：main
- **阶段**：**阶段 1 验收返修完成**，等待用户复验；通过后进入阶段 2
- **代码**：`luowen/`（扩展注册 + 原型级 renderLink 适配器 + 几何/路由/缓存/预览模块），已装本机 custom_nodes 实测
- **工具链**：验证宿主（0.43.2）、前端 1.55.18、codegraph 1.6.2；Playwright 浏览器实测流程已打通
- **最后更新**：2026-11-06 阶段 1 验收返修
  - 根因：`nodeRects` 重复叠加 `pos`（getBounding 已是绝对坐标）→ 障碍矩形平移；上游路由器对穿节点只罚 8× 不禁止
  - 修复：graphRead 绝对坐标；router 增加 `strict`（硬框禁行，无解→原生）；拖拽期两折正交预览（无 A*）；整线悬停高亮（pointermove + 折线距离）
  - 验证：路由穿透扫描 0；拖拽 preview 409 次全程正交；悬停中段命中 link 74；verify 数据不变性 ok；单测 24/24
  - 文档：conventions §2.6（LiteGraph 几何/命中契约）、routing-algorithm §7.1、DEC-006、THIRD_PARTY_NOTICES 修改声明
- **上一阶段**：2026-11-06 阶段 1 完成（初版）
  - 原型级 renderLink/drawConnections 包裹；orthogonal/smooth/native；单条 A*（MIT 复用）+ 三档避障；lane 阶梯；缓存版本化；降级矩阵
  - 实测：三样式切换、obstacleVersion 变化、总开关回滚、数据不变性 ok；单测 17/17
- **再上一阶段**：2026-11-06 阶段 0 完成
  - 前端 1.55.18 调用链（docs/phase0/drawing-api-notes.md）、Cable Management MIT 复用清单、风险 R1–R13
  - 9 项实测全过；命中测试读渲染产物（覆写 seg.path/_pos 即跟随）
- **下一步**：用户复验阶段 1 → 阶段 2（Reroute 节点绕行 + 手动意图优先 + 端口 stub 细化）
- **本阶段禁止**：未经用户复验开始阶段 2；改 PRD 产品边界；在宿主环境装依赖
