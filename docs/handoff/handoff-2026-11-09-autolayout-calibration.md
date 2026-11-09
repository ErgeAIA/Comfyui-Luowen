---
title: 交接 · 自动布局校准三项（DEC-045）——入边间距、主链顶边、列内对齐设置
type: handoff
project: 络纹（LuoWen）
updated: 2026-11-09
description: >
  test2↔test3 对比驱动的三项改进：①自适应层间距改按入边数（222→102px）；
  ②新增 spineTopAlign 主链顶边对齐（全 53.6）；③swapReduceCrossings 增加 align 参数 +
  设置项 LuoWen.AutoLayout.ColumnAlign（默认右对齐，可选居中/左，中列右缘全 905）。
  单测 154/154、宿主探针全绿（重叠0/交叉0/verify ok/undo 10/10）。待用户宿主验证，未合 main。
---

# 交接 · 2026-11-09 · 自动布局校准三项

## 状态

- 分支 `auto-layout`；本轮功能提交见 `git log`（DEC-045）。**未合 main**——新功能按纪律待用户宿主验收后再合（合并/推 main 须用户确认）。
- 改动：`luowen/web/layout/engine.js`（入边计数间距 + spineTopAlign 接线 + columnAlign 透传）、`layout/refine.js`（spineTopAlign 新增 + swapReduceCrossings align 参数）、`luowen/web/index.js`（ColumnAlign 设置 + API 透传）、`i18n.js`（双语）、`tests/unit/layoutRefine.test.mjs`（+3 测试）。已部署宿主，SHA 一致。
- **验收状态**：AI 探针全绿 + 设置项 round-trip 通过；**待用户宿主验证**。

## 关键结论（3 句话）

1. **间距过宽根因**：自适应层间距按 `inPorts.length` 计，把 widget 输入算成端口（KSampler 10 而非 4 入边）→220px；改按 in-degree 后 102px。
2. **主链顶边对齐**：`spineTopAlign` 取可动子图最长路径（并列取起点 top 最小），链上顶边对齐到链上第二个节点；必须在**列重排之前**调用（同列重叠靠列重排消解）。
3. **列内对齐**：`swapReduceCrossings({ align })` right(默认)/center/left；设置项 `LuoWen.AutoLayout.ColumnAlign` 已注册（round-trip 通过）。

## 下次开工第一件事

1. `git log --oneline -3` + `git status --short` 确认基线；宿主若被用户动过，核对 `custom_nodes/luowen/web/layout/{engine,refine}.js` 与仓库 SHA256。
2. **等用户验收**：载入其工作流点「⌁整理」，看 ①列距是否合适（现 102px，可调 base/系数）②主链顶边是否一条线 ③「设置→络纹→自动布局→整理时列内对齐」是否右对齐（可切居中/左）。
3. 验收通过后再谈合并 main。若间距仍偏宽/偏窄，调 `engine.js` 的 `layerSpacing`（现 60）+ 每入边系数（现 20）；若列距想「逐步收紧」需改自适应模型（当前统一值）。

## 坑（别再踩）

- **widget 输入不是端口**：`inPorts` 含 widget 输入，任何按端口数估算走线宽度的逻辑都要改用入边数/连线端口数。
- **spineTopAlign 顺序**：先对齐顶边、再列重排；反过来 KSampler 列间距会被拉大。跨列不会重叠（水平分层），同列重叠由列重排处理。
- **探针启动**：`executablePath` 用 `chromium-1248/chrome-win64/chrome.exe`（默认 1254 缺失）；设置持久化在服务端 `comfy.settings.json`，测后还原（本轮已还原 ColumnAlign=right、CollapseNotes=false）。
- **对比材料**：test2=旧引擎整理结果，test3=用户手动期望（均 10 节点 Z-Image-Turbo，拓扑逐字节一致）；test2 里有 2 处模型缺失红标与宿主版本告警，与布局无关。

## 2026-11-09 补记：DEC-046（逐列 auto 对齐 + 主链感知 + Y 间距可调，supersedes 上文）

- **新测试样本**：`user/default/workflows/test1.json`（13 节点，刻意打乱）/`test2.json`（一键整理）/`test3.json`（手动期望）。**注意 test3 节点 id 已重编号（72–84），与 test1/2（9,62–74）不同**——比对必须按「类型/数组顺序」而非 id。
- **实现变更**：`refine.js` 的 `swapReduceCrossings` 新增 `align='auto'`（逐列按扇入/扇出：`inFromSingle>outToSingle`→左，否则右；基于边数，通用）、`spine` 锚定参数；`spineTopAlign` 改为 `spineOf`（只识别最长路径链+锚顶，不移动）；`engine.js` 接 `nodeGap`；`index.js` 新增 `LuoWen.AutoLayout.NodeGap`（20–120，默认 40），`ColumnAlign` 选项含「自动」且默认自动。
- **实测（宿主 test1）**：col0/1/2 右对齐、col4（VAEDecode→4 save 扇出）左对齐、KSampler 顶边 225.6、重叠 0、交叉 0、undo 13/13、verify ok、66ms。单测 156/156。
- **仍待用户确认**：末列 Y 间距（现统一 40，可调；用户 test3 用 69/114/75 的非均匀值，暂未复现），以及整体观感。