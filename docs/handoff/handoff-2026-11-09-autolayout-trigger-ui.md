---
title: 交接 · 自动布局触发 UI 收尾（DEC-044）——待用户验收 + 三工作流校准
type: handoff
project: 络纹（LuoWen）
updated: 2026-11-09
description: >
  兄弟线间距滑块注册补全、整理按钮可拖动（z=1000 + localStorage）、背景右键菜单迁官方钩子
  getCanvasMenuItems 并删旧 patch。探针 .verify/p7/ui-round-verify.mjs 全绿、宿主部署 SHA 一致、
  单测 151/151。合并 main 推迟待用户验收；盲测改「三工作流校准」待用户给文件。
  文档卫生去重（用户批准）已完成。进度见 project-progress.md 本轮条目与 DEC-044。
---

# 交接 · 2026-11-09 · 自动布局触发 UI 收尾

## 状态

- 分支 `auto-layout`（F-015 工作线）；本轮功能提交 = `c45c87b`（DEC-044 触发 UI 收尾 + 文档卫生）。**未合入 main**——用户明确「优化完按钮和菜单再合」，合并推迟到用户验收通过。
- 代码改动：`luowen/web/index.js`（BrotherSpacing 注册 + 可拖动浮动按钮 + getCanvasMenuItems 钩子、删旧 proto patch）、`i18n.js`（AutoLayout.button/full/selected 双语）、`adapters/renderLinkAdapter.js`（两处过期注释更正）。已部署宿主 `custom_nodes/luowen/web/`，SHA256 与仓库一致。
- **验收状态**：AI 探针全绿（见下），但按项目纪律**修复结果须用户宿主验证**，尚未点头。

## 关键结论（3 句话）

1. **兄弟线间距滑块此前漏注册**：`3be484c` 声称已加但 `index.js` 无对应 setting，本轮补 `LuoWen.BrotherSpacing`（线路外观组，4–24 步进 2 默认 12）；「节点避障」是另一独立项，非此设置。
2. **整理按钮可拖动**：position:fixed + 指针捕获（4px 阈值分点击/拖动）+ localStorage(`luowen.autolayout.btnPos`) + 视口钳制；**z 必须 1000**——顶栏覆盖层 z-999 会盖掉低 z 浮层致点击/拖动全失效（本轮实测根因）。
3. **背景右键菜单走官方钩子**：1.55.18 Vue 模式空白处右键仍走 litegraph，`getCanvasMenuItems()` 有效；**必须删旧 `proto.getCanvasMenuOptions` patch**，否则 `legacyMenuCompat.extractLegacyItems` 差分提取会让同项显示两遍。取证入 conventions §2.12。

## 下次开工第一件事

1. `git log --oneline -3` + `git status --short` 确认基线；宿主若被用户动过，先核对 `custom_nodes/luowen/web/index.js` 与仓库 SHA256。
2. **等用户验收**：按钮拖动/点击、背景右键「络纹」子菜单、线路外观里兄弟线间距滑块。验收通过才谈 auto-layout→main 合并（合并/tag/推 main 须用户确认）。
3. **等用户给三工作流文件名**：示例工作流1（原样）/ 整理后2 / 手动期望3。重点 diff 2↔3，反推自动布局与用户期望的差距，改进 refine/引擎。此前先别动布局算法。

## 坑（别再踩）

- **浮层 z 层**：顶栏覆盖层 z-999、设置对话框 z-1700、`.litecontextmenu` z-9999、节点卡片 19–34。浮动控件要在顶栏区域可点必须 z>999；本轮按钮取 1000。低 z（如 500）会被顶栏盖掉，`elementFromPoint` 返回 actionbar SPAN，点击/拖动全失效。
- **菜单子项点击打开，非 hover**：探针等 submenu 出现要用 click，hover 会超时。
- **官方钩子与旧 monkey-patch 不能并存**：`legacyMenuCompat.extractLegacyItems`（contextMenuCompat.ts:109-202）会差分提取旧 patch 产物 → 迁 `getCanvasMenuItems` 后务必删旧 patch。
- **Playwright 启动**：全局 playwright 1.65.0 需 rev 1254（本机缺），用 `executablePath: 'C:/Users/GigaByte/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe'`。设置对话框经 `getByRole('button',{name:'设置 (Ctrl + ,)'})` 打开，搜索框用原生 value setter + input 事件。
- **设置持久化在服务端** `user/default/comfy.settings.json`：探针 `setSettingValue` 会写真用户设置，测后必须还原（本轮探针已含还原逻辑）；localStorage 是每 context 隔离，探针拖动位置不影响用户。
- **盲测 A/B 是 500 节点合成梯度**，不适合人肉盲测（用户已反馈）；别再拿它当验收材料，改三工作流校准。