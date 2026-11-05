---
title: Decision Log
type: decision-log
project: 落纹（LuoWen）
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

## DEC-003: 插件包定名 ComfyUI-Luowen，git init 随 vibe-init 执行

- **日期**：2026-11-06
- **背景**：基线盘问（grill）Q9/Q10——模板包命名与版本管理时机。
- **决策**：模板包直接定名 `ComfyUI-Luowen`（目录名 / pyproject 包名 / CATEGORY `Luowen`）；基线阶段不手动 git init，等 PRD 到位后由 vibe-buddy vibe-init 一并完成。
- **验证**：vibe-init 已于 2026-11-06 执行（分支 main）。

## DEC-002: 模板走 V1 契约，V3 只做文档

- **日期**：2026-11-06
- **背景**：ComfyUI 0.43.2 中 V1 与 V3 契约并存；基线原则是每条约定有 ≥2 个本地范例背书。
- **决策**：模板/开发基线以 V1 契约（NODE_CLASS_MAPPINGS / INPUT_TYPES）为主体，V3（io.Schema / comfy_entrypoint）仅在约定文档单列摘要；PRD 确认需要 V3 专属能力再切换。注：落纹本体为纯前端扩展，服务端仅需最小 `__init__.py` + `WEB_DIRECTORY`（PRD §11.1）。
- **验证**：7/7 本机成熟节点为 V1；约定文档 §7 记录官方"V1 不废弃"口径。

## DEC-001: 目标环境锁定 0.43.2 portable，TE 实例不碰

- **日期**：2026-11-06
- **背景**：本机存在 0.43.2 与 0.17.0（TE）两套 ComfyUI 安装。
- **决策**：唯一开发与验证目标 = `D:\AIGC\ComfyUI_windows_portable\ComfyUI`（v0.43.2）；环境零改动原则（不升级前端包等依赖）。
- **验证**：模板 a–d 四项验证在该实例通过（docs/comfyui-dev-conventions.md §6）。
