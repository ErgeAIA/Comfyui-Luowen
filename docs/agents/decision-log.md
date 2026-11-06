---
title: Decision Log
type: decision-log
project: 络纹（LuoWen）
updated: 2026-11-06
priority: higher-than-prd
description: >
  开发过程决策日志，优先级高于 PRD；冲突时以本文件最新条目为准并回写 PRD/ADR。
  只追加，不删除或改写历史。AI 在本文件新增或修改任何条目后，必须同步更新 frontmatter 的 updated 字段为当日日期（YYYY-MM-DD）。
---

# Decision Log

> 偏离 PRD 或做出重要技术选择时在此追加记录。只追加，不删除或改写历史。
> **优先级高于 PRD**：冲突时以本文件最新决策为准，并回写 PRD/ADR。
> 格式：`## DEC-NNN: 标题`，新条目置顶，NNN 三位递增。
> 字段：`- **日期**：` / `- **背景**：` / `- **决策**：` / `- **验证**：`

## DEC-005: 阶段 1 挂载策略与几何内核复用方式

- **日期**：2026-11-06
- **背景**：阶段 1 需要在不碰图数据的前提下接管线路绘制；候选挂载点有实例级 `canvas.linkRenderer` 与原型级 `renderLink`，几何内核候选为自研或复用 MIT 的 Cable Management。
- **决策**：
  1. 挂载用**原型级** `LGraphCanvas.prototype.renderLink` + `drawConnections` 包裹，带 `__luowenWrapped` 防双包与精确 uninstall；不用实例 pathRenderer（避免依赖私有属性、随 setGraph 重建失效）。
  2. 命中测试不另做：绘制后覆写 `link.path`/`link._pos`，前端 1.55.18 的命中逻辑直接读渲染产物，悬停/菜单/删除自动跟随。
  3. `router.js`/`trace.js` 逐字复用（MIT，保留版权头、LICENSES 全文、THIRD_PARTY_NOTICES 登记）；`obstacles.js`/`laneAssign.js`/`routeCache.js`/`graphRead.js` 为原创。
  4. 非共线端点禁止直线捷径：先 `corridorClear` 预检，未净空一律走 A*，保证正交样式无斜线。
- **验证**：阶段 1 实测（10 nodes/9 links）：三样式切换、节点拖动避障重算（obstacleVersion 1→2）、总开关回滚原生、数据不变性 verify ok、单元测试 17/17；详见 docs/routing-algorithm.md §7。

## DEC-004: 产品中文名定为"络纹"

- **日期**：2026-11-06
- **背景**：PRD v1.0 原用"落纹"，用户裁决中文名实为"络纹"（络：脉络/网络，贴合连线语义）；英文名 LuoWen、仓库名 Comfyui-Luowen、pyproject 包名均不变。
- **决策**：全局替换 落纹→络纹（38 处：PRD/AGENTS.md/README/CHANGELOG 双语/过程文档/phase0 原型注释/THIRD_PARTY_NOTICES）；已安装 custom_nodes 副本同步；PRD 文件名 luowen-prd-v1.0.md 不变。后续行文一律用"络纹"。
- **验证**：全仓 grep 零残留（0 落纹 / 38 络纹）；agents-changelog 已留痕。

## DEC-003: 插件包定名 ComfyUI-Luowen，git init 随 vibe-init 执行

- **日期**：2026-11-06
- **背景**：基线盘问（grill）Q9/Q10——模板包命名与版本管理时机。
- **决策**：模板包直接定名 `ComfyUI-Luowen`（目录名 / pyproject 包名 / CATEGORY `Luowen`）；基线阶段不手动 git init，等 PRD 到位后由 vibe-buddy vibe-init 一并完成。
- **验证**：vibe-init 已于 2026-11-06 执行（分支 main）。

## DEC-002: 模板走 V1 契约，V3 只做文档

- **日期**：2026-11-06
- **背景**：ComfyUI 0.43.2 中 V1 与 V3 契约并存；基线原则是每条约定有 ≥2 个本地范例背书。
- **决策**：模板/开发基线以 V1 契约（NODE_CLASS_MAPPINGS / INPUT_TYPES）为主体，V3（io.Schema / comfy_entrypoint）仅在约定文档单列摘要；PRD 确认需要 V3 专属能力再切换。注：络纹本体为纯前端扩展，服务端仅需最小 `__init__.py` + `WEB_DIRECTORY`（PRD §11.1）。
- **验证**：7/7 本机成熟节点为 V1；约定文档 §7 记录官方"V1 不废弃"口径。

## DEC-001: 目标环境锁定 0.43.2 portable，TE 实例不碰

- **日期**：2026-11-06
- **背景**：本机存在 0.43.2 与 0.17.0（TE）两套 ComfyUI 安装。
- **决策**：唯一开发与验证目标 = `D:\AIGC\ComfyUI_windows_portable\ComfyUI`（v0.43.2）；环境零改动原则（不升级前端包等依赖）。
- **验证**：模板 a–d 四项验证在该实例通过（docs/comfyui-dev-conventions.md §6）。
