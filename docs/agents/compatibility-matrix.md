---
title: 兼容性矩阵与生命周期验收
type: compatibility-matrix
project: 络纹（LuoWen）
updated: 2026-11-07
description: >
  阶段 3 兼容性矩阵与连接生命周期实测记录：宿主/前端组合、节点模式、子图、组、多重 Reroute、样式与生命周期操作。
  每格给出「通过 / 已知缺陷 / 未支持」，不通过项附现象与判定依据。2026-11-07 补丁轮修复 BUG-006 后补入修前/修后计数对比；同日补 BUG-007（verify 快照纳入 extra/properties/坐标）。两项修复结论均待用户验收。
  AI 在本文件新增或修改内容后，必须同步更新 frontmatter 的 updated 字段为当日日期（YYYY-MM-DD）。
---

# 兼容性矩阵与生命周期验收

> 范围：PRD §11.2 兼容范围、§9.4 连接生命周期、§15 阶段 3 交付中的「经典画布与 Nodes 2.0」「子图/组/撤销重做/加载」。
> 首轮只做兼容性与生命周期实测，未改功能代码、未提交 git、未新增依赖；2026-11-07 补丁轮仅改 `renderLinkAdapter.js` 适配器层修 BUG-006，仍不提交 git、不新增依赖。
> 性能不复测：直接引用 [performance.md](./performance.md) §2026-11-07（50/200/500 节点基准）。

## 1. 实测环境

| 项 | 实测值 | 来源 |
|---|---|---|
| ComfyUI 宿主 | 0.43.2 | `D:\AIGC\ComfyUI_windows_portable\ComfyUI\comfyui_version.py` |
| comfyui-frontend-package | 1.55.18（后端要求 ≥1.57.4，页面出现版本兼容告警） | 宿主 `python_embeded\Lib\site-packages` |
| 页面 | `http://127.0.0.1:8188/` | Playwright headless Chromium |
| 节点模式 | Vue 节点（Nodes 2.0）默认开启；经典画布以 `Comfy.VueNodes.Enabled=false` + reload 切换 | 设置项 |
| 插件状态 | 已安装，`installed=true`；测试结束设置恢复为 `VueNodes.Enabled=true` | `LuoWen.status()` |
| 工作流 | 宿主当前 10 节点 / 10 连线（KSampler 四入线汇聚 + 单主干组 `62:0` + 同目标等距带） | `canvas.graph.serialize()` |
| 第三方冲突插件 | Cable Management / NKD Reroutes / Zip Ties 未安装；`rgthree-comfy` 目录存在于 `custom_nodes` 但当前未加载（`/extensions` 无其前端资源，`/object_info/Reroute` 返回 `{}`），本轮未改动 | `/extensions`、`/object_info/Reroute`、`custom_nodes` 清单（2026-11-07） |

> 版本告警为宿主环境事实（前端低于后端声明），本轮未改宿主依赖。告警不阻断插件挂载与绘制。

## 2. 判定标准

- **通过**：实测项满足 PRD 语义；`LuoWen.verify()` 返回 `{ok:true, diffs:[]}`；图结构（节点/Link/Reroute/组）序列化前后一致；控制台无插件异常。
- **已知缺陷**：功能可用但存在可复现的状态残留或交互异常，已登记 debug-log；不阻断主流程，但验收时须明示。
- **未支持 / 未验证**：当前宿主或环境不具备实测条件，或设计上主动旁路；不得表述为「完全支持」。

## 3. 兼容性矩阵

### 3.1 宿主 × 前端 × 节点模式

| 宿主 ComfyUI | 前端包 | 节点模式 | 结论 | 实测依据 |
|---|---|---|---|---|
| 0.43.2 | 1.55.18 | Vue 节点（Nodes 2.0） | **通过** | `installed=true`、`routed=10`、`rects=10`、`routes=10`；`snap` 已安装并启用（`active=false`，静止态）；`verify ok` |
| 0.43.2 | 1.55.18 | 经典画布 | **通过** | `vueNodesMode=false`、`installed=true`、`routed=10`、`routes=10`；拖动节点后 `routed=10`、`verify ok`；`snapInstalled=false / snapActive=false`（对齐吸附为 Vue-only，主动旁路） |
| 其他宿主/前端组合 | — | — | **未验证** | 本轮只锁定 0.43.2 + 1.55.18；PRD 要求逐版本实测后才可标记支持 |
| 1.57.4+（后端声明版本） | — | — | **未验证** | 宿主未重装前端；不得据 PRD requirements 推断通过 |

> 经典画布下 `snapInstalled=false` 属设计行为：对齐吸附依赖 Vue 节点 DOM，经典画布不安装、不启用，不构成缺陷。

### 3.2 结构维度

| 维度 | 场景 | 结论 | 现象与判定依据 |
|---|---|---|---|
| 子图 | 选 2 节点转 Subgraph → 进入子图 → 返回根图 | **通过** | 转换后根图 9 节点 / 10 链路、`rootRouted=10`；子图内部 2 节点 / 5 链路、`routed=5`、`rects=2`（绘制使用当前活动 graph）；返回根图 9 节点 / 10 链路 / `routed=10`，主干 `62:0 merged=[81,83]`；重载 A 后恢复 `merged=[79,81]`、`verify ok`。截图 `compat_02_subgraph_inside.png`、`compat_03_subgraph_back.png` |
| 组节点（新建/移动/删除） | `LiteGraph.LGraphGroup` 覆盖 2 节点，移动组、删除组 | **通过** | 组移动后节点 `pos` 不变、`routed=10`；删除后组序列化与操作前完全一致（`plateEqualAfterRemove=true`）；图节点/链路未变、`verify ok`。截图 `life_05_group.png` |
| 多重 Reroute | 同一条链插入 3 个 Reroute，再逐个移除 | **通过（含状态刷新时序）** | 插入后 links 仍为 10，`trunks=[]`（含 Reroute 链不参与主干合并，符合 DEC / F-010 / AT-018）；移除后 `reroutes=0`、`routeCount=10`；主干恢复需下一次重绘（`setDirty` 后恢复），属状态刷新时序，不是持久缺陷。截图 `compat_01_multi_reroute.png` |
| 节点折叠 | 折叠节点卡片 | **未验证** | 本轮脚本未覆盖折叠态几何与端口位置变化 |
| 复制 / 粘贴 | 复制连接并粘贴 | **未验证** | PRD §9.4 要求，但不在本轮生命周期清单内 |
| 第三方冲突扩展 | Cable Management / NKD Reroutes / Zip Ties / rgthree | **未支持（环境缺失）** | 宿主未安装，无法实测共存；不得声明兼容 |

### 3.3 样式与开关

| 样式 | 结论 | 实测依据 |
|---|---|---|
| `orthogonal` | **通过** | `routed=10`、`routeCount=10`、`rects=10`；截图 `compat_04_style.png` |
| `smooth` | **通过** | `routed=10`、`routeCount=10`；恢复后 `verify ok` |
| `native` | **通过（完全旁路）** | `routed=0`、`routeCount=0`，所有连线回退原生绘制；符合 F-012 / AT-026 兜底口径 |

## 4. 生命周期测试

| # | 操作 | 验证方法 | 实测结果 | 判定 |
|---|---|---|---|---|
| L1 | 加载工作流（同一图重载） | `app.loadGraphData(serialize)` 后比较路由指纹、图规模与 plate；`verify()` | `routed 10→10`、节点/链路 10/10、`plateEqual=true`、路由指纹 `3664953215` 与基线一致、`verify ok` | **通过** |
| L2 | 切换工作流 A↔B（B 为全图 +260,+120 平移） | A/B 交替加载两次，比较几何指纹与主干/等距带 | `sameA=true`、`sameB=true`；A 指纹与基线一致；B 主干 `62:0:[79,81]`、`bands=2` | **通过** |
| L3 | 清空画布 | `loadGraphData({nodes:[],links:[],groups:[]...})` 后恢复 A | 空图 `routed=0 / rects=0 / trunks=0 / bands=0`、`verify ok`；恢复后 `routed=10`、主干 1 组；`routeCache.size` 未清（105，上限 4096，无几何影响） | **通过（附残留观察）** |
| L4 | 撤销 / 重做连接操作 | 选中节点 63 删除，键盘 Ctrl+Z / Ctrl+Y / 再撤销 | 删除后 9 节点/9 链路/`routed=9`/`routes=9`；撤销 10/10/10；重做 9/9/9；再撤销 10/10/10 且 `verify ok` | **通过** |
| L5 | 删除节点 | 删除节点 68 后测量 | 9 节点 / 9 链路 / `routed=9` / `routes=9`（无幽灵） | **通过** |
| L6 | 仅删除连线（不改节点矩形） | 先删节点 68（links 9），再删 link 79 并强制重绘；另用 `probe16` 做「只删连线、节点全保留」最小复现 | 修后：链路 8 / `routed=8` / `routes=8`，`routes()` 不含 79；最小复现 `nodes 10 / links 9 / routed 9 / routes 9`；旧路径悬停 `hover=null`；`obstacleVersion` 未变（拓扑指纹触发清理）。修前见 §4.2 | **通过（BUG-006 已修复，待验收）** |
| L7 | 重连 | 以原 origin/target 重建连接（生成新 link id 83） | 修后：链路 9 / `routed=9` / `routes=9`；新链路正常绘制、旧条目已清除。修前见 §4.2 | **通过（BUG-006 已修复，待验收）** |
| L8 | 节点拖动 | 注入 `pointer.isDown` + 逐帧 `setPos`，比较拖动前后指纹 | 指纹 `3664953215 → 4165390149`（几何按新位置重算）、`routed=10`、图结构 `graphChanged=true`（仅 pos 变化）、`verify ok` | **通过** |
| L9 | 视图缩放 / 平移 | 缩放至 0.45 并平移；比较缓存 misses / 指纹 | `misses 280/280/280`、`routed 10/10/10`、几何指纹不变（未触发重新求解） | **通过** |
| L10 | 窗口缩放 | 视口 1600×1000 → 1024×700 → 1600×1000 | 三档指纹一致（`4165390149`）、`routed=10`、`rects=10` | **通过** |
| L11 | 组操作 | 新建 / 移动 / 删除组，比较 plate 与图数据 | 见 §3.2；组数据完全回滚、节点坐标未变、`verify ok` | **通过** |
| L12 | 子图切换 | 见 §3.2 | 见 §3.2 | **通过** |

### 4.1 生命周期结论

- 插件未写入工作流图数据：所有步骤结束后 `verify()` 均为 `{ok:true, diffs:[]}`；节点/Link/Reroute/组序列化与基线一致（组操作按操作前 plate 对比）。
- 无插件异常：`suite-run-fixed2.log` 各步骤 `errors: []`、页面 `logs: []`。
- BUG-006 的 `state.routes` 幽灵条目已由拓扑指纹 + 现存 link 差集清理修复（见 §5.1）；图数据自始至终未变，可见绘制只遍历现存链路。
- `routeCache` / `lastGoodRoutes` 在清空或切换工作流时不清空，属缓存容量内残留（4096 上限），实测不改变新图几何。

### 4.2 BUG-006 修前 / 修后计数对比

同一 `suite.mjs`、同一宿主（0.43.2 + 1.55.18），修前用 `.verify/p3/renderLinkAdapter-prefix.js`（HEAD 版本，SHA256 与 HEAD 一致），修后用仓库当前版本（宿主 SHA256 一致）。

| 步骤 | 修前 links / routed / routes | 修后 links / routed / routes |
|---|---|---|
| 先删节点 68（links 9），再删 link 79（节点矩形不变） | 8 / 9 / 9 | **8 / 8 / 8** |
| 原 origin/target 重连（新 link 83） | 9 / 10 / 10 | **9 / 9 / 9** |
| 其余生命周期与矩阵步骤 | routed/rects/routes/bands/bandDegraded/orderDegraded 同值 | 同值；深度 diff 仅视口命中坐标噪声（`fp` 与 `routed` 一致） |

### 4.3 修复后几何回归（历史布局 D 复现）

布局 D 取自 debug-log BUG-005 现场（63=(764.6363,814.3082)、68=(442,800)、70=(846.493,361)、71=(291.5313,618)、67=(292,381)、9=(2013.2686,540.5)、62=(-233,478.3438)、65=(1252.905,515)、66=(-709.5763,-195.1946)、69=(-233.1818,-195.1946)），由 `probe23.mjs` 复现，`probe24.mjs` 把 63 移到 x=841 核对 pivot=0 段。几何未被本次补丁触及（diff 仅失效清理与指纹复用）；suite 修前/修后同名步骤 `fp` 与路由几何一致，过滤计数器噪声后 0 行为差异。

| 回归项 | 实测数据 | 结论 |
|---|---|---|
| 单主干三通 | `trunks=[{group:'62:0', fork:155, merged:[79,81]}]`；`routed=8`（link 80/72 在视口外，受 LiteGraph 视口裁剪） | 通过，与历史 `fork=155 / merged=[79,81]` 一致 |
| 远端双线 gap 8（pivot=0 段，63 x=841） | target 70 带 `[76,82,78]`、anchor 82、pivot 0、shift 0、`xs=[null,806.493,814.493]` → 82/78 间距 8.000，76 为直线（无走廊） | 通过，数值与 BUG-004 记录一致 |
| 远端双线 gap 8（pivot=1 段，63 x=764.6363） | 同带 `xs=[null,718,726]`、pivot 1、shift 0 → 间距 8.000；pivot 随 63 的 4px 外扩箱切换，符合 BUG-004 | 通过（证明 pivot 切换生效） |
| 输入侧四线（pivot=0） | `75=822.493`、`78=814.493`、`82=806.493`，`76` 为水平直线 `y≈393` 无竖段 → 四线嵌套 `75 > 78 > 82`，相邻差 8 | 通过，与文档基线逐值一致 |
| up 组镜像 | 63 下移 top=814.3082、65=(1252.905,895) → `band65` 成员 `[73,74]`、`xs=[1228.905,1220.905]`；y=815 时 63 顶边 814.308 与 65 顶边 815 仅差 0.69px，不足以让 74 走廊从 63 下方绕出（4px 外扩箱 + 净空），未成带；y=895 差 80.7px 成带 | 通过；up 组外侧 73、内侧 74，镜像成立 |
| down 组镜像 | 65=(1252.905,200)（源点全在下方）→ `band65` 成员 `[73,74]`、`xs=[1220.905,1228.905]` | 通过；与 up 组顺序互为镜像，间距 8 |
| 撞上限冻结 | 68→(1204,630) + 65=(1252.905,835)：target 70 带成员 `[82,78]`，`bandDegraded=6`、`orderDegraded=6`。首轮：`82/78 cross-pivot1-k4 fallback:'prev'`（k 到上限 4、`steps=4`、`clamped=false`）；帧末两轮独立求解：`76/78/82 cross solved` 与 `78 cross solved`。band 仍输出 `xs=[806.493,814.493]` | 通过（按设计降级冻结，不写图数据）；与历史「82 prev / 78 solved」差异仅因 63/68 位置组合不同，降级路径一致 |
| 含 Reroute 链不参与合并 | link 79 插 1 个 Reroute：`reroutes=1`、`links=10`、`trunks=[]`；移除 Reroute 并重绘：`reroutes=0`、`trunks=[{62:0, merged:[79,81]}]`、`verify ok` | 通过（F-010 / AT-018） |

### 4.4 拖动与子图步骤的 4 条 bandDegraded/orderDegraded 归因

记录来自 `probe15.mjs`（输出 `.verify/p3/probe15-run-20261107.log`）与 suite 的 `nodeDrag` / `subgraph` 步（修前/修后均 4/4，非本次修复引入）。

| 场景 | 4 条记录明细 | 触发条件 | 稳定性 |
|---|---|---|---|
| 拖动节点 70（+90,+60） | `73@65 cross-pivot1-k4 solved`、`74@65 cross-pivot1-k4 prev`、`73@65 cross solved`、`74@65 cross solved`；中间帧另见 `pivot1-k4-r0 / r2`（74 prev） | 拖动使 65 的输入带（73/74）候选阶梯 k=0..4 全部被交叉预检拒绝，回退 `fallback:'prev'`；帧末独立求解后转为 `cross` | **确定性降级，非瞬时抖动**：拖动到 x≈705 起出现，鼠标释放后保留；重新加载同一拖动后布局仍复现同 4 条 |
| 子图转换后返回根图 | `85@70 cross-pivot1-k4 prev`、`86@70 cross-pivot1-k4 prev`、`85@70 cross prev`、`86@70 cross prev`（link id 随转换新建） | `convertToSubgraph` 重连外部输入，生成新链路 85/86 后对 target 70 重新求解；干净页面仅子图内部时 `inside.bandDegraded=[]`，返回根图才出现 | **确定性重算**：同一拓扑转换可稳定复现；属 DEC-028 显式降级路径，`verify()` 因根图被用户主动转换（10→9 节点）而预期为 `ok:false`，非插件写图 |

### 4.5 待办 2 四类验收（2026-11-07，真实鼠标轮；脚本 `.verify/p3/stage3-remaining.mjs`，记录 `stage3r-run3.json`）

宿主 0.43.2 + 1.55.18，默认模板（10 节点 / 10 链路），Vue 节点模式，ds.scale=0.9。全部用 Playwright 真实鼠标/键盘事件（非 `setPos` / 合成 PointerEvent）；图→屏换算统一用适配器 `eventGraphPoint` 反演式 `client=(graph+ds.offset)·scale+rect`。终态清扫后 `verify() ok:true`、10 节点 / 10 链路 / 10 路由一致；单测 99/99。

| 类 | 步骤 | 结果 |
|---|---|---|
| 真实鼠标拖拽（S1） | pointerdown+move×6+up 拖节点 67（170,290 → 203.3,320） | `verify() ok:true`、`moved` 只含 67（位置变化不判失败）；拖后 `routed==links` 无幽灵、`bandDegraded/orderDegraded` 0；Ctrl+Z 精确还原 |
| 真实右键链路菜单与组删除（S2/S3） | hover 引导：主干点命中 `{linkId:79, part:'trunk', members:[79,81]}` → 右键 | 主干菜单首项「删除这一组（2 条）」（后随 隐藏连线/Add Node/Add Reroute/Delete/Convert to Set/Get）；点击后 10→8 链路、单事务（verify 报 `link-removed: 79/81`）、Ctrl+Z 一次恢复 `ok:true`。分支点命中 `{linkId:79, part:'branch'}` → 右键菜单**无**组删除项（S6 的 link 76 分支菜单同证） |
| 节点折叠（S4） | 点击节点 67 折叠箭头 → 折叠 → 再展开 | 折叠态 `links 10 / routed 10`（无幽灵）、`verify ok:true`；展开后 `routes()` 几何指纹与折叠前一致（geoRestored=true） |
| 复制粘贴（S5） | 选中节点 67 → Ctrl+C / Ctrl+V → 删除粘贴件 | 粘贴后 `nodes 11`、`verify` 如实报 `node-added: 72`、`routed==links` 无幽灵；删除粘贴件后 10/10 恢复、`verify ok:true` |
| `crossCleanup=true` 生命周期（S7） | 设置开启 → `setPos` 构造布局（6 对交叉）→ 真实拖动 67 → 合成删线 → undo → 关闭还原 | 清理运行 2→3→5 次、epoch 逐级失效重建；删线后 `routed==links` 无幽灵；本轮布局 6 对交叉未采纳（`lastReason:'pairs-not-decreased'`，总长增幅超 15% 拒绝，保守语义符合 DEC-017）；关闭后布局还原、`verify ok:true` |

**口径注记（本轮新发现，非缺陷）**：ComfyUI 撤销 = `loadGraphData` 恢复快照 → 触发本插件 `afterConfigureGraph()`（`index.js:333-336`）重建基线，即**每次 Ctrl+Z 后 `verify()` 基线自动跟随撤销后状态**；自动化脚本若在删除后 undo，可能复活已删粘贴件，终态需孤儿清扫 + `rebase()`。详见 debug-log BUG-007 同名小节。

## 5. 已知缺陷与缺口

### 5.1 BUG-006：仅删连线时路由状态表残留幽灵条目（已修复，待验收）

- 修前现象：删除 link 79（不动节点）后 `links=8`，但 `routes=9`、`status().routed=9`；重连后 `links=9` 而 `routes=10`。旧路径上悬停仍可命中已删的 79。
- 判定依据：幽灵只存在于 `state.routes`（调试/悬停分类用），`getStats().routed = state.routes.size`；可见绘制按现存链路遍历，幽灵不可见；图数据未变（`verify ok`）。
- 原根因：`beginFrame` 仅在 `obstacleHash` 变化时执行 `state.routes.clear()`；链路删除不改节点矩形，故不触发清理。
- 修复：适配器层新增拓扑指纹 `computeLinksHash` 比对与 `pruneStaleLinkState` 差集清理（[L955-L1004](file:///d:/Workspace/Code/Comfyui-Luowen/luowen/web/adapters/renderLinkAdapter.js#L955-L1004)）；不清空整表、不递增 `obstacleVersion`、不改几何/lane/带算法。修后计数见 §4.2。
- 记录：见 [debug-log.md](./debug-log.md) BUG-006「修复与验证」。待用户验收。

### 5.2 未覆盖 / 未支持

| 项 | 状态 | 说明 |
|---|---|---|
| 其他 ComfyUI / 前端版本组合 | 未验证 | 只实测 0.43.2 + 1.55.18 |
| 节点折叠 | **已验证（2026-11-07 §4.5 S4）** | 折叠态无幽灵、verify ok；展开后几何指纹还原 |
| 复制 / 粘贴 | **已验证（2026-11-07 §4.5 S5）** | 粘贴 node-added 如实报告、无幽灵；删除粘贴件还原 |
| Cable Management / NKD Reroutes / Zip Ties / rgthree | 未做运行时验证（源码级见 §5.4） | 未安装到宿主，只有源码级冲突面判定 |
| 真实鼠标拖拽 | **已验证（2026-11-07 §4.5 S1–S3/S6）** | 真实 pointer 拖动 + 右键链路菜单（组删除/单删）；此前 BUG-002/003 的 `setPos` 限制在拖拽维度补齐 |
| `crossCleanup=true` 生命周期 | **已验证（2026-11-07 §4.5 S7）** | epoch 失效重算、删线无幽灵；清理保守拒绝路径（pairs-not-decreased）符合 DEC-017 |
| 子图内删线/折叠/粘贴、经典画布四类 | 未验证 | §4.5 仅覆盖根图 + Vue 节点模式 |
| 50/200/500 节点性能 | 已测（引用） | 见 [performance.md](./performance.md) §2026-11-07，不重测 |

### 5.3 待确认项

1. 视口裁剪：切换工作流 B 时 `routeCount=9`（缺 link 80）。已用探针判定为 **LiteGraph 只绘制视口内链路**：B 平移后 SaveImage 移出 1600×1000 视口；把视口平移后 `routeCount` 恢复 10。故不记为缺陷，但矩阵应注明「绘制范围受视口裁剪」。
2. 主干/等距带在链路增删后的恢复需要一次额外重绘（`setDirty`），属 LiteGraph 刷新时序；本次 BUG-006 修复未改动该时序，验证脚本显式触发重绘。

### 5.4 第三方扩展共存（源码级，「未做运行时验证」）

> 范围：Cable Management、NKD Reroutes、Zip Ties、rgthree。受 AGENTS.md 目标环境锁定约束，**未安装任何扩展、未改宿主依赖**；以下全部为源码级判定，四个扩展浅克隆在临时目录 `C:\Users\GigaByte\AppData\Local\Temp\luowen-coexist\`。例外事实：宿主 `custom_nodes\rgthree-comfy` 目录已存在，但 2026-11-07 运行中的服务未加载它（`/extensions` 无其前端资源、`/object_info/Reroute` 返回 `{}`），本轮未改动、也未借它做运行时验证。运行时验证方案见 [spec.md](../specs/third-party-coexistence/spec.md) §6，需用户批准后才可安装。

**我方钩子基线**：原型级 wrap `renderLink` + `drawConnections`（[renderLinkAdapter.js L1537-1547](file:///d:/Workspace/Code/Comfyui-Luowen/luowen/web/adapters/renderLinkAdapter.js#L1537-L1547)）；自绘成功后不回原函数（[L1399-1409](file:///d:/Workspace/Code/Comfyui-Luowen/luowen/web/adapters/renderLinkAdapter.js#L1399-L1409)）；磁吸为 DOM overlay `luowen-snap-overlay`（[dragSnap.js L16-20](file:///d:/Workspace/Code/Comfyui-Luowen/luowen/web/snap/dragSnap.js#L16-L20)）；组悬停菜单为 `LiteGraph.ContextMenu` 构造 Proxy（[L1205-1223](file:///d:/Workspace/Code/Comfyui-Luowen/luowen/web/adapters/renderLinkAdapter.js#L1205-L1223)）；`verify()` 快照已纳入 `extra`（排除宿主自有键）、`node.properties` 与节点坐标，坐标只报 `moved`、不判失败（[index.js L51-201](file:///d:/Workspace/Code/Comfyui-Luowen/luowen/web/index.js#L51-L201)）；本项为 2026-11-07 BUG-007 补丁，合成写入 A/B 通过，待验收。

| # | 冲突面 | 判定 | 依据（file:line / 官方文档） |
|---|---|---|---|
| C1 | renderLinkAdapter × Cable Management 端点替换 | 可能冲突 | `ledger.js:211-216` 在 `_renderAllLinkSegments` 替换 start/end；我方按收到的 a/b 规划，端点在 combs/ribbon 启用时跟随 |
| C2 | renderLinkAdapter × Cable Management `SUPPRESS` | 可能冲突 | `ledger.js:230` 被抑制链路该帧不进 renderLink；我方 `state.routes` 仅在拓扑指纹变化时清理（`renderLinkAdapter.js:996-1004`）→ 悬停可能命中不可见旧线 |
| C3 | renderLinkAdapter × Cable Management 路由引擎 | 可能冲突 | `pathing.js:90-113` 的 PCB 路由在 pathRenderer 内生效；我方自绘成功不回原函数（`renderLinkAdapter.js:1399-1409`），两套避障参数互斥 |
| C4 | 磁吸 overlay × Cable Management | 无交集 | `pathing.js` 无拖动或 overlay 接管；不监听节点拖动 |
| C5 | 组悬停菜单 × Cable Management | 无交集 | 源码 grep 无 `ContextMenu` 包装 |
| C6 | `verify()` × Cable Management 写 `extra` | 已补快照口径（待验收；运行时未验证） | `routestore.js:22-37`、`unpack.js:143` 写 `graph.extra`；`index.js` 已排除宿主键并做 extra/properties 键级比对（L51-102、L130-186）；合成写入 A/B 见 debug-log BUG-007 |
| N1 | renderLinkAdapter × NKD 路由引擎 | 确定冲突（语义重叠） | `rerouteSplines.js:686-730`、`:768-836` 接管 renderLink 与 pathRenderer；我方自绘线不进 NKD 渲染链，反之 native 模式我方不绘制，只能一套生效 |
| N2 | 磁吸 overlay × NKD Shift 磁吸 | 确定冲突（手势重叠） | `dragAdapter.js:545` 仅 Shift 启用、`:595-647` 实例级 `onDrawForeground` 画 guides、`:332-355` pointerup 后 `setTimeout(0)` 最终写位；我方 `dragSnap.js:345-350` 冒泡阶段 pointerup 同步写位 → 落点由 NKD 决定，提示线双份 |
| N3 | 组悬停菜单 × NKD | 无交集 | 源码 grep 无 `ContextMenu` 包装 |
| N4 | 数据面 × NKD | 无交集 | grep 无 `graph.extra` / `serialize` / `links.set`；仅用户拖动时写 `node.pos` |
| Z1 | renderLinkAdapter × Zip Ties 分段重绘 | 确定冲突 | `zip_ties.js:1100-1135` 按 tie 分段并多次调 `origRenderLink`；我方每段覆写 `link.path/_pos`（`renderLinkAdapter.js:1392-1396`）。Zip Ties 在外层 → 命中只剩最后一段；我方在外层 → 自绘直接返回，扎带对络纹线不生效 |
| Z2 | 磁吸 overlay × Zip Ties 手势 | 可能冲突 | `zip_ties.js:791-851` 在 window capture 阶段对 Z 键+pointerdown 执行 `preventDefault/stopImmediatePropagation`；我方事件为 window 冒泡（`dragSnap.js:345-350`） |
| Z3 | 组悬停菜单 × Zip Ties 右键 | 可能冲突 | `zip_ties.js:813-817`、`:825-831` tie 上右键抢先拦截；我方注入依赖 `ContextMenu` 构造（`renderLinkAdapter.js:1205-1223`） |
| Z4 | `verify()` × Zip Ties 写 `extra` | 已补快照口径（待验收；运行时未验证） | `zip_ties.js:11-12` 写 `graph.extra.zipTies`；`index.js` 已排除宿主键并做 extra/properties 键级比对（L51-102、L130-186）；合成写入 A/B 见 debug-log BUG-007 |
| R1 | renderLinkAdapter × rgthree | 无交集 | 源码 grep 无 `drawConnections` / `renderLink` / `_renderAllLinkSegments` patch；`utils.js:148-154` 的端点 patch 属消费方兼容 |
| R2 | 磁吸 overlay × rgthree | 无交集 | `rgthree.js:280-291` 仅记录鼠标事件 |
| R3 | 组悬停菜单 × rgthree `ContextMenu` | 可能冲突 | `menu_auto_nest.js:9-10` 把 `ContextMenu` 替换为普通函数、`:106-108` 改写 `menu.constructor`；我方用 Proxy + `Reflect.construct`（`renderLinkAdapter.js:1209-1219`），层叠顺序可致注入失效或构造异常 |
| R4 | 主干组 × rgthree 组标题按钮 / 组绘制 | 无交集 | `feature_group_fast_toggle.js:85-132` patch `drawGroups`；我方主干组是链路分组，不绘制 `LGraphGroup` |
| R5 | 数据面 × rgthree | 无交集 | `rgthree.js:274-279` 的 `serialize` patch 只记录副本，不改图数据 |

**缺口（未做运行时验证）**：

1. 实际安装顺序决定 renderLink / drawConnections / ContextMenu 的包装层叠，Z1、R3 的最终表现依赖该顺序。
2. C1/C2：Cable Management combs/ribbon 启用后的端点偏差与悬停命中未实测。
3. N1：双路由引擎同时启用是否出现单线双画、闪烁或参数静默失效未实测。
4. N2：Shift 拖动双磁吸的落点、提示线与 undo 条数未实测。
5. Z2/Z3：Z 手势与 tie 右键对我方拖动、链路菜单的实际拦截范围未实测。
6. C6/Z4：`verify()` 已补 `extra` 与 `node.properties` 键级比对（排除宿主自有键；坐标只报 `moved`），合成写入 A/B 通过；真实扩展写入的键名、时序与保存路径仍未运行时验证。
7. 未覆盖：两两/三三组合、经典画布与 Vue 模式分别表现、子图内表现。
8. rgthree 在宿主磁盘存在但未加载：未确认原因（Manager 禁用、启动时序或导入失败均可能），因此 R3（ContextMenu 层叠）当前无法直接运行时验证；排查加载原因属宿主配置操作，需另行批准。

> 结论口径：本节任何「无交集 / 可能冲突 / 确定冲突」均不得转写为「已兼容」；在完成运行时验证前，第三方冲突扩展在 §3.2 矩阵中保持「未支持 / 未验证」。

## 6. 复现入口

- 主脚本：`.verify/p3/suite.mjs`；只向 stdout 输出 JSON，需重定向到 `.verify/p3/suite-run-*.log` 后解析（`suite-out.json` 为旧会话遗留，已过期）。运行前宿主须在 8188 且页面可访问。
- 待办 2 四类验收：`.verify/p3/stage3-remaining.mjs`（§4.5；真实鼠标拖拽/右键菜单/折叠/粘贴/crossCleanup 生命周期；输出重定向后解析，截图 `s3r_*.png`；坐标换算用适配器反演式，见 §4.5 口径注记）。
- 修前对照：`.verify/p3/renderLinkAdapter-prefix.js`（HEAD 版），对应 `suite-run-prefix.log`；修后对应 `suite-run-fixed.log`、`suite-run-fixed2.log`。
- BUG-006 最小复现：`.verify/p3/probe16.mjs`（只删连线、节点全保留，10→9）、`probe19.mjs`（先删节点再删连线，8/8/8）。
- 回归数据探针：`probe20.mjs`（默认布局）、`probe21.mjs`（2B 布局降级记录）、`probe22.mjs`（默认布局修正字段）、`probe23.mjs`（历史 BUG-005 布局六项）、`probe24.mjs`（pivot=0 段四线/双线核对）。输出均在 `.verify/p3/probe*-run-20261107.log`。
- 视口裁剪探针：`.verify/p3/probe14.mjs`。
- 截图：`.verify/p3/` 下 `compat_01..05`、`life_01..08`、`ghost_hover.png`。
- 命令：`node .verify/p3/suite.mjs`（Playwright 全局包路径见脚本首行）。
- 暴露 API：`LuoWen.status()`、`LuoWen.routes()`、`LuoWen.verify()`、`LuoWen.rebase()`。

---

## 附：原始数据摘要（suite-run-prefix.log / suite-run-fixed.log / suite-run-fixed2.log）

- 所有步骤 `errors: []`；环境 `vueNodesMode=true`、`vueSettingRestored=true`、`thirdPartyNodes=[]`。
- `verify()` 在兼容性子图、样式、Vue/经典、加载、切换、撤销重做、删除重连、组、拖动、视口、清空各步骤均为 `{ok:true, diffs:[]}`。
- 主干基线：`62:0`、`merged=[79,81]`、`fork≈40`；切换 A/B 与清空恢复后保持一致。
- 等距带：基线 `bands=2`、`bandDegraded=0`、`orderDegraded=0`；拖动/子图步骤出现 `bands=3` 与 `bandDegraded=4`、`orderDegraded=4` 记录。修前/修后计数一致（4/4），非 BUG-006 修复引入；逐条归因见 §4.4：拖动为 65 输入带 `73/74` 在 `cross-pivot1-k4` 撞 k=4 后回退 `prev`，子图为转换新建链路 85/86 对 target 70 的 `cross-pivot1-k4`/`cross`，均为 DEC-028 显式降级、确定性可复现，不判为缺陷。
- 几何回归：单主干三通、远端双线 gap 8、输入侧四线、up/down 组镜像、撞上限冻结、含 Reroute 链六项数据见 §4.3。
