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

## DEC-008: 阶段 2 多目标主干采用「独立基准 + 共同前缀 + Ribbon + 滞回」

- **日期**：2026-11-06
- **背景**：PRD 阶段 2 要求输出端口连接组、独立基准、候选共享树、全合并/部分合并/独立决策、单目标绕行保护与拓扑滞回，并遵守 §7.3（不得零间距重叠冒充合并）与 §8.3（组选择不可行时降级 Ribbon）。
- **决策**：
  1. **独立基准**复用现有单线缓存；主干规划为纯函数 `routing/trunkPlan.js`，适配器 `planTrunks()` 只负责分组与接线。
  2. **分叉长度 T** 取上限约束而非共同前缀本身：`min(72, 最近目标投影−stub, 正前方最近卡片−stub−6)`，且要求共同前缀 ≥16px；避免分叉顶进迎面卡片造成折返（实测 CLIP 组 69px 处必须收短）。
  3. **Ribbon**：fan 14px + pitch 4px，按目标法向位置排序分股；分支从 offset fork 重新 A*；分支 stub 按 §7.2 收缩为 `min(stub, dist/3)`（该收缩也作用于单线路由）。
  4. **绕行保护 + 滞回**：`ratio=(T+分支长)/独立长`；首次 join 1.25、已合并 keep 1.35、已独立 rejoin 1.15；成员 <2 或股道放不下 → 完全独立。
  5. **重绘保障**：主干规划依赖上一帧记录的端点；几何版本变化的那一帧规划会等待，若画布静止则主动 `setDirty` 再要一帧（实测否则主干永远不生成）。
  6. **交互降级**：不实现“点主干选整组/组删除”；按 §8.3 用 Ribbon 独立股道保留逐条命中/删除，不留下不可选线段。
- **验证**：干净布局主干组成立（`62:0`，T=39，merged 79/81），两股悬停分别命中 79/81；自身/第三方卡片穿透 0；数据不变性 ok；单元测试 32/32（主干规划、绕行保护、滞回、Ribbon 间距、走廊上限、stub 收缩相关几何）。

## DEC-007: 连线不压自身卡片 + 三档求解（strict→semi→loose）

- **日期**：2026-11-06
- **背景**：复验反馈：① 线会被它所连接的卡片压住（路径中段从端点卡片底下穿过）；② 节点重叠时 strict 无解直接回退成贝塞尔曲线（"一端变成曲线"），用户不接受。
- **决策**：
  1. **障碍集合包含两端节点**（`renderLinkAdapter.js:190-193`）：A* 中段不得穿过自己连接的卡片；引脚到 stub 的短出线段仍允许贴边。
  2. **三档求解**（`:208-230`）：`strict`（所有节点框禁行）→ `semi`（仅两端卡片禁行，第三方卡片保留 8× 代价，用 router 新增的 `blockRects`）→ `loose`（纯正交，可穿卡）。三者皆失败才原生。
  3. **不再以原生曲线作为重叠场景的默认退路**：loose 保证横平竖直；只有网格搜索彻底无解（预算耗尽）才回退原生。
  4. 计数器扩展为 `preview/straight/routed/semi/loose/strictNull`，验收可区分每档。
- **验证**：干净布局（无重叠）第三方/自身卡片穿透均为 0；第三方卡片压引脚时自身卡片穿透 0 且路由为 semi 正交；两端卡片互相覆盖的极端重叠下 loose 仍正交。单元测试 26/26（新增端点卡片禁行、blockRects 定向禁行）。详见 docs/routing-algorithm.md §7.1。

## DEC-006: 阶段 1 验收返修——障碍矩形坐标、严格绕行、拖拽预览、整线悬停

- **日期**：2026-11-06
- **背景**：用户验收阶段 1 反馈三项：① 节点绕行不达标（截图显示线从 K采样器 底下穿过）；② 拖拽节点时连接线变成曲线；③ 只有悬停中心圆点才会亮。
- **决策**：
  1. **根因修复**：`getBounding()` 返回绝对坐标（`LGraphNode.ts:2403`），`nodeRects` 曾再次叠加 `pos`，导致所有避障矩形平移。改为绝对坐标，并在 `tests/unit/graphRead.test.mjs` 锁死契约。
  2. **严格绕行**：给 MIT 复用的 `router.js` 增加可选 `strict`（硬节点框禁行，无解→null），适配器默认启用；无解时该线降级原生。上游默认行为不变，修改范围写入文件头与 THIRD_PARTY_NOTICES。
  3. **拖拽预览**：`pointer.isDown` 期间未命中的线改用 `geometry/preview.js` 的两折正交预览（不跑 A*、不进缓存），松手后 A* 重算；不再整线回退曲线。
  4. **整线悬停**：新增 pointermove 监听 + 折线距离判定（阈值 8px/scale），悬停任意线段即白色柔光高亮；中心点 8×8 的原生命中保持不变。只读渲染状态，不改图数据。
  5. **调试 API**：`window.LuoWen.routes()` / `trace()` / `status().counters` 暴露只读快照，用于程序化验收（穿透扫描、preview 计数、悬停命中）。
- **验证**：7 条路由逐段采样穿透数 0；一次拖拽 preview 计数 409 次且折线全程正交；悬停折线中段 `hovered=74`；`verify` 数据不变性 ok；单元测试 24/24。详见 docs/routing-algorithm.md §7.1。

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
