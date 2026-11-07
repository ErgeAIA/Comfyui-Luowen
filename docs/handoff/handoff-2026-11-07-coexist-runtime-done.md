---
title: 交接 · 待办 1 完成（第三方运行时共存验证）
type: handoff
project: 络纹（LuoWen）
updated: 2026-11-07
description: >
  四扩展逐装逐卸完成（6 次宿主重启），被动装载全部无害，主动特征未触发，rgthree 根因查明。
  功能代码零改动。进度见 project-progress.md 本轮条目，逐条结论见 compatibility-matrix.md §5.5，
  证据 `.verify/p5/coexist/`。
---

# 交接 · 2026-11-07 · 待办 1 完成

## 状态

- 仓库 HEAD = `origin/main` = 本轮提交（docs: 待办 1 运行时共存验证…），工作区干净。
- 宿主：已还原至安装前基线（extensions 203、`/object_info` 2318、custom_nodes 清单一致、fp 2472081361）；rgthree 目录保持原状（未加载，根因已查）。
- **验收状态（DEC-037 委托口径）**：本轮全程 AI 自动跑 + 对照表，逐条结论在矩阵 §5.5；用户尚未对 §5.5 整体点头，待确认。

## 关键结论（3 句话）

1. **被动装载四者无害**：几何指纹逐点一致或可归因、无错误、账目对齐、Reroute 保护生效。
2. **主动特征全部未触发**（comb/ribbon/PCB/spline/tie 需各扩展手势创建，脚本不可达）——源码级「确定冲突」三条在被动状态均无表现；N2 实测我方磁吸赢得落点。
3. **rgthree 未加载根因**：与 0.43.2 不兼容（`__init__.py:271` patch 的 `execution.recursive_output_delete_if_changed` 已不存在）→ 导入失败；与本项目无关，R3 阻断。

## 下次开工第一件事

1. `git log --oneline -3` + `git status --short` 确认基线；宿主若被用户动过，先核对 extensions/object_info/custom_nodes 与 `.verify/p5/coexist/before-*.json|txt`。
2. **待办 3：发布材料**（无前提阻塞）：PRD §16 清单 + §14.2 fixture 2→10 组；已知限制如实写（性能 131ms 未达标、兼容性=被动运行时已验/主动未触发、§5.5 引脚跟随提示）。版本号需用户定。
3. 待办 4 smooth 真 Bezier 的前提（P0 欠账）——手动锚点已按 2026-11-07 会话向用户说明（MVP 口径已由 `01d8df7` 达成），**豁免待用户最终点头**；点头即可排 smooth。

## 坑（别再踩）

- **逐装逐卸 = 每轮 2 次宿主重启**：杀 8188 监听 PID + `powershell Start-Process run_nvidia_gpu.bat`（约 20–50s 起）；Git Bash 的 `cmd //c start` 引号会坏，别用。
- **几何指纹基线 fp=2472081361**（模板+Reroute@(400,432) 样本）；装机态若不同先归因再下结论——Cable 那次差异是它改引脚位置（outputs-at-bottom），不是几何漂移。
- **探针加载连字符目录**必须用 `importlib.util.spec_from_file_location`，`sys.path.insert+import` 必败（`rgthree-comfy` 目录名带连字符）。
- `/internal/logs` 在 0.43.2 返回空，宿主导入错误看探针或控制台窗口，别依赖它。
- Playwright 页面设置（LinkRenderMode 等）写的是自己 localStorage，不影响用户；但 **Ctrl+S 会写真工作流**，测试页永远别按。
