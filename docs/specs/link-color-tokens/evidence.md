# 连线 token 设计：三件取证报告

> 采集日期：2026-11-07。宿主 ComfyUI v0.43.2，前端 comfyui-frontend-package 1.55.18。
> 原始数据与脚本在 `data/`；前端源码由宿主 `static/assets/*.map` 的 `sourcesContent` 还原。

---

## 取证一：类型频次与共现

### 1.1 口径

| 来源 | 内容 | 数量 |
| --- | --- | --- |
| `GET http://127.0.0.1:8188/object_info` | 节点类、输出槽、输入类型 | 2318 类节点 / 3712 输出槽 / 208 个不同输出类型 |
| `...\python_embeded\Lib\site-packages\comfyui_workflow_templates_json\templates` | 官方工作流模板（含子图展开） | 612 份 / 4388 条连线 / 62 个不同连线类型 |

模板侧统计：670 个不同节点类型，平均 8.1 节点，中位 6，最大 68；≥20 节点的模板 38 份。

### 1.2 频次分布

连线类型头部（数量 / 出现模板数）：

| 类型 | 连线 | 模板 | 类型 | 连线 | 模板 |
| --- | --- | --- | --- | --- | --- |
| IMAGE | 1564 | 490 | CLIP | 149 | 75 |
| VIDEO | 399 | 233 | MASK | 88 | 27 |
| CONDITIONING | 365 | 77 | AUDIO | 86 | 56 |
| STRING | 310 | 98 | FLOAT | 49 | 24 |
| MODEL | 260 | 78 | MESH | 43 | 9 |
| INT | 260 | 86 | BOOLEAN | 38 | 16 |
| LATENT | 240 | 77 | FILE_3D_GLB | 31 | 27 |
| VAE | 169 | 76 | CLIP_VISION | 27 | 17 |

- 头部 11 类占 88.6% 连线；尾部 40 类各 ≤20 条。
- **官方 16 键 `node_slot` 只覆盖 2969/4388 = 67.7% 连线**，输出槽维度只覆盖 1742/3712 = 46.9%。
- 未被 16 键覆盖的高频类型：`VIDEO`(399)、`STRING`(310)、`INT`(260)、`AUDIO`(86)、`FLOAT`(49)。其中 `VIDEO` 在模板中没有任何 `node_slot` 键，全部回落到 `LINK_COLOR` —— 这是当前主题最明显的可见缺口。

### 1.3 共现（同一条工作流内出现的类型对）

| 类型对 | 出现模板数 |
| --- | --- |
| IMAGE + VIDEO | 164 |
| IMAGE + STRING | 86 |
| CONDITIONING + MODEL | 77 |
| CONDITIONING + LATENT | 76 |
| CONDITIONING + VAE | 76 |
| LATENT + MODEL | 76 |
| LATENT + VAE | 76 |
| MODEL + VAE | 76 |
| IMAGE + INT | 76 |
| CLIP + CONDITIONING | 71 |

读法：`IMAGE+VIDEO` 高共现说明两者必须能同时区分且不互斥；`CONDITIONING/MODEL/LATENT/VAE` 四者几乎总在同一条工作流里，是「采样链」的固定角色组合，配色必须让这四者在同一屏内可分辨。这直接决定了 9 族方案里它们必须是 4 个不同色相，而不是靠明度细分的同色系。

### 1.4 必须覆盖的类型清单

以「实测出现过的 62 类」为必须覆盖集（见 `spec.md` §7.2），`typeMap` 逐条显式写入。长尾（未实测的 146 个输出类型）交给有序正则与 `link.unknown`。

### 1.5 为什么不用节点类型作为配色轴

- 数量不可配：2318 个节点类无法映射为可辨色；实测连线类型只有 62 个。
- 语义错位：连线的颜色应回答「传的是什么」，节点身份已由标题表达。
- 一对多：`CheckpointLoaderSimple` 同时输出 `MODEL`/`CLIP`/`VAE`；按节点着色会把三类信息压成一种，恰好破坏可读性。
- 频次证据：模板里 670 个节点类型、62 个连线类型，节点类型轴的信噪比比类型轴差一个数量级。

---

## 取证二：前端取色解析链与描边宽度

### 2.1 解析链（按优先级）

```
link.color（逐连线覆盖）
  → LGraphCanvas.link_type_colors[slotTypeKey(link.type)]        （Canvas 模式）
  → app.canvas.default_connection_color_byType[type]
  → --color-datatype-<TYPE>                                        （Vue 节点模式）
  → default_link_color                                             （兜底）
```

关键源码（路径均为 sourcemap 还原后的虚拟路径，行号对 1.55.18 的 `static/assets` 产物）：

| 文件 | 行 | 事实 |
| --- | --- | --- |
| `src/lib/litegraph/src/LGraphCanvas.ts` | 356-360 | 静态 `link_type_colors` 默认只有 `-1`/`number`/`node` |
| 同上 | 1011-1015 | `default_connection_color_byType = {}` |
| 同上 | 1071 | `this.connections_width = 3` |
| 同上 | 5217 / 6028 | `ctx.lineWidth = this.connections_width` |
| 同上 | 6351-6354 | reroute 取色 `link.color || link_type_colors[slotTypeKey(link.type)] || default_link_color` |
| 同上 | 6460 | `connectionWidth: this.connections_width`（传入渲染上下文） |
| `src/renderer/core/canvas/pathRenderer.ts` | 168-183 | `determineLinkColor`：highlighted → `link.color` → `byType` → default |
| 同上 | 115 | `ctx.lineWidth = context.style.connectionWidth` |
| `src/services/colorPaletteService.ts` | 82-92 | 先把 `nodeDataTypes` 全部置 `''`，再 `Object.assign(canvas.default_connection_color_byType, types, palette)` 与 `LGraphCanvas.link_type_colors` |
| 同上 | 102-117 | Vue 模式写 `--color-datatype-${dataType}` |
| 同上 | 254 / 260 | 主题加载后分别调用两个装载函数 |
| `src/constants/slotColors.ts` | — | `getSlotColor()`：`String(type).toUpperCase()` + `var(--color-datatype-X, #AAA)` |

### 2.2 结论

1. **描边实际宽度 = 3**，来自 `connections_width`，不是主题文件可配项。因此对比度门槛按 3px 计算；token 的 `width: 3` 只是声明对齐值。
2. **token 的正确插入层**是「调色板对象 → 现有装载函数」，产出 `node_slot` 结构与运行时 map，不进入 `drawConnections`/`pathRenderer`。
3. **零硬编码成立的条件**：所有 62 类显式写入映射；`*` 显式指向 `unknown`；Vue 变量名统一大写。
4. **换主题只换 token**：主题差异只有 primitive 数值与 context，绘制代码零改动。

### 2.3 已确认的坑

| 坑 | 证据 | 后果 |
| --- | --- | --- |
| 空串为假值 | `colorPaletteService.ts:82-92` 先写 `''` | 未列出的类型回落到兜底色（宿主蓝），不是「无色」 |
| CSS 变量大小写 | 写入 `--color-datatype-${dataType}`，读取 `toUpperCase()` | 小写类型名的线在 Vue 模式取不到色 |
| `getSlotColor` 兜底 `#AAA` | `slotColors.ts` | 未配置类型的槽点是灰白，与 `link.unknown` 语义色不一致 |

---

## 取证三：主题 diff、基线体检与现存插件

### 3.1 主题结构

`cyberpunk.json` 与官方 `dark.json` 都是三段式：

```
colors: { node_slot: {TYPE: hex}, litegraph_base: {…}, comfy_base: {…} }
```

| 项 | cyberpunk | dark（官方 Dark Default） |
| --- | --- | --- |
| 画布底色 `CLEAR_BACKGROUND_COLOR` | `#0A0A1A` | `#141414` |
| 节点卡片 `NODE_DEFAULT_BGCOLOR` | `#1A1A3A` | `#353535` |
| `node_slot` 键数 | 16 | 16 |
| 键集差异 | 无 `PIPE_LINE`；含 `CLIP_VISION`/`CLIP_VISION_OUTPUT`/`CONTROL_NET`/`NOISE`/`GUIDER`/`SAMPLER`/`SIGMAS`/`TAESD` | 同左集合，另含 `PIPE_LINE` |
| `LINK_COLOR`（兜底） | `#00FFFF`（青） | `#9A9` |
| 可复用变量 | `node_slot` 三段结构、`litegraph_base` 中的画布/卡片底色 | 同 |

共同缺口：

- 都没有 `VIDEO`、`STRING`、`INT`、`FLOAT`、`BOOLEAN`、`AUDIO`、`MESH` —— 实测这些合计 1172 条连线（26.7%）。
- 两者都没有明度分级约定：同色相只出现一次，无法表达「同族不同层级」。
- `cyberpunk` 的霓虹原色（`#00FFFF`/`#FF00FF`/`#00FF00`）大量落在 L≈0.9 附近，卡片上对比度尚可，但色相间距极小。

### 3.2 基线门槛体检（同一套公式复算）

| 主题 | 16 键中 ΔE<0.02 的色对 | 最差色对 | 对比度不合格 |
| --- | --- | --- | --- |
| cyberpunk | **10 对** | `CLIP`/`GUIDER` = 0.0014 | 0 |
| dark（官方） | **3 对** | `IMAGE`/`LATENT` = 0.0048 | 0 |

cyberpunk 的 10 对失败里，`IMAGE`/`MODEL` = 0.0015、`LATENT`/`VAE` = 0.0048、`CLIP_VISION`/`IMAGE` = 0.0050、`CONTROL_NET`/`MASK` = 0.0050 —— 正是 §1.3 高共现的关键角色，实际使用中会出现「同一屏内分不出」的问题。这就是不直接沿用现有主题色、而重新生成色相阶梯的原因。

外部主题抽样：`shahshrey/ComfyUI-themes` 的 `neon-night` 中 `MODEL` 对卡片/画布对比度 2.95 / 2.62（低于 3:1），且 `CLIP` 与 `TAESD` 同色。

### 3.3 现存轮子与边界

| 来源 | 已有能力 | 与本方案关系 |
| --- | --- | --- |
| ComfyUI 核心 | `Comfy.CustomColorPalettes` 多主题、导入/导出、`colorPaletteService` 装载 | 复用；token 只是它的上游 |
| ComfyUI-Custom-Scripts（pysssss） | `linkRenderMode.js`：直线/曲线/折线等**几何**渲染模式 | 不复用，不重叠；它不提供颜色 |
| `shahshrey/ComfyUI-themes` | 大量现成主题 JSON、主题画廊 | 不重复造；我们的 token 可导出为兼容调色板 |
| rgthree-comfy / KJNodes | 读取 `link_type_colors` 为自己的链路取色 | 只消费，不定义；与本方案兼容 |

结论：**不造主题引擎、不造渲染模式、不造节点。** 只补两个缺口：语义 token 层（可继承、可复算、过门槛）与「流向」动效。

---

## 复算与数据出处

```powershell
cd docs\specs\link-color-tokens
node verify.mjs --strict --out data --object-info C:\Users\GigaByte\AppData\Local\Temp\luowen-tokens\object_info.json
```

| 文件 | 内容 |
| --- | --- |
| `data/type-frequency.json` | 62 类频次 + 30 组共现 + 采集元信息 |
| `data/output-types.json` | 208 个输出类型与槽数 |
| `data/contrast.md` | 两套主题的对比度全表 |
| `data/cvd-matrix-*.csv` | 91 对 × 4 种视觉条件下的 ΔE |
| `data/coverage.json` | 62 类逐条映射结果 |
| `data/verify-report.json` | 全部中间值（含 L/C/H 与门槛判定） |
