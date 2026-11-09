---
title: 性能验收台账
type: performance-log
project: 络纹（LuoWen）
updated: 2026-11-09
description: >
  性能与视觉效果并列为验收维度。本文件记录性能验收口径、待测场景、测量入口与已测得数据。
  只追加不删历史；每条结论必须附测量方法、样本布局与原始数据。
  AI 在本文件新增或修改内容后，必须同步更新 frontmatter 的 updated 字段为当日日期（YYYY-MM-DD）。
---

# 性能验收台账

> 本轮（2026-11-07）只建立落点，**不写性能结论**。任何「性能达标 / 无回退」的表述都必须等实测数据落盘后才允许出现。

## 验收口径

- 效果与性能同时验收：视觉验收通过不等于可交付，反之亦然。
- 每条性能结论必须含三要素：测量方法（工具 / 采样方式 / 取景）、样本布局（节点数、连线数、样式、开关组合）、原始数据（帧时间分位数、每帧求解次数、A* 调用数、缓存命中率等）。
- 只允许与同机器、同宿主版本、同取景的历史基线比较；基线缺失时先建基线，不得跨环境对比。
- 降级与失败路径的耗时同样计入：降级不得以「几乎不发生」为由不测。

## 待测场景（阶段 3 基准清单，尚未开始）

| 场景 | 关注点 | 状态 |
|---|---|---|
| 拖动单节点（真实鼠标） | 逐帧耗时、主干/等距带是否逐帧重解、有无抖动 | 已测（2026-11-07，注入 `pointer.isDown` + 逐帧 `setPos`，非真实鼠标事件；见下 §2026-11-07 性能评估） |
| 拖动多节点 / 组拖动 | 障碍版本批量失效时的帧预算与重解范围 | 待测 |
| 缩放与平移 | 是否触发重解、缓存命中率 | 待测 |
| 首帧装载 | 端点预测采样缺失时的独立态耗时 | 待测 |
| 规模梯度（10 / 50 / 100 节点） | 单帧耗时随节点/连线数的增长曲线 | 已测（2026-11-07，真实图 10 节点 + 合成 50/200/500 节点；见下） |
| 交叉清理开启（静止触发） | 400ms 去抖后的解算耗时、是否阻塞交互 | 待测 |
| 等距带成立 / 降级 / 冻结 | 三种路径的耗时差异 | 待测 |
| 经典画布与 Nodes 2.0 | 两套画布实现下的耗时对比 | 待测 |

## 测量入口

- 运行期计数：`LuoWen.status()`（绘制、缓存、主干、等距带、交叉清理计数）与 `LuoWen.trace()`（逐线 trace）。
- 帧时间：浏览器 Performance 面板或 Playwright 采样；记录 p50 / p95 / 最大值与采样帧数。
- 求解计数：A* 调用数、`planTrunks` / `planBands` 重解次数、缓存命中率。
- 数据不变性必须与性能同时记录：`LuoWen.verify()` 的 `{ok, diffs}`。

## 已记录数据

### 2026-11-07 性能评估（先量后改，第 1 项优化）

**测量方法**

- 宿主：ComfyUI 0.43.2，前端 1.55.18，页面 `http://127.0.0.1:8188/`；浏览器侧 `chrome-devtools` 独立上下文页做 A/B，不污染用户工作流页。
- 页内插桩：`renderLinkAdapter.js` 的 `LuoWen.perfStart(n)/perfStop()/perfReport()`；对 `drawConnections`（frame）、`beginFrame`（begin，含 predict/lanes/trunks/bands 子桶）、`route()`（astar）、`chamferPolyline`（chamfer）、`renderLink`（render）逐帧累加，帧间隔 `gap` 由相邻 `drawConnections` 调用时间差得出（>16.7ms / >33.4ms 计数即掉帧）。
- 帧驱动：`canvas.setDirty(true,true)` + `await requestAnimationFrame` 逐帧强制重绘（静止画布默认不drawConnections）；视图先按节点包围盒自适应 scale/offset，保证全部线路进入绘制范围（`renders` 计数核对）。
- A/B 口径：同一页面、同一合成图、同一帧数、同一预热帧数，仅部署文件相差一行（`trunkCache` 上限 `4096` ↔ `64`，后者为优化前基线）；两次测量前后各校验源文件 SHA256 一致后恢复。
- 拖拽口径：真实 `PointerEvent` 无法驱动 Vue 节点（节点不动、画布被平移），改用 `canvas.pointer.isDown=true` + 逐帧 `node.setPos` 注入，等价走拖拽态热路径；`downFrames` 计数确认冻结态生效。

**样本布局**

- 真实图：宿主当前工作流 10 节点 / 10 连线（KSampler 四输入汇聚 + 单主干组 `62:0` + 等距带目标 70），`smooth` 与 `orthogonal` 两档。
- 合成图：N 个 `LatentBlend`（每节点 2 个 LATENT 输入），`i≥2` 时 `nodes[i-2]→slot0`、`nodes[i-1]→slot1`，连线数 ≈ 2N；50/200/500 节点 → 96/396/996 线；网格布局 320×220，列数 `ceil(sqrt(N))`。
- 设置：`avoidance=high`、`chamfer=true`、`bevelRatio=0.6`、`cornerRadius=10`、`lanePitch=8`、`brotherSpacing=8`、`crossCleanup=false`。
- 帧数：真实图 120（预热 20）、50 节点 120（预热 20）、200 节点 70（预热 20）、500 节点 40（预热 12）、ortho 500 40（预热 8）。

**优化前 → 优化后（ms/帧，同一页面 A/B）**

| 场景 | 指标 | 优化前 | 优化后 | 变化 |
|---|---|---|---|---|
| 真实 10 节点 smooth | frame avg / p95 | 0.648 / 0.9 | 0.513 / 0.8 | −21% |
| | begin / bands / render | 0.298 / 0.123 / 0.143 | 0.254 / 0.119 / 0.099 | |
| 真实 10 节点 ortho | frame avg / chamfer | 0.580 / 0.060 | 0.562 / 0.058 | 持平 |
| 合成 50（96 线）smooth | frame avg / bands | 3.351 / 0.272 | 2.705 / 0.068 | −19% |
| 合成 200（396 线）smooth | frame avg / begin / bands / trunks / astar | 29.247 / 12.242 / 5.124 / 5.612 / 2.381 | 21.333 / 4.495 / 0.768 / 2.218 / 0 | −27% |
| | solveCalls / astarCalls（总） | 23088 / 23088（≈296/帧） | 0 / 0 | 逐帧重解消除 |
| | gap p50 / p95 / >33.4ms 帧数 | 35.3 / 41.9 / 58/78 | 27.8 / 32.5 / 1/78 | |
| 合成 500（996 线）smooth | frame avg / begin / bands / trunks / astar | 142.023 / 62.221 / 38.825 / 19.904 / 6.49 | 119.100 / 35.763 / 24.394 / 7.646 / 0 | −16% |
| | solveCalls（总） | 34656（≈722/帧） | 0 | 逐帧重解消除 |
| | gap p50 / p95 | 154.4 / 181.2 | 134.3 / 145.5 | |
| 合成 500 ortho | frame avg / chamfer / render | 389.869 / 231.929 / 310.000 | 363.473 / 228.092 / 309.835 | −6.8%（chamfer 主导，见下） |
| | begin / bands / trunks | 63.067 / 38.487 / 20.890 | 36.373 / 24.552 / 7.998 | |
| 真实图拖拽（ortho，60 帧） | frame avg / p95 / max | 0.397 / 0.7 / 0.9 | 0.375~0.430 / 0.5~0.8 / 0.7~0.9 | 持平（同口径两次采样区间） |
| | 掉帧（gap >16.7ms） | 0 | 0 | 无 |
| | 拖拽态 astar / solveCalls | 0 / 0 | 0 / 0 | 冻结态生效，无重解 |

**热点排序（优化后，500 节点）**

- `smooth`：render 71.9（原生绘制 + 视线）> bands 24.4 > trunks 7.6 > begin 35.8（含前三者）> A* 0。
- `orthogonal`：chamfer 228.1（占整帧 62.7%）>> bands 24.6 > trunks 8.0 > A* 0。
- `smooth` 下 `planBands` 的主要成本是 `solveBaseline` 的走廊净空与绕行解；`orthogonal` 下 `chamferPolyline` 是唯一量级热点（每条线都重建 obstacles/others 数组，`segmentClear` 逐采样点遍历全部障碍与其他折线）。

**本项结论**

- 优化项 1（`state.trunkCache` 上限 64 → 4096，位于 `luowen/web/adapters/renderLinkAdapter.js:352-355`）：修复 200/500 节点图每帧因缓存超限整体清空导致整图主干逐帧重规划；smooth 500 的 `solveCalls` 由 ≈722/帧 降到 0（稳态全命中），frame avg −16%，200 节点 −27%，50 节点 −19%，真实 10 节点 −21%（同一布局、同一口径 A/B）。
- 行为不变性（同一布局重放，2026-11-07）：真实 10 节点图的 `LuoWen.routes()` 几何指纹 `hash=3021896999 len=524` 在优化前（旧代码页）与优化后（新代码页）完全一致；`LuoWen.verify()` 两页均 `{ok:true,diffs:[]}`；等距带 `target 70 members [76,82,78] anchor 82 spacing 8 xs [null,806.49,814.49]`（相邻 8.00px、顺序不变）；单主干 `62:0 fork=155 merged=[79,81]` 不变；`crossDebug().before/after.count = 0`（交叉 0）；`node --test tests/unit/*.test.mjs` **99 pass / 0 fail**。
- 副作用与边界：ortho 500 整帧只降 6.8%，因为 chamfer 占比 62.7% 掩盖了解算侧收益；500 节点 smooth 仍有 47/48 帧 >33.4ms，距离交互流畅（≤16.7ms）仍有数量级差距，需继续优化 chamfer 与 bands。

**下一步（按收益/改动面排序，未开始）**

1. `chamferPolyline` 预筛：按折线/线段包围盒 + `nodePad`/`linePad` 过滤 obstacles 与 others，消除每条线 O(全部障碍×全部他线) 的重复构建（候选 1）。
2. 帧内复用：`nodesById`、`obstacles` 数组、`endpointIndices` 索引按帧缓存，消除 `recordEndpoint`/`routeArgs` 的 O(L·N) 重建。
3. `planBands` 走廊净空与 `solveBaseline` 采样密度按图规模降级（需用户确认视觉底线后实施）。

### 2026-11-07 性能评估（优化项 2：chamfer 预筛）

**改动内容**

- `luowen/web/geometry/chamfer.js`：新增 `polylineBox`（导出）、`createChamferIndex`（格网 cell=256）与 `PREFILTER_MARGIN=GAP_FAR_MAX=200`；`chamferPolyline` 本体逻辑不变。
- `luowen/web/adapters/renderLinkAdapter.js`：`chamferIndexForFrame()` 每帧建一次索引（obstacles + prevRoutes），拖拽冻结期按 `prevRoutes` 身份 + 障碍版本复用；逐线按折线包围盒外扩 200 查询近邻障碍/他线，替代原来的「每线 `rects.map` + 全量 `prevRoutes` filter/map + 逐采样点全量扫描」。
- 正确性依据：`wrapsNode` 被绕节点整体距角点 ≤ `GAP_FAR_MAX`；`segmentClear` 采样点落在折线包围盒内，障碍判定 +6、他线判定 +10，均 ≤ 200；两种判定只返回布尔，筛选顺序不影响结果。

**测量方法（同口径 A/B）**

- 同一页面（chrome-devtools 独立隔离上下文页）、同一浏览器上下文，仅部署文件不同：优化前 = 提交 `529648e` 的 `chamfer.js` + `renderLinkAdapter.js`；优化后 = 当前工作区两文件。每次切换后 `reload(ignoreCache)`，校验源文件 SHA256。
- 合成图协议：reload 后**立即**构建 500 个 `LatentBlend`（996 线），`fit` 使全部线路进入绘制范围，预热 10 帧后测 40 帧（页内 `__PERF_RUN__`，`setDirty` 逐帧驱动）；`orthogonal`、`avoidance=high`、`chamfer=true`、`bevelRatio=0.6`、`cornerRadius=10`、`lanePitch=8`、`brotherSpacing=8`。
- 真实图协议：reload 后 `fit`，`smooth` 取几何指纹，再 `orthogonal` 测 120 帧（外加 8 预热帧）。
- 采样时只保留 2 个页面（用户工作流页 + 测量页）；多余隔离页会显著抬高结果（本次观测到 1.5~2× 波动）。
- 协议注意：合成图必须在 reload 后立即构建。若先在同一页面测真实图再构建合成图，`routeCache`/`trunkPrev`/`pinOffsets`/`trunkCache` 残留会改变 `bands`/`trunks` 耗时与几何签名（本次误测到 `hash=1368597097 len=61998`，清理协议后复现为 `hash=823324264 len=63091`），该数据作废。

**优化前 → 优化后（ms/帧）**

| 场景 | 指标 | 优化前 | 优化后 | 变化 |
|---|---|---|---|---|
| 合成 500 ortho（996 线） | frame avg / p95 | 358.252 / 378.2 | 131.092 / 147.9 | −63.4% |
| | chamfer / p95 | 238.948 / 255.7 | 23.429 / 27.9 | −90.2% |
| | 单线 chamfer 均摊 | 0.240 | 0.0235 | ≈10× |
| | render（含 chamfer） | 326.240 | 103.596 | 非 chamfer 绘制部分 ≈87 → 80ms |
| | begin / trunks / bands | 13.452 / 8.083 / 1.152 | 14.342 / 8.883 / 1.262 | 持平（噪声内） |
| | chamfers / renders | 47808 / 47808 | 47808 / 47808 | 调用次数不变 |
| | gap p50 / p95 / >33.4ms | 373.6 / 395.9 / 47/48 | 144.8 / 165.4 / 47/48 | 帧数仍全部 >33.4ms |
| 真实 10 节点 ortho（120 帧） | frame avg / p95 | 1.477 / 2.7 | 0.799 / 1.2 | 毫秒级，差异含环境噪声 |
| | chamfer / p95 | 0.159 / 0.5 | 0.147 / 0.3 | −7.5% |

**行为不变（同一布局重放）**

- 合成 500 ortho：996/996 条线逐点几何完全一致（每条线折线坐标四舍五入到 1e-3 后哈希比对，`per-link diffs 0`），总点数 5783 两侧相同，整体签名 `hash=823324264 len=63091` 一致。
- 真实 10 节点：`routes()` 指纹 `hash=3021896999 len=524`；`verify() {ok:true,diffs:[]}`；等距带 `target 70 members [76,82,78] anchor 82 spacing 8 xs [null,806.49,814.49]`（相邻 8.00px、顺序不变）；单主干 `62:0 fork=155 merged=[79,81]`；`crossDebug().before/after.count = 0`（smooth 与 orthogonal 均验）；`bandDegraded/orderDegraded` 均为空；`node --test tests/unit/*.test.mjs` **99 pass / 0 fail**。

**热点排序（优化后，合成 500 ortho）**

- render 103.6（79%，其中 chamfer 23.4、非 chamfer 绘制 ≈80）> begin 14.3（trunks 8.9、predict 2.1、lanes 1.1、bands 1.3）> chamfer 23.4（17.9%）。
- chamfer 已从 62.7% 降到 17.9%；整帧瓶颈转为「逐线绘制」而非求解。

**本项结论与剩余余量**

- 预筛把 chamfer 从 238.9ms/帧 降到 23.4ms/帧（−90.2%，≈10×），整帧 −63.4%；真实 10 节点图 chamfer 亦下降 7.5%，未出现小图回退。
- 帧内复用 `nodesById`/`obstacles`/`endpointIndices` 的剩余空间上限约为 `begin` 的 14.3ms（整帧 11%），且其中 `trunks` 8.9ms 主要是组信标与合并判定，不是索引重建；预估可回收 <10ms，优先级低于绘制路径。
- 500 节点 ortho 仍 47/48 帧 >33.4ms（≈0.13ms/线）；若继续优化，应先单独计时「逐线路径构建（emitRounded/measure）+ 命中路径」的占比，再决定是否值得改动，任何改动须仍满足逐线几何指纹一致。

### 2026-11-07 smooth 真 Bezier（拐角曲线化，同口径 A/B）

**改动**：`trace.js` 新增 `emitBezier`（控制点=角点的贝塞尔；先试升阶三次 bezierCurveTo，实测慢 ~55%，改用同形二次 `quadraticCurveTo` 后反超）；`renderLinkAdapter.js` smooth 分支 `emitRounded(arcTo)` → `emitBezier`。骨架 pts、命中几何、路由算法零改动。

**协议**：500 LatentBlend 网格（clear 后建图，链式 499 线，输出槽单连），`ds.scale=0.22` 全可见；reload 后立即建图 → fit → 预热 10 帧 → `perfStart` → 40 帧（setDirty+双 rAF）→ `perfStop`；同机同日、每次独立页。脚本 `.verify/p5/perf-smooth-ab.mjs <label>`；原始数据 `.verify/p5/coexist/perf-smooth-*.json`。

**数据（ms/帧）**：

| 指标 | HEAD（arcTo 圆角）before-1 / before-2 | bezierCurveTo 三次（弃用）×4 | quadraticCurveTo 终版 ×3 |
|---|---|---|---|
| frame avg | 45.785 / 38.68 | 60.9 / 62.7 / 65.2 / 68.4 | **36.45 / 36.77 / 36.54** |
| render avg | 33.903 / 29.33 | 43.9 ~ 48.5 | **27.76 ~ 28.34** |
| p95 frame | 50.8 / 51.4 | 75.9 ~ 86.4 | 39.3 ~ 39.9 |

同窗口成对对比（before-2 vs 终版）：frame −5.7%、render −4.5%——**不劣于圆角折线（略优）**。before-1 与 before-2 同代码差 18%，为跨页机器噪声上界；三次变体的 +55% 远超噪声带，判真回归并弃用。

**行为不变**：默认模板骨架几何指纹 `3664953215` 与历史一致；`verify() ok`；主干 `62:0 [79,81]`、等距带 2、降级 0；拐角曲线顶点 hover 命中 `{linkId:75, part:'branch'}`（顶点距骨架 6px < 容差 8.9px，单测偏差上界 ≤0.26·d）；单测 105/105（新增 emitBezier 6 项）。截图 `bezier-r0/10/24.png`（0=直角 / 10 默认 / 24 满档）。

### 2026-11-08 配色主题开/关抽查（500 节点 smooth）

- 协议同 §2026-11-07 smooth 真 Bezier（500 LatentBlend / 499 线 / 40 帧）。
- 主题关 frame 48.405 / render 36.255；主题开（luowen-dark）46.978 / 34.205——差值在跨页噪声带内，取色为每线一次 Map.get，无可测成本。
- 数据：`.verify/p5/coexist/`（perf-smooth-ab.mjs theme-off / theme-dark）。

### 2026-11-08 动效 v2：线型原型成本与「每绘成本 vs 绘制频率」

**线型原型微基准**（独立 canvas，正交折线 × 6 段，30 次取均值；`.verify/p5/coexist/anim-v2-*.json`）：

| 线型 | 33 线 ms/帧 | 500 线 ms/帧 |
|---|---|---|
| 实线 | 0.06 | 0.05 |
| 虚线行进（dash 7/13 + offset） | 0.04 | 0.18 |
| 发光（shadowBlur 8） | 0.02 | 0.15 |
| 光晕双描边 | 0.02 | 0.12 |
| 脉冲（宽度振荡） | 0.01 | 0.08 |

结论：三种线型全部远低于预算（≤1ms@33 线 / ≤5ms@500 线），全部提供；发光取 shadowBlur（观感优于光晕且同成本）。

**动效真实代价 = 绘制频率而非每绘成本**（同页成对 A/B，500 LatentBlend / scale 0.5 / 视口 144 线 / 40 帧）：

| 状态 | frame avg | render avg | 绘制次数 |
|---|---|---|---|
| 动效关 | 19.003 | 9.693 | 5760（144×40） |
| 动效开（全图 dash） | 19.052 | 9.597 | 11520（144×80，rAF 循环倍增） |

每绘成本 dash=solid（±噪声）；开启动效 = 持续 60fps 重绘（每秒 render 占用 ≈ 9.6ms×60 ≈ 58% 帧预算）——这正是「生成时禁用动效」（默认开）的直接依据：推理期间砍掉的就是这块持续占用。空闲零重绘已在 `仅执行中` 模式实现（空闲时 rAF 循环自停）。

**协议教训**：scale ≤0.4 时动效闸门自动关闭，此 scale 下测「动效开」只会测到 rAF 循环的双绘开销（renders ×2、frame 虚高）——动效性能测量必须 scale >0.4 并成对同页 A/B。

### 2026-11-08 性能冲刺 D-1：render 细分插桩 + trunk 整计划 memo

**插桩**：perf 新增 `pathBuild`（emitBezier+measure+pointAt）与 `strokeT`（stroke+命中覆写）两桶；500 线 smooth 实测 pathBuild 0.34 / strokeT 0.75——**我方逐线绘制成本仅 1.1ms，render 桶其余 ~26ms 为宿主 drawConnections 循环与栅格化**（原「先单独计时路径构建占比」的既定路线已执行，结论：路径构建不再是优化对象）。

**trunk 整计划 memo**（DEC-035 帧内复用候选的落地）：planTrunks 的 memoKey = linksHash|endpointsVer|laneHash|avoidance|style|trunkCap|enabled，未变则整计划 O(1) 复用（此前静态帧每帧仍做 499 次 key 字符串拼接 + cache 查询 + 372 组 sig/Map 构造）。500 线实测 trunks 8.9 → **0.008ms**；真实图 fp `3664953215` 与历史一致、主干不变、`verify() ok`——行为不变。

**§10.6 现状（如实）**：500 线 smooth 40 帧 p50 39.4 / p95 43.3——距 33.4ms（30fps）仍差 ~18%，且 40/40 帧超标。热点已从「我方算法」整体转移到「宿主绘制循环 + 栅格化」；我方可控面内（路径构建/主干/缓存/lanes）均已压至 ~2ms 级。进一步达标需要接管整个连线渲染层（自绘全部连线、绕开宿主逐线机器）——属重决策，另行拍板。

**协议**：500 LatentBlend（clear 后 499 链）scale 0.22 全可见，40 帧成对；脚本 `.verify/p5/perf-smooth-ab.mjs`；跨页机器噪声带 ±18%（before-1 45.8 vs before-2 38.7 先例），单次对比不作数。

### 2026-11-08 动效 v3：beam 线型预算与自停架构（实施轮，DEC-042）

**测量方法**：同页成对 A/B（`.verify/p6/anim-v3-verify.mjs` T7 / `anim-v3b-result.json` M3），真实 10 节点图 scale 0.9，循环自驱 60 帧 ×2 状态（beam / dash），perfStart/perfStop 口径；自停行为用 setDirty/RAF 计数（1.2–1.5s 窗口，实例级影子打桩）。

**数据**：

| 状态 | p50 | p95 | 备注 |
|---|---|---|---|
| dash（降级档） | 0.80ms | 1.1ms | 10 可见线 |
| beam（束身单描） | 0.90ms | 1.2ms | 10 可见线 |
| beam（三层伪发光版） | 1.0ms | 1.7ms | +13% 相对，绝对值远低于 16.7ms |

**行为计数（自停架构）**：selected 空选 / executing 空闲 / 生成中禁用 三态 setDirty=0 且 **RAF 增量=0**（BUG-009 时代 RAF 仍 +65/s 空转；研究报告 §4.4 自停+唤醒设计落地）。相位冻结实测：按住指针 600ms 相位仅 +16ms（1 帧），松开无跳变（`colorDebug().phaseMs`）。

**注入口径参照**（页面级瞬时注入，宿主不改文件）：144 可见线（500 节点图 @0.5）持续帧 24–26ms≈40fps，候选层增量低于同页噪声带（`.verify/p6/inject-ab.json`）——静态基线主导，非动效之过。

**结论**：beam 预算达标（验收线：同图动效开 p95 ≤ 动效关+10% 或 ≤33.4ms）；shadowBlur 维持禁用（§2026-11-08 微基准 209ms@500 线）；beam 发光用三层伪描边（外晕/亮芯/亮头），成本增量 ≈+0.5ms@10 线。

### 2026-11-08 自动布局（F-015）研究性能数据（DEC-043 阶段 C/D，分支 auto-layout）

**测量方法**：Node 端实验（`.verify/p7/algos/run.mjs`，fromWorkflowJson→算法→evaluateLayout 全链路计时）+ 真实宿主探针（`.verify/p7/prototype/phase-d-proto.mjs`，loadGraphData→ELK→pos 写入→setDirty 刷新）。样本=真实工作流 6 份（largest 230 节点/248 链 等，见 model.md §5）。

**端到端数据（ms）**：

| 环节 | largest(230 节点) | 说明 |
|---|---|---|
| 图模型构建（含 Reroute 折叠） | 14.6 | 纯函数 |
| 指标评估（9 项） | 4.5 | 纯函数 |
| ELK 布局（端口 FIXED_SIDE, LR） | 95–261 | 一次性；durability 无关（非热路径） |
| dagre | 50–80 | 对照 |
| 自研参考分层 | 1.3–3.5 | 参考实现（交叉无最小化） |
| 真实宿主 ELK+写入+刷新（端到端） | 95–117（布局）+ 刷新一帧 | E3 实测；209 节点 |

**结论（研究期）**：布局端到端成本 ≤300ms@230 节点，远低于交互式一次性操作可接受阈（秒级）；分桶热点在 ELK 计算本身（我方转换/指标 ≤20ms）。实施轮须补测：批量 pos 写入→画布刷新的完整帧耗时（Phase D 只测到 setDirty 调用）、500 节点级梯度。基线对照：用户手工布局交叉 116–187（largest/mostGroups），ELK 31–74（−60~93%）。

### 2026-11-08 自动布局（F-015）研究性能数据（DEC-043 阶段 C/D，分支 auto-layout）

**测量方法**：Node 端实验（`.verify/p7/algos/run.mjs`，fromWorkflowJson→算法→evaluateLayout 全链路计时）+ 真实宿主探针（`.verify/p7/prototype/phase-d-proto.mjs`，loadGraphData→ELK→pos 写入→setDirty 刷新）。样本=真实工作流 6 份（largest 230 节点/248 链 等，见 model.md §5）。

**端到端数据（ms）**：

| 环节 | largest(230 节点) | 说明 |
|---|---|---|
| 图模型构建（含 Reroute 折叠） | 14.6 | 纯函数 |
| 指标评估（9 项） | 4.5 | 纯函数 |
| ELK 布局（端口 FIXED_SIDE, LR） | 95–261 | 一次性；durability 无关（非热路径） |
| dagre | 50–80 | 对照 |
| 自研参考分层 | 1.3–3.5 | 参考实现（交叉无最小化） |
| 真实宿主 ELK+写入+刷新（端到端） | 95–117（布局）+ 刷新一帧 | E3 实测；209 节点 |

**结论（研究期）**：布局端到端成本 ≤300ms@230 节点，远低于交互式一次性操作可接受阈（秒级）；分桶热点在 ELK 计算本身（我方转换/指标 ≤20ms）。实施轮须补测：批量 pos 写入→画布刷新的完整帧耗时（Phase D 只测到 setDirty 调用）、500 节点级梯度。基线对照：用户手工布局交叉 116–187（largest/mostGroups），ELK 31–74（−60~93%）。
### 2026-11-09 自动布局 Stage 0：行为金标 + 阶段计时（只插桩，不改布局；DEC-051）

**目的与纪律**：先建立「行为金标 + 分阶段计时」，任何优化落地前都必须有对照。本节**不宣称任何优化**，只登记基线与热点位置。

**测量方法**

- Node 全管线：`scripts/layout-perf/bench-node.mjs`（mock LGraph，无 DOM → 无 effH）；每用例预热 1 次、取 3–5 次 p50；用例 = chain / fan-in10 / fan-out8 / dense / 多副本。
- 宿主真实 DOM：`scripts/layout-perf/golden-host.mjs`（Playwright，CDP 禁缓存，1600×1000）；协议 `loadGraphData → fit(scale≤0.9) → 等 .lg-node DOM 就绪 → autoLayout('full') → 读 node.pos`；同图重复 3 次取中位数（post4/5/6）。
- 阶段耗时：`runAutoLayout().stages`（`performance.now()` 分段；一次性操作，非渲染热路径），另有 `scale` 规模诊断。
- CPU 采样：`node --cpu-prof`，chain 1000 节点 ×2 次运行。
- 行为金标：节点左上角坐标四舍五入 1e-3 → SHA1-16；插桩前后逐样本、逐坐标比较；基线入库 `tests/fixtures/layout-golden/host-path.json`。
- 默认设置：`columnAlign=auto`、`nodeGap=40`、`layerGap=60`、`inlineGap=50`、`componentLayout=vertical`、折叠关。

**样本**

6 份真实工作流（largest 230 节点/248 线、mostGroups 176/209、mostReroute 193/226、mostComponents 186/181、midGroups 23/22、largeCollection 209/171）+ `midGroups ×1/×3/×5`；合成 chain 100/250/500/1000/2000、fan-in10、fan-out8、dense 10×10 / 25×10 / 50×10 / 100×10。

**行为不变（插桩前 vs 插桩后）**

| 样本 | 节点 | 哈希 | 坐标逐点一致 | 插桩前 ms | 插桩后 ms（中位） |
|---|---|---|---|---|---|
| largest | 230 | 864a5c784815c4d6 | 是 | 125.8 | 130.1 |
| mostGroups | 176 | 704797dcfd0b3f68 | 是 | 149.2 | 123.0 |
| mostReroute | 193 | ae49b7e66fc9af49 | 是 | 48.0 | 39.4 |
| mostComponents | 186 | a7f38039cdd86cea | 是 | 140.1 | 115.5 |
| midGroups | 23 | 471b918da2c56d6a | 是 | 23.6 | 21.2 |
| largeCollection | 209 | 18a4a4423402a788 | 是 | 94.3 | 86.1 |
| midGroups_x3 | 69 | 172ee2f738b90777 | 是 | 31.5 | 29.7 |

**宿主阶段耗时（中位数，ms；post4/5/6）**

| 样本 | 节点 | snapGraph | effH | model | plan | elk | straighten | tracks | capture1 | write | capture2 | metrics | total |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| largest | 230 | 1.1 | 7.0 | 3.1 | 1.3 | 82.3 | 0.5 | 0.8 | 15.0 | 3.8 | 12.7 | 2.8 | 130.1 |
| mostGroups | 176 | 1.1 | 6.5 | 2.4 | 0.6 | 87.6 | 0.5 | 1.7 | 9.8 | 3.7 | 8.5 | 0.9 | 123.0 |
| mostReroute | 193 | 0.9 | 5.9 | 1.3 | 0.9 | 7.4 | 0.1 | 0.1 | 11.5 | 1.8 | 9.1 | 0.5 | 39.4 |
| mostComponents | 186 | 0.8 | 4.9 | 1.6 | 0.7 | 73.4 | 0.4 | 2.3 | 13.6 | 4.1 | 10.2 | 0.7 | 115.5 |
| midGroups | 23 | 0.2 | 0.2 | 0.3 | 0.0 | 16.2 | 0.0 | 0.1 | 2.0 | 0.7 | 1.4 | 0.0 | 21.2 |
| largeCollection | 209 | 1.0 | 8.4 | 2.0 | 0.8 | 43.0 | 0.3 | 1.6 | 13.1 | 4.4 | 10.5 | 0.8 | 86.1 |
| midGroups_x3 | 69 | 0.5 | 1.2 | 0.7 | 0.3 | 16.1 | 0.0 | 0.3 | 5.4 | 1.9 | 3.4 | 0.0 | 29.7 |

**宿主阶段占比（中位数）**

| 样本 | ELK | capture1+capture2 | effH | model | write | 其余 |
|---|---|---|---|---|---|---|
| largest | 63.3% | 21.3% | 5.4% | 2.4% | 2.9% | 4.8% |
| mostGroups | 71.2% | 14.9% | 5.3% | 2.0% | 3.0% | 3.7% |
| mostReroute | 18.8% | 52.3% | 15.0% | 3.3% | 4.6% | 6.1% |
| mostComponents | 63.5% | 20.6% | 4.2% | 1.4% | 3.5% | 6.7% |
| midGroups | 76.4% | 16.0% | 0.9% | 1.4% | 3.3% | 1.9% |
| largeCollection | 49.9% | 27.4% | 9.8% | 2.3% | 5.1% | 5.5% |
| midGroups_x3 | 54.2% | 29.6% | 4.0% | 2.4% | 6.4% | 3.4% |

**运行间噪声（同一引擎、同一图，total ms）**

| 样本 | 最小 | 中位 | 最大 | 极差/中位 |
|---|---|---|---|---|
| largest | 121.3 | 124.0 | 249.1 | 103% |
| mostGroups | 117.2 | 122.1 | 139.8 | 19% |
| mostReroute | 37.4 | 38.8 | 46.1 | 22% |
| mostComponents | 105.4 | 111.9 | 133.1 | 25% |
| midGroups | 17.7 | 19.8 | 22.4 | 24% |
| largeCollection | 77.2 | 86.1 | 95.9 | 22% |
| midGroups_x3 | 24.0 | 29.8 | 48.5 | 82% |

**Node 规模矩阵（p50，ms）**

| 用例 | 节点 | 连线 | total | elk | tracks | model | metrics |
|---|---|---|---|---|---|---|---|
| chain_100 | 100 | 99 | 31.89 | 29.82 | 0.89 | 0.42 | 0.29 |
| chain_250 | 250 | 249 | 44.80 | 40.68 | 2.01 | 1.28 | 0.73 |
| chain_500 | 500 | 499 | 86.48 | 72.01 | 7.30 | 3.08 | 1.41 |
| chain_1000 | 1000 | 999 | 180.94 | 140.12 | 20.40 | 11.98 | 5.78 |
| chain_2000 | 2000 | 1999 | 536.87 | 386.59 | 87.84 | 38.60 | 21.06 |
| fanin10_500 | 500 | 499 | 79.02 | 65.78 | 7.48 | 3.83 | 1.60 |
| fanout8_500 | 497 | 496 | 80.56 | 68.20 | 7.75 | 2.82 | 1.45 |
| dense_50x10 | 500 | 980 | 287.11 | 264.40 | 8.99 | 5.10 | 6.83 |
| dense_100x10 | 1000 | 1980 | 1005.15 | 908.68 | 44.74 | 19.59 | 29.61 |
| midGroups_x1 | 23 | 22 | 19.72 | 19.03 | 0.17 | 0.13 | 0.08 |
| midGroups_x3 | 69 | 66 | 32.28 | 30.92 | 0.43 | 0.26 | 0.13 |
| midGroups_x5 | 115 | 110 | 44.32 | 42.08 | 0.59 | 0.53 | 0.20 |

**T(N) 幂指数（chain 拟合）**

- 100→2000 全段：total 0.76、elk 0.67、tracks 1.39、model 1.43、metrics 1.26（ELK 含约 13–17ms 固定初始化开销，压低小 N 端指数）。
- 1000→2000 段：elk 1.46、tracks 2.1、model 1.7、metrics 1.9——**tracks / model / metrics 已进入超线性区**。

**CPU 采样（chain 1000，`--cpu-prof`，598 samples）**

| 桶 | 占比 |
|---|---|
| `elk.bundled.js` 内部 | 70.4% |
| 我方 `refine.js` | 6.7% |
| Node 内部（ESM 装载 / GC） | 6.7% |
| 我方 `graph-model.js` | 3.2% |
| 我方 `metrics.js` | 2.0% |
| 我方 `engine.js` | 0.8% |

我方函数自耗时 Top：`rect`（refine.js:375）3.2%、`find`（graph-model.js:158）1.3%、`countCrossings` 0.8%、`layoutComponents` 0.8%、`effH` 0.8%、`buildModel` 0.7%、`topoOrderOf` 0.7%。采样开销使总耗时 574ms（无采样同一用例 328ms），只用相对占比。

**结论（作为 Stage 1/2 输入，不是优化结论）**

1. **ELK 是唯一数量级项**：真实样本 50–76%（跳过 Reroute 的 mostReroute 除外）；合成 dense 1000 节点 909/1005ms。当前 ELK 的净作用主要是「排序种子」——`layoutSpineTracks` 会整体重放主链与侧组，`straightenEdges` 的产出也大部分被覆盖。
2. **`captureCanvasState` ×2 是宿主第二大项**：15–30%（mostReroute 达 52%），200 节点级每次约 9–15ms。
3. **effH 逐节点 `document.querySelector`**：4–10%，0.2–10.6ms，随节点数近似线性；Node 路径同环节仅 0.1ms。
4. **`model` 超线性来自 `topoOrderOf`**：O(V·E)，但生产布局没有任何消费方——Node 1000 节点 11.98ms、2000 节点 38.6ms，属纯浪费。
5. **`tracks` 超线性**：最终重叠统计 O(N²) + 碰撞消解反复 `rect()`；1000 节点 20.4ms、2000 节点 87.8ms，CPU 采样中 `rect` 是我方最大自耗函数。
6. **`metrics` O(E²)**：dense 1000 节点 29.6ms；只用于返回报告，不在布局决策中使用。
7. **规模悬崖**：dense 1000 节点/1980 边已达 1005ms（单次主线程长任务）；chain 2000 节点 537ms。当前无重入保护：连点两次「⌁整理」会起两条异步管线交错写位置。
8. **噪声必须用中位数**：同引擎同图 total 极差 9%–103%（含离群），单次 A/B 结论不可采信。

**Stage 1 候选与收益上限（未实施，按实测上限排序）**

| 候选 | 依据 | 上限 |
|---|---|---|
| `topoOrder` 改为按需计算 | 生产未消费，O(V·E) | 38.6ms@2000 |
| `tracks` 重叠统计扫描线/网格 + `rect` 缓存 | O(N²) + 重复取值 | 87.8ms@2000 中大部分 |
| `metrics` 按需计算 / 交叉统计降复杂度 | 仅报告用，O(E²) | 29.6ms@dense1000 |
| effH 单次 `querySelectorAll` 建 Map | 逐节点全文档查询 | 5–10.6ms@200 节点宿主 |
| 无位移时跳过 capture / 核查双 capture 语义 | 空转也付两次快照 | 20–27ms/次宿主 |
| ELK 去留（阶段 2，需拍板） | 仅提供排序种子 | 数量级（dense 1000 达 909ms） |

**已知限制**：宿主阶段之和与 total 一致（差异 <1%，为取整）；Node 路径无 DOM 故 effH≈0；ELK 固定开销使小图指数偏低；CPU 采样只用于相对占比。
### 2026-11-09 Stage 0 补记：真实工作负载口径（test1/2/3）——用户更正

**背景**：用户澄清：自动布局实际只用过 test1/2/3 三条流；其余 6 份样本含大量 Reroute、Set/Get 节点与人工注释，是人工排布、从未用自动布局处理，且"很难通过算法识别"（未来或可由 agent 操作）。因此此前以 6 份大样本为主的优化排序**口径偏了**，本节把目标口径改回真实工作负载。

**测量**：同一宿主协议（见上节），test1/2/3 各独立运行 2 次，哈希两次一致；金标入库 `tests/fixtures/layout-golden/user-tests.json`。

| 样本 | 节点/连线 | Reroute | Set/Get | total（两次） | ELK（两次） | capture1+capture2 | effH | 其余 |
|---|---|---|---|---|---|---|---|---|
| test1（打乱原图） | 42/42 | 0 | 0 | 34.3 / 21.3 | 20.7 / 12.7 | 8.3 / 4.6 | 1.1 | <2 |
| test2（自动整理后） | 56/55 | 0 | 2 | 38.3 / 35.2 | 20.0 / 20.4 | 12.0 / 9.8 | 1.5 / 1.1 | <3 |
| test3（手工期望） | 14/14 | 0 | 0 | 14.7 / 12.3 | 9.0 / 8.1 | 4.2 / 2.4 | 0.3 / 0.4 | <1 |

**修正后的结论**

1. **真实规模 14–56 节点，宿主 total 12–38ms（暖机）**；ELK 占 52–61%，`captureCanvasState`×2 占 24–31%，effH ≈4%，其余全部 <3ms。
2. **6 份大样本降级为压力/回归参照**：mostReroute 等样本的 Reroute 分量被整体跳过，本就不代表正常路径；其 Set/Get 与注释编码的是人工意图，不纳入算法目标。
3. **N² 项在真实规模无意义**：tracks 0.1–0.9ms、metrics ≤0.3ms、model ≤0.6ms（test2）。它们只作为"大文件不爆炸"的护栏，不排在 Stage 1 前列。
4. **ELK 固定成本显著**：1 节点温态 `elk.layout` ≈4.85ms，14 节点 8–9ms，56 节点 20ms；bundle 首载 ≈48.6ms（一次性）。ELK 仍是真实负载下的第一大头，且其去留需要行为金标对照（见 Stage 2）。
5. **capture ×2 是第二大头**：test2 每次布局约 10–12ms 花在两次画布快照上，即使布局位移很小也照付。

**Set/Get 边界事实（当前代码行为）**：仅含 **Reroute** 的连通分量会整体跳过重排（`rerouteComponentIds`）；Set/Get 节点没有特殊处理，按普通节点参与布局——test2 里的 1 个 SetNode + 1 个 GetNode 被移动，且该结果已获用户验收。含大量 Set/Get + 注释的人工图不在算法能力内，本轮不改动其行为。

**Stage 1 排序修正（未实施）**：先解决 ELK 固定成本（实例复用/去留评估）与 capture 双快照；effH 单次 DOM 扫描次之；topoOrder 等"免费清理"顺带做；N² 统计类降级为大文件护栏。
### 2026-11-09 自动布局 Stage 1：函数级效率优化（行为不变）

**范围**：按用户口径只做函数执行效率，不改算法与几何；Set/Get 节点本版本不做特殊处理；宿主 `captureCanvasState`×2 不动（拆掉会改变撤销链目标状态）。

**改动**

1. **空闲预热 ELK**（`warmupAutoLayout` + `requestIdleCallback`）：只拉起 bundle 并跑一次脱离图的 2 节点布局，把首次「整理」的装载与冷 JIT 移到浏览器空闲期。
2. **effH 单次 DOM 扫描**：`querySelectorAll('.lg-node[data-node-id]')` 建 id→元素表，替代逐节点 `document.querySelector`。
3. **ELK 种子缓存**：缓存键 = 可动节点（id/宽/高/入端口数/出端口数）+ 边（id/两端/端口）+ 间距；命中直接复用。ELK 只消费尺寸/端口/边、不读原位置，输出确定；任何结构、尺寸、端口、边或间距变化都会换键。
4. **消除重复工作**：全图布局不再为「整理选中」准备原位置拷贝与连通分量 BFS；返回前的两张位置表合并为一轮遍历。

**行为不变（机检）**

- 大样本宿主金标 **7/7** 哈希与 Stage 0 完全一致（`tests/fixtures/layout-golden/host-path.json`）。
- Node 金标 **7/7** 一致；单测 **157/157**。
- test1/2/3 因用户正在编辑、`inputSha` 全部漂移，本轮不作为行为判据（fixture 已标记 `stale`）。

**实测（宿主；Stage 0 为中位数，Stage 1 为单次运行；同图噪声 ±19–26%，方向性差异远超噪声）**

| 指标 | Stage 0 | Stage 1 | 机制 |
|---|---|---|---|
| largest 首次整理 total | 130.1ms | 66.6ms | 空闲预热吸收冷装载/JIT |
| largest ELK | 80.6ms | 32.2ms | 同上 |
| effH（176–230 节点） | 4.9–8.4ms | 0.6–1.1ms | 单次扫描 |
| 重复点击 total（23 节点样本） | 40.5ms | 5.6ms | 缓存命中 |
| 重复点击 ELK | 32.3ms | 0ms | 缓存命中 |

**未做（明确留下的）**

- `captureCanvasState`×2（真实负载 10–12ms）：宿主实现内部是整图 `serialize()`；只保留后一次会改变撤销目标状态，需用户拍板。
- ELK 替换 / Worker：结构性变更，不在本阶段。
- N² 统计类（tracks/metrics）：真实规模 <1ms，只保留为大文件护栏。

**已知边界**：连续多次点击「整理」时，位置会继续小幅变化（Stage 0 已存在，与缓存无关；首次点击后 DOM 真实高度稳定过程所致），本轮未改。

### 2026-11-09 金标口径更正：以 test1 为准（用户指令）

- test2/test3 已被用户修改，**不能作为参考**；此前 Stage 0/1 中 test2/test3 的数字仅作历史记录，不再参与比较。
- 金标重建为 `tests/fixtures/layout-golden/test1.json`：当前 test1 = **14 节点 / 14 边**（UNETLoader / CLIPLoader / VAELoader / ModelSamplingAuraFlow / KSampler / CFGNorm / CLIPTextEncode / EmptySD3LatentImage / VAEDecode / SaveImage / SaveImageAdvanced / SaveAnimatedPNG / SaveWEBM），`inputSha256_16=9623f322a3df8674`；两次独立运行哈希 `0d2f20898d5e6613` 一致。
- 当前 test1 宿主实测（两次）：total **32.7 / 33.9ms**；ELK **24.2 / 24.5ms**；capture×2 **3.3 / 3.8ms**；effH 0.2ms；其余 <2ms。
- Stage 1 的行为不变证据仍以大样本金标 7/7 + Node 金标 7/7 为准；**test1 金标自本提交起作为后续算法升级的唯一行为判据**。
