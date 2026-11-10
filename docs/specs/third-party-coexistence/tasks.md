---
title: 第三方扩展共存分析任务
type: tasks
project: 络纹（LuoWen）
updated: 2026-11-07
description: 源码级共存分析的执行清单；批准后按序执行，不含宿主安装。
---

# 任务清单

- [x] T1 四个仓库浅克隆到临时目录并取证接管点（file:line）——见 `spec.md` §3
- [x] T2 判定「冲突面 × 无交集/可能冲突/确定冲突 × 依据」——见 `spec.md` §4，共 19 条
- [x] T3 写 `docs/agents/compatibility-matrix.md` 新增 §5.4（精简版，保留 file:line 与判定）——§5.4 含 19 条与「未做运行时验证」缺口
- [x] T4 更新 `compatibility-matrix.md` §5.2 第三方扩展行指向 §5.4——行内容为「未做运行时验证（源码级见 §5.4）」
- [x] T5 更新 `docs/agents/project-progress.md` 本轮进展块与 frontmatter `updated`——含源码级结论、临时克隆位置、运行时方案待批准
- [x] T6 文档一致性核对（不提交 git、不安装扩展）——`git status` 仅文档变更；宿主 `custom_nodes` 未新增
- [x] T7 环境事实核对——rgthree 目录存在但当前服务未加载（`/extensions`、`/object_info/Reroute` 取证），已写入矩阵 §1/§5.4 与 spec §5

## 约束

- 不安装任何扩展到 `%ComfyUIPortable%`。
- 不改宿主依赖、不改 `renderLinkAdapter.js` / `dragSnap.js` 功能代码。
- 不提交 git，提交由用户安排。
