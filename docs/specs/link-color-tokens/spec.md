# 连线颜色与流向动效 Token 规范（草案 v1.0）

> 状态：草案，待评审。范围：只定义连线的颜色 token 与「流向」动效 token；不涉及节点、背景、字体、布局。
> 目标：提高工作流可读性。任何不服务于「更快认出这条线传什么、从哪来到哪去」的视觉处理都不纳入。
> 复算：`node verify.mjs --out data --object-info <object_info.json>`（零依赖，见 §9）。

---

## 1. 三级 token 结构

```
primitive（原始色：色相角 / 明度 / 彩度）
   ↓ 只被引用，不直接用于渲染
semantic（语义色：link.image / link.model …，13 个）
   ↓ 只被映射表引用
component（组件：连线宽度、流向动效参数）
```

- `primitive` 是唯一允许出现「数字」的地方：9 个色相角、3 个明度带、1 个彩度、1 个中性彩度、3 个中性明度。
- `semantic` 不含任何十六进制色值，只写 `{ "hue": "primitive.hue.image", "luminance": "primitive.luminance.hi" }` 或 `{ "neutral": "primitive.neutralLuminance.scalar" }`。
- `component` 不含颜色，只含 `width` 与 `flow`。
- `context`（画布底色 / 卡片底色）**不参与渲染**，只为门槛复算保存宿主主题的两个取值；这是本文件中唯一允许出现的十六进制。

JSON Schema：`link-tokens.schema.json`（draft 2020-12）。校验点：

| 约束 | 作用 |
| --- | --- |
| 根 `required` 七个键 | 防止漏掉任一层 |
| `semantic` 键 `^link\.[a-z0-9-]+$` | 语义名稳定、可做 CSS 变量后缀 |
| 语义值 `oneOf` 两形态 | 强制「有色相」或「纯中性」，不允许混写 |
| 引用必须命中 primitive | 防悬空引用 |
| `typeMap`/`typeRules` 的 token 必须已定义 | 防映射到不存在的语义 |
| `luminance` ∈ [0.3, 0.95]、`chroma` ≤ 0.4 | 防越界导致出 sRGB 色域 |

### 主题继承

子主题写 `"extends": "luowen-dark"`，只覆盖 `primitive` 叶子、`semantic` 叶子、`component`、`context`；`typeMap` 与 `typeRules` 整段继承。

- 禁止删除继承的语义键：子主题缺少 `link.audio` 时校验失败，而不是静默回落到宿主蓝。
- 合并规则：按层深合并（primitive / semantic / component / context 各合并一次），不允许数组级替换以外的语义重定义。
- 换主题 = 换一个 token 文件，绘制代码与映射表不动。

### 已交付文件

| 文件 | 内容 |
| --- | --- |
| `link-tokens.schema.json` | 结构定义 |
| `luowen-dark.tokens.json` | 基准主题：13 个语义 token + 62 条显式映射 + 13 条外推规则 |
| `luowen-cyberpunk.tokens.json` | `extends: luowen-dark`，只覆盖彩度、明度带、组件参数、画布上下文 |
| `verify.mjs` | 零依赖复算：结构校验、对比度、ΔE/CVD 矩阵、类型覆盖 |
| `data/` | 原始统计快照、生成的对比度表、CVD 矩阵 CSV、覆盖清单 |

---

## 2. 色相阶梯（OKLCH）

固定彩度 C，固定两档明度，只用色相角区分类别。色相顺序按语义亲疏排列，不按色轮等距：

| 顺序 | 语义 | 色相 H | 明度带 | 设计理由 |
| --- | --- | --- | --- | --- |
| 1 | `link.vae` | 22.9 | hi | 暖红，图像↔潜空间的「出入口」 |
| 2 | `link.conditioning` | 69.8 | lo | 橙，提示词→采样器的语义通道 |
| 3 | `link.clip` | 105.3 | hi | 黄绿，文本/视觉编码器 |
| 4 | `link.mask` | 144.8 | lo | 绿，遮罩与分割（沿用既有心智模型） |
| 5 | `link.audio` | 182.9 | hi | 青，音频（与图像蓝分离） |
| 6 | `link.mesh3d` | 211.2 | lo | 蓝青，3D 网格/体素 |
| 7 | `link.image` | 248.8 | hi | 蓝，图像（最常用，沿用既有心智模型） |
| 8 | `link.model` | 291.4 | lo | 紫，模型/采样/调度权重 |
| 9 | `link.latent` | 327.1 | hi | 品红，潜空间张量 |

- 相邻色相最小间距 37.6°（conditioning→clip），最大 46.5°；同明度带下相邻两族 ΔE_OK 最小 **0.0539**（cyberpunk，audio/mesh3d），门槛 0.02。
- 明度带：`hi = 0.775`、`lo = 0.705`、`video = 0.655`（dark；cyberpunk 为 0.780 / 0.712 / 0.662）。
- 彩度：dark `C = 0.12`，cyberpunk `C = 0.11`。选 0.12 是因为 L=0.74 时全色相最小可用彩度约 0.126，再高会出 sRGB 色域；cyberpunk 用 0.11 以贴合其霓虹底色而不刺眼。
- 明度带不是装饰，是**同色相内的冗余编码**：`link.video` 与 `link.image` 同色相，仅明度差 0.10（ΔE_OK ≈ 0.10），在 3px 描边上可辨；形状上视频链路常成串出现，两者叠加可靠区分。
- 中性族单独一套明度：`scalar = 0.66`、`struct = 0.60`、`unknown = 0.72`，彩度 `C = 0.02`、色相固定 250。低彩度的含义是「非数据、不参与语义竞争」：参数、容器、未知。

> 为什么不用节点类型作为配色轴：见 §7.1。

---

## 3. 语义 token

| token | dark | cyberpunk | 覆盖 |
| --- | --- | --- | --- |
| `link.image` | `#76BCFF` | `#7EBDFB` | 图像/像素/图层/预览 |
| `link.video` | `#5196D6` | `#5A98D3` | 视频帧序列、轨道 |
| `link.latent` | `#DF9ADE` | `#DD9EDC` | 潜空间张量、噪声 |
| `link.conditioning` | `#D09244` | `#CE9550` | 条件、控制、参考 |
| `link.clip` | `#C1BA59` | `#C1BC64` | 文本/视觉编码器 |
| `link.vae` | `#F99692` | `#F69B96` | VAE / TAESD |
| `link.model` | `#A192E5` | `#A395E1` | 模型/采样器/调度器/GUIDER |
| `link.mask` | `#6EB470` | `#75B476` | 遮罩/分割/包围盒 |
| `link.audio` | `#44CFBD` | `#57CEBE` | 音频/语音 |
| `link.mesh3d` | `#13B3CA` | `#36B4C9` | 网格/体素/点云/3D 文件 |
| `link.scalar` | `#89939E` | `#89939E` | STRING/INT/FLOAT/BOOLEAN/COMBO/COLOR |
| `link.struct` | `#77818C` | `#77818C` | PIPE/DICT/ARRAY/配置/模板 |
| `link.unknown` | `#9BA6B1` | `#9BA6B1` | 未识别类型、`*` |

以上十六进制由 `verify.mjs` 从 primitive 复算，token 文件内不存储色值。

---

## 4. 门槛与达标情况

门槛（全部可复算）：

1. 3px 描边在画布底色与卡片底色上的 WCAG 非文本对比度 ≥ **3:1**。
2. `protan` / `deutan` / `tritan`（Machado 2009，severity 1.0，线性 sRGB）仿真后，任意两语义色 `ΔE_OK` ≥ **0.02**（约 1 JND）。
3. 相邻色相在参考明度带下 `ΔE_OK` ≥ **0.02**。

| 指标 | luowen-dark | luowen-cyberpunk |
| --- | --- | --- |
| 画布对比度最低 | 4.65（`link.struct`） | 4.95（`link.struct`） |
| 卡片对比度最低 | **3.10**（`link.struct`） | **4.23**（`link.struct`） |
| 卡片对比度最高 | 6.37（`link.audio`） | 8.76（`link.audio`） |
| 色盲全矩阵最差 | 0.0257（`video`/`model`） | 0.0236（`video`/`model`） |
| ΔE < 0.02 的色对 | 0 | 0 |
| 相邻色相最小 ΔE | 0.0585 | 0.0539 |

`link.struct` 的 3.10 是刻意贴近门槛：它是「容器」语义，本来就不该抢视觉优先级；再暗就会不合格。`link.video`/`link.model` 的 0.0257 是当前余量最薄的一对，两者在三类色盲下都靠明度差支撑，因此这两档明度带不再允许下压。

对比度全表：`data/contrast.md`；色盲矩阵：`data/cvd-matrix-luowen-dark.csv`、`data/cvd-matrix-luowen-cyberpunk.csv`。

---

## 5. 前端接入层（源码取证结论）

### 5.1 当前取色链（前端 1.55.18）

1. `link.color`：逐连线覆盖，优先级最高。
2. `LGraphCanvas.link_type_colors[slotTypeKey(link.type)]`：按类型名取色。
3. Vue 节点模式：`--color-datatype-<TYPE>` CSS 变量（`getSlotColor()` 读取时 `toUpperCase()`）。
4. `default_connection_color_byType` / `default_link_color`：兜底。

证据（sourcemap 还原的 `sourcesContent`）：

- `.../src/lib/litegraph/src/LGraphCanvas.ts` `:356-360` 默认 `link_type_colors` 只有 `-1/number/node`；`:1011-1015` `default_connection_color_byType = {}`；`:1071` `this.connections_width = 3`；`:5217`、`:6028` `ctx.lineWidth = this.connections_width`；`:6351-6354` reroute 取色顺序；`:6460` `connectionWidth: this.connections_width`。
- `.../src/renderer/core/canvas/pathRenderer.ts` `:168-183` `determineLinkColor`；`:115` `ctx.lineWidth = context.style.connectionWidth`。
- `.../src/services/colorPaletteService.ts` `:82-92` 先把 `nodeDataTypes` 全部置 `''`，再 `Object.assign(app.canvas.default_connection_color_byType, types, linkColorPalette)` 与 `LGraphCanvas.link_type_colors`；`:102-117` Vue 模式写入 `--color-datatype-${dataType}`；`:254`、`:260` 主题加载后调用。
- `.../src/constants/slotColors.ts` `getSlotColor()`：`String(type).toUpperCase()` + `var(--color-datatype-... , #AAA)`。

### 5.1b 当前宿主实测：插件绕过调色板（关键）

宿主已安装络纹，其 `renderLink` 包装在 `luowen/web/adapters/renderLinkAdapter.js:1123`：

```js
const stroke = typeof color === 'string' && color ? color : '#94a3b8';
```

原生调用 `renderLink` 时第 7 个参数 `color` 为 `null`，因此：

- 只写 `LGraphCanvas.link_type_colors` / `--color-datatype-*` **不会生效**，连线仍是 `#94a3b8`（实测 33 条连线全部该色）。
- 在运行时于原型上再包一层、按 `link.type` 解析出 token 色并透传，33 条连线立即变为 13 个语义色（实测 9 个不同色值，覆盖当前工作流 16 类型）。

结论：**token 的接入点必须是 `renderLink` 的 `color` 实参**（原生取色链的上游），而不是只改调色板对象。落地时优先改插件一行解析（或由 materialize 生成的调色板 + 插件读取），本轮不改代码。

对应证据与截图见 `acceptance.md` §7。

### 5.2 token 应插在哪一层

**插在「token → 调色板对象 → 现有装载函数」之间，不碰绘制热路径。**

```
*.tokens.json → materialize.mjs（计算 hex + 展开 typeMap）
              → { node_slot: {TYPE: hex}, typeMap, typeRules }
              → 复用 loadLinkColorPalette / loadLinkColorPaletteForVueNodes
              → LGraphCanvas.link_type_colors + --color-datatype-*
```

理由：

- 绘制层只读 `style.connectionWidth` 与颜色字符串，插在这里天然零硬编码。
- 换主题只替换 materialize 的输入文件；不重新编译、不改调色板服务。
- 不进入 `drawConnections` / `pathRenderer` 的逐帧逻辑，不影响既有路由性能预算。

### 5.3 必须处理的三个坑

1. **空串是假值**：`loadLinkColorPalette` 先把所有已知类型写成 `''`，未在 `typeMap` 中列出的类型会落到兜底色。因此 `typeMap` 必须显式包含实测 62 类，`*` 必须显式指向 `link.unknown`。
2. **CSS 变量大小写**：写入端用 `--color-datatype-${dataType}`（原样），读取端 `toUpperCase()`。CSS 变量名大小写敏感，类型名含小写时视觉上会「随机没颜色」。materialize 时统一 `toUpperCase()`。
3. **兜底色仍是宿主蓝**：任何未命中规则的类型回落到 `default_link_color`。因此「未知」必须是第一类公民，而不是「没有配置」。

### 5.4 有效线宽随缩放变化（实测，影响门槛解释）

`connections_width = 3` 是在 `ds.toCanvasContext(ctx)` 建立的缩放坐标系里赋值的（`LGraphCanvas.ts:5523`、`:6028`），所以**屏幕上的有效线宽 = 3 × 当前缩放**。宿主实测（同一视中心，强制全量重绘，拦截 `stroke` 读取 `lineWidth × transform.a`）：

| 缩放 | 有效线宽 | 描边次数 |
| --- | --- | --- |
| 100% | 3.00 px | 30 |
| 60% | 1.80 px | 32 |
| 40% | 1.20 px | 33 |

因此 §4 的「3px 描边 ≥3:1」只在 100% 缩放成立；对比度比值本身与线宽无关，但**可辨性会随线宽变细下降**。这是 ≤40% 建议关闭流向动效、并保留 `component.connection.width` 作为「屏幕空间最小宽度」待定项的实测依据。

---

## 6. 动效：只表达「流向」

### 6.1 语义

唯一表达：**数据从源槽流向目标槽**。实现为虚线沿路径的行进方向，源→目标。

不做的事：不做颜色渐变、不做「数据流动量」提示、不做按类型差异化速度。速度、虚实只允许一套。

修订（DEC-040，2026-11-08）：原「不脉冲、不发光」调整为「装饰性动效默认不提供；发光（shadowBlur 恒定光晕）与脉冲（宽度振荡）作为显式线型供用户选择，须过帧预算（500 线微基准 ≤0.15ms/帧）与对比度门槛」。原禁令的噪声/眩晕顾虑由「默认虚线行进 + 三重闸门 + 用户可随时关闭」承接。

### 6.2 token

```json
"component": {
  "connection": {
    "width": 3,
    "flow": { "enabled": false, "dash": 7, "gap": 13, "speed": 48, "opacity": 0.92 }
  }
}
```

- `width: 3` 与宿主 `connections_width` 对齐；token 只声明期望值，宿主值仍是事实来源。
- `dash/gap` 为屏幕像素（100% 缩放）；`speed` 为 px/s。
- `opacity` 作用于虚线叠层，不改连线本体颜色，避免二次混色破坏对比度门槛。

### 6.3 开关与降级

| 条件 | 行为 |
| --- | --- |
| 用户设置关闭（默认关闭） | 实线，行为与原生完全一致 |
| `prefers-reduced-motion: reduce` | 强制关闭动画，保留静态虚线或不保留虚线（二选一，见待确认项）；颜色不变 |
| 缩放 ≤ 40% | 建议自动关闭动画（虚线在小缩放下退化为噪点） |
| 宿主未开启 Vue 节点模式 | 两种模式共用同一批语义色，动效层独立判断 |

### 6.4 渲染成本

- 动画只对**视口内可见连线**推进 `lineDashOffset`，复杂度 O(可见连线数)，与节点数、路由搜索无关。
- 不新增每帧布局、不触发重排；只改 stroke 的 dash offset 与一次 `strokeStyle` 赋值。
- 关闭时零额外绘制。微基准结果见验收文档（`acceptance.md` §5）。

---

## 7. 类型覆盖与长尾

### 7.1 为什么不用节点类型作为配色轴

| 维度 | 数据类型轴（本方案） | 节点类型轴 |
| --- | --- | --- |
| 取值数量 | 208 个输出类型，实测 62 个出现在连线中 | 2318 个节点类 |
| 可配色性 | 9 族 + 3 中性足够覆盖 88.6% | 无法为 2318 类分配可辨色 |
| 与连线的关系 | 连线本身由 slot 类型决定 | 一个节点可同时输出 MODEL/CLIP/VAE，节点色会让三类信息合并为一种 |
| 用户问题 | 「这条线传什么」 | 「这个节点是什么」由标题已回答 |

结论：颜色编码的是**数据语义**；节点身份已由标题与形状表达，再着色是重复编码。

### 7.2 必须覆盖的类型清单（实测 62 类）

按连线数排序，全部显式写入 `typeMap`，覆盖率 **4388/4388 = 100%**：

`IMAGE`(1564)、`VIDEO`(399)、`CONDITIONING`(365)、`STRING`(310)、`MODEL`(260)、`INT`(260)、`LATENT`(240)、`VAE`(169)、`CLIP`(149)、`MASK`(88)、`AUDIO`(86)、`FLOAT`(49)、`MESH`(43)、`BOOLEAN`(38)、`FILE_3D_GLB`(31)、`CLIP_VISION`(27)、`CLIP_VISION_OUTPUT`(24)、`SIGMAS`(23)、`SAMPLER`(21)、`RECRAFT_COLOR`(20)、`GUIDER`(16)、`NOISE`(16)、`ARRAY`(13)、`VOXEL`(12)、`*`(12)、`ELEVENLABS_VOICE`(10)、`FILE_3D_FBX`(10)、`COMBO`(10)、`SVG`(9)、`AUDIO_ENCODER_OUTPUT`(9)、`FILE_3D`(8)、`FISHAUDIO_VOICE`(7)、`FILE_3D_OBJ`(7)、`TRACKS`(6)、`BACKGROUND_REMOVAL`(5)、`DICT`(5)、`RECRAFT_CONTROLS`(5)、`CONTROL_NET`(5)、`LUMA_REF`(4)、`RECRAFT_V3_STYLE`(4)、`BOUNDING_BOX`(4)、`MHR_POSE_DATA`(4)、`WAN_CAMERA_EMBEDDING`(4)、`SPLAT`(3)、`PIXVERSE_TEMPLATE`(3)、`LATENT_OPERATION`(3)、`SAM3D_BODY_MODEL`(3)、`AUDIO_ENCODER`(3)、`SHAPE_SUBDIVIDES`(2)、`MOGE_MODEL`(2)、`MOGE_GEOMETRY`(2)、`GEMINI_INPUT_FILES`(2)、`KREA_STYLE_REF`(2)、`STYLE_MODEL`(2)、`MODEL_PATCH`(2)、`LATENT_UPSCALE_MODEL`(2)、`LOAD3D_CAMERA`(1)、`LAYERS`(1)、`COLOR`(1)、`OPENAI_CHAT_CONFIG`(1)、`UPSCALE_MODEL`(1)、`SAM3_TRACK_DATA`(1)。

分布：`image` 1579、`video` 405、`scalar` 668、`conditioning` 411、`model` 329、`latent` 259、`clip` 200、`vae` 169、`mesh3d` 119、`audio` 115、`mask` 92、`struct` 30、`unknown` 12。最大族 `image` 占 36.0%，没有出现某族独占导致其余颜色失效的结构。

### 7.3 长尾策略

1. **实测命中**：62 类显式映射，不依赖正则，等价于「锁死」。
2. **外推规则**：13 条按序正则，只用于宿主升级后新增类型；首条命中即返回。
3. **回落**：`link.unknown` 是显式语义（中性、低彩度、对比度 7.44），不是「没配置」。`*` 必须在 `typeMap` 中显式出现，否则会落回宿主蓝。
4. **不覆盖是设计选择**：208 个输出类型中 9 类 / 212 槽回落 `unknown`（其中 `*` 占 203 槽），剩余主要是组合字符串与 3 个第三方私有类型（`NLFPRED`、`LYNXIP`、`UNIANIMATE_POSE`）。理由：它们没有可归纳的数据语义，硬凑颜色反而制造假规律。

---

## 8. 边界与不做的事

- 不写进插件绘制代码：本轮只产出 token、Schema、复算脚本与文档。
- 不改主题文件：`cyberpunk.json` 与 `dark.json` 保持原样；token 与其并行存在。
- 不引入新依赖：`verify.mjs` 只用 Node 标准库。
- 不重复造轮子：ComfyUI 自带调色板编辑器与导入导出，`shahshrey/ComfyUI-themes` 已做主题画廊，pysssss 的 Link Render Mode 只做几何渲染模式；本轮不造主题引擎、不造渲染模式、不造节点，只补「语义 token + 流向动效」这一层。

---

## 9. 复算方法

```powershell
cd docs\specs\link-color-tokens
node verify.mjs --strict --out data --object-info C:\Users\GigaByte\AppData\Local\Temp\luowen-tokens\object_info.json
```

- 不带 `--object-info` 时只复算颜色门槛与 62 类覆盖。
- `data/verify-report.json` 含全部中间值（每个 token 的 L/C/H、对比度、91 对 ΔE、覆盖分布）。
- 原始统计快照在 `data/type-frequency.json` 与 `data/output-types.json`，抓取时间与宿主版本记录在 `meta` 中。

---

## 10. 待确认项

1. 动效默认开启还是默认关闭：本草案取**默认关闭**（成本与眩晕风险优先），需产品确认。
2. `prefers-reduced-motion` 下是「静态虚线」还是「纯实线」：草案倾向纯实线，避免虚线被误读为「运动中的状态」。
3. ≤40% 缩放自动关闭动效：是否需要用户可见提示。
4. `link.struct` 卡片对比度 3.10 贴门槛，是否允许为美观再降明度（不建议，降即不合格）。
