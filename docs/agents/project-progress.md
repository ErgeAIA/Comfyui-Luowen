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
- **阶段**：**PRD 阶段 1（线路样式 + 单条 A* 路由）已完成**，等待用户验收后进入阶段 2
- **代码**：`luowen/`（扩展注册 + 原型级 renderLink 适配器 + 几何/路由/缓存模块），已装本机 custom_nodes 实测通过；单元测试在 `tests/`
- **工具链**：验证宿主（0.43.2）、前端 1.55.18、codegraph 1.6.2；Playwright 浏览器实测流程已打通
- **最后更新**：2026-11-06 阶段 1 完成
  - 挂载：原型级 `renderLink`+`drawConnections` 包裹，`__luowenWrapped` 防双包，uninstall 精确还原
  - 能力：orthogonal/smooth/native 三样式；单条 A*（MIT router.js 逐字复用）+ 节点避障（low/standard/high）；反向连接；lane 阶梯分离；缓存按障碍版本失效；A* 失败/异常单线降级原生
  - 实测：三样式切换、节点拖动避障重算（obstacleVersion 1→2）、总开关关→原生曲线/开→正交、数据不变性 verify ok（10 nodes/9 links）；单元测试 17/17
  - 文档：docs/routing-algorithm.md（算法 seed）、THIRD_PARTY_NOTICES 增补产品内 MIT 副本登记、decision-log DEC-005
- **上一阶段**：2026-11-06 阶段 0 完成
  - 三路调研落盘结论：前端 1.55.18 调用链（docs/phase0/drawing-api-notes.md）、Cable Management MIT 复用清单、Zip Ties/官方 PR #21965（未合并）/NKD GPL 边界（docs/phase0/compat-risks.md）
  - 实测 9 项全过：切换/数据不变性/拖拽/命中→菜单→删除/ghost=0/回滚/重入/Nodes 2.0 双形态；截图证据在 .verify/
  - 关键发现：命中测试读渲染产物（覆写 seg.path/_pos 即跟随）；官方 tie PR 未合并，络纹差异化成立
- **下一步**：用户验收阶段 1 → 阶段 2（Reroute 节点绕行 + 手动意图优先 + 端口 stub 细化）
- **本阶段禁止**：未经用户验收开始阶段 2；改 PRD 产品边界；在宿主环境装依赖
