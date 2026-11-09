---
title: Decision Log
type: decision-log
project: 络纹（LuoWen）
updated: 2026-11-09
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

## DEC-047: 重叠修复（渲染真实高度）+ 主链水平间距参数化 + 侧列以轴中线上下分布

- **日期**：2026-11-09
- **背景**：用户实测红框两处节点重叠（CLIPTextEncode×CFGNorm、SaveImageAdvanced×SaveWEBM）。定位：Vue 节点 DOM 高度 = 存档 `size` + 30（标题/底栏），SaveWEBM/CFGNorm 还按内容再撑高（+48/+32）；布局按 `size` 打包 → 视觉间距仅 ~10、个别直接重叠。用户另要求把主链水平间距也做成可调参数；并确认「侧列以主链为轴上下分布（2 上 2 下）」方向。
- **决策**：
  1. **渲染真实高度**：runAutoLayout 布局前读每个节点 `.lg-node` 的 DOM 高度（÷画布缩放）写入 `effH`，列重排按 `effH`（回退 `size`）计算竖直堆叠 → 视觉间距=设定值、杜绝重叠。
  2. **主链水平间距可调**：新增设置 `LuoWen.AutoLayout.LayerGap`（slider 20–160，默认 60），作为 ELK 层间距基准（入口多的层仍自适应加宽）。
  3. **侧列以轴上下分布**：列重排中，若列内顶端节点非主链节点（纯扇入/扇出侧列），以「连接口 y 均值」为中线、按总高上下对称分布（4 个→上 2 下 2）；含主链顶端的列仍锚定主链顶边。
  4. **源节点归列暂缓**：曾尝试把入度 0 节点吸到最左列，但会把 VAELoader（应靠 VAE解码）也吸走、并把 UNETLoader 挤出主链顶边 → 已回退。待做更精确规则（只归「喂早期层」的源）。
- **验证**：单测 156/156；宿主 test2（14 节点含 CFGNorm）实测：**视觉重叠 before [CLIPTextEncode×CFGNorm, SaveImageAdvanced×SaveWEBM] → after 0**；save 列 2 上 2 下；主链顶边全 212；undo 14/14；verify ok；66ms。
- **结果**：已实现并部署宿主（SHA 一致）。**补记**：侧源对齐已加——入度 0 且目标全不在主链上的源（如 CLIP 加载器→CLIP 文本编码），顶边对齐到其目标顶边均值；实测 CLIPLoader 自动下移到 511、与 UNETLoader 视觉间距 **9.3→134**，拥挤消除。**补记2**：1 进 1 出并排压实已加（`compressSpineInline`：沿主链整列累计左移，1 进 1 出段收窄到 `inlineGap`≈50；整列平移保持后续列间距；因宽侧节点同列，部分段被重叠钳制）。实测 test2：采样算法→CFG归一化 段 50/160，后续 107/102；无重叠、undo 14/14。新增设置 `InlineGap`（20–160，默认 50）。

## DEC-046: 列对齐改为逐列按流向（扇入右/扇出左）+ 主链感知重排 + 列内 Y 间距可调

- **日期**：2026-11-09
- **背景**：用户提供 test1（刻意打乱）/test2（一键整理）/test3（手动期望）新场景（13 节点、图像端 4 个同级 save 节点）。暴露三点：①DEC-045 的全局「默认右对齐」在扇出列（VAEDecode→4 save）上让左缘错位、连线打架；应逐列按流向判定——多源扇入（→单节点）右对齐、单源扇出（→多节点）左对齐。②主链顶边被列重排打断（KSampler 落 123.8 而非 225.6）：重排把非列内顶端的主链节点又挪走。③用户要求通用（视频类多端口节点，不能只针对 KSampler），且首/末列 Y 间距可调。
- **决策**：
  1. **逐列 auto 对齐**：swapReduceCrossings 的 align 新增 `auto`（默认）——每列统计「单源扇入边数 inFromSingle」与「单源扇出边数 outToSingle」，`inFromSingle > outToSingle` → 左对齐（扇出目标列），否则右对齐（扇入源列/默认）。基于**边数**，与节点类型/端口数无关，通用。
  2. **主链感知重排**：`spineTopAlign`（移动节点）改为 `spineOf`（只识别最长路径链 + 锚顶），由 swapReduceCrossings 在重排时对「列内顶端是主链节点」的列锚定起始 y = 锚顶；扇出列（顶端非主链，如 save 列）保持自身堆叠，不强行拉到主链顶边——与 test3 一致。
  3. **列内 Y 间距可调**：新增设置 `LuoWen.AutoLayout.NodeGap`（slider 20–120，默认 40），autoLayout 透传 nodeGap。
  4. 设置 `LuoWen.AutoLayout.ColumnAlign` 选项改为 自动/右/居中/左，默认自动（覆盖 DEC-045 的默认右）。
- **验证**：单测 **156/156**（新增 auto 扇入/扇出、主链锚定、spineOf 链/环 5 项）；宿主 test1 实测：col0/1/2 右对齐、**col4 左对齐**、**KSampler 顶边 225.6**、重叠 0、交叉 0、undo 13/13、verify ok、66ms。
- **结果**：已实现并部署宿主（SHA 一致）；**待用户宿主验证**；未合 main。

## DEC-045: 自动布局校准——入边计数间距、主链顶边对齐、列内对齐设置（默认右对齐）

- **日期**：2026-11-09
- **背景**：test2（旧引擎整理结果）↔ test3（用户手动期望）对比：拓扑/连线/参数逐字节一致，仅布局差异。提取三项改进：①列距 222px 过宽（自适应层间距把 widget 输入计入端口：KSampler 10 而非 4 入边 → 60+(10−2)×20=220）；②主链顶边参差（用户把 ModelSampling→KSampler→VAEDecode→SaveImage+UNETLoader 顶边统一 y≈54）；③中列四节点右对齐（宽节点为锚）。用户要求三项全做，并把列内对齐做成设置项（默认右对齐）。
- **决策**：
  1. **间距按入边计数**：engine.elkLayout 的 maxInPorts 改按 in-degree（入边数），widget 输入不连线、不计入；实测列距 222→102px。
  2. **主链顶边对齐**：新增 refine.spineTopAlign——可动子图内最长路径（并列取起点 top 最小），链上节点顶边对齐到链上第二个节点；engine 在 straightenEdges 后、列重排前调用（同列重叠由列重排消解，跨列因水平分层不会重叠）。实测主链五节点顶边全 53.6。
  3. **列内对齐可选**：swapReduceCrossings 增加 align 参数（right 默认 / center / left）；新增设置 `LuoWen.AutoLayout.ColumnAlign`（combo，默认右对齐，i18n 双语）；autoLayout API 透传 columnAlign。实测中列右缘全 905。
- **验证**：单测 **154/154**（新增列对齐 right/left/center + spineTopAlign 最长路径/环跳过 3 项）；宿主探针 `.verify/p7/calibration-probe.mjs`：列距 102、主链顶边 53.6、中列右缘 905、重叠 0、交叉 0、verify ok、undo 10/10、无页面错误、96ms；对比图 `.verify/p7/calibration-after.html`（已渲染验证）。
- **结果**：三项已实现并部署宿主（SHA 一致）；**待用户宿主验证**；新功能未合 main（按纪律验收后再合）。

## DEC-044: 自动布局触发 UI 收尾——兄弟线间距注册补全、整理按钮可拖动、菜单迁官方钩子；合并推迟待验收；盲测改三工作流校准

- **日期**：2026-11-09
- **背景**：用户接手验收 auto-layout 工作线，反馈四点：①设置面板「线路外观」里看不到兄弟线间距滑块（`3be484c` 声称已加但实际漏注册）；②「⌁整理」按钮位置固定，希望能拖动；③优化完按钮和菜单再合入 main；④盲测 A/B 打开是「AI 生成的巨长工作流」（500 节点合成梯度），不适合人肉盲测，提出改用「示例工作流1→点整理存2→手动调到期望存3」三份对比校准。另指示顺手解决文档卫生（重复条目、过期 handoff）。
- **决策**：
  1. **兄弟线间距注册补全**：`index.js` 补 `LuoWen.BrotherSpacing` slider（4–24 步进 2、默认 12、线路外观组、i18n 双语、onChange→setSettings），并更正 `renderLinkAdapter.js` 两处过期注释（面板项已存在，调试入口仅为内存态）。确认「节点避障」是另一独立设置项，非兄弟线间距。
  2. **整理按钮可拖动**：改浮动按钮为 position:fixed + 指针捕获拖动（4px 阈值区分点击/拖动）+ localStorage 持久化（key `luowen.autolayout.btnPos`）+ 视口钳制/resize 重钳；默认停靠 actionbar「运行」左侧。**z 层定案 1000**（实测顶栏覆盖层 z-999 会盖掉低 z 浮层致点击/拖动失效，设置对话框 z-1700、菜单 z-9999 在其上）。
  3. **菜单迁官方钩子**：背景右键菜单项从 monkey-patch `proto.getCanvasMenuOptions` 迁到公开扩展钩子 `getCanvasMenuItems()`，**并删除旧 patch**——1.55.18 Vue 菜单翻译层 `legacyMenuCompat.extractLegacyItems` 会差分提取旧 patch 产物，两者并存会同项显示两遍。取证与先例写入 `docs/comfyui-dev-conventions.md` §2.12。
  4. **合并时机**：auto-layout→main **推迟**，待用户宿主验收按钮/菜单/滑块通过后执行（用户「优化完按钮和菜单再合」）。
  5. **盲测口径改三工作流校准**：废弃 500 节点合成 A/B 的人肉盲测用途；改由用户提供 示例工作流1 / 整理后2 / 手动期望3 三份文件，重点分析 2↔3 差异以改进自动布局（待用户给文件名）。
  6. **文档卫生（用户批准）**：去除 project-progress「实施轮」×3 与「工具链」×2、decision-log DEC-043 补记 F×3 的**字节级相同重复**（各保留首份，实施轮保留含 R1/R2/R3 的超集）；仅删重复副本、不删任何历史信息。补最新 handoff。
- **验证**：`.verify/p7/ui-round-verify.mjs` 全绿（滑块注册/联动/还原、按钮停靠对齐、拖动+持久化、重载恢复、点击布局+撤销、背景右键→络纹子菜单→整理全图+撤销）；截图 ui-round-settings/btn-dragged/menu.png；宿主部署 SHA256 一致；单测 151/151。**修复结果待用户宿主验证**（禁止自行宣称已修复）。
- **结果**：代码+文档已就绪并本地提交；待用户验收按钮/菜单/滑块 + 提供三工作流文件名；合并 main 暂缓。

### DEC-044 补记（2026-11-09，用户验收通过 + 合入 main + 三工作流校准分析）

- **验收与合并**：用户宿主验收通过（按钮拖动/点击、右键菜单、兄弟线间距滑块）。按「优化完按钮和菜单再合」执行 fast-forward 合并：main `e6c2629`→`2892fff` 并 push（`origin/main`=`2892fff`）。
- **校准分析（test2↔test3，10 节点 Z-Image-Turbo；拓扑/连线/参数逐字节一致，仅 6 位置 + 2 尺寸改动）**：
  1. **水平间距过宽根因**：自适应层间距 `60+(maxInPorts−2)×20` 把 widget 输入计入端口（KSampler 10 个输入而非 4 个入边）→220px；用户压到 70–136px。改进=只数入边（in-degree），得 ~100px。低风险快赢。
  2. **主链顶边对齐**：用户把 ModelSampling→KSampler→VAEDecode→SaveImage（+UNETLoader）顶边统一 y≈54；现 ELK 居中放置 + straightenEdges 只对端口、不对顶边，主链顶边参差。改进=主链顶边对齐后处理（待设计）。
  3. 左列右移（x13→138）是①的连带结果（首列净距 222→136 推向中列锚点 x615）；两处手动改尺寸属美化/widget 适配，非 F-015（仅 pos）范畴，不纳入算法。
- **结果**：合并完成；校准改进①（端口计数）与②（主链顶边对齐）交用户裁决后实施。对比图 `.verify/p7/calibration-compare.html`（已渲染验证）。

## DEC-043: 自动布局（F-015）研究与实施计划立项——任务书核实评估通过并落盘可执行计划

- **日期**：2026-11-08
- **背景**：用户提供另一 AI 起草的《自动布局深度研究与方案设计任务书》（luowen-auto-layout-research-brief.md）。逐项核实后：结构合格、边界纪律正确（研究/实施分离、硬约束一票否决、版本核对、反方审查），但含 3 处事实预设错误（F1「三引擎长期存在」——Layout 引擎不存在、Theme 仅配色 token；F2 前端路径未锁版本——已取证 1.55.18 实有 layoutMutations/layoutStore/graphLayoutAttachment/types 且 LayoutSource 仅 canvas/vue 两值；F3 Vitest——本项目 node:test）与 2 处重要遗漏（G1 宿主原生「整理」useArrangeNodes vertical/horizontal/grid + gap——任务书未提；G2 本项目 verify()/graphRead/Reroute 判定等结构不变量资产可复用）。
- **决策**：
  1. 评估结论与修正后事实基线落盘为可执行计划 `docs/specs/auto-layout/plan.md`（§1 核实表 / §2 事实基线 / §3 阶段 A–E 计划 / §4 用户决策清单 / §5 禁止事项）。
  2. 阶段推进：A 现状与宿主审计（含 layoutStore↔node.pos 同步语义定案、真实样本征集）→ B 图模型与约束模型（纯函数）→ C 算法对照（elkjs/Dagre/自研，依赖 vendor 政策先决）→ D 真实画布原型（页面级注入，不改生产代码）→ E 性能 + 最终 PRD。每阶段一轮、完成即停等验收。
  3. MVP 建议口径：流向布局（全图）+ 选区局部布局（固定未选节点）；功能分组/入口出口组织证据不足、列为后续。
  4. 研究阶段不改生产代码；实施轮另行启动（沿 DEC-042 对照表口径）。
- **验证**：本条目所引取证均为 1.55.18 sourcemap file 级证据（layoutMutations.ts 全文 2698 字符、useArrangeNodes.ts ArrangeLayout 三模式、LayoutSource 枚举）与仓库 HEAD 4859a18 状态；plan.md 详列。
- **结果**：计划已落盘待用户批准开工；阶段 A 待启动。

### DEC-043 补记 A（2026-11-08，分支 auto-layout，Phase A 完成）

- **执行**：按 plan.md §3 阶段 A 完成现状与宿主审计，报告 `docs/specs/auto-layout/audit.md`。要点：
  1. **写入路径裁决**：自动布局采用「node.pos 批量提交 + 布局前单次 changeTracker.captureState」，不 import useLayoutMutations——静态证据：graphLayoutAttachment 是 node.pos↔layoutStore 双向桥（pos 直写经 commitNodePosition 收口到同一 applyOperation('moveNode')，store 版本机制回读渲染），两条写法殊途同归；运行时证据：useLayoutMutations 为未暴露的 Vue 组合式工厂且 LayoutSource 仅 canvas/vue 两值。
  2. **撤销机制反例（实测）**：宿主经典 graph.arrange() 执行后 10/10 节点重排且我方路由跟随（视口裁剪后 8 条），但 Ctrl+Z **不恢复**（直写 pos 未进 changeTracker）——F-015「单条 undo」必须由我方显式 captureState，宿主路径不可依赖。
  3. 原生整理对照表（经典 arrange 无 Group/Reroute/撤销处理 vs 目标差异化）；ArrangeButton（三模式+gap）静态取证完成、DOM 入口留 Phase D 补测。
  4. 样本征集待用户（缺失期间以合成样本+fixture14 代替并如实标注）。
- **验证**：探针 .verify/p7/（arrange-probe/2 + host-ga.js + host-layoutStore.js 全文摘录）；audit.md 逐条带证据。

### DEC-043 补记 B（2026-11-08，分支 auto-layout，Phase B 完成）

- **执行**：图模型与约束模型落地 `luowen/web/layout/`（graph-model.js/metrics.js/constraints.js，纯计算层零 import、grep 已证）+ 单测 20 项（layoutModel 11 + layoutMetrics 9），全量 **144/144**。规格 `docs/specs/auto-layout/model.md`。
- **关键口径**：
  1. Reroute 折叠（DEC-033 引申）：进链沿唯一出边折叠、被吞段移除并记 rerouteChain、边标 manualIntent；分叉/汇合/成环保守不折叠 + dropped 如实；Reroute 不计分量/拓扑序但保留位置布置。
  2. Group 成员按几何包含推导（serialize 无显式成员）。
  3. 指标 9 项全可计算（crossings/length/backward/bends/portAlignment/cohesion/footprint/overlaps/displacement），MVP 口径限制（端口均分投影/直连线段/曼哈顿弯折）如实标注待 Phase D 校准。
  4. 约束模型：局部布局未选全 fixed+障碍、pinned 恒 fixed、lockedGroup 并入、Reroute 意图进 notes。
- **验证**：真实样本冒烟（`.verify/p7/sample-smoke.json`，207 份样本库六维选样）——largest 230 节点 build+eval 19ms；mostReroute 116 Reroute 折叠后边数 226→114；三样本全部 topoOrderValid；现状基线 largest=116 交叉/9 重叠/35 反向（mostGroups）。缺陷与修复如实：折叠初版未移除被吞链尾边 + 分叉首断漏记 dropped + components/topo 含 reroute——单测抓出后修正；两处测试期望自身算错（bounding 范围/链段方向）修正。
- **结果**：阶段 B 完成，停等用户验收；阶段 C（算法对照，vendor 政策先决）待启动。

### DEC-043 补记 D（2026-11-08，分支 auto-layout，Phase D 完成）

- **执行**：真实画布原型（页面级注入 ELK vendor bundle，不改生产文件）`docs/specs/auto-layout/prototype-report.md`。硬约束机检全绿：拓扑不变（verify ok）、**撤销 23/23 恢复**、幂等 23/23、固定节点 0 位移、209 节点 ELK 95–117ms、reload 无残留。
- **关键修正（Phase A 假设证伪）**：`graph.beforeChange/afterChange` 事务**不产生 undo 记录**（实测）。真实撤销链 = Pinia `workflow` store → `activeWorkflow.changeTracker`（运行时实证可达路径 `app.extensionManager._p._s`）：
  1. `captureCanvasState()` 为 **activeState 模型**——调用时把上一个 activeState 压入 undoQueue，因此**布局前 + 布局后双采**才可撤销（单采无效，undoQueue 0→1 实证）；
  2. `changeCount>0`（事务内）时 capture 被跳过——事务包裹反而有害；
  3. 撤销语义=整图快照恢复，恰满足 F-015「单条 undo」（一次布局=一条 undo）。
- **折叠（智能尺寸）机制定案**：`node.collapse(true)` 置位 collapsed 标志（渲染收窄由宿主负责），**node.size 不自动变**——「智能缩小」须显式写 size（[宽, 标题高]），属 pos+size 写入。收益可计算（单 Note 280×375→高 ~30，节省 ~345px）。**边界待用户决策**：超出 F-015「仅 pos」，需 PRD 修订允许「折叠标志+折叠尺寸」写入（默认关、可选开关）；语义规则 MVP 建议只折叠 Note/Markdown 类。
- **结果**：阶段 D 完成；阶段 E（性能+最终 PRD）待启动。

### DEC-043 补记 E（2026-11-08，分支 auto-layout，Phase E 完成——研究任务收官）

- **执行**：性能台账入 performance.md（端到端 ≤300ms@230 节点，分桶明细）+ 最终《自动布局 PRD/技术方案》`docs/specs/auto-layout/prd.md`（任务书 §8 十六项齐备，证据分级标注，实施拆分 5 步）。
- **交付状态**：研究任务 A–E 全部完成；PRD 为草案 v1.0，**待用户批准后启动实施轮**（批准时同步修订 PRD §4.2 F-015 边界——若 D1 折叠开关获批）。
- **需用户拍板（prd.md §15）**：D1 折叠写入边界修订（建议批准，默认关）/ D2 MVP 范围（建议 MVP-1+MVP-2）/ D3 Group 重组（建议不做）/ D4 盲测时机（建议实施验收时）。
- **结果**：DEC-043 全部补记 A–E 结案；实施轮（5 步，每步对照表验收）待用户批准。

### DEC-043 补记 F（2026-11-08，分支 auto-layout，实施轮完成——D1–D4 用户批准后实施）

- **执行**：按 prd.md §17 五步实施（本笔为 1–4 步 + 验收）：
  1. **布局快照适配器**：`luowen/web/layout/engine.js` snapshotFromGraph（LGraph duck-typed 现场快照，单测 3 项）。
  2. **ELK 编排**：runAutoLayout(app, {scope, collapseNotes})——vendor 懒加载（浏览器 UMD 解析修正：self.ELK）+ movable 子图 + 端口 FIXED_SIDE + **captureCanvasState 前后双采**（单条 undo，Pinia workflow store 路径）。
  3. **障碍规避**：shiftToFreeBand（局部场景 movable 布局整体平移到 fixed 包围盒右侧空白带，确定性单次平移，单测 1 项）。
  4. **Group bounds 重算**：按快照同序索引对齐现场 groups（LGraphGroup 无 id 可靠匹配）+ **正规写入口 setBounds/commitBounds**（_bounding 为 Rectangle 实例，直接 splice 无效——运行时取证修正）+ recomputeInsideNodes 不调用（保留原成员语义）。
  5. **触发 UI**：`LuoWen.AutoLayout.CollapseNotes` 设置（D1，默认关，i18n 双语）+ `window.LuoWen.autoLayout(scope)` API；菜单/快捷键挂接待宿主命令 API 取证（如实标注）。
- **D1 落地**：折叠写入 = Note/Markdown 类 collapse(true)+size[1]=30（collapsed 为 getter 只读、collapse() 为正规入口——运行时取证修正）；仅开关开启时写入。PRD §4.2 F-015 已按批准修订（pos 与可选折叠状态）。
- **验收（六真实样本，`.verify/p7/accept-probe.mjs` + impl-accept.json）**：full 布局全绿——moved 全量、交叉 30/74/66/72/1/0、**重叠全 0**、幂等 N/N、**undo N/N 恢复**、verify ok；折叠开关 on→collapsed+30px、off→不折叠；局部布局 2 动 21 不动（未选零位移）。探针过程缺陷如实：S2 崩溃泄漏 CollapseNotes=true 致 S1 undo 假失败（探针缺 try/finally——BUG-008 纪律重申）+ ELK UMD 浏览器解析（self.ELK）+ evaluateLayout 漏 import + forEach continue 非法 + Group 匹配需索引对齐，均探针/检查抓出后修正。
- **结果**：实施轮 1–4 步完成并部署（SHA256 一致）；第 5 步性能台账与盲测按 prd.md §12/§13 口径随验收执行（盲测待用户组织）。PRD §4.2 已回写。

### DEC-043 补记 G（2026-11-09，分支 auto-layout，后续三项完成）

- **执行**：
  1. **快捷键**：Ctrl+Shift+L=全图 / Ctrl+Alt+L=选区（keydown 全局监听，输入框内不触发）。1.55.18 无公开命令注册 API（sourcemap 全量检索无 registerCommand）→ 画布右键菜单挂接列待宿主 Vue 菜单组件取证。
  2. **500 节点梯度**：500 LatentBlend / 499 链——ELK 端到端 421ms（engine 375ms），moved=500、straightened=499。性能预算达标（≤1s@500）。verifyOk=false 为探针 baseline 过期（graph.clear 后未 rebase），非实际缺陷。
  3. **盲测 A/B 文件**：默认模板原布局（blind-A-original.json）+ 自动布局后（blind-B-autolayout.json），交用户/参与者做盲测对比（D4）。
- **结果**：后续三项完成。F-015 全部交付项（菜单快捷键/触发 UI/引擎/障碍规避/验收机检/性能梯度）至此闭合，剩余盲测由用户执行。

## DEC-042: 动效 v3 实施口径——beam 主线型、自停+唤醒、设置收窄迁移（研究报告 §7 拆分 ②③④）

- **日期**：2026-11-08
- **背景**：DEC-041 裁决与研究任务 v2 收官后，用户指示「实施吧」。实施范围=研究报告 §7 拆分的 ②自停+唤醒 ③beam 线型 ④DEC-041 落地；BUG-009（①）已随 10e9575 完成。
- **决策**：
  1. **beam 参数三档**：`LuoWen.BeamSpeed`（0–10 档，×30=屏幕像素/秒，默认 2）、`LuoWen.BeamLen`（12–160 屏幕像素，默认 48）、`LuoWen.BeamSpacing`（80–600 屏幕像素，默认 240）；「动效·光束」设置组。
  2. **FlowStyle 收窄**：仅 `beam`/`dash`；已存 glow/pulse 值在运行态映射为 beam（onChange/setSettings 迁移），服务端原值保留不动、用户下次触碰该设置自然覆写。
  3. **自停+唤醒**：flowLoopTick 无 work/隐藏/指针按下即自停（不重排 RAF）；唤醒=我方设置 onChange、api 执行事件、window keyup/wheel/pointerup、visibilitychange、matchMedia reduced-motion change、afterConfigureGraph、legacy onSelectionChange（链式挂钩）。选择唤醒不依赖选择回调——1.55.18 Vue 模式只置 state.selectionChanged 不回调（selectionAdapter.ts 取证）。
  4. **相位语义**：墙钟改为 dt 累加器（单帧 ≤100ms 钳制），仅本帧真的会动时推进；暂停/恢复/隐藏无跳变（探针实测 frozenDelta=16ms≈1 帧、resumedDelta=417ms/400ms）。
  5. **主干去重**：组内首成员画全路径、其余成员跳过 [0,forkT)（forkT=trunkPlan 公共前缀弧长）；颜色构造性一致无需混色规则。
  6. **glow/pulse 移除**：4 个设置项与绘制分支删除；uninstall 收编 cancelAnimationFrame + 唤醒监听拆除 + 选择钩子还原（BUG-009 观察项 G 落地）。
- **验证**：单测 124/124（新增 beamTrace 4 项：flatten 端点/弧长/偏差上界、pointAtPx/subPolyPx 区间守恒、beam 覆盖段冒烟）；宿主探针 `.verify/p6/anim-v3-verify-result.json` 全绿——自停（selected 空选/executing 空闲/生成中禁用三态 setDirty=0 且 RAF 增量=0，BUG-009 时代 RAF 仍 +65/s）、点击唤醒、相位冻结、glow→beam 迁移、reload 自启、预算 beam p95 1.2ms vs dash 1.1ms（+9% ≤+10% 口径）、beam 视觉（v3-beam-zoom74/zoomtrunk：正交+圆角+亮束+主干单流束）；restoreOk/finalVerifyOk。
- **结果**：已部署宿主（SHA256 一致）并自测通过；待用户验收。

### DEC-042 补记（2026-11-08 用户反馈两则，当日修复）

- **线型下拉框空显**：已存 `glow` 值不在新选项列表 → combo 显示空白（运行态已迁移但 UI 读原值）。改用 1.55.18 原生迁移机制 `SettingParams.migrateDeprecatedValue`（settingStore.tryMigrateDeprecatedValue，注册期调用并回写 store）——reload 后 store 值即迁为 `beam`（探针 m1：storeAfterReload=beam），下拉框正常显示。
- **beam 可见性不足**：束段改三层伪发光——外晕（3× 宽、α0.25）+ 亮芯（混白 60%）+ 亮头（混白 88%、1.25× 宽）；不用 shadowBlur（§3.4 不可扩展结论不变）。预算：beam p95 1.7ms vs dash 1.5ms（10 线，绝对值远低于 33.4 口径）。视觉：`v3b-beam-glow-zoom.png`（束段外晕+亮芯清晰可辨）。
- 用户自调参数如实记录：BeamSpeed=6 档、AnimMode=全图（氛围）。

### DEC-042 补记 2（2026-11-08 用户纠正 i18n 架构，当日实施）

- **用户反馈**：语言不应双语拼接显示，应有独立语言设置，文案应放独立文件。
- **决策**：
  1. **独立语言文件** `luowen/web/i18n.js`：zh/en 两套字典（52 对 key，含全部 18+1 项设置名/tooltip/combo 选项文案），`t(key)` 取串，缺失回退中文再回退 key。
  2. **新增设置 `LuoWen.Language`**（基础组，combo：跟随宿主/中文/English，默认跟随宿主）：`auto` 按宿主 `Comfy.Locale` 解析；`t()` 每次渲染实时读取——设置项以 getter 暴露 name/tooltip/options，切换后重开设置面板即生效（无需刷新页面）。
  3. **撤销双语拼接**：17 项设置名恢复单语（由语言文件按所选语言出词）；codemod 见 `.verify/p6/i18n-codemod.mjs`。
- **验证**：探针 `.verify/p6/i18n-verify.mjs`——auto(宿主 zh) 下中文名 5/5；切 en 重开面板：英文名 5/5、中文 0/5、选项值全链路本地化（Light Pulse / Executing / High）；还原 auto 回中文；`finalVerifyOk`；截图 `v3d-i18n-zh/en.png`。单测 124/124。
- **结果**：已部署宿主（index 6adcd33e / i18n 79a57b9a），待用户验收。

## DEC-041: 连线动效语义四层框架与出厂默认修订——all 降为氛围装饰、selected 设为默认（研究任务 v2 第二阶段裁决）

- **日期**：2026-11-08
- **背景**：研究任务 v2（luowen-motion-research-prompt-v2.md）第二阶段要求对「DEC-040『唯一语义=正在发生的数据流』与默认 all 空闲持续动画」的矛盾做第一性原理裁决。证据链见 docs/specs/motion-research.md §2：外部源码取证（AnimatedLinks 动效仅 hover 关注范围出现但调度器常驻 rAF，animated_links.js:355-376；EnhancedLinks 执行事件驱动+错误态+选中 FX+聚焦+wake() 空闲睡眠，GPL 仅概念对照）；宿主原生执行闪光（triggerSlot→link._last_time 白色渐隐）=「连线执行信号」的本体先例；本机实测 all=持续 60fps 全量重绘的结构性成本；主要用户自发从出厂 all+dash 迁移到 selected+pulse+自定参数。
- **决策**：
  1. **四层语义框架**：连线动效可诚实表达的只有 执行态（唯一状态性语义，execution 事件驱动）＞关注态（唯一位置性语义，自限）＞方向提示（自终止辅助）＞氛围装饰（不表意，须 opt-in+如实标注）。完成/错误态本轮不扩展。
  2. **DEC-040 第 1 条修订**：「动效唯一语义=正在发生的数据流」收窄为「执行态动效的唯一语义=正在发生的数据流」；全图持续动效的真实语义=氛围装饰，不表意。DEC-040 其余条目（三重闸门/预算约束/WCAG 口径）不变。
  3. **三模式保留不合并**：executing=执行态（事件驱动，不变）；selected=关注态（焦点期间持续，不变）；all=氛围装饰（重定义口径）。
  4. **出厂默认 all→selected**：出厂即诚实语义+静态空闲；executing 不作默认（与 DisableAnimOnRun 默认开组合=出厂零动效）。
  5. **all 口径重写**：label/tooltip 如实标注「空闲时也持续动，属装饰，不代表正在执行」；设置 value 不动，已存值不受影响。
  6. 「短暂」只约束自动触发的方向提示；选中期间持续动效属自限，不强制短暂。
- **验证**：本裁决为产品/设计决策，引用证据均落 docs/specs/motion-research.md §2.3（含证据等级标注）；E6「持续运动读作忙碌」为设计假设，留第七阶段盲测检验。
- **结果**：用户拍板采纳（2026-11-08）；术语已入 GLOSSARY「动效」节。**实施（默认值/label/tooltip 改动）排在研究任务收尾的实施轮，不在研究期间动设置与代码**；PRD 回写随实施轮一并执行。

## DEC-040: 动效系统 v2——以「执行」为第一信号、以帧预算为约束（第一性原理审查）

- **日期**：2026-11-08
- **背景**：B 项上线后用户提出五点：动效模式细化（全图/仅选中）、生成时禁用（默认开，运行时关结束自动恢复）、两主题颜色近同的疑问、动效独立设置组（间距/流速/发光/脉冲）、第一性原理审查。前置调研（file:line 级）：① api 执行事件在 `api-DTg5QMcw.js`——websocket 分支 `executing`→`dispatchCustomEvent('executing', display_node||node)`，`execution_start/error/interrupted/cached/success/progress` 原样透传，运行时 `api.addEventListener` 可订阅；② 宿主动画开关 id=`Comfy.Appearance.DisableAnimations`（boolean，settings-BoUVXjXn.js 定义、GraphView-C7jM5DM_.js 消费）；③ 原生 flow 动效：bundle 静态检索无 `renderLink` 定义（仅 1 处且为 `linkConnector.renderLinks`），运行时方法存在（探针实证）但 flow 分支无证据——**按「1.55.18 无可用原生流动效」处理，我方 dash 是唯一实现**；④ 线型原型微基准（33/500 线，独立 canvas）：solid 0.05/0.05、dashed 0.04/0.18、shadowBlur 发光 0.02/0.15、光晕双描边 0.02/0.12、脉冲（宽度振荡）0.01/0.08 ms/帧——**全部远低于预算（≤1ms@33 线 / ≤5ms@500 线）**，三种线型全部可提供。
- **决策**：
  1. **动效唯一语义 =「正在发生的数据流」**。据此定义三模式：`全图`（现状）/`仅选中`（只动与选中节点相连的线）/`仅执行中`（只动与当前执行节点相连的线；空闲时零动画零重绘）。模式默认 `全图`（保持现行为）；`仅执行中` 是信息量最高形态，但受第 2 条开关节制。
  2. **生成时禁用开关 `LuoWen.DisableAnimOnRun` 默认开**：队列运行期间（`execution_start`→`success/error/interrupted`）所有模式的动效一律暂停，结束后自动恢复。已知张力并接受：开关开 + 模式「仅执行中」= 运行时也静止（用户若要执行可视化，把本开关关掉即可）——两个设置正交，语义如实写进 tooltip。
  3. **spec §6.1「不脉冲、不发光」修订为**：装饰性动效默认不提供；「发光（shadowBlur 恒定光晕）/脉冲（宽度振荡）」作为显式线型提供，须过帧预算（本次微基准已过）与对比度门槛（发光后的有效颜色=描边色叠加光晕，门槛按描边色本身继续适用）。原禁令的理由（噪声与眩晕）由「默认虚线行进 + 三重闸门 + 用户可选」承接。
  4. **两主题近同的裁决**：实测六头部类型 hex 差 <0.01（dark `#C1BA59` vs cyber `#C1BC64` 等）——色相族固定、仅 L/C 微调导致肉眼难辨。裁决：**重调 cyberpunk**（提高色度做霓虹感、拉开明度带），重跑 `verify.mjs --strict` 全部门槛，过则重物化；门槛过不了则合并为单主题（不留两个假主题）。
  5. **空闲零重绘**：动效 rAF 循环仅在「主题开 && FlowAnim 开 && 模式下存在该动的线 && 页面可见 && 非(开关开且运行中)」时驱动 setDirty；`仅执行中` 模式空闲时循环自停。宿主开关 `Comfy.Appearance.DisableAnimations=true` 时我方动效一并关闭（附加闸门）。
  6. **WCAG 2.2.2（无限动画可暂停）**：本扩展动效完全由用户设置控制启停（总开关即暂停机制）且尊重 prefers-reduced-motion，以此作为合规口径记录。
- **验证**：本条目所引微基准与取证均落 `.verify/p5/coexist/anim-v2-*.json` 与 conventions §2.11；实现后的逐项验收见 progress 本轮条目与 performance.md §2026-11-08。
- **结果**：已实现并宿主验收（单测 110/110；mock 队列事件链与三模式/三线型/双闸门全绿；cyberpunk 重调过全部门槛并重物化；数据见 progress 本轮条目与 performance.md §2026-11-08），待用户验收。

## DEC-039: 连线配色 token 与主题接入渲染层（B 项落地口径）: 连线配色 token 与主题接入渲染层（B 项落地口径）

- **日期**：2026-11-08
- **背景**：DEC-029/spec 已定「类型轴 + 三级 token + 接入点=renderLink 的 stroke」，验收材料齐（62 类覆盖 100%、对比度/ΔE 过门槛）；A 项（smooth Bezier）验收通过后按执行序开工 B。
- **决策**：
  1. **单一来源**：`docs/specs/link-color-tokens/materialize.mjs` 把 token JSON + `data/link-colors-*.json`（verify.mjs 产物）打包为 `luowen/web/colors/materialized.js`（含生成横幅与再生成命令）；运行时零 OKLCH 计算，只查表。
  2. **取色优先级**：`resolveLinkColor(link) ?? 原生 color 实参 ?? '#94a3b8'`——主题开启时语义色生效；关闭（默认）时行为与接入前逐字节一致（`colors-off.png` 对照）。
  3. **设置面**：`LuoWen.ColorTheme`（off/dark/cyberpunk，默认 off，线路外观组）+ `LuoWen.FlowAnim`（默认关）；动效三重闸门=用户开关 && 非 prefers-reduced-motion && 缩放 >0.4；流向=虚线沿路径行进（源→目标），token `flow.enabled:false` 即设置默认值的规范来源。
  4. **边界**：不写 `graph.extra`/节点数据；不造主题引擎/渲染模式；cyberpunk.json 与 dark.json 主题文件原样不动；类型轴不变（62 类显式 + 13 条长尾正则 + link.unknown）。
- **验证**：单测 109/109（新增 linkColors 4 项：默认 null/62 类 hex 合法/映射与 token 产物逐值一致+长尾/动效三闸门）；宿主 `colors-accept.mjs` 全绿——off/dark/cyberpunk 三态 verify ok、`colorDebug()` 按类型解析与 token 产物一致（MODEL #A192E5 等）、流向虚线运行两帧截图 `colors-flow-1/2.png`、reduced-motion 强制实线 `colors-flow-reduced.png`、还原后宿主 `comfy.settings.json` 的 LuoWen 键保持用户原值；500 节点主题开 46.0ms vs 关 48.4ms（噪声内，Map.get 可忽略）；截图 `colors-off/dark/cyber.png`。插曲如实记录：导出名不一致（colorDebug/getColorDebug）导致模块图加载失败一次，改名后通过；探针设置持久化到服务端 `comfy.settings.json`，测后已还原。
- **结果**：随本轮提交；主题文件、调色板注入均未改动，接入点与 spec §5.2 一致。

## DEC-038: 产品边界修订——自动布局纳入范围；手动锚点豁免；发布材料延后: 产品边界修订——自动布局纳入范围；手动锚点豁免；发布材料延后

- **日期**：2026-11-07
- **背景**：用户质疑「PRD 内容是否都做了」并点名自动布局/主题未做。对账结论：①自动布局在 PRD §2.3（非目标）与 §4.3（P2）两处被排除；②主题属配色 token 设计任务（spec 就绪、代码未接）；③发布材料在剩余功能未齐时不该启动。用户逐项拍板：自动布局**纳入范围**；手动锚点**豁免**；发布材料**延后**。
- **决策**：
  1. **自动布局纳入**：PRD §2.3 由「不属于本产品范围」改为「独立功能纳入范围」；§4.2 P1 新增 **F-015 智能节点自动布局**——用户主动触发（菜单/快捷键/设置项）、一次性重排、**单条 undo 可撤销**、不静默改动、不在渲染热路径运行、只改 pos 不动连接数据、执行前快照失败回退；§4.3 相应移除。AGENTS.md 禁令行同步修订并留痕 agents-changelog。**实现另行排期**（顺序在 A smooth Bezier / B 配色主题 / C fixture / D 性能之后）。
  2. **手动锚点豁免**：F-010/AT-018 的 MVP 口径（§8.4 L420「包含原生 Reroute 链的连接默认不参与跨目标自动合并」）已由 `01d8df7` 达成并验收；PRD 未定义独立的手动锚点创建 UI，用户能建的手动锚点即原生 Reroute。验证面并入共存验证 Reroute 场景（§5.5 各循环已覆盖）。**P0 欠账就此清空**。
  3. **发布材料延后**：用户明示「现在没到发布的时候」；待办 3 从近期序列撤下，待 A–E 剩余项完成后重启。
  4. **剩余工作顺序（用户定）**：A smooth 真 Bezier → B 配色 token + 主题接入 → C §14.2 fixture 2→10 → D 性能冲刺 / E AT-027/028 + 子图内四类；F 自动布局（实现排期）殿后。
- **验证**：PRD 修订 diff（§2.3、§4.2、§4.3）；AGENTS.md 一行修订 + changelog 留痕；本条目。
- **结果**：待办 3 挂起；F-015 待排期；A 项随即开工。

## DEC-037: 验收分工——机器可验证项 AI 自动跑，用户保留签字权

- **日期**：2026-11-07
- **背景**：BUG-006 幽灵条目肉眼不可见，无法用「看画布」验收；用户明确指示「这种能自己测不需要我肉眼看的就自己跑」。原规则「修复结果须由用户验证」在机器可客观判定的项上造成重复人工。
- **决策**：
  1. **机器可验证项**（脚本实测、单测、`LuoWen.verify()` 对账、几何逐点比对、性能 A/B）由 AI 自动执行，交付「预期 vs 实测」对照表与可复跑脚本路径。
  2. **用户保留**：观感/手感等主观项的亲自验收，以及最终结论的签字权；AI 不得在用户确认前写「已验收」。
  3. 对照表即验收材料：用户看表确认一句即完成该项验收，不再手工复跑。
  4. 本口径适用于后续全部待办（含待办 1 第三方运行时验证的逐项结论）。
- **验证**：`.verify/p4/mirror-user-steps.mjs`（BUG-006/007 对照表，复刻用户控制台步骤全绿：删线后 `routed==links` 9/9、`hover=null`、`verify` 如实报 `link-removed: 78`、undo 恢复 ok、extra/properties 写入检出、拖动只进 `moved`；2026-11-07 交付并经用户确认）。
- **结果**：BUG-006、BUG-007、待办 2 四类按此口径记验收通过；后续待办照此执行。

## DEC-036: 第三方共存只做源码级取证，运行时验证单列待批

- **日期**：2026-11-07
- **背景**：阶段 3 需要回答 Cable Management / NKD Reroutes / Zip Ties / rgthree-comfy 的共存冲突，但 AGENTS.md 目标环境锁定明确「不动宿主环境依赖」，安装第三方扩展属红线操作。
- **决策**：
  1. 共存分析限定为源码级：只把扩展浅克隆到临时目录读源码，不装进 `D:\AIGC\ComfyUI_windows_portable\ComfyUI\custom_nodes`，不改宿主依赖。
  2. 结论按「无交集 / 可能冲突 / 确定冲突」三档落 `docs/agents/compatibility-matrix.md` §5.4，共 19 条（8 / 8 / 3）；「确定冲突」为 NKD 双路由引擎、NKD Shift 双磁吸、Zip Ties 分段重绘。全部标注「未做运行时验证」。
  3. 运行时验证（安装位置、依赖、影响面、回滚与逐装逐卸步骤）写入 `docs/specs/third-party-coexistence/spec.md` §6，等用户单独批准后才可执行。
  4. 环境事实纠偏：宿主 `rgthree-comfy` 目录已存在但服务未加载，矩阵原「四者均未安装」改为准确描述；不因此改动宿主。
- **验证**：源码取证带 `file:line`（见 project-progress 本轮条目与矩阵 §5.4）；无运行时数据，不作为「已兼容」结论。
- **结果**：文档随 `5146c82` 提交；运行时验证仍缺，保持待批。

## DEC-035: 性能优化只做两项、先量后改、同页面 A/B

- **日期**：2026-11-07
- **背景**：`docs/agents/performance.md` 建台账后，500 节点图仍远低于交互帧率；需要在不改几何的前提下压成本，且未测量不得宣称改善。
- **决策**：
  1. 以实测热点排序决定顺序，只做两项：`trunkCache` 上限 64→4096（消除每帧整表清空导致的整图重规划）、chamfer 预筛（把斜切候选粗筛放到几何计算前）。
  2. 两项都不改可见几何：trunkCache 只改容量与注释；chamfer 预筛只提前排除不可能命中斜切的角，输出折线需与优化前逐点一致。
  3. 验收口径：同一宿主、同一页面、同一布局做 A/B，记录帧时分布与热点；原始数据与复现入口写入 `docs/agents/performance.md`，结论必须附测量方法与样本。
  4. 后续候选按收益排序为帧内复用（`nodesById`/`obstacles`/endpoint 索引）→ bands 采样降级，未经测量不提前实施。
- **验证**：chamfer 预筛后 500 节点 ortho 131.09ms；trunkCache 修复后 500 节点仍 47/48 帧 >33.4ms，说明距达标仍远，未宣称性能达标。数据见 `docs/agents/performance.md`。
- **结果**：两项分别随 `9f93d3c`、`8d55a0b` 提交。

## DEC-034: verify() 快照纳入 extra / node.properties，坐标只报 moved

- **日期**：2026-11-07
- **背景**：共存分析暴露 `verify()` 盲区（矩阵 C6/Z4）——快照只比 kind/nodeCount/节点 id/link 元组，第三方写 `graph.extra` 或 `node.properties` 时自检仍报 `ok:true`。
- **决策**：
  1. `snapshotGraph` 增加 `extra`（按非宿主键过滤后做键深排序规范化）、每节点 `properties` 规范化 JSON、节点坐标（3 位小数，兼容宿主 Float64Array）。
  2. 宿主自有 extra 键固定排除十项：`ds / frontendVersion / linkExtensions / linkPresentation / reroutes / workflowRendererVersion / BlueprintDescription / BlueprintSearchAliases / linearMode / linearData`。
  3. 坐标变化只写入 `verify().moved`，不计入 `ok/diffs`，避免用户拖动导致误报；`diffs` 新增 `extra-*`、`node-prop(id)-*` 键级差与节点 id 集合差。
  4. 不改图数据、不改路由几何；本插件自身不得写 `graph.extra` / `node.properties`。
- **验证**：`.verify/p4/verify-ab.mjs` 合成写入 A/B——修前三类写入均 `ok:true`，修后分别报 `extra-added` / `node-prop-added`，删除后恢复；宿主键写入保持 `ok:true`；节点位移只进 `moved`。单测 99/99、`suite.mjs` 16 个 verify 全 ok，见 debug-log BUG-007。
- **结果**：随 `ebbc038` 提交；真实第三方写入时序仍待运行时验证。

## DEC-033: 手动意图保护——含 Reroute 链的连接不参与主干合并与等距带

- **日期**：2026-11-07
- **背景**：PRD 原则 6 / 场景 E / F-010 / §6.1（L243）/ §8.4（L420）/ AT-018 / §9.2 要求「手工意图优先」；§8.4 明确 MVP 保守策略：包含原生 Reroute 链的连接默认不参与跨目标自动合并，无法确定意图时保持原生路径。此前 `planTrunks` / `planBands` 遍历 `graphLinks` 时未排除带 Reroute 链的 link。
- **决策**：
  1. **判定层**：前端 1.55.18 的 Reroute 挂在单条 Link 上（`link.parentId` 非空即含链，见 `docs/comfyui-dev-conventions.md` §2.6）；在 adapter 新增 `carriesReroute(link)`，不改 `graphRead`、不写图数据。
  2. **主干**：`planTrunks` 遍历时跳过带 Reroute 链的 link，使其不并入主干组、不共用 `sharedPrefixLength` / `splitAt` 公共前缀；同组其余普通 link 仍可自行成组。
  3. **等距带**：`planBands` 分组时把带链 link 计入 `manual` 但不入 `members`；若排除后可平移走廊成员 `< 2` 且组内有手动成员，则整组跳过，不写 `bandDegraded` / `orderDegraded`，避免虚假降级；`orderCtx` 因不进入阶梯而不会生成。
  4. **不改**：`laneAssign`（只错开走廊、不共享几何）、`trunkPlan` 几何、`opts.reroute` 中间段原生直通、`crossCleanup`（默认关闭、消交叉非合并）、`spacing` / `k` 上限 / 降级语义、原生工作流数据。
- **验证**：见 `docs/agents/project-progress.md` 本轮条目。无 Reroute 真实图指纹 `0xb0fa2c54`（524 字符）、38 点最大偏差 6.7e-5、主干 `62:0 fork=155 merged=[79,81]`、等距带 `[76,82,78] xs [null,806.49,814.49]`、交叉 0、`verify()` ok、单测 99/99；现场 A/B（link 79 与 78 各建一条 Reroute，测试后 reload 还原、`reroutesSize=0`）：旧版 `trunks [62:0 merged [79,81]]`、`bands [76,82,78]`，补丁版 `trunks []`、`bands []`；两版 79/81/78/82/76 路线逐点一致、交叉 0、无新增降级；冻结探针（68→(1204,630)、65 y=835）复现 `cross-pivot1-k4 steps4`、82/78 `fallback:'prev'`。
- **已知限制**：本次现场样本中旧版的主干/成带计划未改变可见几何（锚点使段端点与整条计划不一致），因此以 `status().trunks/bands` 结构差异 + 路线逐点一致作为对比证据；未覆盖多 Reroute 长链、子图内 Reroute、经典画布。
- **结果**：未提交 git，交用户验收。

## DEC-032: 等距带阶梯改为方向感知 + 候选兄弟交叉预检（P0 + P0.5）

- **日期**：2026-11-07
- **背景**：BUG-005 现场——VAE解码 65 移到两个源下方后，K采样器 73 与 加载VAE 74 交叉。DEC-030 的阶梯公式隐含「rank 升序 ⇒ 走廊 x 递增」，只对 `dir='down'` 成立；`up` 组需要镜像。
- **决策**：
  1. **P0 方向感知阶梯**：`s = dir === 'up' ? -1 : 1`，`required = pivotX + s·(r-p)·dirToNode·spacing`。`down/flat` 取 +1，逐点保持 DEC-030 原算式；`down` 组逐点不变是硬约束。
  2. **P0.5 候选预检**：在 `k=0..4 × pivot` 枚举内，对候选 staged 折线与不可平移的直线成员做同组两两 `pathsCross`（沿用 crossings.js 的内点交叉 + 共线重叠口径）；交叉候选直接不提交；全部候选失败才走 `markOrderDegraded`，不新增降级类型。
  3. **改动面**：仅 `luowen/web/adapters/renderLinkAdapter.js` 的 `planBands`（+23/−6）；`laneAssign`、`trunkPlan`、`shiftCorridor` 语义、`spacing`、`BAND_MAX_SHIFT_STEPS=4`、降级与帧末校验语义全部不变。
  4. **不做**：不改 `checkOrderCrossings` 的冻结口径，不动 laneAssign 的 ups/downs/flats 分组，不引入新斜率或候选树搜索。
- **验证**：见 `docs/agents/debug-log.md` BUG-005——本例逐帧 20 帧交叉 0、旧公式同布局模拟交叉 2；远端双线 xs 与已验收基线一致、gap 8、cross 0；四线共线镜像嵌套成立、交叉 0；down 组逐点不变；单主干与 spacing=8 不变；降级/冻结探针按原语义工作；真实图指纹 `0xb0fa2c54`、`verify()` ok、单测 99/99。
- **已知限制**：`chosen.k===4`（`reason:'cap'`）的成功分支未在现场或探针触发（A* 先行避障后阶梯无需外移），仅由代码审阅与单测覆盖，不得宣称已现场验证。
- **结果**：未提交 git，未宣称已修复，交用户验收。

## DEC-031: 验收状态落盘、性能纳入验收维度与阶段 3 开工顺序

- **日期**：2026-11-07
- **背景**：用户验收了 P0 主干组交互（DEC-021 口径）、BUG-002 连线抖动修复与 BUG-003 等距带方案 A（DEC-030）；同时新增关注点「性能」，要求效果之外把性能纳入验收并在文档体系里留出位置；本轮做一次文档与协作契约对齐，不改代码、不提交。
- **决策**：
  1. **验收结论**：DEC-021 的「组高亮 + 组删除」通过验收；BUG-002 抖动修复通过验收；DEC-030 方案 A 通过验收（VAE 从 x=841 左拖到 300，24 个关键点间距恒 8px、交叉计数 0、`orderDegraded` 全程为空）。
  2. **性能与视觉效果并列验收**：性能结论必须附测量方法、样本布局与数据，写入 `docs/agents/performance.md`；未测量不得宣称达标，也不得以「几乎不发生」为由跳过降级路径。
  3. **阶段 3 开工顺序**：先补 P0 剩余欠账（手动意图保护 F-010/AT-018），再改 `smooth` 为真 Bezier 对齐 PRD §5.1，最后进阶段 3（兼容性、生命周期、冲突、性能基准、发布材料）。本轮不改 PRD 口径。
  4. **配色 token 状态**：`docs/specs/link-color-tokens/` 规格与验收材料已出，尚未接入代码；接入前任何文档不得宣称「配色已可用」。
  5. **经验库分域**：沿用 `routing` / `process`，不按技术栈改名。
- **验证**：`node --test tests/unit/*.test.mjs` 99/99（fail 0）；AGENTS.md 增量与 `agents-changelog.md` 留痕对应；project-progress / debug-log（BUG-002/003）追加验收结论。

## DEC-030: 等距带改为「先解后排序 + 引脚 y 全序阶梯 + 枢轴扇开」

- **日期**：2026-11-07
- **背景**：DEC-028 的准入条件「原走廊间距 ≤ 2×lanePitch」依赖成员独立解的结果。障碍版本一变，同组两条线的缓存同时失效，准入在真正需要成带的那一帧必然为 false 且不可逆——现场 BUG-003 复测 `bands` 恒为空，用户所见「VAE 左移、线1 翻到线2 上方」未消除。用户选定方案 A（先解后排序），并要求帧末校验覆盖「带不成立」、不许静默降级、保留现场布局。
- **决策**：
  1. **流水线顺序改为「先解后排序」**：`planBands` 先对同组每个成员各自求解（trunk → 缓存 → `solveBaseline`），再做排序、阶梯与校验。只对同目标同方向的入线预解；缓存命中时零次 A*，不重复求解。
  2. **准入只看「同 target + 同方向」**：方向按两端节点 `pos.y` 分 up/down/flat；删除「原走廊间距 ≤ 16px」硬门槛。`BAND_MAX_SHIFT_STEPS = 4` 保留为整梯外移上限。
  3. **rank 按目标引脚 y 全序**：`members.sort((a,b)=>a.ep.by-b.ep.by)`，y 最小为 rank0 = 外侧基准；目标侧走廊 x 必须随 rank 单调，相邻间距 `spacing = min(brotherSpacing, minPinGap)`，钳制时 `clamped:true`。纯直线成员（无目标侧竖段，如 L76）不参与阶梯，保持直线。
  4. **受限重解改几何版 `shiftCorridor`**：只平移目标侧竖段两端点 x（长度与端点 y 不变，相邻水平段随之伸缩），替代 DEC-028 的 `offsetStrand`；竖段为首/末段或会越过目标引脚 → 返回 null，交给降级路径。
  5. **枢轴枚举允许向外扇开**：`k=0..4` × `p=0..len-1`，`x_r = pivotX + (r-p)·dirToNode·spacing`，取第一个全部通过 `shiftCorridor + entryEndsClean + bandClear` 的方案。理由：现场把 L78 内移到 814.49 会蹭到 VAELoader 63 的 4px 外扩箱；允许 pivot=1（L78 留 726、L82 外移到 718）避开障碍同时保持序。
  6. **失败必须先显式降级**：阶梯无解 → `markOrderDegraded` 写 `bandDegraded` + `orderDegraded`（reason 具体到 `pivotP-kK-rR`）；撞 `k=4` 上限也算降级（`reason:'cap'`）。只有上一帧折线端点与当前 <0.5px 一致时才冻结 `lastGoodRoutes`，否则保留本帧解并标 `fallback:'solved'`。
  7. **帧末校验覆盖带不成立**：`checkOrderCrossings` 对同组两两 `pathsCross`（复用 crossings.js 的内点交叉 + 共线重叠口径）；相交时优先冻结上一帧端点一致且 `prev×prevOther` 不交叉的折线，否则保留本帧解，但每条都写 `orderDegraded`（`reason:'cross'`）。带外成员在 `tryCustomRender` 里按 `orderCtx.x` 回夹一次（同样过 `entryEndsClean + bandClear`）。
  8. **缓存与帧预算**：`laneKeyOf` 键口径不变；`planBands` 预解结果写入同一 `state.cache`，`tryCustomRender` 命中后直接取 `bands/orderCtx`，未出现每帧求解翻倍。
- **验证**（宿主 0.43.2 + 1.55.18，用户现场布局，节点坐标未还原）：见 `docs/agents/debug-log.md` BUG-003「方案 A 重做：先解后排序」逐帧数据；24 个关键点交叉 0、间距 8、上下序不变、`orderDegraded` 全程为空，单测 99/99，`verify()` ok。
- **未覆盖 / 已知限制**：拖动为合成 `setPos` 而非真实鼠标；继续左压未撞 `k=4`（VAE 离开走廊 y 带后阶梯无需外移），上限路径仅由代码审阅与单测覆盖；组删除菜单未现场执行（避免改动用户图数据）。
- **结果**：交用户验收；未提交 git，未宣称已修复。

## DEC-029: 连线配色采用「类型轴 + 三级 token」，接入点为 renderLink 的 color 实参

- **日期**：2026-11-07
- **背景**：用户要求连线配色与动效只服务于可读性、不硬编码、便于多主题；已有 `cyberpunk.json` 主题文件，但宿主络纹插件把描边兜底写死为 `#94a3b8`，只写调色板/主题 JSON 完全不生效（实测 33 条连线全灰）。
- **决策**：
  1. **配色轴 = 连线数据类型**，不用节点类型：实测 2318 节点类 vs 208 输出类型（真实工作流 62 类），节点类型多 11 倍且一节点多输出，按节点着色会随端点变化。
  2. **13 语义色**（9 个 OKLCH 色相族 + scalar/struct/unknown 三中性）；`video` 复用 image 色相的低明度带做冗余编码。
  3. **三级 token**（primitive → semantic → component）+ JSON Schema + `extends` 深合并；色相阶梯固定 L/C、相邻 ΔE ≥0.02；`typeMap` 显式 62 类、`typeRules` 有序正则兜底长尾。
  4. **门槛**：3px 描边对画布/卡片 ≥ WCAG 3:1；protan/deutan/tritan 仿真后两两 ΔE ≥0.02。dark 与 cyberpunk 均通过（最紧 0.0257 / 0.0236，对比度最低 3.10:1 / 4.23:1）。
  5. **动效只表达流向**：默认关闭；`prefers-reduced-motion` 降级为静止虚线；≤40% 缩放关闭。有效线宽随缩放为 3×scale（1.20px @40%）。
  6. **接入点**：必须是 `renderLink` 第 7 个 `color` 实参（或插件 `tryCustomRender` 的 `stroke` 解析）；只改 `LGraphCanvas.link_type_colors` / `--color-datatype-*` 无效。本轮只写规范，不改代码。
  7. 编号说明：`DEC-028` 已被 adapter 注释引用（同目标等距带，尚未补记），本条跳号以免冲突。
- **验证**：62/62 实测类型覆盖；4388/4388 连线显式命中；`verify.mjs --strict` 全门禁通过；三档真实渲染截图（100%/60%/40%）；计时代理（同色候选 33→1）与动效成本（+0.70ms/帧）已记录。
- **关联**：`docs/specs/link-color-tokens/spec.md`、`evidence.md`、`acceptance.md`、`link-tokens.schema.json`、两份主题 token 与 `verify.mjs`。

## DEC-028: 同目标兄弟线改为「等距带（ribbon）」，间距可调并按引脚 y 差钳制

- **日期**：2026-11-07
- **背景**：BUG-003 方案 A 只做到「两条线不落在同一 x」，用户验收口径更硬：线1 绕行时必须与线2 **保持恒定间距并跟随其形状**，不是各自在障碍间找空位、恰好错开；smooth 样式也不做斜线通道。VAE 左移时线1 让到上限就停，不得翻到线2 上面或穿越。
- **决策**：
  1. **同带判定**：同目标节点 + 同一接近方向（按节点 y 分 up/down/flat，不跨组，避免平行偏移翻转已验收的输入侧嵌套次序）+ 原走廊间距 ≤ `2 × lanePitch = 16px`。阈值理由：`laneAssign` 名义步长就是 1×pitch；冲突簇重排仍保持连续步长；`stubCap` 最多压缩一步，2×pitch 能覆盖合法嵌套对而不把相隔 3 步以上的独立线路硬绑成一组。
  2. **基准与偏移**：带内按 `stubIn` 升序（近→远）取 rank0 为基准线；基准线按障碍正常求解，其余成员由基准几何经 `offsetStrand` 整体偏移 `-i × spacing` 得到，而不是各自 A* 后再去重；只在基准改道时整带平移。
  3. **间距可调与上限**：默认 8px；上限 = 同组接入点之间的最小 y 间距（如 KSampler slot2/slot3 = 20px），超过即钳到上限并在 `bandInfo` 标 `clamped:true`。依据：竖向间距大于引脚 y 差时，入口水平段无法同时保持各自 y 且不歪斜。
  4. **等距只作用于竖向走廊**：首/末水平段由 `offsetStrand` 重锚回各自引脚，`entryEndsClean` 校验水平进入引脚的 y 误差 <0.5px；到转弯处分叉，各线回自己引脚的 y 再水平进入。
  5. **撞上限**：整带按 `k=0..4` 外移；全部非法则 `bandDegraded` 记因，仅在上一帧折线端点与当前一致时回退（避免锁死旧位置），不穿越、不换序、不拆散间距。
  6. **工程约束**：本轮不改 `luowen/web/index.js` 设置块（另一会话正在改该文件）；先用内部常量 + `LuoWen.setBrotherSpacing(v)` 内存态入口做 A/B，面板项待合并后补。
- **验证**（宿主 0.43.2 + 1.55.18；构造布局 70→`(660,30)`、68→`(310,700)`、71→`(170,510)`、63→`(600,410)`，并将 9 移到 `(1120,500)` 以避开保存图像卡片）：
  - VAE x=600：`bands=[{target:"70",members:["78","82","76"],base:78,spacing:8,shift:0,degraded:false}]`；竖段 `596/588/580`，两两 8px；入口水平 y = `712/102`（L78）与 `521.95/82`（L82），与各自引脚 y 一致（<0.5px）。
  - VAE 继续左移至 x=590：独立解基准变为多竖段异向（`baseX=999`）→ `bandDegraded` 三条 `reason:"homotopy", fallback:"prev"`，折线冻结在最后合法的 `596/588/580`（撞上限停住，间距不变、上下序不变）。
  - 间距 A/B：`setBrotherSpacing(4)` → 596/592/588；`(12)` → 596/584/572；`(30)` → 钳到 `19.99997`（`clamped:true`）并降级 `base-clear-k4`；恢复 `(8)` → 596/588/580。
  - 回归：`style=orthogonal` 10 条 routes、0 斜线段，band 仍成立；原布局 reload 后 `bands=[] / bandDegraded=[]`（无误报）；单主干 `62:0 merged=[79,81]`；`snapDebug` `installed/enabled`；单测 99/99；`verify() {ok:true, diffs:[]}`。
- **未覆盖 / 已知限制**：① 基准线变为多竖段异向（绕行 wrap）时 `offsetStrand` 不能平行偏移，本轮按「降级 + 冻结上一合法折线」处理，未实现「整带跟随绕行」；② 未做全组联动重排；③ 宿主 reload 后布局与用户截图布局不同，验收用等价构造，用户原布局待其补充坐标；④ 组悬停/组删除本轮未交互复测（仅 `classifyHover` 单测覆盖）；⑤ 未用真实鼠标拖动。
- **结果**：交用户验收；未提交 git，未宣称已修复。

## DEC-027: 输入走廊冲突按「真实引脚口径 + 冲突簇重排」修复（BUG-003 方案 A）

- **日期**：2026-11-07
- **背景**：BUG-003（第三方节点挤占输入走廊后，同目标两条线的竖直段落到同一条 x、共线重叠）。用户确认选方案 A，并确认实际拖动是**纯水平**（只改 x）。本轮先复现对齐再实施。
- **复现对齐**：原始布局（node 63 `y=639.6719` 不变）纯水平扫描 x 660→−420（步长 20）全程无共线重叠——VAE 初始 x 与 KSampler 矩形重叠，左移先穿 KSampler 走 semi/loose 绕行，不进窄缝。用户所见布局与宿主原布局不同，故按「VAE 的 y 带同时覆盖 L78 与 L82 竖直跨度」构造**等价布局**（70→`(660,0)`、68→`(310,670)`、71→`(170,540)`、63 `y→380`），初始 x=660 后只改 x；`(300,380)` 触发 301px 同轴重叠。报告中已声明这是等价构造，非用户原布局。
- **决策**：
  1. **阻挡判定改用真实引脚口径**：`allocateLanes` 新增 `pins` 入参（`{x, y0, y1}`，由 adapter 的 `endpointsToPins` 从同帧 `predictEndpoints` 生成）。判定 x 用线路真实入端点 `bx`（与 router 的 `eStub` 同基准），y 跨度用两端引脚实际 `ay/by`；无 `pins`（装载首帧 / 单测）才退回旧 `rect.x + 10` 与整节点跨度。
  2. **冲突簇重排**：名义阶梯（`base + i × pitch`）逐条合法时原样使用（与既有基线逐点一致）；任一被占则整组按「近→远」重排到一段连续合法位，保持嵌套顺序。
  3. **顺延设边界**：向内侧最多下探 1 档（`MIN_STUB_STEPS=1`），外侧最多名义末位后 4 档（`MAX_FORWARD_STEPS=4`），落实 PRD §7.3「不得无限增加绕行」。
  4. **lane 重算时机**：`predictEndpoints` 前移到 `beginFrame` 的 lane 分配之前；`pinsHash` 并入 lane 指纹，端点移动即重算，避免沿用被占走廊。
  5. 不改 A* 成本、不加线间重叠代价、不做全图重规划；仍属渲染热路径零候选树的约束（PRD §10.1）。
- **验证**：验收样本修复前 `x=636` 重叠 301px → 修复后 `x=628 / 636`，公共段 0；全区间复扫 `overlaps:0`；输入侧嵌套 `75=636/76=628/78=620/82=612`（8px 等距、顺序不变）；单主干 `62:0 fork=36.53125 merged=[79,81]`；单测 99/99；`verify()` ok。详见 `docs/agents/debug-log.md` BUG-003「方案 A 实施与验证」。
- **未覆盖**：真实鼠标拖动、≥3 条同簇线、`crossCleanup=true`、经典画布/子图；用户原布局需其补充 node 63/68/70/71 的 `pos` 与 `getBounding()` 才能一一对应。
- **结果**：交用户验收；未提交 git，未宣称已修复。

## DEC-026: PRD 圆角半径口径回写——从「自动、正交生效」改为「可调、仅 smooth 生效」

- **日期**：2026-11-07
- **背景**：DEC-025 记录了实现与 PRD §5.4 的冲突（PRD 写「圆角半径 | 自动 | 仅正交样式生效」）。用户本轮批准回写 PRD，要求只改文档、不动代码。
- **依据**：`luowen/web/geometry/trace.js:12-30` —— `DEFAULT_RADIUS = 10`，`emit(path, pts, radius = DEFAULT_RADIUS)`，`filletRadius()` 取 `min(设定值, 相邻两段各 1/3)`，`radius <= 0` 返回 0；`luowen/web/adapters/renderLinkAdapter.js` 仅在 `cfg.style === 'smooth'` 时调用 `emitRounded(path, pts, cfg.cornerRadius)`，`setSettings` 夹取 `[0, 24]`；`luowen/web/index.js` 注册 `LuoWen.CornerRadius`（slider，0–24，默认 10）。orthogonal 只走 `chamferPolyline` + `sharpPath`（DEC-012），不读圆角半径。
- **口径变更**：
  - 旧：圆角半径「自动」，且「仅正交样式生效」。
  - 新：圆角半径可调（0–24px，默认 10px，0 为直角），实际半径按相邻两段各 1/3 夹取；**仅 smooth 圆角样式生效**；orthogonal 的大斜切是另一套表达，与圆角互斥。
- **文档改动**（仅文档，未动代码）：
  1. `docs/prd/luowen-prd-v1.0.md` §5.4 表格「圆角半径」行：原文 `自动 | 仅正交样式生效。` → 改为可调范围、夹取规则、0 直角、仅 smooth 生效、与 orthogonal 大斜切互斥。
  2. `docs/prd/luowen-prd-v1.0.md` §5.2 要求「转角可圆角化…」：原文与「仅 smooth 生效」矛盾 → 改为「转角保持直角，唯一斜线表达是绕障外角大斜切；圆角只属于 smooth 样式」。
  3. `docs/prd/luowen-prd-v1.0.md` §5.1 要求列表：新增一条「圆角半径可调（0–24px，默认 10px，0 为直角）…」，补齐平滑样式侧口径。
  4. `docs/routing-algorithm.md` 几何内核表「圆角描边」行：原文 `emit(path, pts)，圆角半径 10，钳制到相邻段 1/3` → 改为参数化并注明设置来源、范围与默认值、0 直角。
- **结果**：全篇不再出现「圆角半径 自动」或「仅正交样式生效」的旧口径；DEC-025 的「已知冲突」项由本条解除。仅改文档，未提交 git。

## DEC-025: 圆角半径设置——设定值为上限，实际半径取几何夹取

- **日期**：2026-11-07
- **背景**：用户要求把 `smooth` 样式的圆角半径做成可调设置，并明确「设定值只是上限，实际半径 = min(设定值, 几何允许值)」，0 表示直角，范围 0–24。
- **取证**：圆角唯一实现点是 `luowen/web/geometry/trace.js:12` 的 `RADIUS = 10`；`emit()` 在 `:21-26` 用 `Math.min(RADIUS, 相邻两段各 1/3)` 夹取并取 `Math.max(0.5, r)`。调用点只有 `luowen/web/adapters/renderLinkAdapter.js:791`（`cfg.style === 'smooth'`）；正交样式走 `sharpPath`，大斜切是另一套（DEC-012）。
- **决策**：
  1. `trace.js` 把 `RADIUS` 改为导出常量 `DEFAULT_RADIUS = 10`，`emit(path, pts, radius = DEFAULT_RADIUS)`；新增纯函数 `filletRadius(radius, prevLen, nextLen)`，语义为 `min(设定值, 两段各 1/3)`，`radius <= 0` 返回 0（直角），正半径保留 0.5 下限以维持默认观感。
  2. `renderLinkAdapter.js` 的 `state.settings` 新增 `cornerRadius`（默认 `DEFAULT_CORNER_RADIUS`），`setSettings` 夹取到 `[0, CORNER_RADIUS_MAX = 24]`；绘制时 `emitRounded(path, pts, cfg.cornerRadius)`。不改路由、缓存键与命中几何。
  3. `index.js` 新增 `LuoWen.CornerRadius`（线路外观组，`sortOrder: 75`，位于线路样式 80 与节点避障 70 之间），`type: 'slider'`，`attrs: { min: 0, max: 24, step: 1 }`，`defaultValue: DEFAULT_RADIUS = 10`；tooltip 一句一行并写明「仅 smooth 生效、orthogonal 无效」。
  4. 新增调试入口 `window.LuoWen.setCornerRadius(v)`（夹取后同步持久设置），供同取景 A/B。
- **验证**：
  - 单测 `node --test tests/unit/*.test.mjs` **99/99**（新增 2 项：`filletRadius` 上限/夹取/0 直角/0.5 下限；`emit` 半径参数进入 `arcTo`）。
  - 宿主默认工作流（10 节点 / 10 连线，smooth 样式）同取景（scale=1、offset=[500,350]、1600×1000）：半径 0 全部直角；默认 10 与改前观感一致；上限 24 时 28 个转角中 17 个用满 24px、8 个短引脚段自动收缩到 <8px、其余 3 个分别 <11/<13/<23，无异常折返。
  - `LuoWen.verify()` ok（10 nodes / 10 links，diffs 空）。
  - 设置面板：线路外观组依次为 线路样式 / 圆角半径 / 节点避障 / 绕障外角大斜切；滑块 + 数字框存在且 id = `LuoWen.CornerRadius`。滑块聚焦后 `Home` → 状态与数字框均 0、`End` → 均 24，控件到渲染链路闭合。提示框 400×116px、5 行、每行单行盒、最长 368px，无孤字行；900×800 下 `right=770`、`bottom=515`、无溢出。
  - 截图：`docs/specs/assets/luowen-corner-radius-0-2026-11-07-2026-11-06T18-02-30-340Z.png`、`luowen-corner-radius-10-2026-11-07-2026-11-06T18-02-37-160Z.png`、`luowen-corner-radius-24-2026-11-07-2026-11-06T18-02-44-137Z.png`、`luowen-corner-radius-setting-tooltip-2026-11-07-v3-2026-11-06T18-04-56-338Z.png`。
  - 宿主副本 `index.js` / `renderLinkAdapter.js` / `trace.js` 与源文件 SHA256 一致（`FE9E16F9…1B22` / `E36B2297…7A47` / `72A13E97…B9A5`）。未提交 git。
- **已知冲突（未改 PRD）**：PRD §5.4 表格「圆角半径 | 自动 | 仅正交样式生效」与实现（仅 smooth 生效）及 §5.1「smooth 样式回到圆角」不一致；本轮按用户最新口径实现并在 tooltip 写明，不改 PRD 边界，待用户确认后再回写。

## DEC-024: 设置项提示框改为显式换行 + 受控放宽

- **日期**：2026-11-07
- **背景**：1.55.18 的设置提示框固定 `max-width: var(--p-tooltip-max-width)` = 200px，长句被硬折行并出现断词。提示框由 PrimeVue 指令渲染到 body，class 只有 `p-tooltip p-component`，无法用设置行祖先选择器限定样式；直接改全局 `.p-tooltip` 会波及其他扩展。
- **决策**：
  1. 6 项 `tooltip` 改为 PrimeVue 对象形式 `{ value, class: 'luowen-tooltip' }`，按句号/分号显式插入 `\n`，一句一行；不新增、不丢失行为信息。
  2. 扩展加载时注入未分层规则 `.p-tooltip.luowen-tooltip{max-width:min(28rem,calc(100vw - 2rem))}`；只放宽带标记 class 的提示框，不改宿主文件、不写全局 `.p-tooltip` 规则。
  3. 依赖前提：`FormItem.vue` 把 `setting.tooltip` 原样交给指令；`SettingItem.vue:77-78` 的 `st()` 在无翻译键时原样返回 fallback（`i18n.ts:331`），因此对象可透传。已核对宿主仅此一处消费 tooltip。
  4. 问号图标来自宿主 `FormItem.vue:15` 的 `i.pi-info-circle`，本轮不摘除；按用户规则先报告来源。
- **验证**：
  - 运行态：我们的提示框 class 含 `luowen-tooltip`，`max-width` 448px、实际宽 416px、高 116px，5 行；`white-space: pre-line`、`innerText` 保留 `\n`。
  - 对照：核心设置提示框仍为 `p-tooltip p-component`、宽 200px，未被影响。
  - 截图同取景对比：`docs/specs/assets/luowen-tooltip-before-2026-11-07-2026-11-06T17-35-38-171Z.png` 与 `luowen-tooltip-after2-2026-11-07-2026-11-06T17-37-24-646Z.png`；提示框右边缘 x≈943，未覆盖右侧控件、未溢出窗口。
  - 单测 `node --test tests/unit/*.test.mjs` 97/97；`node --check` 通过；宿主副本 SHA256 与源文件一致（`D8F8E1B9…3D9A`）。
  - 契约写入 `docs/comfyui-dev-conventions.md` §2.10；未提交 git，等用户验收。
- **补充（同日第二轮，用户要求「再宽一点，内容自适应 + 上限封顶」）**：
  - 宽度上限由 `28rem`（448px）改为 `min(560px, calc(100vw - 2rem))`。实测内容宽 282–491px，560px 上限从未被触达；1100px 窗口下最宽一项右边缘 933px，未贴边，因此不下调到 520px。
  - 指令在根节点写内联 `width: fit-content`，内联优先级高于注入的 `width: max-content`；实际生效的是「`fit-content` 内容自适应 + `max-width` 封顶」，与用户口径等价。`width:max-content` 保留为宿主去掉内联宽度时的回退。
  - 6 项文案按句号/分号/逗号重排，每行 ≤ 约 30 个中文字等效宽度（英文/数字按 0.55 折算）。`离线交叉清理` 的 31 字长句拆为「交叉对数严格下降。」+「参与线路总长增幅不超过 15% 时才采纳。」，消除 900px 视口下折行后尾段仅约 2 字的孤字行。
  - 复测（1600×1000）：六项宽 406 / 491 / 282 / 373 / 416 / 352px，行数 2 / 3 / 3 / 3 / 5 / 6，自动折行 0 处、控件遮挡 0 处、视口溢出 0 处；1100×1000 与 900×800 均 0 折行，900 下最大 `right=861`、`bottom=732`，未溢出。
  - 核心设置提示框仍为 200px（`p-tooltip p-component`，无标记 class）。
  - 截图：`docs/specs/assets/luowen-tooltip-560-2026-11-07.png-2026-11-06T17-55-57-120Z.png`（绕障外角大斜切，1600×1000，同取景）。

## DEC-023: 模板包不再注册用户可见的示例设置项

- **日期**：2026-11-07
- **背景**：验证宿主设置导航「其他」组下同时出现 `LuoWen`（本插件）与 `Luowen`（模板示例），后者页内是 `Example → Luowen 问候语`（值 `hello from luowen`）。取证确认该设置唯一来源是 `template/ComfyUI-Luowen/web/js/luowen.js:19-33` 的 `settings: [{ id: 'ComfyUI-Luowen.greeting', category: ['Luowen','Example'] }]`；宿主 `custom_nodes/ComfyUI-Luowen/web/js/luowen.js` 是同一文件的副本（改前两份 SHA256 均为 `8B33FBBC…8F2E`），不存在第三个注册点。
- **决策**：
  1. 在仓库源头（模板）删除该 `settings` 注册（含 id、显示名、文案与分类），改为注释形式的注册写法样例，并注明「建议沿用既有 id」「三级分类避免折叠」两条约束。
  2. 同步覆盖宿主副本 `custom_nodes/ComfyUI-Luowen/web/js/luowen.js`；**不删除任何目录、不动其他扩展注册**。改后两份 SHA256 一致（`E38DD908…9F1A`）。
  3. 明确包关系：`template/ComfyUI-Luowen/` 是新建插件用的脚手架，不是与 `luowen/` 并列分发的产品包；模板默认不应向用户设置面板注入任何可见项。
- **验证**：
  - `node --check` 通过；浏览器刷新（Web 静态文件无需重启 ComfyUI）后设置导航「其他」组下只剩 `LuoWen`，无 `Luowen`。
  - 搜索 `问候`、`Example` 均为 0 项；搜索 `Luowen`/`LuoWen` 只命中本插件 6 项；6 项仍按「基础 / 线路外观 / 实验」可见且顺序正确。
  - 读写：`app.extensionManager.setting` 读取 6 项值正常；`LuoWen.WireStyle` 由 `smooth → orthogonal → smooth` 往返写入生效，其余值未变。
  - 截图：`docs/specs/assets/luowen-settings-example-removed-2026-11-07-2026-11-06T17-31-29-519Z.png`。
  - 未提交 git，等用户验收。

## DEC-022: 设置项改为三级分类并落地 A 方案（入口独立、id 与默认值不变）

- **日期**：2026-11-07
- **背景**：1.55.18 设置树按 `category || id.split('.')` 建树，同路径复用节点并覆盖 `data`（`treeUtil.ts:36-37`）。本仓库 6 项设置共用单元素分类 `['LuoWen']`，导航「其他 → LuoWen」只剩最后注册的 `LuoWen.CrossCleanup`，其余 5 项只能靠搜索找到。用户确认采用方案 A：只修原生分类，不新增侧边栏、不新增低层参数、不做恢复默认值。
- **决策**：
  1. 6 项分类改为三级 `['LuoWen', 组名, id 后缀]`：基础（`Enabled` 100、`SnapAlign` 90）、线路外观（`WireStyle` 80、`NodeAvoidance` 70、`Chamfer` 60）、实验（`CrossCleanup` 50）；`sortOrder` 固定组与组内顺序。
  2. **保留全部既有 id 与 `defaultValue`**，不改设置语义、`onChange` 与路由代码；显示名保持「绕障外角大斜切」；避障档位改用 `{ text, value }` 选项，展示「低 / 标准 / 高」，内部值 `low / standard / high` 不变。
  3. `LuoWen.CrossCleanup` 显示名去掉「（实验）」后缀，改用 `experimental: true`（1.55.18 实测渲染为烧瓶徽章）；名称内不硬塞检索词，分类组名承担检索。
  4. 本轮不做侧边栏入口、不做恢复默认值；二者仅记为后续候选（spec §6）。`Luowen/Example` 属模板包，不动，只从验收口径排除。
- **验证**：
  - 单测 `node --test tests/unit/*.test.mjs` **97/97** 通过（fail 0）。
  - 宿主实测（0.43.2 + 1.55.18）：导航「其他」下出现独立 `LuoWen` 项；页内 6 项按「基础 / 线路外观 / 实验」全部可见且顺序正确；搜索 `LuoWen` 与各主名词均命中；改前设为 `smooth` 的 `LuoWen.WireStyle` 刷新后仍为 `smooth`。
  - 契约结论见 `docs/comfyui-dev-conventions.md` §2.9；方案、边界与证据见 `docs/specs/luowen-settings-ui.md` §4、§7；截图 `docs/specs/assets/luowen-settings-verified-2026-11-06T17-18-21-299Z.png`。
  - 未提交 git，等用户验收后再定。

## DEC-021: 主干组交互口径由「组选中」改为「组高亮 + 组删除」

- **日期**：2026-11-07
- **背景**：PRD AT-013/015/017 原要求「悬停整组高亮、点击共享主干选择整组全部原生连接、整组删除与原生多选语义一致」。查证前端 1.55.18 后确认该口径依赖宿主不存在的链路选中能力。
- **旧口径**：
  1. 点击共享主干 → 选中共享组全部原生 link；
  2. 删除整组 → 依赖原生多选/`deleteSelected` 语义；
  3. 悬停 → 整组高亮。
- **新口径**：
  1. 悬停共享主干段 → 高亮整组（主干 + 全部分支）；悬停分支段 → 只高亮该分支，主干保持常态；
  2. 共享主干段右键 → 菜单出现「删除这一组（N 条）」并保留单条删除；分支段只有单条删除；
  3. 整组删除 → 自建事务（`emitBeforeChange + graph.beforeChange … graph.afterChange + emitAfterChange`），只产生一条 undo；分支删除沿用原生单条语义；
  4. 不改键盘 Delete 语义，不弹二次确认，不高亮对端节点。
- **依据**：
  1. 可选中类型枚举不含 link：`selectionState.ts:7`（仅 node/group/reroute/io）；
  2. `selectedItems` 为 `Set<Positionable>`，link 无法放入：`LGraphCanvas.ts:746`；
  3. `deleteSelected()` 只处理 node/group/reroute：`LGraphCanvas.ts:4787-4821`；
  4. 无批量链路删除接口，单条删除走 `graph.removeLink + layoutStore.deleteLinkLayout`：`LGraphCanvas.ts:6760-6775`；
  5. 原生无 link 级 hover：`LGraphCanvas.ts:3549-3553`、`:4556-4814`；
  6. 菜单可注入且不破坏 changeTracker：`ContextMenu.ts:311-341`、`changeTracker.ts:625-630`。
- **范围**：只改交互与验收口径；不改几何（单主干、输入走廊嵌套、大斜切、最晚分叉、磁吸），不改任何 Link ID、origin/target slot 与节点数据。
- **验证**：查证结论已写入 `docs/comfyui-dev-conventions.md` §2.8（附 file:line 与交叉验证表）；实现与宿主实测结论另见 project-progress。

## DEC-020: 文档与代码对齐口径——阶段 3 未开始，3A/3B 属 P1 增强

- **日期**：2026-11-06
- **背景**：README 仍写「开发尚未开始」，CHANGELOG 仍写 17 项测试 / 5px 间距 / Ribbon 平行股道，与提交 `603a1b5` 后的代码事实严重冲突；同时项目进度把 3A/3B 的完成混在阶段 3 语境里，容易让接管者误判阶段 3 已开工。
- **决策**：
  1. **事实基线以代码与 git 历史为准**：阶段 0–2 已验收（阶段 2 为 `8614a8a`）；3A（`b6dab5c`）与 3B（`603a1b5`）是 PRD §4.2 的 P1 增强，**不计入阶段 3 交付**；阶段 3 尚未开始。
  2. **PRD 阶段编号只到 3**：不新增「阶段 4」；3A/3B/3C 属于阶段 3 前置的 P1 增强编号，不是 PRD 阶段。3C 已按 DEC-019 撤除，不再实现。
  3. **仓库文档分工不变**：README 由 `shuxu` 维护、CHANGELOG 双语由 `changelog-manager` 维护，本轮不手写结构；过程档案（progress/decision/debug）与 GLOSSARY 由 `vibe-sync` 口径同步。
  4. **已知偏差不静默择一**：smooth 样式实现为圆角折线而非 PRD §5.1 的 Bezier、§14.2 fixture 只做 2/10、主干组交互与手动意图保护未通过验收等，统一写入 project-progress「已知未完成项」，不通过改文档措辞掩盖。
  5. **测试数只有实跑数可用**：`node --test tests/unit/*.test.mjs` 实跑 95/95；任何文档不得再引用旧测试数。
- **验证**：`git log` 与 `603a1b5` 一致；单测实跑 95/95（tests 95 / pass 95 / fail 0）；README/CHANGELOG 双语/GLOSSARY/project-progress 已按上述口径改写。

## DEC-019: 撤除 3C 顺序抽头实现（由公共前缀合并天然达成）

- **日期**：2026-11-06
- **结论**：顺序抽头（Daisy-Taps）在当前架构下由「单主干 + 分叉后公共前缀合并」（DEC-009/DEC-010）天然实现，不需要独立代码。
  - 宿主同取景 A/B（11 节点分散目标、scale=1、offset=[500,350]、1600×1000）：开/关**连线画布逐像素 0 差异**，仅底部统计文字（DOM）181 px 差异；交叉对集合完全相同（均为 10 对）。
  - 根因：`T_i = p_i − stub` 使抽头列恰好等于单 T 分支自身的转向列，分支首段又沿主干方向，抽头只改变折线顶点归属与共享点集合，不改变绘制并集。
  - 实现与 A/B 明细见 DEC-018（仅存档，不代表当前代码）。
- **决策（用户批准撤除范围，仅本轮 3C 新增内容）**：
  1. `routing/trunkPlan.js`：移除 `TAP_MIN_SPREAD` / `TAP_GAP` / `chooseTapSequence` / `planDaisy`，以及 `planTrunk` 的 `daisyTaps` 分支；
  2. `geometry/chamfer.js`：移除 `pointKey` 与 `findSharedPoints(paths, extra)` 的 `extra` 参数，恢复 `findSharedPoints(paths)`；
  3. `adapters/renderLinkAdapter.js`：移除 `settings.daisyTaps`、主干缓存签名的 `dt0/dt1` 分量、`trunkInfo` 与 `getStats().trunks` 的 `daisy`/`taps` 透出；
  4. `index.js`：移除设置项 `LuoWen.DaisyTaps` 与 `window.LuoWen.setDaisyTaps`；
  5. 删除 `tests/unit/daisyTaps.test.mjs`。
- **未动**：`crossings.js` / `crossCleanup.js`（3B 保留）、`alignSnap` / `dragSnap`（3A 保留）、输入侧走廊、单主干、斜切、合法最晚分叉。
- **验证**：
  - 全量单测 `node --test tests/unit/*.test.mjs` **95/95**，fail 0（移除新增 7 项后回到 3B 后的应有数量）。
  - 宿主默认布局：10 节点 / 10 link，`verify()` `ok:true, diffs:[]`；主干组 `2:0` `fork=107, merged=[9,10]`；`LuoWen` 命名空间无 `setDaisyTaps`，`status()` 无 `daisyTaps`，设置面板无 `LuoWen.DaisyTaps`。
  - 撤销后复现撤除前「关闭态」临时布局：`fork=66, merged=[9,10,11]`；link9 `[[-440,139],[-374,139],[-374,-288],[-350,-288]]`、link10 `[[-440,139],[-44,139],[-44,342],[-20,342]]`、link11 `[[-440,139],[476,139],[476,32],[500,32]]`，与撤除前记录的关闭态**逐点一致**；该布局 `rebase()` 后 `verify()` ok（11 节点/11 link）。
  - 源文件与宿主 `custom_nodes/luowen/web` 四份副本哈希一致。

## DEC-018: 3C 顺序抽头 Daisy-Taps（默认关闭，宿主 A/B 无可见差异）

- **日期**：2026-11-06
- **背景**：3B-2 离线交叉清理收益极小（10 对→9 对，+0.48% 长度），用户决定保持其默认关闭，转向「从源头减少交叉」的 3C：同一输出端口的多个分散目标按投影顺序逐段抽头，避免所有分支都从同一远端 T 点拉出。
- **决策**：
  1. **抽头序列**：`trunkPlan.js` 新增导出常量 `TAP_MIN_SPREAD=48`、`TAP_GAP=24` 与 `chooseTapSequence(targets)`；成员 ≥3、按目标投影升序、相邻投影间距 ≥48、`T_i=min(proj_i−stub, 走廊上限)` 且 ≥`min`、相邻抽头间距 ≥24；任一不满足返回 `null`。
  2. **规划路径**：新增 `planDaisy`；`planTrunk` 在 `opts.daisyTaps && ids.length>=3` 时优先调用，成功要求三条分支全部有解且 **全部通过 `decideMembership`**，否则原样回退现有单 T 合流。2 目标永不进入该分支，行为逐点不变。
  3. **路径分组**：第 k 个成员路径为 `pin + 前 k 个抽头 + 该成员分支`，抽头顶点不做 `simplify`；最后一个抽头只出现在末位成员路径上。
  4. **直角锁定**：`chamfer.findSharedPoints(paths, extra)` 新增可选 `extra`；适配器把全部抽头点并入 skip 集合，抽头处不参与绕障外角大斜切（单测锁定）。
  5. **开关与调试**：设置项 `LuoWen.DaisyTaps` 默认 `false`；`LuoWen.setDaisyTaps(bool)` 内存态 + 持久设置同步；主干缓存签名追加 `dt0/dt1`；`trunkInfo` / `getStats().trunks` 透出 `daisy` 与 `taps[{id,T,point}]`。关闭时 `planTrunk` 不进入该分支，结果逐点不变。
- **验证**：
  - 单测 `node --test tests/unit/*.test.mjs` **102/102**；新增 `tests/unit/daisyTaps.test.mjs` 7 项：① 投影 100/300/500 → 抽头 76/276/476 且间距合法；② 成员 <3 或投影过密 → `null`；③ 三目标抽头路径分组与分支起点；④ 2 目标开/关 `deepEqual`；⑤ 三目标间距不足回退与关闭态一致；⑥ 关闭 vs 不传选项逐点一致；⑦ 全部抽头进 skip 后大斜切不切抽头（无 skip 时会被切）。
  - 宿主 A/B（11 节点临时布局：node4→(-350,-300)、node5→(-20,330)、新增 CLIPTextEncode→(500,20) 接 CLIPLoader slot0；scale=1、offset=[500,350]、视口 1600×1000）：关闭 `fork=66, merged=[9,10,11], daisy=false`；开启 `fork=916, merged=[9,10,11], daisy=true`，抽头 `T=66/396/916`（x=-374/-44/476），投影间距 **330/520**，主干分段 `-440→-374 / -374→-44 / -44→476`，分支起点 `-374→上`、`-44→下`、`476→上`。
  - 可见结果：同取景截图逐像素 diff **181 px**，bbox `(91,932)-(119,940)` 为底部统计文字（DOM），**连线画布区域 0 差异**；交叉对开/关均为 **10 对**且集合完全相同。
  - 根因（已定位）：`T_i = proj_i − stub` 使抽头列恰等于单 T 分支自身转向列（目标列 −24 stub），且分支首段沿主干方向；两种模式下所有折线的**绘制并集完全相同**，抽头只改变顶点归属与共享点集合，不改变可见几何，也不改变交叉对。标准节点输出槽方向恒为右，无法构造垂直主干来观察差异。
  - 不变量：`verify()` `ok:true, diffs:[]`；11 节点坐标与 11 条 link 五元组零差异。
  - 截图：`.verify/shots/3c-daisy-off-sameframe-2026-11-06T14-11-39-817Z.png` / `3c-daisy-on-sameframe-2026-11-06T14-11-50-846Z.png`（同取景）；另有 scale 0.7 / 1.0 旧组。
- **未覆盖**：
  1. 垂直/非右向主干不可构造，抽头在该拓扑下是否产生可见差异未验证；
  2. 主干带内有卡片时 `corridorLimit` 会压短抽头并导致回退，复杂绕障布局未实测；
  3. 2 目标仅单测 `deepEqual`，未做宿主 A/B；
  4. 未用真实鼠标交互、未测连线增删事件；
  5. 本轮不提交 git；3C 是否保留/重定义（例如让抽头列偏离目标 stub 列）待用户决定。

## DEC-017: 3B-2 离线交叉清理接宿主（默认关闭）

- **日期**：2026-11-06
- **背景**：3B-1 只做了交叉枚举与 router 的可选成本，未接宿主。3B-2 要把「停止拖拽后离线重解、减少交叉」接到宿主，但保持默认关闭，先用 A/B 供用户判断是否改为默认开。
- **决策**：
  1. **模块**：新增纯模块 `luowen/web/routing/crossCleanup.js`，导出 `planCrossCleanup({ routes, resolve, maxRounds, maxGrowth, crossCost, locked })`；默认 `maxGrowth=0.15`、`maxRounds=2`、`crossCost=60`。不依赖 DOM / litegraph / app。
  2. **触发**：`drawConnections` 包裹层在每次绘制后调 `scheduleCleanup`；去抖 `CLEANUP_DEBOUNCE_MS=400`（落在用户要求的 300–500ms 区间）。指针按下（拖拽中）不调度。
  3. **几何校验**：待执行项记录 `version|laneHash|env` 三元组；`beginFrame` 中障碍版本（节点移动/尺寸变化）、lane 哈希（连线变化）、环境（样式/避让/间距）任一变化即 `invalidateCleanup`，清空待执行与已应用结果；去抖回调执行前再校验三元组，不符直接返回（`geometry-changed` / `dragging`）。
  4. **范围**：只对 `enumerateCrossings` 的 `byPair` 中 `cross > 0` 的线路对重解；纯共线重叠对不进候选。同组共线重叠与共享引脚仍按 DEC-016 豁免，不处罚。
  5. **重解输入**：把所有其他线路折线作为 `lineObstacles`、`crossCost=CLEANUP_CROSS_COST` 传给 `route`；锁定主干成员（`groupOf.keys()`）不参与重解，但仍计入交叉统计。
  6. **采纳条件**：交叉对数严格下降（`stats.pairs - trialStats.pairs > 0`）且参与线路总长增幅 ≤ 15%；否则丢弃整轮，保持当前画面。重新解出与基准逐点相同的线路记为 `unchanged`，不计入参与线路与增幅。
  7. **轮上限**：`maxRounds` 钳制在 1–2（默认 2），避免多次连锁重解。
  8. **缓存签名**：`version|laneHash|env|specs.length|fnv1a(全部基准几何)`；几何指纹覆盖参与清理的全部线路，任一线路移动都会换签名，不会复用旧几何结果。
  9. **调试入口**：`LuoWen.setCrossCleanup(bool)`、`LuoWen.crossDebug()`（交叉对数、候选对、逐线尝试、采纳列表、丢弃原因、总长与增幅、轮数、epoch）、`LuoWen.crossCleanupNow()`（手动立即执行）。
  10. **默认关闭不变**：设置项 `LuoWen.CrossCleanup` 默认 `false`；关闭时 `tryCustomRender` 的覆盖分支短路，不写 `baseRoutes`/`effectiveRoutes` 覆盖，路径逐点与已验收版本一致。
- **验证**：
  - 单测 `node --test tests/unit/*.test.mjs` **95/95**（新增 `tests/unit/crossCleanup.test.mjs` 11 项：采纳、增幅拒绝、未下降拒绝、无路由、确定性、第二轮幂等、锁定线、纯重叠不候选、同组重叠豁免、轮数钳制、空输入）。
  - 宿主实测（复刻 10 节点 / 10 连线、KSampler 四输入汇聚）：清理前 **10 对 / 11 事件**，涉及 `[2,3,4,5,6,7,8,9]`；清理后 **9 对 / 10 事件**；采纳线路 `link 8`（VAEDecode→SaveImage），参与线路总长 `1517.657 → 1525.000`（**+0.484%**，≤15%）；round1 采纳 8，round2 全部 `unchanged`。
  - 幂等：已应用态再调 `crossCleanupNow()` 返回 `cached`；强制失效（关→开）重算得到与首次逐点相同的 link 8 路径（最大坐标差 0）。
  - 移动节点：KSampler +20px / 再 +20px 后 `activeLinks` 立即清空、`appliedEpoch` 落后于 `epoch`；700ms 后按新几何重新清理。旧清理结果不残留，画面无跳变。
  - 默认关闭：关闭态两次采样逐点一致；开→关后与关闭态基准逐点一致。
  - `verify()` `ok:true`、`diffs:[]`；节点坐标与 10 条 link 的 `id/origin_id/origin_slot/target_id/target_slot` 零差异。
  - 截图：`.verify/shots/3b2-ab2-off-z09-*.png` 与 `3b2-ab2-on-z09-*.png`（scale 0.9，同一取景）。
  - 未覆盖：连线增删事件、缩放事件、真实鼠标/触摸拖拽期间、缓存签名「别的线移动」专项构造、15% 增幅边界的宿主实测（仅单测覆盖）。

**补记（2026-11-06，用户决定；不改上方实现与验证结论）**

- **决策**：`LuoWen.CrossCleanup` 保持**默认关闭**，实现代码保留不删；后续稀疏布局可按需手动开启。
- **理由**：逐条重解收益极小——宿主实测 10 对交叉仅降到 9 对，参与线路总长增幅 +0.4838%；先做 3C 顺序抽头，从源头减少交叉（3C 结论见 DEC-018）。
- **处置**：设置项默认值不变（`false`），不进入设置面板默认启用清单；调试入口 `setCrossCleanup` / `crossCleanupNow` / `crossDebug` 保留。

## DEC-016: 3B-1 交叉枚举与可选交叉成本（默认关闭）

- **日期**：2026-11-06
- **背景**：3B 需要把线路交叉变成可度量、可计费的对象；但本阶段只做离线枚举与 router 的可选成本，不接宿主、不改已验收的路由形态。
- **决策**：
  1. **模块**：新增纯模块 `luowen/web/routing/crossings.js`，不依赖 DOM / litegraph / app。`segmentsOfRoutes` 把带 `startPin`/`endPin` 的折线摊平成线段，引脚只挂在首段起点与末段终点（中间拐点不是引脚）。
  2. **判定口径**：`cross` = 垂直相交且交点到两条线段各自端点的距离都 > tol（默认 0.5 图 px）；`overlap` = 同轴共线重叠长度 > tol；`touch` = 只在端点接触，或共线相切（重叠长 ≤ tol）。`cross` 与 `overlap` 计入，`touch` 只记录不计数。斜边不参与（`state.routes` / `link.path` 始终保持正交）。
  3. **同组豁免边界**：仅豁免「同组 + 共线重叠」（共享走廊、共享段是设计预期）；同组线束之间的垂直穿插仍计为交叉。共享引脚要求两侧端点引脚标识相同，而不是仅坐标相同。
  4. **输出**：`pairs`（唯一线路对）、`count`（计入事件数，一对可有多处）、`involved`（涉及线路集合，保留原 id 类型并排序）、`byPair`、`events`（含未计入项与 reason）、`ignored`（sameLink / sameGroup / sharedPin / touch）。
  5. **router 可选成本**：`route({ lineObstacles, crossCost })`；`lineObstacles` 是既有折线数组，`crossCost` 是每次垂直内点交叉的代价。仅 `crossCost > 0` 时构建线段表；`crossCost=0` 或无线段时新代码路径完全不进入。直连捷径在开启且与既有线路相交时不再放行，交 A* 计费。
  6. **未接宿主**：3B-1 不向宿主传 `lineObstacles`，适配器默认调用与已验收版本一致；离线清理留到 3B-2，本轮未加骨架。
- **验证**：单测 `node --test tests/unit/*.test.mjs` **84/84**（新增 `crossings.test.mjs` 15 项）。默认关闭逐点证据：同一输入在 `route(args)` / `{lineObstacles, crossCost:0}` / `{crossCost:40}`（无线段）三条路径下输出均 `[[0,100],[24,100],[24,24],[576,24],[576,100],[600,100]]`。成本生效证据：等长上下绕行时默认走 y=234，`crossCost=60` 改走 y=366（避开 x=300 竖段）。
- **未覆盖**：① 斜边不参与枚举；② 共线重叠不进入路由成本（成本只计垂直内点交叉），是否按重叠长度计费待 3B-2；③ 成本量级（60）未做宿主调参；④ 枚举为 O(n²) 两两检查，未做空间索引；⑤ 真实工作流下的交叉计数与观感未实测。

## DEC-015: 3A-2 接宿主——Vue 后置 rAF、引脚行候选、自建 DOM overlay、设置开关

- **日期**：2026-11-06
- **背景**：3A-1 的 `alignSnap` 纯函数完成，需要接入宿主（ComfyUI 1.55.18，`vueNodesMode=true`）。约束：写入必须晚于原生 rAF；收尾必须早于 `mouseup` 快照；多选跳过；提示线不参与命中测试；用户明确保留「相连邻居优先」的 2px 平手窗口语义，不改。
- **决策**：
  1. **挂载**：window 冒泡阶段监听 `pointerdown/pointermove/pointerup/pointercancel/contextmenu`；`pointermove` 每帧只排一个自建 rAF，晚于原生 `handleDrag` 的 rAF；`pointerup` 内取消未执行 rAF 并同步做最后写入，早于 changeTracker 的 `mouseup` 快照。`Alt` 拖动与 `pinned`/`readOnly` 直接不接管。
  2. **候选**：矩形来自 `graphRead.nodeRects`，统一换算成 body 坐标（`y + NODE_TITLE_HEIGHT`、`h - NODE_TITLE_HEIGHT`，折叠节点跳过）；`adjacent` 由 `graphLinks` 的 origin/target 判定。引脚行候选 `yTarget = nodeY + (neighborPinY - movedPinY)`，只按被拖动节点 `top` 匹配并 `skipX`，使两端引脚 y 相等、连线变直。
  3. **多选**：`canvas.selectedItems.size > 1` 跳过并清空迟滞、隐藏提示线。实测注意点：原生 `pointerdown` 会重置选择集，合成多选必须在 `pointerdown` 之后再调用 `canvas.selectItems([...], true)` 才生效。
  4. **提示线**：自建 `#luowen-snap-overlay`（absolute、`pointer-events:none`、z-index 500）挂在运行时 `#graph-canvas-container` 末尾；按 `(graph + ds.offset) * ds.scale` 同步；`pointerup` 立即 `display:none`。源码包无该容器 id 字符串，接入点结论只以运行时 DOM 为准（见 conventions §2.7）。
  5. **开关**：新增设置 `LuoWen.SnapAlign`（默认开），关闭后适配器不接管拖动、不显示提示线，行为与未安装一致；`LuoWen.setSnapEnabled(bool)` 与 `LuoWen.snapDebug()` 作为对照入口。
- **验证**（宿主 1100×800，`ds.scale=0.9`，`ds.offset=[416,109.6876]`；node 62 CLIPLoader → node 67 CLIPTextEncode，link 79）：
  - 引脚吸附：raw y=295 → 落点 290.00006（pin 目标 290.00006），`pinDy=0`；link 79 折线 `[[0,302.000064],[170.00001,302.000064]]`，完全水平。
  - 超距不吸附：选完全自由落点 raw (-340,382) → 落点不变，`state` 两轴均 null、无提示线。
  - 迟滞：raw 299 → 吸附 290；raw 302（12px）与 304（14px）仍保持 290；raw 306（16px）引脚解除（随后被 node 63 中线的通用锚点捕获，属 3A-1 既有语义）。
  - 多选：选择集 2 时 `multi=true`、`state=null`、无提示线，落点严格等于 raw。
  - overlay：z=500（卡片 19~34、选择框 9999、菜单 999、提示框 99999），`elementFromPoint` 返回 `CANVAS#graph-canvas`；`pointerup` 同帧两条线 `display:none`。
  - 不变量：`LuoWen.verify()` 前后 `ok:true`（10 节点/10 连线）；除 node 62 外其余节点坐标零差异；10 条 link 五元组逐一相同。
  - undo：单次拖动（3 次 pointermove）队列 6→7（增量 1）；`changeTracker.undo()` 后回到拖动前 310.00006，队列回到 6。
  - 单测：`node --test tests/unit/*.test.mjs` **69/69**（新增 6 项 pin 目标与迟滞）。
- **未覆盖**：① 真实鼠标/触控笔与触摸拖动（本轮全部用合成 PointerEvent 驱动真实 Vue 拖动）；② Legacy 拖动（关闭 Vue 节点）未实现也未测；③ 越过 15px 解除后仍可能被其他节点的通用锚点立即捕获，是否放宽 2px 平手窗口待宿主长期实测；④ 截图仅 OS 窗口截图落盘（Chrome DevTools MCP 的 `filePath` 受 workspace roots 限制），未做逐帧录屏；⑤ 多节点高密度布局下「完全自由落点」很少，测试 2 需先算锚点距离再选点。

## DEC-014: 3A 修饰键改设置开关；提示线改 DOM overlay；对齐吸附内核落地

- **日期**：2026-11-06
- **背景**：3A-0 查证确认宿主走 Vue 节点拖动，Alt（克隆拖动）与 Shift（多选 + 原生网格吸附）在 pointerdown 阶段均被占用，且拖动中松开任一修饰键都会触发 `captureState` 把一次拖动拆成多条 undo（`changeTracker.ts:559-564`、`:580-585`）。原「默认 Alt，被占用改 Shift」两条均不成立。
- **决策**（用户拍板）：
  1. **不绑修饰键**。改为设置项「对齐吸附 开/关」（默认开），由 `alignSnap` 的 `enabled` 入参控制；Alt/Shift/Ctrl/Meta 原生行为一律不动。理由：B（Shift 重定义为网格吸附）与 C（另选键）交互代价过大，keyup 拆 undo 风险不可接受。
  2. **提示线走 DOM overlay**：`pointer-events:none`，z-index 高于 Vue 节点卡片层，随 `canvas.ds` 同步平移/缩放；拖动结束立即消失，不参与命中测试。**不用** `canvas.onDrawForeground`。若宿主已有 overlay 容器/插槽则优先复用；无则自建，接入点在 3A-2 先给结论再实现。
  3. **保留 3A-0 约束**：吸附写入必须排在原生 rAF 之后；收尾写入在 `pointerup` 内、早于 `window mouseup` 快照（保证一次拖动一条 undo）；`selectedItems.size > 1` 跳过；`snapTol=10` 图坐标、脱离阈值 15px 迟滞。
  4. **内核契约**：新增纯函数 `luowen/web/snap/alignSnap.js`，入参 `{pos,size,candidates,state,multiSelect,enabled,snapTol,releaseTol}`，出参 `{position,delta,snapped,guides,state,skipped}`。每轴独立（x 用 left/center/right，y 用 top/middle/bottom）；距离差 <2px 的近似平手窗口内相连邻居 `adjacent=true` 优先，同档取更近，完全等距但落点不同判为歧义、该轴不吸附；距离差 ≥2px 时取更近者。多选与总开关由调用方标志跳过并清空迟滞状态。
- **验证**：单元测试 **64/64**（新增 `tests/unit/alignSnap.test.mjs` 13 项，覆盖常量量纲、单轴/双轴、邻居平手优先、≥2px 取近、同级取近、等距歧义、重复候选、10px 进入/15px 迟滞边界、多选跳过、开关关闭、大图坐标）。3A-1 只做纯函数与单测，不接宿主。
- **未覆盖**：① 3A-2 的 Vue 拖动适配器、overlay 接入点与宿主实测；② `adjacent` 由调用方按连接关系计算，3A-2 再定实现位置；③ 多选判定的真实来源（`canvas.selectedItems`）未实测；④ 迟滞状态跨 drag 会话的清理时机由适配器负责；⑤ 触摸/触控笔未覆盖。

## DEC-013: 产品判定顺序——可读性 > 简洁 > 美化（输入侧不得共用几何）

- **日期**：2026-11-06
- **背景**：用户反馈「一个节点有多个输入时，左侧进来的线会被收拢成一根」，并明确插件目标是让工作流清晰可读，美化是次要项。实测 K采样器（node 70）四条入线在 `x=646` 共用同一竖直走廊，不是截图错觉：75 model `[[521,124],[646,124],[646,334],[670,334]]`、76 positive `[[571,304],[646,304],[646,354],[670,354]]`、82 negative `[[566.47,534],[646,534],[646,374],[670,374]]`、78 latent `[[561,714],[611,714],[646,545],[646,394],[670,394]]`；其中 75↔76 在 y 304–334、82↔78 在 y 394–534 完全共线。根因是 `laneAssign` 输入侧按 `target_id:target_slot` 分组，每个引脚一组且组内仅一条线 → rank 恒 0 → 所有 `stubIn=24` → 走廊 x 相同；`trunkPlan` 只按 `origin_id:origin_slot` 分组，输入侧没有合并分支。
- **决策**：
  1. **判定顺序**：可读性 > 简洁 > 美化。任何几何处理若与可读性冲突，一律服从可读；美化项不得以牺牲线归属可辨为代价。
  2. **输入侧**：每个输入引脚是独立语义，不得合并、不得共用走廊。同一目标节点的不同输入端口之间，任何几何段都不得共线复用，必须保留可分辨的最小间距（pitch 是否足够由实测判定）。同一输入端口、多源汇入仍按现有阶梯错开（本轮不动）。
  3. **输出侧**：同一输出端口共享单主干成立（语义上就是一条网）；主干之后每个分支必须可分辨，不能靠贴得很近的平行线充数；做不到时优先提前分叉，而不是加密平行股。
  4. **美化项准入**：大斜切、合法最晚分叉、圆角等逐项按可读性复核；导致归属不明确即收窄适用条件或退回直角。
- **逐项对照（本轮结论）**：

  | 已实现项 | 结论 | 理由 |
  | --- | --- | --- |
  | 绕障外角大斜切（0.6） | 保持 | 只削同一条路径的绕障外角，不改变线归属；共享点已强制直角 |
  | 合法最晚分叉 | 收窄适用条件 | 分叉越晚，分支可分辨的正交段越短；须保证每个分支在到达引脚前有可分辨分离段，否则提前分叉 |
  | 输出侧单主干 | 保持 | 同一输出端口语义即一条网；主干后必须能看到分支 |
  | 分叉后公共走廊复用（DEC-010） | 保持，但须在各自引脚前分离 | 一条共用线比 5px 平行双线更可辨；共用段不得延伸进引脚 |
  | 输入侧 lane 阶梯 | 需修复 | 当前按引脚分组导致不同引脚走廊 x 相同，是缺陷不是美化项 |
  | 近共线 3px 捷径 | 保持 | 减少无意义小台阶，提升可读，不改变归属 |
  | smooth 圆角样式 | 保持（非默认、与斜切互斥） | 可选样式；默认正交，不影响可读基线 |
  | 三档避障 strict→semi→loose | 保持 | 防止压卡，属可读性硬约束，非美化 |
  | 拖拽正交预览 | 保持 | 拖动期即呈现最终正交形态，无额外美化 |
- **验证**：本轮先出诊断与对照结论，代码未改；待用户确认后按最小补丁修 `laneAssign` 输入侧分组，并补单测与实测坐标。PRD 优先级段落待随后回写。
- **未覆盖**：pitch=5（线宽 2 → 3px 边缘间隙）是否达到可分辨待实测；`stubCap` 对短连接会压缩 stub，压缩后仍可能共线；同一引脚多源本轮不改。

**补记（2026-11-06，用户拍板参数并实施；不改上方诊断结论）**

- **参数拍板（可读性优先口径）**：
  1. 输入侧进线间距默认 **8px**（按线宽 2 计，边缘净空 6px；宿主实装 `connections_width=3`，实测净空 5px）。落为导出常量 `DEFAULT_LANE_PITCH=8`。
  2. 保留可调入口 `LuoWen.setLanePitch(v)`（内存态，2–24 钳制，不写持久设置），用于同取景对照；额外产出 5px 对照截图，只改这一个常量，其余参数与取景不变。
- **实现（只改输入侧，输出侧未动）**：
  1. `laneAssign.js` 输入侧分组键由 `i:${target_id}:${target_slot}` 改为按 `target_id` 聚合，组内按 `target_slot` 升序分层。
  2. 每 slot 起始偏移 = `base + Σ(之前 slot 线数) × pitch`；slot 内部仍按对端节点 y 分上行/下行/平走并保留原相对间距（同引脚多源同起点）。
  3. 输出侧 `stubOut` 分支、DEC-009 单主干、DEC-010 分叉后公共走廊、DEC-012 大斜切与合法最晚分叉判定全部保持不动。
  4. lane 指纹追加 `|p{pitch}`，切换 pitch 立即重算；`getStats().rev` 改为 `r7-input-lanes`。
- **验证**：
  - 单元测试 **50/50**（新增 2 项：「同节点多引脚不共线」断言 4 条走廊 x 互不相同且任意竖直走廊无重叠区间；「默认 pitch=8 的 slot 累计偏移」断言 slot 起点 `24 / 40` 与输出侧 `stubOut=24` 不变）。
  - 实测 `state.routes`（K采样器 4 条入线竖直段 x）：**8px 档 646 / 638 / 630 / 622**，5px 档 646 / 641 / 636 / 631；两两同轴线段（水平同 y / 竖直同 x）重叠检查 `conflicts=[]`。
  - 回归：默认工作流主干组 `62:0`（links 79/81）`fork=825`，`stubIn` 仍 24，折线与改前逐点一致 `[[-669,914],[156,914],[156,304/534],[180,304/534]]`；`LuoWen.verify()` ok（10 nodes / 10 links，diffs 空）；节点位置未移动。
  - 截图（`.verify/`，同一取景 scale=1.5 / offset=[-413.3333,-40]）：`p3_input_lanes_8px-2026-11-06T10-18-41-489Z.png`、`p3_input_lanes_5px-2026-11-06T10-20-04-731Z.png`。
- **观察（未改）**：8px 档走廊左移后，link 82/78 的绕障拐角与 node 67 的间隙落入 `GAP_FAR_MAX=200`，触发大斜切；5px 档因与其他线路净空不足退回直角。属既有斜切判据的边界触发，按 DEC-012 保留。
- **未覆盖（本轮如实列出）**：① `stubCap` 对短连接压缩 stub 后仍可能共线；② 同一输入引脚多源本轮不动；③ 合法最晚分叉可分辨段收窄（本轮不做，单独排期）；④ 绕障间隙阈值（`GAP_NEAR_MAX`/`GAP_FAR_MAX`）本轮不放宽。

**补记 2（2026-11-06，输入侧走廊按接近方向嵌套；用户硬约束；不改上方诊断与参数结论）**

- **触发**：8px 只解决「不共线」，分道顺序仍按 `target_slot` 升序，与「线从哪一侧接近」无关；用户指出截图里负向条件与 Latent 之间仍有交叉。
- **现状违反证据（改前 8px 档）**：K采样器四条入线走廊 x = 646/638/630/622（75/76/82/78），首个接近方向 up/up/down/down。78（pin y=394）的走廊 x=622 比 82（pin y=374）的 x=630 更远，违反下方来源的镜像规则，产生两处相交：78 竖线 x=622 穿过 82 在 y=534 的水平段；78 在 y=394 的水平段穿过 82 竖线 x=630。
- **决策（嵌套规则）**：接近方向按 `dy = originNodeY - targetNodeY` 分类，`|dy|<=1` 为平走。
  1. 上方来源：引脚越高（slot 越小）走廊越靠节点，向下依次外移。
  2. 下方来源：镜像——引脚越高越靠外、引脚越低越靠节点。
  3. 平走来源：最外层。
  4. 跨组按「上 → 下 → 平」一次性由近到远编号，跨组同样遵守嵌套；组内同一引脚多源沿用旧序（上方越顶越贴、下方越底越贴）。
- **实现**：只改 `laneAssign.js` 输入侧：收集 entries 后分 `ups/downs/flats`，按上述规则排序后统一 `k` 编号并叠加 `base + k*pitch`。输出侧 `stubOut`、DEC-009/010/011/012 的主干、分叉、斜切与最晚分叉判定均未动。
- **净空顺延（兑现走廊的必要补丁，不改 A* 成本项）**：仅排序不足以兑现——近端 lane 若被第三方节点（±4px hard 箱）占住，A* 会绕到更外侧，嵌套反转（改前实测 78 分配 lane 630 被 node 63 VAELoader 挡住，A* 退到源 stub x=585）。故新增 `laneBlocked(pinX - stub, y0, y1, nodes, skipIds)`，命中则 `k += 1` 顺延到下一个空位，游标不回退；`INPUT_PIN_X_OFFSET=10` 为前端 1.55.18 实测常量。
- **验证**：
  - 单测 **51/51**。新增「多引脚上/下混合接近时走廊嵌套不交叉」：断言上组 `xs[10] > xs[11]`、下组 `xs[12] < xs[13]`（镜像），并用 stub 还原 4 条正交折线断言任意两段无交点；保留「不同引脚走廊 x 互不相同」。
  - 实测（K采样器 node 70，pinX=670）：75（上方，pin334）x=646；76（上方，pin354）x=638；78（下方，pin394）x=622；82（下方，pin374）x=614。方向 up/up/down/down；四条两两相交检查（竖直-水平、竖直-竖直/水平-水平共线重叠）`conflicts=[]`。
  - 全局：7 条已路由线两两检查同样 `conflicts=[]`。
  - 截图（`.verify/`，同取景 scale=1.5 / offset=[-413.3333,-40]）：`p3_input_lanes_nested-2026-11-06T18-41-05-2026-11-06T10-41-08-238Z.png`。
- **未覆盖**：① 「上/下引脚在 y 上交错」的布局几何上无法同时满足不交叉（本规则只对凹/凸嵌套有效）；② 接近方向用节点 `pos.y` 与 slot 序近似，未读真实引脚 y（折叠/特殊节点可能失真）；③ 平走组只有单测样本，未构造宿主实测；④ 连续被第三方节点阻挡时靠 `k<64` 兜底，极端密集布局走廊会被推得很远；⑤ A* 成本项未改（本轮刻意不扩范围）。

## DEC-012: 转角 45° 局部倒角（B）+ 合法最晚分叉（PRD §5.2 书面例外）

- **日期**：2026-11-06
- **背景**：PCB 观感调研的五个待定项由用户拍板：转角选 B（局部 45° 倒角，不选 C 全局斜切）；`TRUNK_MAX=72` 改为「合法的最晚分叉」；顺序抽头（Daisy-Taps）、交叉惩罚/离线清理、磁吸对齐均不做（磁吸后续单独立项）。用户要求先出对比截图判断观感，不直接定稿；B 与最晚分叉若视觉冲突先回报。
- **决策**：
  1. **B 局部倒角**：新增纯函数 `geometry/chamfer.js`。仅在正交样式且开关 `LuoWen.Chamfer` 开启时生效；与 smooth 圆角互斥。`c` 取区间 `[1.5W, 3W]` 内的 `2W`（W=2 → 4px）。在**合并后的共用树**上识别 T 点（同一点在组内具有 ≥3 个不同入射方向），同组共用同一 `c` 与同一 skip 集合，保证共享段倒角完全一致；T 点、相邻段 `< 2c`、共线/零长度、切角三角区侵入节点矩形的转角一律不倒。若分叉点处所有成员同向（合并树在该点只有 2 个方向、视觉上只是主干拐弯），按普通转角倒角，不会出现 T 形缺口。
  2. **命中语义不变**：倒角结果只用于绘制；`link.path` 仍由原正交折线构建，`state.routes` 仍存正交折线，悬停/删除仍走正交语义。原生命中容差 10px 大于倒角最大偏移 2.83px，行为差异不可见。
  3. **合法最晚分叉**：`trunkPlan.chooseForkLength` 移除固定 72px 上限，T 直接取 `min(最近目标投影 − stub, 前方卡片净空 − 余量)`；仍保留 `min` 下限与走廊净空约束，不把分叉点推进卡片或推过最近目标。合并准入、绕行保护（ratio 双阈值滞回）、分支共用几何不变。
  4. **不做**：顺序抽头、交叉惩罚/离线清理、磁吸对齐。
- **验证**：
  - 单元测试 42/42（新增 `chamfer.test.mjs` 7 项：c 取值、90° 切成 45°、短段跳过、共线跳过、T 点保留、共享前缀倒角一致、切角侵入障碍退回直角；改写 `trunkPlan.test.mjs` 的 T 断言：76 / 376 / 825，并新增「显式 limit 不再被 72 封顶」）。
  - 实测（宿主 0.43.2 / 前端 1.55.18，源节点移至 `-1000,900` 同一布局）：`cap=72` 时 T=72、`cap=null` 时 T=825 且 links 79/81 仍 merged；`verify` ok（10 nodes / 10 links，diffs 空）。
  - 对比截图（`.verify/`）：`p2_pcb_01_straight_cap72...png`、`p2_pcb_02_chamfer_cap72...png`、`p2_pcb_03_chamfer_latefork...png`；320% 特写 `p2_pcb_01z_straight_zoom...png` / `p2_pcb_02z_chamfer_zoom...png`，可直观看到同一转角由直角变 45° 斜切；`p2_pcb_03z_latefork_elbow...png` / `p2_pcb_03wide_chamfer_latefork...png` 显示长主干 + 末端倒角，未见「多个倒角碎片化」。
  - 悬停实测：同布局 320% 下，正交直线段与倒角斜边中点均能悬停到 link 81，移开为空；`routes()` 全部正交。
- **观感取舍**：长主干场景只在末端有一个倒角，B 与最晚分叉未出现视觉冲突；当前参数（c=4）在 320% 下斜边约 8 屏px，观感接近 PCB 圆角/倒角，未见「切得太碎」。若后续判定太锐，可把 c 上调到 3W（W=2 → 6px），代价是短段跳过阈值升到 12px。
- **未覆盖**：
  1. 原生点击选中/删除未单独实测（合成鼠标事件未触发选择；代码层 `link.path` 仍为正交，且原生容差 10px 覆盖倒角偏移）。建议下次用真实鼠标验收删除。
  2. 「凸角」采用净空采样判定（切角三角区若侵入节点矩形则视为凹角并跳过），未实现严格的多边形凸性判定；共线分叉点（所有成员同向）会按普通转角倒角。
  3. 倒角只在最终 path 上做逐点处理，虽以共用树 T 集合约束、共享段结果一致，但没有把倒角后的折线回写进 `plan.paths` 缓存；每帧重算 `chamferPolyline`（O(顶点数)，10 条线以内可忽略）。
  4. smooth 圆角样式未加倒角，也未验证两者视觉混用的可能性（设计上互斥）。
  5. `setTrunkCap` 为调试对照入口，默认 `null`；未在设置面板暴露。

**补记（2026-11-06，用户验收后修订；不改上方历史结论）**

- **背景**：用户验收指出「处处都是倒角、三通处也倒角，看着不干净」；几像素微倒角与直角无视觉差别，原意是「大节点右/下都有节点时，连线绕过其右下角，把这个大直角整块削掉，腾出可放节点的三角空间」。据此本条 B 方案被取代。
- **修订决策**：
  1. **取消 4px 微倒角**：`chamfer.js` 重写为「绕障外角大斜切」；`MIN_CUT=24`，低于此值直接直角。
  2. **仅绕障外角**：转角内侧象限须完整包住某第三方节点矩形，两臂分别贴其两条垂直边，间距在绕行间隙内（`GAP_NEAR_MAX=64`、`GAP_FAR_MAX=200`，实测本机 gap≈(191,53)），且臂长越过节点角点；本连接 origin/target 节点排除。普通阶梯、正交偏好拐角不倒。
  3. **共享点一律直角**：`findSharedPoints` 识别组内 ≥2 条成员路径共有的坐标（主干 T 点、分叉点、同向分叉点、公共走廊、引脚出入段），命中即跳过；同组共用同一 skip 集合。
  4. **不必 45°、不等边**：`cutA`/`cutB` 按两腿可用长度独立取值；两腿等长自然接近 45°，一近一远为浅/陡角。每腿可用长度扣除 `MIN_LEG=24` 的可读性直段（与 stub 同量级）。
  5. **净空**：斜边按 `SAMPLE_STEP=4` 采样，节点 `nodePad=6`、其他线路 `linePad=10`；失败按 `t=1.00→0.05` 比例缩短，仍低于 `MIN_CUT` 则退回直角。其他线路以「上一帧实际绘制折线」为参照（`state.frame.prevRoutes`）。
  6. **命中改实际折线**：`link.path` / `link._pos` / `state.routes` 全部使用含斜边的 `drawPts`（取代本条原第 2 点「命中仍走正交折线」）。
  7. **默认档位固化**：`0.6` 为固定默认（`DEFAULT_BEVEL_RATIO`）；`0.35 / 0.85` 仅作调试对比，`window.LuoWen.setBevelRatio()` 只在内存态覆盖、不写入持久设置，重载后回到 0.6。未在设置面板暴露。
  8. **不改动**：合法最晚分叉（`trunkPlan.js`）与 DEC-009/010/011 的主干、走廊、stub 结论全部保留。
  9. **目标边界（用户确认）**：斜切服务于「视觉省位」——减少正交线在角部同时占用的两个方向空间、改善观感；**不是提供可放置节点的画布**。不放宽腿长、间隙上限（`GAP_NEAR_MAX=64` / `GAP_FAR_MAX=200`）与净空阈值，不承诺三角缺口能容纳常规 225px 宽卡片；验收与单测不以「能塞进节点」为目标。
- **验证**：单元测试 48/48（`chamfer.test.mjs` 13 项：共享点直角、等长/不等边切角、0.35 与 0.6 档位差、普通阶梯不倒、端点排除、短腿退直角、节点/线路净空缩短、净空不可达退直角、共线跳过、默认常量）。实测两布局三档截图见 `docs/routing-algorithm.md` §7.5；斜边中点悬停命中 link 74、移开为空。
- **未覆盖/待办**：
  1. 用户已确认目标为视觉省位，不再以「塞入节点」为验收口径；0.6 已固化，0.35 / 0.85 保留为调试对照。
  2. 净空失败时按统一比例 `t` 缩短双腿，未实现「保长腿切角、只缩另一腿」的 Pareto 策略。
  3. 几何版本变化后的首帧无 `prevRoutes`，斜切可能偏大，第二帧收敛。
  4. 本轮未用真实鼠标重测删除；沿用上一轮用户已验收的删除/重绘结论。
  5. 本机原始布局中「加载VAE」横腿仅 35px（贴采样器右缘），无斜切空间；对比截图通过临时移动节点构造两种布局，拍摄后已还原。

## DEC-011: 输出侧 stub 组内统一 + 近共线 3px 容差（双线退化收口）

- **日期**：2026-11-06
- **背景**：DEC-010 修复远距正向场景后，用户报告「加载CLIP」位于两个左对齐「CLIP文本编码」**下方**时，端口出口竖直段又变成两条并排竖线（实测 `170,1000` 处 x=525/530；`290,900` 处 x=645/650）。根因分三类：
  1. `laneAssign` 输出侧仍按 rank 给 `stubOut = 24 + rank*5`（`laneAssign.js` 分组循环），与 DEC-009 单主干要求直接冲突；
  2. 目标位于端口反方向（投影 ≤0）时 `planTrunk` 不规划主干（`trunkPlan.js:175-176`），组退回独立绘制，没有统一 stub 兜底；
  3. 近共线（如「UNet加载器→采样算法」，Δy 约 2px）在正交样式下被 router 的 `<2px` 直线捷径与固定 `flatTol=0`（`renderLinkAdapter.js:331`、`:81`）当成普通高差，走出多余折线。
- **决策**（用户拍板）：
  1. **输出侧取消 rank/pitch 阶梯**：同一 `origin_id:origin_slot` 组内所有成员统一 `stubOut = base(24)`，端口只出一条线；输入侧阶梯保留（同向多源汇入同一引脚仍需错开）。实现为 `laneAssign.js` 分组循环里对 `stubOut` 跳过阶梯。
  2. **stub 单一来源**：删除 `solveBranchFor` 里 DEC-010 临时加的 `stubOut` 覆盖，stub 长度只由 `laneAssign` 决定，`planTrunks` 不再自行指定。
  3. **近共线容差 `STRAIGHT_TOL = 3px`**：两端引脚偏移 ≤3px 视为共线，由 `nearFlatPath` 直接生成正交近直线；**端点钉死在引脚中心，不做端点吸附位移**，只允许在目标侧 stub 处出现一段 ≤3px 的极短转折段；仍要求走廊净空（正交样式禁止斜线，PRD §5.2）。不放开 router 的 `flatTol`（其 null 语义会被 `solveRouteTiers` 当作无解而降级原生）。
  4. **大高差折线维持现状**：竖直段仍贴近目标侧；「对称台阶」只列入美学规则候选，与后续磁吸辅助一起在阶段 3 评估，本轮不改。
  5. 不引入候选树/二次 A*；热路径约束不变（PRD §10.1）。
- **验证**：单元测试 35/35（输出侧 3 个阶梯用例改写为统一 24，新增输入侧阶梯用例）；实测见 `docs/routing-algorithm.md` §7.3（下方两位置、4 个远端前向位置、反向位置、近共线 +2px / +20px）；`verify` ok（10 nodes / 10 links，diffs 空）。
- **未覆盖**：`nearFlatPath` 是 adapter 内部函数，没有独立单测；反向连接（源在目标右侧）仍不规划主干，且分支需绕开自身卡片时会出现较大折线（实测 `0,420` 的 link 79）；`STRAIGHT_TOL=3` 只覆盖两端引脚近乎水平/垂直的情形，斜向引脚不适用；对称台阶未实现。

## DEC-010: 分叉后仍需共用的走廊复用主干几何，分支起点统一 stub

- **日期**：2026-11-06
- **背景**：DEC-009 验收通过后，用户报告同一组（「加载CLIP」CLIP 输出 → 两个左对齐「CLIP文本编码」，links 79/81）在源节点靠近时是单线三通，移远后端口附近的竖直段退化为两条几乎并排的竖线（实测 x=-573 与 x=-568，相差 5px），先各自竖走再各自横进目标。用户要求：无论源节点在哪，该端口出来都必须是同一条线，只有真正需要分开的位置才分叉。
- **根因**：不是 T 上限（实测 T=72 正常），而是 `laneAssign` 按目标 rank 给每个 link 不同 `stubOut = 24 + rank*5`；两条分支从同一 fork 重新 A* 时首个转折点 x 相差 5px，在仍需共用的竖直走廊上各画一段，视觉变回两条线。
- **决策**：
  1. **分支起点统一 stub**：`planTrunks` 求解分支时传组共享 `DEFAULT_STUB`（24），不再沿用 per-link 阶梯；仍保留 PRD §7.2 的 `min(stub, dist/3)` 收缩。
  2. **公共走廊复用主干几何**：分支求解后取所有 merged 分支的几何公共前缀（同轴/同向/共线才计入，短的一段转向处即停），把该前缀绘制成一条共用折线，剩余段才各自走线；公共前缀为 0 时退回原逻辑。
  3. 不引入候选树、二次 A* 或全图重规划：仍在既有每分支一次求解的预算内（PRD §10.1）。
  4. 仅作用于 merged 成员；未合流成员、主干 `pin → fork`、分支独立性与 DEC-009 一致。
- **验证**：单元测试 34/34（新增「同列目标分叉后仍共用竖直走廊」用例）；实测源节点 6 个位置，4 个前向位置（近 `-240,420` 与远 `-1000,900` / `-1400,700` / `-700,1100` / `-1000,260`）两条路径竖直走廊 x 完全一致且唯一（如远端 `-573`，不再出现 `-568`）；`verify` ok，links 79/81 的 origin/target slot 未变，10 nodes / 10 links。
- **未覆盖**：源节点位于目标右侧、输出引脚 x 大于目标引脚 x 的反向连接（目标投影 ≤0 时本就不规划主干，本次未改其行为）；同一 fork 后公共走廊与最终引脚的接缝处仍可能出现一次 5px 内的小折返（仅当两目标 lane 的 `stubIn` 不同，当前默认布局未触发）。

## DEC-009: 主干段改为单条共享几何（修正 DEC-008 的 Ribbon 分股）

- **日期**：2026-11-06
- **背景**：阶段 2 验收时用户指出，一个输出端口接多条线（「加载CLIP」CLIP 输出 → 两个「CLIP文本编码」）时，静态渲染在端口处画出两条平行线、再在右侧用竖线相连，视觉为 `=[`；拖动预览却是单线三通 `-[`。用户要求静态结果与拖动预览一致：端口只出一条线，到分叉点后再分成多条。
- **决策**：
  1. **合流段改为单主干共享几何**：`pin → fork` 由同组所有成员共用同一条路径，端口只出一条线；**废弃 DEC-008 第 3 条的 fan 14 / pitch 4 平行 Ribbon 股道**（仅保留分叉长度 T、绕行保护与滞回）。
  2. 分叉后每条连接从 fork 重新走 strict→semi→loose 求解，分支区段各自独立；分支 stub 仍按 PRD §7.2 收缩 `min(stub, dist/3)`。
  3. router 对 canonical 直连返回 null 时，用共线直线补一条 `fork → 目标` 分支，该成员仍参与合流（否则分组会因一个直连成员退化）。
  4. 主干段的重叠是**真实共享几何**（同一路径被多个逻辑连接共用），不是 PRD §7.3 禁止的「零间距重叠冒充合并」；命中/删除在主干段退化为命中其中一条连接，分支段仍各自独立（PRD §8.3 降级形态不变）。
  5. 其余阶段 2 行为不变：分叉长度三约束、绕行保护 ratio、双阈值滞回、组签名缓存、成员 <2 回退独立。
- **验证**：单元测试 33/33（新增「全部合流共用单条主干」「router 返回 null 的直连成员共线补齐」用例）；视觉实测见 project-progress 本轮记录（用户最终验收）。

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
