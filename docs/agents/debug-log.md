---
title: Debug Log
type: debug-log
project: 络纹（LuoWen）
updated: 2026-11-07
description: >
  反复调试的 bug 追加记录，优先级与实现事实对齐。只追加，不删除或改写历史。
  AI 在本文件新增或修改任何条目后，必须同步更新 frontmatter 的 updated 字段为当日日期（YYYY-MM-DD）。
---

# Debug Log

> 反复调试的 bug 记录。只追加，不删除历史。
> 格式：`## BUG-NNN: 标题` + 日期/现象/根因/修复/验证限制/教训。NNN 三位递增。
> 字段：`- **日期**：` / `- **现象**：` / `- **根因**：` / `- **修复**：` / `- **验证限制**：` / `- **教训**：`

***

## BUG-001: 同一目标节点的不同输入引脚走廊完全共线

- **日期**：2026-11-06
- **现象**：K采样器（node 70）四条入线在 `x=646` 共用同一竖直走廊，75↔76 在 y 304–334、82↔78 在 y 394–534 完全重叠，视觉上像汇成一根再分开。
- **根因**：`laneAssign.allocateLanes` 输入侧按 `target_id:target_slot` 分组；每个引脚一组且组内通常仅一条线 → rank 恒 0 → 所有引脚 `stubIn=24` → 竖直走廊落在同一 x。与 `trunkPlan`（只按输出端口分组）无关。
- **修复**：已实施（2026-11-06），待用户验收。`laneAssign.js` 输入侧改为按 `target_id` 聚合、`target_slot` 升序分层；每 slot 起点 = `base + Σ(之前 slot 线数) × pitch`；slot 内部 up/down/flat 与相对间距沿用；输出侧 `stubOut` 与 DEC-009/010/012 全部不动。默认 `DEFAULT_LANE_PITCH=8`，`LuoWen.setLanePitch(v)` 仅内存态对照。
- **验证**：单测 50/50（新增「同节点多引脚不共线」与「默认 pitch=8 累计偏移」两项）；实测 K采样器四条入线竖直段 x = 646/638/630/622（8px 档）、646/641/636/631（5px 档），两两同轴线段重叠检查 `conflicts=[]`；主干组 `62:0`（links 79/81）`fork=825`、`stubIn` 仍 24、折线逐点不变；`verify()` ok。
- **验证限制**：① `stubCap` 对短连接压缩 stub 后仍可能共线；② 同一输入引脚多源本轮未改；③ 合法最晚分叉可分辨段收窄未做；④ 8px 档绕障拐角（node 67）触发既有大斜切，5px 档退回直角，属斜切判据边界而非本 bug。
- **二次归因与修复（2026-11-06，用户硬约束：分道顺序按接近方向、目标嵌套不交叉）**：
  - 现象：8px 后四条入线已不共线，但负向条件（82）与 Latent（78）仍交叉。实测走廊 x=646/638/630/622（75/76/82/78），方向 up/up/down/down；78（pin y=394）比 82（pin y=374）更远，违反下方来源镜像规则，两处相交（78 竖线 x=622 穿 82 的 y=534 水平段；78 的 y=394 水平段穿 82 竖线 x=630）。
  - 根因：排序键只有 `target_slot` 升序，没有「接近方向」；`stubIn` 的走廊序号与来源侧无关。
  - 修复：`laneAssign` 输入侧改为 `ups/downs/flats` 三组——上方按 slot 升序（引脚越高越贴）、下方按 slot 降序（镜像）、平走最外层，跨组一次编号；新增 `laneBlocked` 净空顺延（近端 lane 被第三方节点 ±4px hard 箱占住时 `k+=1`，避免 A* 绕到更外侧导致嵌套反转）。
  - 验证：单测 51/51；K采样器四条入线 x = 646/638/622/614（75/76/78/82），方向 up/up/down/down，两两相交检查 `conflicts=[]`；全局 7 条 routes 亦为空；截图 `.verify/p3_input_lanes_nested-2026-11-06T18-41-05-2026-11-06T10-41-08-238Z.png`。
  - 未覆盖：上/下引脚 y 交错时几何上无法同时满足；接近方向用节点 pos.y 与 slot 序近似；平走组未构造宿主实测；A* 成本项未改。
- **教训**：分道（lane）的分组粒度必须与「语义独立单位」一致：输入侧语义单位是引脚内部，不是单个 link；按单 link 分组会让同节点多引脚退化为同一条走廊。

***

## BUG-002: 主干态与独立态逐帧翻转（竖线在源侧/目标侧来回跳）

- **日期**：2026-11-07
- **现象**：拖动任意节点时，`加载CLIP → CLIP文本编码` 一束主干线的竖直段在「贴近源节点右侧」与「贴近目标节点左侧」之间逐帧来回跳；松手停在目标节点左侧。只有两态几何不同时才肉眼可见（`T` 恰好等于首段 stub 时两态重合，故默认布局复现不出）。
- **复现布局**：node 67 → `(660,290)`、node 71 → `(660,520)`、node 68 → `(300,380)`，移动 node 63。
- **修复前逐帧证据**（旧代码）：`v31 A` = `[[100,432],[124,432],[124,302],[660,302]]`（竖线 x=124，源侧 stubOut 末端）；`v31 B` = `[[100,432],[294,432],[294,302],[660,302]]`（竖线 x=294，主干 fork）；`v32` 重复同样交替。
- **根因（两层）**：
  1. 版本变更帧 `planTrunks` 因 `endpointsVer !== version` 早退并自请求一帧 → 该帧 `trunks` 为空走独立路径，下一帧才恢复主干。修复思路为「同帧用节点 pos + 上一帧引脚偏移预测端点」。
  2. 预测实际从未生效：`nodesById(graph)` 按 graph 对象跨帧缓存节点表，而扩展在页面装载早期（`_nodes` 尚空）首次调用，缓存了**空 Map**；graph 对象不重建 → 空表永久复用 → `recordEndpoint` 全部走 `else` 分支删除偏移（探针实测 `nOff=0`），预测退回上一帧端点，端点移动时逐帧滞后一帧 → 仍两态翻转。
- **修复**：`renderLinkAdapter.js` ① `recordEndpoint`/`predictEndpoints`/`solveBaseline` 同帧预测与同帧基准求解；`planTrunks` 去掉版本门禁；`tryCustomRender` 用 `state.frame.plannedEndpoints` 做 0.5px 一致性判定。② `nodesById` 去掉跨帧缓存（每帧重建，节点数级开销）；删除 `state.frame.nodesById/nodesByIdGraph`。
- **修复后验证**（2026-11-07，宿主 0.43.2 + 1.55.18，同一复现布局）：
  - 拖动端点节点 67（每帧 +8px）：连续 11 帧全部 `fork=170`、`vx=[294]`，折线 `[[100,432],[294,432],[294,302],[660..676,302]]`，无翻转；首帧（瞬移后）即为主干态。
  - 拖动无关节点 63（每帧 +6,−3）：连续 12 帧全部 `fork=170`、`vx=[294]`；版本 v11→v22 逐帧递增。
  - 探针：`nOff=9`、`diagNodes=10`、link 79 偏移 `a=[340,12]`、`b=[0,12]`；`LuoWen.verify()` → `{ok:true, diffs:[]}`。
  - 单测 `node --test tests/unit/*.test.mjs` **99/99** 通过。
- **验证限制**：① 首次安装/新图首帧仍会走一次独立态（尚无偏移采样），只在装载瞬间出现；② 拖动仅用 `setPos` 模拟，未合成真实 PointerEvent；③ 倒角 `others`（`prevRoutes`）在版本变更帧被清空的两态差异未在本轮处理；④ 大斜切只验了 `style=orthogonal` 能正常出线，未逐点核对斜切几何；⑤ 磁吸仅确认 `installed/enabled`，未在拖动中触发；⑥ 整组悬停/组删除仅由单测 `classifyHover` 覆盖，宿主未复测。
- **教训**：按对象引用做跨帧缓存时，必须确认首次填充时数据已就绪；对「可能晚于安装才填充」的图数据，宁可每帧重建也不要按 graph 身份缓存。
- **用户验收（2026-11-07）**：用户在宿主复测通过，BUG-002 结案；代码改动仍待提交。

***

## BUG-003: 第三方节点挤占输入走廊后，同目标两条线落到同一条走廊（共线重叠）

- **日期**：2026-11-07（仅根因分析；未改代码、未提交 git）
- **现象**：默认布局 node 63（加载VAE，`(660,700)`）。L78 `68→70 slot3`、L82 `71→70 slot2` 初始竖直段 x=620/612（8px 嵌套，无重叠）。把 node 63 移到 `(300,400)` 后两条竖直段都落在 `x=636`：L78 `[[570,712],[636,712],[636,392],[660,392]]`、L82 `[[575,532],[636,532],[636,372],[660,372]]`；重叠段 `x=636, y∈[392,532]` 长 140px，属**同轴共线重合**（不是平行相邻，也不是局部压线）。
- **节点矩形**（getBounding，图坐标）：63 移动后 `300,370 320×137`（hard 箱 `296..624 × 366..511`）；68 `310,670 260×198`，出引脚 `(570,712)`；71 `170,490 405×170`，出引脚 `(575,532)`；70 `660,290 315×371`，入引脚 `(660,392)` / `(660,372)`。走廊合法区间只剩 `x∈(624,656)`，Hanan 候选 `636`（70 外扩左沿）与 `644`（63 外扩右沿）。
- **根因链**（三层叠加，非单一层）：
  1. `laneAssign` 给该组分配 `stubIn` 75/76/78/82 = `24/32/40/504`：`pinX = targetRect.x + INPUT_PIN_X_OFFSET(10)`（`laneAssign.js:39,116`）按 `670-stub` 判阻挡，而真实走廊在 `660-stub`，差 10px → 78 的 620 未被判为阻挡；82 被判阻挡后 `while` 只把 `stub` 往左增（`:127-130`），跑到 504（被 `stubCap` 截到 60.38），落点 599.6 仍在 63 的 hard 箱内。y 跨度用 target/origin 整块矩形（`:122-125`）而非引脚实际 y，偏保守。
  2. 两条线的 `eStub` 都落在 63 的 hard 箱内 → `solveRouteTiers` strict 双双返回 null（`renderLinkAdapter.js:138-146`）→ 退到 `semi`（63 变 8× 代价可穿）。semi 里最近的合法竖向网格是 `x=636`，两条线各自独立都选它。
  3. A* 单线求解，线不作为障碍（`lineObstacles/crossCost` 只在 3B、默认关，且只计垂直交叉不计共线重叠）→ 没有让第二条线让开的压力。
  4. 主干不是原因：78 属 `68:0`、82 属 `71:0`，均无主干；`trunks` 只有 `62:0`（79/81）。原生降级也不是原因：路径仍由本扩展绘制。
- **证据**：`LuoWen.trace()` 里 78/82 最新条目仍是 `ver=1`（装载首帧，`stub=[24,40]/[24,48]`，pts 620/612），说明当前绘制走的是 `planTrunks` 预填缓存（`renderLinkAdapter.js:252-254` cache set、`:797` cache hit），计数器不增长，故 `strictNull/semi/loose` 看似为 0。用仓库同一份 `laneAssign.allocateLanes` + `router.route` 离线复算（相同矩形/端点/stub）：78/82 strict 均 null，semi 均得 `x=636`，与绘制逐点一致；把 78 的 stub 改 32 → strict 成功 `[[570,712],[628,712],[628,392],[660,392]]`，把 82 改 24 → strict `x=636`，即「两条 8px 分开且都不穿卡」的期望形态可达成。
- **触发条件**：63 的矩形要同时压住 L78（竖跨 392..712）与 L82（竖跨 372..532）的穿越带，且右侧仍留一条合法网格。默认 y=700 纯左移不复现（63 的 y 带 670..807 不碰 L82，L82 仍 612）：实测命中在 `(300,340)/(300,400)/(300,460)`；`(300,520)` L82 只被压住下半段，semi 选择 599 而不重叠；`(300,580)/(300,620)` L82 走 600（laneBlocked 的整块 y 跨度误报）。
- **候选修法（未实施）**：
  A. `laneAssign` 改「冲突簇 + 双向就近合法位」：修正 pin x（用真实引脚 x 或端点，不用 +10）；y 跨度改用引脚实际 y；只对「穿越带重叠」的线做簇内编号，允许 `stub` 小于 base（向下探到 8/16），把合法内侧位（32/24 → 628/636）分给冲突线；限制顺延上限。
  B. 同目标线路的并行重叠后校验：布局变更帧解完基准后，检测同目标（或同走廊）线段的同轴重叠，给后解的一条换一条合法网格重解（可复用 3B 清理的严格验收口径，但目标需从「垂直交叉」扩到「同轴共线」）。
- **验证限制**：仅 `setPos` 合成移动，非真实拖拽；复现位置与 node 67/71 矩形有重叠，用户实际布局可能不同（需其移动前后坐标或截图布局复核）；未测 3 条以上同簇线、`style=orthogonal`、`CrossCleanup` 开启时的表现。
- **教训**：lane 分配只保证「已分配走廊」互不相同，不保证「A* 改道后」仍互不相同；走廊被第三方挤占时，必须把合法剩余走廊也纳入分配，或在线路间加并行重叠代价。
- **方案 A 实施与验证（2026-11-07，用户确认选 A、拖动为纯水平；未提交，等用户验收）**：
  - **纯水平复扫（原始布局，node 63 y=639.6719 不变，x 660→−420 步长 20）**：全程无共线重叠（`overlaps:0`）。L82 竖直段稳定在 119.5 / 599 等位，L78 在 327.7 → 999 / 868 / 628 等位跳变，两条从未落在同一 x。原因：VAE 初始 x=647 与 KSampler 矩形（x 405.87..720.87）在 x 上重叠，左移先穿过 KSampler，路线走 semi/loose 大绕行，不进入两条走廊的窄缝。
  - **等价构造（非用户原布局）**：node 70→`(660,0)`、68→`(310,670)`、71→`(170,540)`、63 的 y 改到 `380`（y 带 350..486.7 同时覆盖 L78 竖跨 72..682 与 L82 竖跨 52..552），初始 VAE x=660 后只改 x。验收样本 VAE `(300,380)` 修复前：L78 `[[570,682],[868,682],[868,373],[636,373],[636,72],[660,72]]`、L82 `[[575,552],[636,552],[636,52],[660,52]]`，同轴重叠 `x=636, y∈[72,373]` 长 301px。
  - **改动一 `luowen/web/routing/laneAssign.js`**：`allocateLanes` 新增 `pins` 入参；`geometryOf` 优先用真实入引脚 x（`ep.bx`）与两端引脚实际 y 跨度（`min/max(ay,by)`），无 pins 时退回旧 `rect.x + 10` 与整节点跨度（装载首帧与单测行为不变）；名义阶梯全合法时逐点不变，否则把整组按「近→远」重排到一段连续合法位，新增 `MIN_STUB_STEPS = 1`（向内侧最多下探 1 档）与 `MAX_FORWARD_STEPS = 4`（外侧顺延上限，PRD §7.3）。
  - **改动二 `luowen/web/adapters/renderLinkAdapter.js`**：`beginFrame` 把 `predictEndpoints` 前移到 lane 分配之前；新增 `endpointsToPins(eps)` 与 `pinsHash(pins)`，pins 指纹并入 lane 指纹 `lh`，端点移动即重算 lane。
  - **修复后同一验收样本**：L78 `[[570,682],[868,682],[868,373],[628,373],[628,72],[660,72]]`、L82 `[[575,552],[636,552],[636,52],[660,52]]`；竖直段 `x=628` 与 `x=636`，8px 分开，公共段 0。
  - **全区间纯水平复扫（同一等价布局，x 660→−420 步长 20）**：`overlaps:0`；走廊分组：初始 594/599 → x=600 时 594/595 → x=580..320 时 L78 走 999/628、L82 599 → x=300 时 628/636 → x=280 时 628/604 → x≤260 时 628/599。
  - **输入侧走廊嵌套基线**（干净布局 70→`(660,290)`、67→`(170,100)`、68→`(335,900)`、9→`(1000,100)`、65→`(1000,300)`）：实测 `75=636 / 76=628 / 78=620 / 82=612`，8px 等距、近→远顺序与历史一致；与历史 `646/638/622/614` 整体差 −10px，来自本次按要求把阻挡判定基准从 `rect.x + 10` 改为真实端点 x（间距与嵌套顺序未变）。
  - **原始布局回归（reload 后）**：`trunks=[{group:'62:0', fork:36.53125, merged:[79,81]}]`；79/81 共享 `y=138.6875, x∈[-370,-333.47]`（长 36.53 = fork），79 在 `x=146` 转入目标、81 在 `-333.47` 分开 → 单主干 + 最晚分叉成立。L78 竖段 `x=619`、L82 `x=119.53`，原始布局无重叠。
  - **大斜切**：`style=orthogonal` 下 10 条 routes 正常，link 75 含 1 段绕障外角大斜切 `[[100.82,426.1],[134.82,506.1]]`（x/y 同时变化），切回 `smooth`。
  - **磁吸**：`snapDebug()` → `installed:true, enabled:true`（未在真实拖动中触发）。
  - **整组悬停/删除**：主干点 `(-350,138.6875)` → `hover={linkId:79, part:'trunk', members:[79,81]}`；分支点 `(0,138.6875)` → `{part:'branch', members:[79]}`。链路菜单注入：主干位置首项「删除这一组（2 条）」（选项出现 `LuoWen:DeleteTrunkGroup`），分支位置无该项（仅 `Add Reroute` / 隐藏连线）。
  - **单测与不变性**：`node --test tests/unit/*.test.mjs` **99/99** 通过（fail 0）；`LuoWen.verify()` → `{ok:true, baseline/now 10 nodes/10 links, diffs:[]}`。
  - **还原**：reload 后节点回原始坐标（63 `(647,639.6719)`、70 `(405.8686,494.1)`、68 `(335,692.6894)`、71 `(-309.4687,664.5)`、67 `(170,290.0001)`、9 `(418.2686,483.5)`、65 `(619.2686,454.5)`、62 `(-710,126.6875)`）；`style=smooth`、`avoidance=high`、`chamfer=true`、`crossCleanup=false`、`lanePitch=8`；视图缩放随 reload 回默认。宿主两个改动文件 SHA256 与仓库一致（`laneAssign.js` `FEE3F1B3…7311`、`renderLinkAdapter.js` `3F29931F…6F10`）。
  - **主机补充说明**：用户所见布局与本次原始布局不同；纯水平扫描在原布局不复现，故复现用的是等价构造。若要与其所见一一对应，需用户补充 node 63 / 68 / 70 / 71 的 `pos`（`node.pos[0], node.pos[1]`）与 `getBounding()`，或移动前后截图；判据是 VAE 的 y 带须同时覆盖 L78 竖跨（68 引脚 y → 70 slot3 y）与 L82 竖跨（71 引脚 y → 70 slot2 y）。
  - **验证限制**：未用真实鼠标拖动（仍 `setPos` 合成）；未测 ≥3 条同簇线、`crossCleanup=true`、经典画布/子图；装载首帧无 `pins` 时仍走旧口径。
  - **结论**：交用户验收，未宣称已修复、未提交 git。
- **等距带（ribbon）追加实施与验证（2026-11-07，DEC-028；未提交，等用户验收）**：
  - 目标变更：验收从「不重叠」升级为「线1 走廊 = 线2 走廊整体偏移固定间距、同进同退并行等距」；smooth 不做斜线通道；让到上限即停，不换序、不穿越、不拆间距。
  - 实现（仅 `luowen/web/adapters/renderLinkAdapter.js`，未改 `index.js` 设置块）：`planBands` 按 `target|接近方向` 分组、原走廊间距 ≤ `2×lanePitch` 入带；`planOneBand` 以 `stubIn` 升序 rank0 为基准，其余成员经 `offsetStrand` 整体偏移；间距默认 8、按 `minPinGap` 钳制；`k=0..4` 整带外移；失败写 `bandDegraded` 并在端点一致时回退上一帧；新增 `LuoWen.setBrotherSpacing(v)` 内存态 A/B 入口。
  - 已修次生 bug 一：降级分支原先无条件回退 `lastGoodRoutes`，而回退后的旧折线又被下一帧 `lastGoodRoutes` 捕获 → 「节点已动、连线永远是旧几何」自锁；改为仅当上一帧折线端点与当前端点 <0.5px 一致时才回退。
  - 已修次生 bug 二：基准几何退化为多竖段异向时原实现静默丢带；现先判成员独立解是否真的重叠，重叠才记 `homotopy` 降级，避免误伤本就满足间距的兄弟线（如 73/74）。
  - 宿主证据（构造布局 70→`(660,30)`、68→`(310,700)`、71→`(170,510)`、63→`(600,410)`、9→`(1120,500)`）：VAE x=600 时 `bands=[{target:"70",members:["78","82","76"],base:78,spacing:8,shift:0,degraded:false}]`，竖段 `596/588/580`（两两 8px），入口水平 y = `712/102`、`521.95/82`（等于各自引脚 y）；x=590 起 `bandDegraded` 三条 `reason:"homotopy", fallback:"prev"`，折线冻结在 596/588/580（撞上限停住）。
  - 间距 A/B：4 → 596/592/588；12 → 596/584/572；30 → 钳到 19.99997（`clamped:true`）并降级 `base-clear-k4`；恢复 8 → 596/588/580。
  - 回归：`style=orthogonal` 10 条 routes、0 斜线段且 band 仍成立；原布局 reload 后 `bands=[] / bandDegraded=[]`（无误报）；单主干 `62:0 merged=[79,81]`；`snapDebug` installed/enabled；单测 99/99；`verify() {ok:true,diffs:[]}`。
  - 遗留：基准 wrap（多竖段异向）时只降级冻结，未实现整带跟随绕行；未做全组联动重排；用户原布局与宿主 reload 后布局不同，本轮为等价构造；组悬停/删除与真实鼠标拖动未交互复测。
  - 还原：节点坐标回原位、`style=smooth`、`lanePitch=8`、`avoidance=high`、`chamfer=true`、`brotherSpacing=8`，视口随 reload 复原。
- **方案 A 重做：先解后排序（2026-11-07，DEC-030；未提交，等用户验收）**：
  - **现场布局（按用户要求保留，未还原）**：63 `(764.6363,814.3082)` 320×106.66；68 `(442,800)`；70 `(846.493,361)`；71 `(291.5313,618)`；67 `(292,381)`；9 `(2013.2686,540.5)`；62 `(-233,478.3438)`；65 `(1252.905,515)`；66 `(-709.5763,-195.1946)`；69 `(-233.1818,-195.1946)`。
  - **`bands` 为空的真实原因**（区别于 DEC-028 的构造结论）：旧 `planBands` 准入要求「原走廊间距 ≤ 2×lanePitch」，但它读的是成员独立解的结果；障碍版本一变，78/82 缓存同时失效，两侧独立解在真正需要成带的那一帧必然错开（或其中一条尚未解出），准入恒 false → `bands=[]` → 两条线各自 A* → L82 竖段落到 L78 内侧，视觉上就是「VAE 左移、线1 翻到线2 上方」。这是顺序依赖的死结，只能改流水线顺序。
  - **改动**（仅 `luowen/web/adapters/renderLinkAdapter.js`）：准入改为 `target|dir`；`planBands` 改为先各自求解再排序；新增 `approachOf/shiftCorridor/pathsCross/round2/markOrderDegraded/checkOrderCrossings`，删除 `corridorOf/verticalDirs/corridorXs/minCorridorDist/markBandDegraded/planOneBand`；`offsetStrand` 由几何受限重解 `shiftCorridor` 替代；帧状态新增 `orderCtx/orderDegraded`；`tryCustomRender` 求解前优先取 `orderCtx.pts`，求解后对带外成员按 `orderCtx.x` 回夹一次；`getStats()` 输出 `orderDegraded`。
  - **现场基线**：`L76 [[702,393],[846.493,393]]`（纯直线，不参与阶梯）；`L78 [[702,812],[726,812],[726,433],[846.493,433]]`；`L82 [[696.531,629.951],[718,629.951],[718,413],[846.493,413]]`；`bands={anchor:78,pivot:1,spacing:8,shift:0,xs:[null,718,726]}`、`orderDegraded:[]`、`bandDegraded:[]`。L78 引脚 y=433 > L82 y=413，故 L78 走廊在外侧 x=726，满足「rank 随引脚 y 增大、走廊 x 单调」；交叉 0。
  - **VAE 左拖重放（合成 `setPos`，x=841→764.64 共 11 步，再压到 300 共 13 步，合计 24 个关键点）**：全程 `gap=8`、`orderOk=true`、`crossings=0`、`orderDegraded=0`、`bandDegraded=0`。x=841..787.57 用 pivot=0（806.49/814.49，随障碍下移）；x=779.94..730 切 pivot=1（718/726，避开 63 的 4px 外扩箱）；x=710..300 回 pivot=0（806.49/814.49；x=500 时 822.49/830.49）。
  - **未撞 k=4 的原因（不是漏记降级）**：走廊竖跨 413–812，而 node 63 的 y≥814，VAE 左移后离开走廊 y 带，阶梯无需继续外移；因此 `orderDegraded` 全程为空是几何事实。上限分支由代码审阅与单测覆盖，未在现场触发。
  - **回归**：输入侧嵌套基线（75 竖段 822.49、76 直线 393、82=718、78=726，不同方向组未混入，0 交叉）；单主干 `62:0 fork=155 merged=[79,81]`；`style=orthogonal` 9 条 routes、bands 不变、0 交叉、无降级（已恢复 smooth）；`snapDebug` `installed:true, enabled:true, active:false`（未真实拖动触发）；主干点 `[187.5,490.34]` 悬停 `{linkId:79,part:'trunk',members:[79,81]}`，移开 `null`；单测 **99/99**；`LuoWen.verify()` `{ok:true,diffs:[]}`。
  - **未现场执行**：组删除菜单——合成 `contextmenu` 未打开链路菜单（`entries:[]`、`menuOpen:0`），按非破坏原则不改用户图数据，相关代码本轮未改；真实鼠标拖动（仍 `setPos` 合成）。
  - **还原**：未改节点坐标（用户指定保留验收现场）；`style=smooth`、`brotherSpacing=8`、`avoidance=high`、`chamfer=true`、`crossCleanup=false`、视口 `scale=1.1` / `offset=[365.8822885946525,-73.97045528506945]` 已恢复；localStorage 测试键已清理；宿主 `renderLinkAdapter.js` SHA256 与仓库一致。
  - **结论**：交用户验收，未宣称已修复、未提交 git。
  - **用户验收（2026-11-07）**：用户在宿主按现场布局复测通过——VAE 从 x=841 左拖到 300，24 个关键点间距恒 8px、交叉计数 0、`orderDegraded` 全程为空；DEC-030 方案 A 结案，代码改动仍待提交。

## BUG-004: 大规模图每帧整图主干重规划（trunkCache 上限 64 触发逐帧清空）

- **发现（2026-11-07，性能评估第 1 项；先量后改）**：合成 200/500 节点图（396/996 线）每帧 `solveCalls` 达 ≈296 / ≈722 次，而 `routeCache` 命中率 0.997；`LuoWen.status().trunkDebug.groups` 仅个位数，说明求解量并非来自逐线求解。
- **根因**：`luowen/web/adapters/renderLinkAdapter.js` 的 `state.trunkCache` 上限写死 64。合法主干组数 = 连线数/2（996 线约 372 组），每帧写入后立即超限并整体 `clear()`，下一帧全部主干缓存消失 → `planTrunk` + `solveBranchFor` 全图重解，形成逐帧死循环。
- **修复**：上限 64 → 4096（必须大于合法组数上限：1000 线最多 500 组），并在写入处留注释说明原因。
- **同口径 A/B（同页面、同合成图、同帧数、同预热，仅部署文件相差该一行；`LuoWen.perfStart/perfStop` 页内采样）**：smooth 500 frame avg 142.023 → 119.100ms（−16%），`solveCalls` ≈722/帧 → 0；smooth 200 29.247 → 21.333ms（−27%），≈296/帧 → 0；smooth 50 3.351 → 2.705ms（−19%）；真实 10 节点 0.648 → 0.513ms（−21%）；ortho 500 389.869 → 363.473ms（−6.8%，chamfer 占 62.7%，掩盖解算收益）。
- **行为不变**：真实图 `routes()` 几何指纹 `hash=3021896999 len=524` 优化前后完全一致；`verify()` 两页均 `{ok:true,diffs:[]}`；等距带 `target 70 members [76,82,78] anchor 82` 相邻 8.00px、顺序不变；单主干 `62:0 fork=155 merged=[79,81]`；`crossDebug` before/after count 0；单测 99 pass / 0 fail。拖拽注入 60 帧无掉帧、无重解。
- **预防规则**：缓存上限不得按「小图直觉」写死，必须 ≥ 该缓存键理论最大条目数；性能排查先看「缓存条目数是否被清空」，再看命中率——命中率只覆盖逐线 routeCache，不覆盖 trunkCache。
- **状态**：已部署宿主实测、已恢复宿主文件（SHA256 与仓库一致），未提交 git，交用户验收。

## BUG-005: 目标落在源下方后，同目标 up 组兄弟线阶梯斜率写死导致交叉

- **发现（2026-11-07，用户现场：K采样器 70 与 加载VAE 63 同连 VAE解码 65）**：65 位于两源之间时正常——73 归 `65|up`、74 归 `65|down`，各自单成员不成带；65 下移到低于 63（top y>800）后 73/74 同属 `65|up`，旧阶梯把 rank0（上引脚 73）留在近端、rank1（下引脚 74）推到远端 `1236.905`，两条线交叉。
- **根因**：`planBands` 阶梯写死 `x_r = pivotX + (r-p)·dirToNode·spacing`，隐含「rank 升序 ⇒ 走廊 x 递增」。该假设只对 `dir='down'`（源在目标下方，DEC-013 镜像：引脚越高越靠外）成立；`up` 组的正确嵌套是镜像——引脚 y 越小越贴目标，即 rank 升序走廊 x 递减。`pivot/k` 只平移不改方向，`shiftCorridor` 只平移末段不交换先后，`lastGoodRoutes` 无条件快照会保留交叉几何。
- **修复（P0 + P0.5，仅 `planBands`）**：P0 阶梯方向感知：`s = dir === 'up' ? -1 : +1`，`required = pivotX + s·(r-p)·dirToNode·spacing`；`down/flat` 取 +1，逐点保持 DEC-030 原算式。P0.5 在 `k=0..4 × pivot` 枚举内对候选（含不可平移的直线成员）做同组两两 `pathsCross`，交叉候选不提交；全部候选失败才走 `markOrderDegraded`。`laneAssign`、`trunkPlan`、`shiftCorridor` 语义、`spacing`、`BAND_MAX_SHIFT_STEPS=4` 与降级语义均未改。
- **现场数据（宿主 0.43.2 + 1.55.18，真实图 10 节点；reload 加载新模块后 `loadGraphData` 恢复原布局与视口）**：
  - 本例逐帧（65 从 y=515 到 895，步长 20，共 20 帧）：73/74 竖段 x 恒 `1228.905 / 1220.905`、gap 8、交叉 0、`orderDegraded` 空；y=815 起（65 top 越过 63 top=800）band 成立 `{members:["73","74"],pivot:0,shift:0,spacing:8,xs:[1228.91,1220.91]}`，序不反转。
  - 同布局对照：把 74 目标侧竖段按旧公式（s=+1）挪到 `1236.905`，交叉计数 2（74 源侧水平段 y=812 横穿 73 竖段；73 入口水平段 y=842 横穿 74 竖段）；新代码实际 0。
  - 远端双线（target 70，members [76,82,78]）：`xs:[null,806.49,814.49]`、anchor 82、pivot 0、shift 0 与已验收基线一致；78/82 gap 8、交叉 0；8 条基线线逐点最大偏差 ≤4.7e-4（仅为验收记录的小数截断，非回归）。
  - 输入侧四线共线（node 70 的 75/76/82/78）：75（`up` 单成员）x=822.493；down 组 82（pin 413）x=806.493、78（pin 433）x=814.493、76 纯直线 y=393 无走廊；82/78 保持「引脚越高越靠外」的镜像嵌套，任意两线交叉 0；阶梯重排结果与 laneAssign 一致，未产生镜像翻转。
  - down 组（65 上移到 y=200，73/74 均源在上）：xs `[1220.91(73),1228.91(74)]`、gap 8、交叉 0、`orderDegraded` 空，DEC-013 下镜像语义逐点不变。
  - 单主干三通：`trunks [{group:"62:0",fork:155,merged:[79,81]}]` 与基线一致；79/81 的共线重叠属共享主干前缀（`pairCross 79-81 = 1` 是 crossings.js 共线口径），非新增兄弟交叉。
  - spacing=8 保持（`min(brotherSpacing=8, minPinGap=20)`）；`BAND_MAX_SHIFT_STEPS=4` 未改。
  - 降级/冻结（合成探针，已还原）：68 移到 `(1204,630)`（rect `[1204,600,260,198]`）并令 65 y=835，target 70 组全部候选被 P0.5 拒绝，记录 `reason:"cross-pivot1-k4",steps:4`；82 端点未变 → `fallback:"prev"`（冻结上一帧），78 端点已变 → `solved`；帧末 `checkOrderCrossings` 追加 `reason:"cross"`。证明「全部候选失败才降级」与冻结口径按原语义工作。
  - 未能现场构造 `chosen.k===4`（`reason:"cap"`）的成功分支：每条线先由 A* 避开障碍，阶梯取自已合法走廊；探针中 A* 直接把走廊放到障碍左侧 `1196.91`，`shift:0` 即成立。该分支仅由代码审阅（`k` 上限与 `degraded: chosen.k>=4` 判定未改）和单测覆盖。
- **行为不变证据**：真实图没有「同目标 up 组 ≥2 成员」的成带场景（73 up 单成员、74 down 单成员、75 up 单成员），`routes()` 逐点未变；指纹（10 线、3 位小数、FNV-1a）`0xb0fa2c54`；`verify()` `{ok:true,diffs:[]}`；单测 99/99（fail 0）。
- **预防规则**：凡把「rank 序号」映射到坐标的阶梯，先判定该组的嵌套镜像侧；`up`/`down` 共用同一斜率公式等于把方向语义写死。新增阶梯/排序必须带同组两两交叉预检，且「全部候选失败」必须显式降级，不许静默回退。
- **状态**：已部署宿主（SHA256 与仓库一致 `4065A7400AD6188C10F4385293D04C99D5BFBC33EE114A081C7A704E37B1B443`），未提交 git，交用户验收；未宣称已修复。

## BUG-006: 仅删除连线时路由状态表残留幽灵条目

- **日期**：2026-11-07（阶段 3 生命周期测试发现；仅记录，未改代码、未提交 git）
- **现象**：删除 link 79（不移动任何节点）后，图 `links=8`，但 `LuoWen.status().routed=9`、`LuoWen.routes()` 仍含 79；随后在原 origin/target 重连生成 link 83，图 `links=9`，而 `routes=10`。在旧 path 上注入 pointermove 可命中 `{linkId:79, part:'branch', members:[79]}`；节点移动使障碍版本变化后 `routed` 回落、悬停命中变 `null`。
- **判定依据（为何是「已知缺陷」而非「通过」）**：`getStats().routed = state.routes.size`（`renderLinkAdapter.js:1635`）与 `routes()` 调试快照均把已删除链路计入；悬停分类读 `state.routes`，可命中不存在的链路。图数据未变（`verify()` `{ok:true,diffs:[]}`）、幽灵线不可见（`renderLink` 只遍历现存链接，高亮条件 `state.hover.linkId === link.id` 永不成立），故不阻断主流程。
- **根因**：`beginFrame` 仅在 `obstacleHash` 变化时清理路由状态——`renderLinkAdapter.js:969-985`（`if (oh !== state.frame.obstacleHashStr) { ... state.routes.clear(); ... }`）。删除链路不改节点矩形，hash 不变；`tryCustomRender` 的 bypass（`renderLinkAdapter.js:1204`）只删除当前 link 的条目（且只在本次渲染该 link 时才执行），被删 link 不会再被遍历，因此条目永久残留，直到下一次节点几何变化。`lastGoodRoutes`（同文件 L967）在清理前快照 `state.routes`，也会复制幽灵条目，但仅作等距带端点一致时的回退源，未观察到几何影响。
- **复现步骤**：加载 10 节点基线 → 删除 link 79（`graph.removeLink` 或原生删除）→ 等待 800ms 并 `setDirty` 两次 → 读 `status().routed`（期望 8，实测 9）→ 在旧路径中点注入 pointermove → 读 `status().hover`（实测 `{linkId:79,...}`）；移动任一节点后再读，`routed` 恢复为现存链路数。
- **验证限制**：① 幽灵只存在于内存状态表，不可见、不写工作流 JSON；② 悬停命中只通过合成 pointermove 复现，未用真实鼠标；③ 未测多链路连续删除、子图内删除、`crossCleanup=true` 下的交互；④ 重连后 trunk 与等距带需要第二次 `setDirty` 才恢复，属刷新时序，与幽灵条目一并待修。
- **预防规则**：状态失效指纹必须覆盖「拓扑维度」（现存 link 集合/端点对），不能只用节点矩形 hash；删除链路时应在同一帧按现存 link 集合做差集清理，而不是依赖几何变化兜底。调试/悬停表与可见绘制表应分离或同源，禁止「统计口径」包含已不存在的对象。
- **状态**：仅登记，本轮按约束未改功能代码；交后续修复与用户验收。矩阵见 [compatibility-matrix.md](./compatibility-matrix.md) §5.1。

### 修复与验证（2026-11-07，阶段 3 补丁轮）

- **改动范围**：只改适配器层 [renderLinkAdapter.js](file:///d:/Workspace/Code/Comfyui-Luowen/luowen/web/adapters/renderLinkAdapter.js)，未改几何、lane 分配与等距带算法。
- **修复**：
  1. 新增 `pruneStaleLinkState(links)`（[L955-979](file:///d:/Workspace/Code/Comfyui-Luowen/luowen/web/adapters/renderLinkAdapter.js#L955-L979)）：以现存 link 集合做差集，清理 `state.routes`、`lastGoodRoutes`、`prevRoutes`、`baseRoutes`、`effectiveRoutes`、`endpoints`、`pinOffsets`、`cleanup.routes`、`frame.bands`、`frame.orderCtx`；悬停引用的链路已消失时同步清空 `state.hover`。只删消失项，不清空整表，未受影响链路缓存与几何保留。
  2. `beginFrame` 新增拓扑指纹 `computeLinksHash(graph)` 比对（[L996-1004](file:///d:/Workspace/Code/Comfyui-Luowen/luowen/web/adapters/renderLinkAdapter.js#L996-L1004)），拓扑变化即触发差集清理；不递增 `obstacleVersion`，不触发几何重算。拓扑哈希原本已用于 lane 指纹，本次只计算一次并同时服务失效检测与 lane 指纹（未增加每帧哈希次数）；`allLinks` 复用给 lane 指纹与分配，避免二次遍历。
- **修前/修后（同一 suite.mjs，宿主 0.43.2 + 1.55.18）**：
  - suite 先删节点 68、再删 link 79（节点矩形不变）：修前 `links 8 / routed 9 / routes 9` → 修后 `links 8 / routed 8 / routes 8`。
  - 重连（新 link 83）：修前 `links 9 / routed 10 / routes 10` → 修后 `links 9 / routed 9 / routes 9`。
  - 其余步骤 `routed/rects/routes/bands/bandDegraded/orderDegraded` 全部同值；深度 diff 仅 4 处目标计数与 3 处视口命中坐标噪声（同一步 `fp` 与 `routed` 一致）。
- **最小复现**：`.verify/p3/probe16.mjs`（只删连线不动节点：`nodes 10 / links 9 / routed 9 / routes 9`；`routes()` 不含 79）、`probe19.mjs`（先删节点 68 再删 link 79：`8/8/8`）。旧路径中点注入 pointermove 后 `status().hover=null`；重连生成 link 83 后 `links 10 / routed 10 / routes 10`；节点坐标逐项未变；`obstacleVersion` 保持 1，证明清理由拓扑指纹触发而非几何兜底。
- **验证限制**：① 幽灵仍只存在于内存状态表，未写入工作流；② 悬停用合成 pointermove，未用真实鼠标；③ 未覆盖子图内删连线、`crossCleanup=true`、真实鼠标删除；④ 链路增删后主干/等距带仍需一次额外重绘（`setDirty`），属 LiteGraph 刷新时序，本次未改。
- **状态**：已修复并完成宿主实测，待用户验收。
- **提交（2026-11-07）**：随 `d546e39` 提交并 push；仍待用户验收。

### 真实鼠标删除复测（2026-11-07，待办 2「阶段 3 剩余验收」轮）

- **方式**：Playwright 真实鼠标事件（非 `setPos`/合成 PointerEvent）——移动到 link 76 最长段中点。图→屏换算用适配器 `eventGraphPoint`（`renderLinkAdapter.js:1130-1136`）的反演式 `client=(graph+ds.offset)·scale+rect`（scale=0.9；旧 probe4 口径 `graph·scale+offset` 仅在 scale=1 时凑巧成立，本轮已废弃）。
- **结果**：`status().hover` 命中 `{linkId:76, part:'branch', members:[76]}` → 右键菜单 `隐藏连线 / Add Node / Add Reroute / Delete / Convert to Set/Get` → 点击 `Delete` → `links 9 / routed 9`（相等，无幽灵）、`hover=null`；`verify()` 如实报 `link-removed: 76`（ok:false 属预期，主动删除不是篡改）；Ctrl+Z 后 `links 10 / routed 10`、`verify() ok:true`。
- **覆盖闭环**：本条目验证限制 ②（悬停用合成 pointermove）与 ③（真实鼠标删除、`crossCleanup=true` 下删线）在本轮全部补上真实鼠标证据；记录 `.verify/p3/stage3r-run3.json`（S6 节）、截图 `s3r_06_*.png`。

### 用户验收（2026-11-07，DEC-037 委托口径）

- AI 交付对照表（`.verify/p4/mirror-user-steps.mjs` 复刻用户控制台步骤：rebase → 两数对账 → 真实鼠标删线 → 对账 → hover → `verify()` → undo → extra/properties 探针 → 真实拖动）：删线后 `routed==links`（9/9）、`hover=null`、`verify()` 如实报 `link-removed: 78`、undo 后 `ok:true`，**用户确认通过，结案**。
- 附带口径澄清（非缺陷）：删线后 `verify()` 报 `link-removed` 属如实报告；步骤②删线后做后续探针前需 Ctrl+Z 或 `rebase()`（undo 会自动 rebase，见 BUG-007 同名小节）。

## BUG-007: verify() 快照盲区——不含 graph.extra / node.properties / 节点坐标

- **日期**：2026-11-07（第三方共存源码级分析暴露；对应矩阵 C6/Z4 验收盲区）
- **现象**：`verify()` 只比对 kind/nodeCount/nodeIds/linkTuples。合成写入 `graph.extra.probe_vendor`、`graph.extra.zipTies`、`node.properties['cablemanagement.owned']` 后，修前均返回 `{ok:true,diffs:[]}`；第三方写工作流 `extra` 或节点 `properties` 时自检无感知。
- **宿主自有字段排查（比对时排除）**：宿主前端工作流 extra schema（`comfyui_frontend_package/static/assets/api-DTg5QMcw.js`，`or=...`，`.passthrough()`）定义 `ds / frontendVersion / linkExtensions / linkPresentation / reroutes / workflowRendererVersion / BlueprintDescription / BlueprintSearchAliases / linearMode / linearData`。实测普通操作只写 `ds`（视口，serialize/load 重写）；原生 Reroute 与保存路径会写 `linkExtensions/linkPresentation`。以上十项全部排除；第三方自定义键不在其中，仍可检出。本插件源码 grep 无 `graph.extra` / `node.properties` 写入。
- **修复（只改 [index.js](file:///d:/Workspace/Code/Comfyui-Luowen/luowen/web/index.js)）**：
  1. `EXTRA_HOST_KEYS` + 键深排序的 `canonicalValue/canonicalJson` + `extraFingerprint`（[L51-102](file:///d:/Workspace/Code/Comfyui-Luowen/luowen/web/index.js#L51-L102)）：extra 只保留非宿主键。
  2. `snapshotGraph` 增加 `nodePos`（3 位小数；宿主 1.55.18 的 `pos` 是 Float64Array）、`nodeProps`（每节点 properties 规范化 JSON）、`extra`（[L106-128](file:///d:/Workspace/Code/Comfyui-Luowen/luowen/web/index.js#L106-L128)）。
  3. `diffSnapshot` 增加节点 id 集合差、`extra-*` 键级差、`node-prop(id)-*` 键级差（[L130-186](file:///d:/Workspace/Code/Comfyui-Luowen/luowen/web/index.js#L130-L186)）；原有 kind/节点数/链路判定不变。
  4. `movedNodes` + `verify().moved`（[L189-201](file:///d:/Workspace/Code/Comfyui-Luowen/luowen/web/index.js#L189-L201)、[L441-452](file:///d:/Workspace/Code/Comfyui-Luowen/luowen/web/index.js#L441-L452)）：位置变化只报告，不计入 `ok/diffs`，避免用户拖动造成误报。
- **A/B（同一宿主 0.43.2 + 1.55.18，`.verify/p4/verify-ab.mjs`；合成写入仅内存、测后还原、未 serialize）**：
  - 修前：上述三类合成写入均 `{ok:true,diffs:[]}`。
  - 修后：`extra.probe_vendor` → `{ok:false,diffs:["extra-added: probe_vendor"]}`；`extra.zipTies` → `extra-added: zipTies`；`node.properties['cablemanagement.owned']` → `node-prop(9)-added: cablemanagement.owned`；删除对应键后均恢复 `{ok:true,diffs:[]}`。
  - 宿主键噪声：改 `extra.ds`、新增 `extra.linkExtensions` 均 `{ok:true,diffs:[]}`。
  - 位置：节点 9 位移 (+4,+3) → `{ok:true,diffs:[],moved:[{id:"9",from:[1280,320],to:[1284,323]}]}`；还原后 `moved:[]`。
  - 未写入场景 `v0` 的 `ok/diffs` 与修前一致。
  - 节点/链路增删：临时 Reroute（+1 节点）→ `node-count: 10 -> 11`、`node-added: 72`；临时建链路 83 → `link-count: 10 -> 11`、`link-added: 83`；删除临时链路与节点后恢复 `{ok:true,diffs:[]}`，节点与链路 id 集合与原状一致（`verify-node-ab.mjs`、`verify-link-ab.mjs`）。
- **回归**：
  - `node --test tests/unit/*.test.mjs`：99 pass / 0 fail。
  - `suite.mjs`：16 个 verify 全 `{ok:true,diffs:[]}`、各步 `errors:[]`；删除重连 `8/8/8` → `9/9/9` → 恢复 `10/10/10`；切换 A/B `sameA/sameB=true`；组 `plateEqualAfterRemove=true`；拖动 `bandDegraded/orderDegraded=4/4` 与修前一致；指纹 `3664953215`。
  - `probe23.mjs`：单主干 `62:0 fork=155 merged=[79,81]`；pivot1 `xs=[718,726]`；up895 `73=1228.905 / 74=1220.905`；down200 `[1220.905,1228.905]`；撞上限 `xs=[806.49,814.49] bandDegraded=6`；Reroute `trunks=[]`，移除后恢复单主干。
- **验证限制**：第三方扩展仍未安装，A/B 为合成写入；真实 Cable Management / Zip Ties 的键名、写入时序与保存路径未运行时验证（矩阵 §5.4 缺口保留）。
- **预防规则**：数据不变性自检必须覆盖工作流可序列化的扩展位（`extra` / `node.properties`），并显式排除宿主自有键；坐标等用户态变化只报告、不判失败。
- **状态**：已部署宿主（仓库与宿主 SHA256 一致 `8BEA51F999FF4C1B351AA7884F8C9DF975F2E8AF03636E838A4D0BE94FA7B9E5`），未提交 git，待用户验收；未宣称已修复。
- **提交（2026-11-07）**：随 `ebbc038` 提交并 push；仍待用户验收。

### 真实鼠标删除复测与 undo 自动 rebase 口径（2026-11-07，待办 2「阶段 3 剩余验收」轮）

- **真实鼠标删除**：右键 link 76 分支段（hover 先命中 `{linkId:76, part:'branch'}`）→ 菜单 `Delete` → `verify()` `{ok:false, diffs:["link-count: 10 -> 9","link-removed: 76"]}`——如实报告用户主动删除，属预期行为；Ctrl+Z 撤销后 `ok:true`。真实鼠标主干右键组删除（link 79/81 一次事务删除 2 条）同轮通过，undo 恢复 `ok:true`。
- **口径注记（新发现，非缺陷）**：ComfyUI 的撤销 = `loadGraphData` 恢复快照，会触发本插件 `afterConfigureGraph()`（[index.js:333-336](file:///d:/Workspace/Code/Comfyui-Luowen/luowen/web/index.js#L333-L336)）重建基线——**每次 Ctrl+Z 后 baseline 自动跟随撤销后的状态**。因此「undo 后 verify ok:true」只证明「与撤销后状态一致」，不能证明「与最初基线一致」；用户手工验收时若先做过删除/撤销，应先 `LuoWen.rebase()` 再判定。
- **自动化脚本注意事项**：undo 链可能把已删除的粘贴节点复活（撤销「删除节点」）；验收脚本终态需孤儿清扫 + 强制 `rebase()`（`.verify/p3/stage3-remaining.mjs` finalSweep），否则 `FINAL` 的 ok 会建立在被污染的基线上。

### 用户验收（2026-11-07，DEC-037 委托口径）

- 对照表确认：`extra.probe_vendor` → `extra-added` 检出、`node.properties` → `node-prop(9)-added: fake.vendor` 检出、删除后均恢复 `ok:true`、真实拖动只进 `moved` 不判失败；宿主自有键不误报引用 `.verify/p4/verify-ab.mjs` 既有 A/B（ds/linkExtensions 均 ok）。**用户确认通过，结案**。
- 真实第三方（Cable Management / Zip Ties）的键名、写入时序与保存路径仍留待待办 1 运行时验证（矩阵 §5.4 缺口保持，不因本验收关闭）。

***

## BUG-008: 用户动效全灭——探针覆盖服务端共享设置 + 主题闸门静默失效设计

- **日期**：2026-11-08
- **现象**：用户报告「所有动效都不生效」。排查：`LuoWen.ColorTheme` 被置为 `off`，而动效闸门含「主题关 → shouldAnimate 一律 false」——主题被关，动效全灭且无任何提示。
- **根因（两层）**：
  1. **探针覆盖用户设置**：ComfyUI 设置持久化在服务端 `user/default/comfy.settings.json`，与用户浏览器共享。验收探针结束时按「默认值」还原（`ColorTheme=off`、`FlowAnim=false`），而非按**测试前快照**逐键还原——把用户正在使用的 cyberpunk 主题+动效配置清掉了。此错误发生了不止一次（B 项验收轮、动效 v2 轮均发生）。
  2. **设计缺陷**：动效依赖配色主题（shouldAnimate 的 themeId 闸门）且无任何提示——用户开了动效、关了（或被清了）主题，动效静默全灭。
- **修复**：
  1. 动效与主题解耦：`shouldAnimate` 移除 themeId 闸门——主题关时对当前描边色（原生 color || #94a3b8）照样动效；「启用动效」tooltip 去掉「仅配色主题开启时生效」。单测语义翻转（121/121）。
  2. 用户设置恢复：cyberpunk + 档位 10 + 动效开（用户明示意图）。
- **预防规则**：探针触碰任何服务端共享状态前，**先快照全部将改动的键**，结束后按快照逐键还原（不是还原成默认值）；能不碰就不碰。凡「A 开关静默依赖 B 开关」的 UI 设计，要么解耦，要么在 A 的 tooltip 与运行时状态里显式标明依赖。
- **教训**：无头验收页与用户浏览器共享服务端状态，「页面即弃」不等于「状态即弃」。
