---
title: CLIP 主干线拖动抖动 Tasks
type: tasks
project: 络纹（LuoWen）
status: pending-approval
created: 2026-11-07
updated: 2026-11-07
spec: ./spec.md
---

# CLIP 主干线拖动抖动 Tasks

> 顺序执行；每完成一段立即向用户回报。T1–T2 只诊断不改码；T3 起必须先获用户拍板。

## T0 前置事实采集（已完成）

- [x] 确认该束链路为组 `2:0`（link 9 → 4/0、link 10 → 5/0），稳定态 fork T=107。
- [x] 记录稳定态 link 9/10 折线逐点坐标（见 Spec §1）。
- [x] 建立拖拽期状态机结论（Spec §2.3）与放大效应实测（Spec §2.4）。

## T1 复现与几何取证（已完成，结论写入 Spec §2）

- [x] `setPos` 扫掠 30 帧（SaveImage）：折线逐点不变，trunks 恒空。
- [x] 单步矩阵 node 1/3/7/8/9/10：折线不变。
- [x] 合成真实 PointerEvent 拖拽 18 步：折线不变，hover / over_link_center 恒空。
- [x] 排除像素级 diff 口径（canvas 回读非确定性，Spec §2.5）。

## T2 闭合「可见差异来源」（已完成，只插桩不改码）

- [x] 在用户宿主上用页面级包装（不写仓库文件）逐帧记录：倒角后的 `drawPts`、`chamferPolyline` 的 `skip` 与 `others` 长度、`frame.trunks` 是否存在、`hovered`、`cutA/cutB`。
  - 验收：给出「同一条线在两态下折点不同的第一处差异」或明确证明两态折点相同（则差异来自另一条被遮住的成员线）。
- [x] 判定「同组另一条是否也在动」：同时记录 link 9 与 link 10 每帧折点。
  - 验收：明确回答 Spec §5 第 2/3 条。

## T3 方案拍板（门禁）

- [x] 用户拍板走「同帧读取引脚坐标、不再自请求一帧」（A 方案）。
- [ ] 若选 B/C，先补 `docs/comfyui-dev-conventions.md` 可复核条目（C 需 `layoutStore.isDraggingVueNodes` 的 file:line）。（未选，不适用）

## T4 实施（获批后）

- [x] 按拍板方案做最小精确补丁（禁止整文件重写）。
- [x] 单测覆盖：`planTrunks` 在版本变更帧的 trunk 保留/重算语义。
- [x] 宿主实测 Spec §7 六项（见下「验证记录」；大斜切/磁吸/整组悬停仅抽查）。
- [x] 追加 `docs/agents/debug-log.md` BUG-002 条目（只追加）。
- [x] 更新 `docs/agents/project-progress.md`。

### 验证记录（2026-11-07）

- [x] 跳动消失：端点节点 67 每帧 +8px 连续 11 帧、无关节点 63 每帧 +6,−3 连续 12 帧，全部 `fork=170`、`vx=[294]`。
- [x] 修复期额外根因：`nodesById` 跨帧缓存空表导致偏移未记录（`nOff=0`）；去掉缓存后 `nOff=9`。
- [x] `LuoWen.verify()` `{ok:true,diffs:[]}`；单测 99/99。
- [ ] 用户宿主验收（真实鼠标拖动）。

## T5 收尾

- [ ] 用户宿主验证通过后再按 git-manager 流程提交（本轮不提交）。
