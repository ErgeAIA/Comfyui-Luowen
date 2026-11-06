# 兼容性风险清单（PRD 阶段 0 交付物）

> 调研与实测基准日 **2026-11-06**；宿主 = ComfyUI v0.43.2 + 前端 1.55.18。
> 三路调研来源：1.55.18 sourcemap 源码核实 / Cable Management 深研 / Zip Ties + 官方 PR + NKD 边界；实测证据见 `drawing-api-notes.md` §5。

## 风险登记

| # | 风险 | 等级 | 证据 | 缓解 |
|---|---|---|---|---|
| R1 | **悬停 UX 的合成测试局限**：1.55.18 真实交互走 CanvasPointer 指针门面，`processMouseMove`/`over_link_center` 旧管线在 pointermove 下不执行（实测 pm=4/pmm=0；原生同构）。悬停高亮/tooltip 的真人验收未做 | 中 | 实测记录 drawing-api-notes §5.9 | 机制级已验证（匹配器 + `path`/`_pos` 数据通道与原生同构）；真人悬停/高亮留给阶段 0 用户验收与阶段 1 交互实现 |
| R2 | **前端版本漂移**：Cable Management 实测教训——前端 1.53.6–1.54.8 上其 ribbon 失效（Issue #6）；它依赖 `linkRenderer.pathRenderer` 私有属性，重命名即死。本机 requirements 声明 1.57.4 与实装 1.55.18 不一致，升级随时可能发生 | 高 | CM Issue #6；本机版本不一致（UI 有 Compatibility Warning） | 络纹选**原型级 `renderLink`**（比 pathRenderer 私有属性稳一层）；能力检测 + 静默降级已内置；**每次宿主升级必须重跑 phase0 验证脚本**；目标版本矩阵在阶段 3 建立（PRD F-014） |
| R3 | **官方 tie/ribbon PR 落地不确定**：PR #21965（Zip Ties 作者本人移植）截至 2026-11-06 open + 冲突未合并；竞品 draft #22441 亦未合并。一旦合并，束交互/命中/undo 由官方承担 | 中 | GitHub API 实查 `merged:false, mergeable:dirty` | 差异化按 PRD 既定收缩：正交路由、节点避障、线路分道、间距自定义为络纹核心（官方 PR 明确 out-of-scope）；**实现日重查** `api.github.com/repos/Comfy-Org/ComfyUI_frontend/pulls/21965` 的 `merged_at` |
| R4 | **Nodes 2.0 演进**：当前 flag 默认关、link 仍走同一 renderLink（已实测通过）；但前端源码自述 vue 节点 "until stable"，未来 link 层 Vue 化则 wrap 失效 | 当前低 / 前瞻中 | coreSettings.ts:1189（experimental）；实测双形态通过 | 能力检测 + 静默降级已内置；版本矩阵覆盖两种形态（PRD F-014） |
| R5 | **子图实测缺口**：代码级保证单一 renderLink 覆盖根图+子图（唯一画布实例换 graph），但阶段 0 未做子图 UI 实测；且 `app.graph` 是 deprecated getter（永远根图），活动图必须取 `app.canvas.graph` | 中 | LGraphCanvas.ts:1934-1951、app.ts:355-358 | 路由代码一律用 `app.canvas.graph`/`canvas.subgraph`；子图交互实测列入阶段 3（AT-025） |
| R6 | **reroute 共享段竞争**：一个 reroute 的 `path` 会被多条 link 的渲染先后覆写（adapter 309 行，原生行为即如此） | 中 | litegraphLinkAdapter.ts:309 | 每段独立处理、不缓存跨帧对象引用（已实现）；reroute 链连续性与手动意图保护是阶段 1/2 课题（PRD F-010，MVP 保守跳过含 reroute 链的跨目标合并） |
| R7 | **Vue 节点端点坐标不可信**：高节点上 `getConnectionPos` 返回默认槽位、偏差一整列（CM/NKD 均实测踩坑） | 中 | CM registry.js pinMemo 注释；NKD pcb.js "miente" 注释 | 从实际 draw 调用收割真实端点（pinMemo 自愈模式，阶段 1 采用）；障碍快照 rect-hash 版本化 |
| R8 | **扩展冲突**：Cable Management / NKD / Zip Ties / 官方未来实现都会 wrap `renderLink`/`drawConnections`——wrap 链顺序、双包、卸载互相破坏 | 中 | CM pathing.js 挂载蓝图；rgthree 在 0.43.2 已因 patch 核心失败（本机实测） | `luowen_wrapped` 防双包已内置；卸载只还原自己的 wrap；冲突扩展组合测试列入阶段 3（PRD §11.4）；冲突时安全关闭冲突能力并提示 |
| R9 | **workflow 数据键位**：官方 PR #21965 会把 `extra.linkTies` 写进 workflow schema（0.4/1 均声明）；Zip Ties 用 `extra.zipTies` | 低 | PR ADR LINK-TIES-0049 | 络纹坚持运行时派生数据零落盘（PRD §9.3），设置走 ComfyUI settings 机制；**绝不读写 `extra.linkTies`/`extra.zipTies`**，未知键 passthrough 不报错 |
| R10 | **性能红线**：渲染热路径跑搜索 = 画布卡死（CM 注释实测：单异常逃逸会让 core `is_rendering` 卡死、canvas 整会话死掉） | 高（纪律性） | CM pathing.js 降级注释；NKD SEARCH_BUDGET=24 | 阶段 1 起执行：计算/绘制分离、障碍每帧读一次、rect-hash 版本缓存、拖动期冻结 + 每帧预算、单线异常隔离（phase0 已内置异常隔离模式） |
| R11 | **renderLink 参数多态 / 双入口**：动画类插件（link_animations）绕过 renderLink 走底层 `drawLink`；CircuitBoardLines 调 renderLink 时传**坐标数组**而非独立数字，参数索引整体位移（color 从 8 → 6）——错误假设参数位会导致形状错乱 | 高 | AlignLayout 作者《LineEdit修改连线测试》实测报告（其仓库 web/docs/） | wrap 内做参数形态判别（`typeof a === "number"` vs 数组）；兼容矩阵必须含 link_animations、CircuitBoardLines 两个插件 |
| R12 | **覆盖层渲染器"借用" renderLink**：AlignLayout 连接助手用 `Object.create(canvas)` 派生渲染器、以 `ds.scale=1` 在独立覆盖层 canvas 上调 renderLink 画预览线——该调用会落进络纹的原型级 wrap | 中 | AlignLayout port_connect_menu.js（源码核实） | wrap 内识别非主画布上下文（如 `this !== app.canvas` 或 ctx 与主 canvas 不符）→ 原函数直通；络纹自己的预览线用一次性派生渲染器模式（借鉴其做法） |
| R13 | **批量节点移动的重算风暴**：自动布局类扩展（AlignLayout Alt+L）在单个 beforeChange/afterChange 事务内批量写 `node.pos`，会触发络纹成规模的路径重算请求 | 中 | AlignLayout auto_layout.js（事务包裹批量赋值） | 重算请求合并/去抖（PRD §10.5 已有此要求）；可探测 `__comfy_auto_layout_instance` 在布局动作完成后统一触发一次重算 |

## 邻域调研：ComfyUI-AlignLayout（2026-11-06）

> 仓库 pixixai/ComfyUI-AlignLayout（v1.6.7，Registry id `alignlayout`，110 star，2026-11-01 仍在更新；**无 LICENSE 文件**——pyproject 声明与实际不符，默认版权保留，只借鉴思想不碰代码）。完整调研记录见当次会话报告；要点：

- **定位正交、是上游搭档不是竞品**：它做节点自动布局（ASAP/ALAP 分层 + BFS 孤岛 + 天际线游标 + Slot-Index 防交叉排序，Alt+L 触发、无自动触发），对连线**完全放任原生贝塞尔**——两套 auto_layout 源码均无 renderLink/drawConnections 挂载点、不写 link 数据，只改 `node.pos`/`group.pos`。"布局（AlignLayout）+ 布线（络纹）"组合叙事成立；其布局后"节点整齐但连线交叉"的窗口期正是络纹的入口场景。
- **三条第一手兼容性情报**（其 RedBoldLinks 实验报告，直接进 R11/R12/R13）：renderLink/drawLink 双入口；参数多态（数组坐标调用位移索引）；属性式修改会被缓存/绕过。
- **可借鉴机制**：`renderedPaths` Path2D + `isPointInStroke`（临时重置矩阵）做命中检测——与络纹 phase0 同款思路的第三方印证；一次性派生渲染器复用原生 renderLink 画预览线；`node.pos` 必须整体赋新数组才触发 `_bounding` 更新（LiteGraph 硬约定）；entry.js 按 `Comfy.VueNodes.Enabled` 分流双模式结构。
- **回归基线**：其测试基线是前端 1.53.10；最新 Registry 版本状态为 `NodeVersionStatusFlagged`（原因未知，仅存档）。

## 许可证边界（PRD §13.6）

- **NKD Reroutes 已于 2026-10-29 整体切到 GPL-3.0**（LICENSE + pyproject 1.14.2 确认）——只做思想参考，**不引入任何代码**，除非未来整体改 GPL。
- 但 NKD 的 `js/route/router.js` 内部源自 **MIT 的 Cable Management**——需要现成 A\* 实现时，**回溯 MIT 上游 vtokic/comfyui-cable-management 直接引用**，绕开 GPL。
- MIT 可直接复用清单（阶段 1 输入，须在 THIRD_PARTY_NOTICES.md 登记版权与修改）：`web/pathing/router.js`（稀疏 Hanan A\*，纯几何零依赖 12.8KB）、`web/pathing/trace.js`（折线→Path2D/弧长）、`web/pathing/nudge.js`（共线分离/同引脚粘连/反辫）。
- 调参起点（CM/NKD 实战常数）：穿节点 ×8、软区 ×1.02、拐弯 24、clearance 16、stub 24、A\* 预算 20000、拖动期每帧预算 24。

## 实现日检查清单（每次动工前过一遍）

- [ ] 查 PR #21965 与 #22441 的 `merged_at`（一锤定音 API）
- [ ] 确认宿主前端包版本与 `docs/phase0/drawing-api-notes.md` 的版本档案一致；不一致先重跑 phase0 验证
- [ ] `LGraphCanvas.prototype.renderLink` 签名未变（能力检测自动做，但人工确认降级原因）
- [ ] 未读写 `extra.linkTies` / `extra.zipTies`
- [ ] 新增 wrap 点已登记本文档 §4 表并具备回滚
