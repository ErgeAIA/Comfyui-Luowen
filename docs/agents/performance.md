---
title: 性能验收台账
type: performance-log
project: 络纹（LuoWen）
updated: 2026-11-07
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


