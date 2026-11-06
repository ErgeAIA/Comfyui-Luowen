---
title: Project Progress
type: project-progress
project: 络纹（LuoWen）
updated: 2026-11-06
description: >
  项目开发进度实时记录：阶段、分支、代码状态、最近进展。每次会话更新。
  AI 在本文件新增进展或修改当前状态后，必须同步更新 frontmatter 的 updated 字段为当日日期（YYYY-MM-DD）。
---

# Project Progress

> 记录当前任务状态、分支和最近进展。每次会话更新。
> 新进展插在「当前状态」之后、旧「最后更新」之前。

---

## 当前状态

- **当前分支**：main
- **阶段**：阶段 2 已验收并提交（commit `8614a8a`，14 文件）；3A（对齐吸附 + 提示线）已由用户验收并提交（commit `b6dab5c`，8 文件）；3B-1 与 3B-2 已完成（3B-2 保持默认关闭），本轮提交 3B；**3C 顺序抽头经实测撤除**（由公共前缀合并天然达成，DEC-019）
- **代码**：`luowen/`（含 `routing/trunkPlan.js` 单主干共享几何、Ribbon 已移除、三档避障、预览、缓存、`geometry/chamfer.js` 绕障外角大斜切、`routing/laneAssign.js` 输入侧按接近方向嵌套分道 + 走廊净空顺延），已装本机 custom_nodes 实测
- **工具链**：验证宿主（0.43.2）、前端 1.55.18、codegraph 1.6.2；Playwright 浏览器实测流程已打通
- **本轮 3C 顺序抽头阶段性实现后撤除（2026-11-06，DEC-018 存档 / DEC-019 撤除）**：
  - 曾按「≥3 分散目标、投影升序抽头、间距 ≥48/≥24、全员合流否则回退单 T」实现 `chooseTapSequence` / `planDaisy` 并接宿主开关 `LuoWen.DaisyTaps`（默认关闭）。
  - 宿主 A/B 结论：同一 11 节点布局、同取景（scale=1、offset=[500,350]、1600×1000）下，开/关**连线画布逐像素 0 差异**（仅底部统计文字 DOM 181 px 差异）；交叉对开/关均为 **10 对**且集合相同；开启抽头 `T=66/396/916`、投影间距 330/520，关闭 `fork=66`。
  - 根因：`T_i = proj_i − stub` 使抽头列恰等于单 T 分支自己的转向列（目标列 −24），分支首段又沿主干方向 → 两种模式绘制并集相同；顺序抽头当前架构下由「单主干 + 分叉后公共前缀合并」天然达成。
  - 处置（用户批准，仅撤本轮 3C 新增）：删除 `trunkPlan.js` 的 `TAP_MIN_SPREAD`/`TAP_GAP`/`chooseTapSequence`/`planDaisy` 与 `daisyTaps` 分支、`chamfer.js` 的 `pointKey` 与 `findSharedPoints` 的 `extra`、适配器的 `daisyTaps`/`dt0/dt1`/`daisy`/`taps` 透出、`index.js` 的 `LuoWen.DaisyTaps` 与 `setDaisyTaps`，并删除 `tests/unit/daisyTaps.test.mjs`。
  - 验证：全量单测 **95/95**（fail 0）；宿主默认布局 10 节点/10 link，`verify()` ok、`fork=107, merged=[9,10]`；`LuoWen` 无 `setDaisyTaps`/`status().daisyTaps`/`LuoWen.DaisyTaps`；复现撤除前关闭态临时布局，`fork=66, merged=[9,10,11]`，link9/10/11 折线与撤除前记录逐点一致。
  - 存档截图（不再代表当前实现）：`.verify/shots/3c-daisy-off-sameframe-2026-11-06T14-11-39-817Z.png` / `3c-daisy-on-sameframe-2026-11-06T14-11-50-846Z.png`。
- **本轮 3B-2 离线交叉清理接宿主（2026-11-06，DEC-017；用户决定保持默认关闭）**：
  - 新增纯模块 `luowen/web/routing/crossCleanup.js`：`planCrossCleanup({routes, resolve, maxRounds=2, maxGrowth=0.15, crossCost=60, locked})`；只对 `byPair` 中 `cross>0` 的线路对重解，纯重叠不进候选；整轮验收「交叉对严格下降 + 参与线路总长增幅 ≤15%」；`samePoints` 记 `unchanged`，不计参与与增幅；`maxRounds` 钳制 1–2。
  - 适配器 `renderLinkAdapter.js`：`CLEANUP_DEBOUNCE_MS=400`、`CLEANUP_CROSS_COST=60`、`CLEANUP_MAX_GROWTH=0.15`、`CLEANUP_MAX_ROUNDS=2`；新增 `frame.baseRoutes`（清理前基准）+ `frame.effectiveRoutes`（清理后）+ `frame.cleanupEpoch`、`cleanup{sig,epoch,triggerSig,routes,timer,pending,runs,lastReason,last}`；`scheduleCleanup` 记录 `version|laneHash|env` 三元组，`beginFrame` 中任一变化即 `invalidateCleanup`（障碍版本 `obstacle-version` / lane 哈希 `lane-hash` / 设置 `settings`），去抖回调执行前再校验一次；指针按下不调度。
  - 覆盖：`tryCustomRender` 先写 `baseRoutes` 再按 `cleanup.routes` 覆盖（仅当 `epoch===cleanupEpoch` 且端点一致），不改变未采纳线路；缓存签名为 `version|laneHash|env|specs.length|fnv1a(全部基准几何)`。
  - 调试入口 `index.js`：设置项 `LuoWen.CrossCleanup`（默认 false）、`LuoWen.setCrossCleanup(bool)`、`LuoWen.crossDebug()`（交叉对数/候选对/逐线尝试/采纳/丢弃原因/总长与增幅/轮数/epoch）、`LuoWen.crossCleanupNow()`。
  - 实测（复刻 10 节点 / 10 连线、KSampler 四输入汇聚、SaveImage 在 (418,484)）：清理前 **10 对 / 11 事件**，涉及 `[2,3,4,5,6,7,8,9]`；清理后 **9 对 / 10 事件**，`activeLinks=[8]`（VAEDecode→SaveImage），参与线路总长 `1517.657 → 1525.000`（**+0.4838%**）。link 8 由下方绕行（`y≈788`）改为上方绕行（`y≈228`），视觉差异明显；round1 采纳 8，round2 全部 `unchanged`。
  - 幂等：已应用态再调 `crossCleanupNow()` → `lastReason='cached'`；关→开强制重算，link 8 路径与首次逐点差 0（`md=0`），`pairs [10,9]`、`active [8]`。
  - 移动放弃：KSampler `setPos(+20)` 后 `active` 立即清空（`ep 60/58`）；再 `+20` → `ep 62/58`、`pending:true`；700ms 后按新几何重算 `ep 62/62`、`active [8]`；回原位 `ep 64/64`。旧结果不残留，画面无跳变。
  - 默认关闭：关闭态两次采样逐点一致（`same12:[]`）；开→关后与基准逐点一致（`same14:[]`）。
  - 不变量：`verify()` `ok:true, diffs:[]`；10 节点坐标与 10 条 link 五元组零差异（`nodesSame:true`、`linksSame:true`）。
  - 单测 `node --test tests/unit/*.test.mjs` **95/95**（新增 `tests/unit/crossCleanup.test.mjs` 11 项）。
  - 截图（同一取景）：`.verify/shots/3b2-ab1-off-z068-2026-11-06T13-41-11-850Z.png` / `3b2-ab1-on-z068-2026-11-06T13-41-20-521Z.png`（scale 0.68 全图）；`.verify/shots/3b2-ab2-off-z09-2026-11-06T13-42-14-801Z.png` / `3b2-ab2-on-z09-2026-11-06T13-42-31-803Z.png`（scale 0.9 局部）。
  - 未覆盖：连线增删事件、缩放事件、真实鼠标/触摸拖拽期间、缓存签名「别的线移动」专项构造、15% 增幅边界的宿主实测（仅单测）；移动时 `lastReason` 实际落为 `'lane-hash'`（行为正确、标签不够贴合语义）。
  - **用户决定（2026-11-06）**：保持 `LuoWen.CrossCleanup` **默认关闭**，代码保留不删（后续稀疏布局可手动开启）。理由：逐条重解收益极小（10 对交叉仅降到 9 对，参与线路总长 +0.48%），先做 3C 从源头减少交叉。
- **本轮 3B-1 交叉枚举与可选成本（2026-11-06，DEC-016；默认关闭、未接宿主）**：
  - 新增 `luowen/web/routing/crossings.js`：`segmentsOfRoutes` / `enumerateCrossings` / `crossingsOnSegment`；输出 `pairs`（唯一交叉对）、`count`（计入事件）、`involved`（涉及线路，去重排序）、`byPair`、`events`、`ignored`（sameLink / sameGroup / sharedPin / touch）。
  - 口径：垂直内点相交 = `cross`（计入）；同轴共线重叠长 >0.5px = `overlap`（计入，同组或共享引脚除外）；仅端点接触与共线相切 = `touch`（不计）；斜边不参与。
  - `geometry/router.js` 新增可选 `lineObstacles`（既有折线）与 `crossCost`（每次垂直内点交叉的代价）；仅 `crossCost > 0` 时构建线段表，默认关闭。
  - 单测 `node --test tests/unit/*.test.mjs` **84/84**（新增 `tests/unit/crossings.test.mjs` 15 项）。
  - 默认关闭证据：同一输入在 `route(args)` / `{lineObstacles, crossCost:0}` / `{crossCost:40}` 三条路径下输出逐点相同 `[[0,100],[24,100],[24,24],[576,24],[576,100],[600,100]]`。
  - 成本生效证据：等长上下绕行时默认走 y=234，`crossCost=60` 改走 y=366（避开 x=300 竖段）。
  - 未覆盖：未接宿主、未做离线清理（3B-2）、斜边不参与枚举、重叠未进成本（只计 cross）、成本量级未调参。
- **本轮 3A-2 接宿主（2026-11-06，DEC-015；已提交 `b6dab5c`）**：
  - 新增 `luowen/web/snap/dragSnap.js`（install/uninstall/setSnapEnabled/getSnapDebug）；`index.js` 增加设置 `LuoWen.SnapAlign`（默认开）与 `LuoWen.setSnapEnabled` / `LuoWen.snapDebug` 调试入口。
  - 挂载：window 冒泡 + 自排 rAF（晚于原生 `useNodeDrag.handleDrag`）；`pointerup` 同步收尾（早于 `mouseup` 快照）。候选：`nodeRects` 换算 body 坐标 + `graphLinks` 判 adjacent + 引脚行 `yTarget`（`skipX`）。多选 `selectedItems.size>1` 跳过。
  - 提示线：自建 `#luowen-snap-overlay`（z=500、`pointer-events:none`）挂运行时 `#graph-canvas-container`；源码包无该容器字符串，结论以运行时 DOM 为准（conventions §2.7 已补）。
  - 实测（scale 0.9，node 62→67，link 79）：±10px 内落点 290.00006（pinDy=0，link79 全 y=302.00006 水平）；完全自由落点 (-340,382) 不吸附；迟滞 12/14px 保持、16px 解除（随后被 node 63 通用锚点捕获）；多选不吸附无提示线；`elementFromPoint` 命中 canvas；`verify()` ok、其余节点坐标与 10 条 link 五元组零差异；单次拖动 undo +1、undo 后回 310.00006。
  - 单测 `node --test tests/unit/*.test.mjs` **69/69**。截图：`.verify/shots/3a2-t1-pin-window.png`（引脚行对齐 + 水平提示线 + link79 变直）、`.verify/shots/3a2-t5-guide-window2.png`（提示线在卡片之上）；均为 OS 窗口截图（Chrome DevTools `filePath` 受 workspace roots 限制）。`.verify/shots/3a2-t5-guide-window.png` 截到的是另一浏览器实例（83% 缩放），不作为证据。
  - 未覆盖：真实鼠标/触摸、Legacy 拖动模式、逐帧录屏、多节点高密度布局下的自由落点选取；解除后可能立即被其他锚点捕获（设计使然）。
- **本轮 3A-0 拖动挂载点查证（2026-11-06，未改代码、未提交）**：
  - 结论已写入 `docs/comfyui-dev-conventions.md` §2.7，附 file:line 与交叉验证表。
  - 宿主实际走 Vue 节点拖动：运行时 `LiteGraph.vueNodesMode=true`，legacy `_processNodeClick` 直接 return（`LGraphCanvas.ts:2784-2788`）；legacy `item.move` 循环不参与。
  - Vue 拖动每帧 rAF 绝对重算并 `batchMoveNodes`（`useNodeDrag.ts:137-192`）；无逐帧移动回调，`onNodeMoved` 仅拖动结束一次且 Vue 模式不调用（`LGraphCanvas.ts:871`、`:3701-3711`）。
  - 坐标是图坐标（`screenToCanvas` / `delta/ds.scale`），`snapTol=10px` 按图坐标口径成立；缩放 0.826 时约 8.3 屏幕 px。
  - undo 正常一次拖动一条；Vue 拖动中松开 Ctrl/Shift/Alt/Meta 会额外 `captureState`（`changeTracker.ts:559-564`、`:580-585`）。
  - **Alt 与 Shift 均被占用**（Alt=克隆节点；Shift=多选+网格吸附），原「Alt 被占用改 Shift」不成立；修饰键方案需用户重新拍板后再进 3A-1。
- **本轮 3A-1 对齐吸附内核（2026-11-06，DEC-014；未接宿主、未提交）**：
  - 用户拍板：修饰键方案选 **A**（不绑修饰键，改设置项「对齐吸附 开/关」默认开）；提示线走 **DOM overlay**（`pointer-events:none`、z-index 高于节点卡片层、随 `canvas.ds` 同步），不用 `canvas.onDrawForeground`。
  - 新增 `luowen/web/snap/alignSnap.js` 纯函数；`tests/unit/alignSnap.test.mjs` 13 项。
  - 契约：入参 `{pos,size,candidates,state,multiSelect,enabled,snapTol,releaseTol}`；出参 `{position,delta,snapped,guides,state,skipped}`；全部图坐标，无屏幕像素。
  - 规则：每轴独立（x left/center/right，y top/middle/bottom）；10 图 px 进入、15 图 px 脱离迟滞；距离差 <2px 平手窗口内 `adjacent` 邻居优先，同档取更近，完全等距但落点不同则歧义不吸附；≥2px 取更近；`multiSelect`/`enabled=false` 跳过并清空迟滞状态。
  - 验证：`node --test tests/unit/*.test.mjs` **64/64** 通过（全量；alignSnap 新增 13 项）。
  - 未覆盖：宿主拖动适配器、overlay 接入点、`adjacent` 来源、`selectedItems` 实测、跨 drag 会话状态清理、触摸/触控笔。
- **本轮返修 6b 实施（2026-11-06，DEC-013 补记 2；待用户验收）**：
  - 规则（用户硬约束）：输入侧分道顺序按「线从哪一侧接近」决定，目标嵌套不交叉——上方来源引脚越高越贴节点，下方来源镜像（引脚越高越远），平走最外层；跨组按「上→下→平」一次编号。
  - 违反证据（改前 8px）：走廊 x=646/638/630/622（75/76/82/78），方向 up/up/down/down；78（pin394）比 82（pin374）更远，78↔82 两处相交（x=622 竖线穿 y=534 水平段；y=394 水平段穿 x=630 竖线）。
  - 实现：`laneAssign.js` 输入侧收集 entries 后分 `ups/downs/flats` 排序再统一编号；新增 `laneBlocked` 净空顺延（近端 lane 被第三方节点 ±4px hard 箱占住时 `k+=1`，避免 A* 绕外侧导致嵌套反转）；输出侧、主干、斜切、最晚分叉均未动。
  - 单测 **51/51**；新增「多引脚上/下混合接近走廊嵌套不交叉」（断言上组 `xs[10]>xs[11]`、下组 `xs[12]<xs[13]`，还原 4 条正交折线断言任意两段无交点），保留 x 互不相同断言。
  - 实测（node 70，pinX=670）：75 x=646、76 x=638、78 x=622、82 x=614；方向 up/up/down/down；四条两两相交 `conflicts=[]`，全局 7 条 routes 两两检查同样为空。
  - 截图（同取景 scale=1.5 / offset=[-413.3333,-40]）：`.verify/p3_input_lanes_nested-2026-11-06T18-41-05-2026-11-06T10-41-08-238Z.png`。
  - 未覆盖：上/下引脚 y 交错时几何上无法同时满足；接近方向用节点 pos.y 与 slot 序近似；平走组未构造宿主实测；连续阻挡靠 `k<64` 兜底；A* 成本项未改（未扩范围）。未提交 git。
- **本轮返修 6 实施（2026-11-06，DEC-013 补记；待用户验收）**：
  - 参数拍板：输入侧默认 **pitch=8px**（线宽 2 → 边缘净空 6px；宿主实装 `connections_width=3` 实测净空 5px），导出常量 `DEFAULT_LANE_PITCH=8`；`LuoWen.setLanePitch(v)` 仅内存态对照（2–24 钳制、不持久化）；另出 5px 同取景对照截图
  - 实现：`laneAssign.js` 输入侧由 `i:${target_id}:${target_slot}` 分组改为按 `target_id` 聚合、`target_slot` 升序分层；每 slot 起点 = `base + Σ(之前 slot 线数) × pitch`；slot 内部 up/down/flat 与相对间距沿用；输出侧 `stubOut` 与 DEC-009/010/012 未动；lane 指纹追加 `|p{pitch}`；`getStats().rev` → `r7-input-lanes`
  - 单测 **50/50**（新增「同节点多引脚不共线」（4 条走廊 x 互不相同、任意竖直走廊无重叠区间）与「默认 pitch=8 累计偏移」（slot 起点 24/40、输出侧 stubOut 仍 24））
  - 实测 `state.routes`（K采样器 4 条入线竖直段 x）：8px 档 **646 / 638 / 630 / 622**，5px 档 646 / 641 / 636 / 631；两两同轴线段重叠检查 `conflicts=[]`
  - 回归：主干组 `62:0`（links 79/81）`fork=825`、`stubIn` 仍 24、折线逐点不变 `[[-669,914],[156,914],[156,304/534],[180,304/534]]`；`verify()` ok（10 nodes / 10 links，diffs 空）；节点位置未移动
  - 截图（`.verify/`，同取景 scale=1.5 / offset=[-413.3333,-40]）：`p3_input_lanes_8px-2026-11-06T10-18-41-489Z.png`、`p3_input_lanes_5px-2026-11-06T10-20-04-731Z.png`
  - 观察（未改）：8px 档走廊左移使 link 82/78 绕障拐角与 node 67 间隙落入 `GAP_FAR_MAX=200` 触发大斜切；5px 档因净空不足退回直角（斜切判据边界，按 DEC-012 保留）
  - 未覆盖：`stubCap` 压缩短连接后仍可能共线；同一输入引脚多源未改；合法最晚分叉可辨段收窄（本轮不做，单独排期）；绕障间隙阈值未放宽
  - 文档：DEC-013 补记、BUG-001 更新、`routing-algorithm.md` §4 / §7.6；未提交 git
- **本轮返修 6（2026-11-06，诊断与对照结论；代码未改）**：
  - 用户反馈：一个节点多个输入时，左侧入线被收拢成一根；并明确「目标不是美化，首要让工作流清晰可读」
  - 实测（KSampler node 70 四条入线）：75 model `[[521,124],[646,124],[646,334],[670,334]]`、76 positive `[[571,304],[646,304],[646,354],[670,354]]`、82 negative `[[566.47,534],[646,534],[646,374],[670,374]]`、78 latent `[[561,714],[611,714],[646,545],[646,394],[670,394]]`——四条竖直段同在 `x=646`，75↔76 在 y 304–334、82↔78 在 y 394–534 完全共线
  - 根因：`laneAssign` 输入侧按 `target_id:target_slot` 分组，每个引脚组内仅一条线 → rank 恒 0 → `stubIn` 全为 24 → 走廊 x 相同；`trunkPlan` 只按 `origin_id:origin_slot` 分组，不存在输入侧合并逻辑（属分道粒度缺陷，不是合并逻辑）
  - DEC-013：产品判定顺序 **可读性 > 简洁 > 美化**；输入侧每引脚独立、不得合并/共用走廊；输出侧单主干成立，但主干后每个分支必须可分辨
  - 美化项逐项对照：大斜切 / 输出侧单主干 / 分叉后公共走廊 / 近共线捷径 / smooth 圆角（非默认）/ 三档避障 / 拖拽预览=保持；合法最晚分叉=收窄（须保证分支在引脚前有可辨分离段）；输入侧 lane 阶梯=需修复
  - 待做（需用户确认后）：`laneAssign` 输入侧改为按目标节点统一编号（slot 升序累计偏移，保留同一引脚内 up/down/flat 语义）；补单测并用 `state.routes` 坐标证明互不共线；实测 pitch=5 描边可分辨性；必要时再调 pitch
  - 未覆盖：pitch 是否够用待实测；`stubCap` 压缩短连接后仍可能共线；同一引脚多源本轮不改
- **本轮返修 5（2026-11-06，DEC-012 补记：绕障外角大斜切）**：
  - 用户反馈：4px 倒角与直角无差别，且「处处倒角」、三通处也倒，看着不干净；真正需要的是把绕障形成的大直角整块削掉，腾出可放节点的三角空间
  - 实现：`chamfer.js` 重写为绕障外角大斜切——`wrapsNode` 判据（内侧象限包住第三方节点、两臂贴其两垂直边、间隙 64/200、臂长越过角点）、共享点（≥2 成员路径共有坐标）一律直角、`cutA/cutB` 按两腿可用长度独立计算、每腿保留 ≥24px、斜边净空采样失败按比例缩短或退回直角；命中改用实际折线（`link.path`/`_pos`/`state.routes`）
  - 参数：`0.6` 已固化为默认常量；`0.35 / 0.85` 仅保留为 `window.LuoWen.setBevelRatio()` 调试对照（内存态、不持久化），未进设置面板
  - 目标边界（用户确认）：本能力是**视觉省位**，减少正交线在角部同时占用的两向空间、改善观感；**不是提供可放置节点的画布**，不放宽腿长/间隙上限，不承诺三角区能容纳 225px 卡片
  - 实测（link 74 `加载VAE → VAE解码` 绕 `采样器`，两种布局 × 三档，详见 routing-algorithm §7.5）：布局 A 0.6 切 208/202、布局 B 0.6 切 208/118（浅角）；直角基线、三档截图与 240% 外角特写均已存 `.verify/`
  - 命中/悬停：斜边中点悬停命中 link 74，移开为空；删除沿用上一轮用户真实鼠标验收结论，本轮未重测
  - 未覆盖：净空失败按统一比例缩短双腿（未做保长腿的 Pareto）；几何版本首帧无 `prevRoutes`；本机原始布局横腿仅 35px，截图经临时移动节点构造、拍后已还原
  - 单测：48/48；文档：DEC-012 补记、PRD §5.2 例外重写、routing-algorithm §4.1/§7.5
- **本轮返修 4（2026-11-06，DEC-012：B 倒角 + 合法最晚分叉）**：
  - 用户拍板：转角选 B（局部 45° 倒角，不做 C 全局斜切）；`TRUNK_MAX=72` 改为合法最晚分叉；顺序抽头、交叉惩罚/离线清理、磁吸对齐不做
  - 新增：`geometry/chamfer.js`——T 点识别（同点 ≥3 入射方向）、`c` 取 `[1.5W,3W]` 内 `2W`（W=2→4px）、短段 `<2c` 跳过、切角侵入节点退回直角；adapter 只在正交样式+`LuoWen.Chamfer` 开启时绘图，`link.path`/`state.routes` 保持正交
  - 分叉：`chooseForkLength` 去掉固定 72 上限，T=最近目标投影−stub 与前方卡片净空的最小合法值；`setTrunkCap(72)` 仅供对照
  - 实测（同一 `-1000,900` 布局）：cap72 T=72、无 cap T=825，links 79/81 仍 merged；默认 `-240,420` 仍 T=49（<72，不受影响）；`verify` ok（10 nodes / 10 links）
  - 命中：320% 下正交直线段与倒角斜边中点均悬停到 link 81，移开为空；`routes()` 全正交
  - 观感：三组截图 ①直角 ②B ③B+最晚分叉；B 与最晚分叉未见视觉冲突，长主干只在末端一个倒角，无碎片化；用户尚未确认最终形态
  - 未覆盖：原生点击选中/删除未单独实测（合成事件未触发选择；代码层 `link.path` 正交）；凸角用净空采样而非严格多边形判定；倒角未回写主干缓存
  - 单测：42/42；文档：DEC-012、PRD §5.2 书面例外、routing-algorithm §4.1/§7.4
- **本轮返修 3（2026-11-06，DEC-011：端口双竖线收口 + 近共线）**：
  - 反馈：源节点「加载CLIP」（62）在两「CLIP文本编码」下方时，端口出口竖线又变两条并排（`170,1000` 实测 x=525/530；`290,900` 实测 x=645/650）；另「UNet加载器→采样算法」近共线出现多余折线
  - 根因：① `laneAssign` 输出侧仍按 rank 阶梯 `stubOut=24+rank*5`；② 目标投影 ≤0 时 `trunkPlan` 不规划主干（`trunkPlan.js:175-176`），组退回独立绘制、无统一 stub 兜底；③ 近共线被 router 的 `<2px` 捷径与固定 `flatTol=0` 当成正常高差
  - 修复：① 输出侧整组统一 `stubOut=24`，输入侧保留阶梯；② 删除 `solveBranchFor` 的 stub 覆盖（stub 单一来源）；③ 新增 `STRAIGHT_TOL=3` + `nearFlatPath`（端点钉死在引脚中心、允许 ≤3px 极短转折、走廊净空）；大高差折线与「对称台阶」未改
  - 实测：下方两位置端口竖线唯一（525/525、645/645）；近距 `-240,420`（T=49）与远端 4 位置（T=72）merged 与返修 2 一致；反向 `0,420` 首段仍单线（link 79 存在绕自身卡片大折线，未改）；近共线 +2px 为 `[131,124]→[206,124]→[206,126]→[230,126]`，+20px 仍正常台阶；`verify` ok（10 nodes / 10 links）
  - 未覆盖：`nearFlatPath` 无独立单测（adapter 内部函数）；反向/下方场景不规划主干；`STRAIGHT_TOL` 仅覆盖水平/垂直引脚对；对称台阶未实现
  - 单测：35/35；文档：DEC-011、routing-algorithm §4/§4.1/§7.3/§8；截图 `.verify/p2_below_single_stub-2026-11-06T06-09-56-837Z.png`、`.verify/p2_near_after_dec011-2026-11-06T06-10-20-761Z.png`
- **本轮返修 2（2026-11-06，阶段 2 验收后追加缺陷）**：
  - 现象：`62:0` 组（links 79/81，两个左对齐 CLIP文本编码）在源节点靠近时单线三通；移远后端口附近竖直段变成两条并排竖线（`x=-573` / `x=-568`，相差 5px）
  - 根因：`laneAssign` 按目标 rank 给 per-link `stubOut = 24 + rank*5`，两分支从同一 fork 各自 A* 时首个转折点 x 错开 5px，在仍需共用的走廊上各画一条；T 上限不是主因
  - 修复：① adapter 分支求解统一传组共享 `DEFAULT_STUB`；② `trunkPlan.js` 取 merged 分支几何公共前缀（`sharedPrefixLength`/`splitAt`）合并为一条共用折线，直到真正分歧
  - 实测：源节点 6 个位置；近 `-240,420` 与远 `-1000,900` / `-1400,700` / `-700,1100` / `-1000,260` 均 merged，两条路径竖直走廊 x 完全一致且唯一（远端 `-573`，不再有 `-568`）；`verify` ok，links/slots 未变；截图 `.verify/p2_trunk_corridor_far-2026-11-06T05-18-55-115Z.png`
  - 未覆盖：源在目标右侧的反向连接、两目标 `stubIn` 不同的极端布局
  - 单测：34/34；文档：DEC-010、routing-algorithm §4.1/§7.2
- **本轮返修 1（2026-11-06，阶段 2 验收反馈）**：
  - 反馈：一个输出端口接多条线时，静态渲染端口处为两条平行线（`=[`），与拖动预览的单线三通（`-[`）不一致
  - 根因：DEC-008 的 Ribbon 从 fan=14 起就分股（pitch=4 平行股道），端口之后立刻出现两股
  - 修复：合流段改为 `pin → fork` 单条共享几何，分叉后再各自 A*；router 对 canonical 直连返回 null 的成员用共线直线补齐；移除 fan/pitch
  - 实测：默认 10 节点工作流 `62:0` 组（links 79/81）共用 `(91,434)→(156,434)` 后分叉；主干悬停命中 81、分支悬停命中 79；移动目标节点 +60px 后仍合流；`verify` ok；单测 33/33
  - 文档：DEC-009、routing-algorithm §4.1/§7
- **上一阶段（阶段 2 初版）**：2026-11-06 阶段 2 完成
  - 主干：按输出端口分组 → 独立路径基准 → 共同前缀 + 分叉长度三约束（72 / 最近目标 / 迎面卡片）→ Ribbon（fan 14, pitch 4，按目标排序）→ 分支 A*
  - 决策：绕行保护 ratio 1.25 + 双阈值滞回（1.35 / 1.15）；成员不足或空间不足回退独立
  - 修复：几何版本变化后主动补一帧重绘，否则画布静止时主干不生成；settings 注册期 install 空 canvas 防护
  - 实测：`62:0` 组 T=39、merged 79/81；两股悬停分别命中 79/81；干净布局自身/第三方穿透 0；verify ok；单测 32/32
  - 文档：routing-algorithm §4.1、DEC-008
- **更早（阶段 1 复验返修 2）**：2026-11-06
  - 反馈：线被自身连接的卡片压住；节点重叠时 strict 无解回退曲线
  - 修复：A* 障碍包含两端节点；三档求解 strict→semi（blockRects）→loose；不再以曲线作默认退路
  - 验证：干净布局自身/第三方穿透均 0；极端重叠保持正交；单测 26/26
- **更早（阶段 1 初版 + 返修 1）**：2026-11-06
  - 原型级 renderLink/drawConnections 包裹；三样式；单条 A*（MIT 复用）+ 三档避障；lane 阶梯；缓存版本化
  - getBounding 绝对坐标修复、strict 避障、拖拽正交预览、整线悬停高亮
- **下一步**：用户验收返修 5（默认 0.6 的绕障外角大斜切、三通/分叉直角、外角特写；目标为视觉省位，不要求塞入节点）→ 阶段 3（兼容性矩阵、与 Cable Management/NKD/Zip Ties 冲突测试、性能基准、发布材料；磁吸对齐与「对称台阶」美学规则候选一并评估）
- **本阶段禁止**：未经用户验收开始阶段 3；改 PRD 产品边界；在宿主环境装依赖
