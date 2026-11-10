# 连线颜色与流向动效 Token 规范 — 验收材料 v1.0

- 日期：2026-11-07
- 宿主：ComfyUI v0.43.2 / comfyui-frontend-package 1.55.18 / 络纹插件（宿主安装版）
- 被测工作流：`video_minimax_h3_r2v.json`（29 节点 / 33 连线 / 16 类型）
- 规范与主题：`spec.md`、`link-tokens.schema.json`、`luowen-dark.tokens.json`、`luowen-cyberpunk.tokens.json`
- 复算：`verify.mjs`；数据：`data/*`
- 本轮只产出规范与取证，**未修改插件绘制代码、未修改宿主题文件、未引入依赖**

## 0. 验收结论

| 项 | 结果 | 证据 |
| --- | --- | --- |
| 类型覆盖 | 62/62 实测类型 100%；208 输出类型中 9 类回落 `link.unknown`（6 槽为真实私有类型） | §1、`data/coverage.json` |
| 对比度（3px，画布/卡片） | dark 最低 4.65:1 / 3.10:1；cyberpunk 最低 4.95:1 / 4.23:1；全部 ≥3:1 | §2、`data/contrast.md` |
| 色盲 ΔE | 78 对 × 4 条件全部 ≥0.02；最紧 0.0257（dark）、0.0236（cyberpunk） | §3、`data/cvd-matrix-*.csv` |
| 三档缩放截图 | 100% / 60% / 40% 均渲染出 token 语义色；有效线宽 3.00 / 1.80 / 1.20 px | §4、`assets/*.png` |
| 计时试验 | 机器代理 20 次 × 2 条件：同色候选 33 → 1；人眼计时为 N=0，协议见 §5.4 | §5 |
| 动效成本 | 33 连线全量重绘下，流向虚线中位耗时 6.10 → 6.80 ms（+0.70 ms） | §6 |

两项必须显式标注的限制：截图是**运行时注入**（不改文件）得到的；人眼计时试验**尚未执行**，本文只给出可复现协议与机器代理指标。

---

## 1. 类型覆盖清单

### 1.1 配色轴的选择

- 配色轴 = **连线数据类型**（link type），不是节点类型。理由：实测 2318 个节点类、670 个节点 title，但连线只有 208 种输出类型、其中真实工作流出现 62 种；节点类型数量约为连线类型的 11 倍，且同一节点会输出多种类型（如采样器输出 LATENT/IMAGE），按节点类型着色会导致同一条线依赖「哪一端」而变色。
- 真实工作流的共现结构（612 个模板 / 4388 条连线）：IMAGE+VIDEO 164 次、IMAGE+MODEL 152、IMAGE+CONDITIONING 133；头部 11 类覆盖 88.6% 连线。因此必须覆盖的类型 = 这 11 类 + 语义上必须区分的 2 个中性（scalar/struct）。

### 1.2 62 类实测覆盖（100%）

| 类型 | 语义 token | 连线数 | 出现工作流数 |
| --- | --- | --- | --- |
| `IMAGE` | `link.image` | 1564 | 490 |
| `VIDEO` | `link.video` | 399 | 233 |
| `CONDITIONING` | `link.conditioning` | 365 | 77 |
| `STRING` | `link.scalar` | 310 | 98 |
| `MODEL` | `link.model` | 260 | 78 |
| `INT` | `link.scalar` | 260 | 86 |
| `LATENT` | `link.latent` | 240 | 77 |
| `VAE` | `link.vae` | 169 | 76 |
| `CLIP` | `link.clip` | 149 | 75 |
| `MASK` | `link.mask` | 88 | 27 |
| `AUDIO` | `link.audio` | 86 | 56 |
| `FLOAT` | `link.scalar` | 49 | 24 |
| `MESH` | `link.mesh3d` | 43 | 9 |
| `BOOLEAN` | `link.scalar` | 38 | 16 |
| `FILE_3D_GLB` | `link.mesh3d` | 31 | 27 |
| `CLIP_VISION` | `link.clip` | 27 | 17 |
| `CLIP_VISION_OUTPUT` | `link.clip` | 24 | 14 |
| `SIGMAS` | `link.model` | 23 | 17 |
| `SAMPLER` | `link.model` | 21 | 17 |
| `RECRAFT_COLOR` | `link.conditioning` | 20 | 7 |
| `GUIDER` | `link.model` | 16 | 12 |
| `NOISE` | `link.latent` | 16 | 12 |
| `ARRAY` | `link.struct` | 13 | 11 |
| `VOXEL` | `link.mesh3d` | 12 | 6 |
| `*` | `link.unknown` | 12 | 8 |
| `ELEVENLABS_VOICE` | `link.audio` | 10 | 6 |
| `FILE_3D_FBX` | `link.mesh3d` | 10 | 10 |
| `COMBO` | `link.scalar` | 10 | 3 |
| `SVG` | `link.image` | 9 | 9 |
| `AUDIO_ENCODER_OUTPUT` | `link.audio` | 9 | 2 |
| `FILE_3D` | `link.mesh3d` | 8 | 8 |
| `FISHAUDIO_VOICE` | `link.audio` | 7 | 4 |
| `FILE_3D_OBJ` | `link.mesh3d` | 7 | 5 |
| `TRACKS` | `link.video` | 6 | 1 |
| `BACKGROUND_REMOVAL` | `link.image` | 5 | 2 |
| `DICT` | `link.struct` | 5 | 4 |
| `RECRAFT_CONTROLS` | `link.conditioning` | 5 | 5 |
| `CONTROL_NET` | `link.conditioning` | 5 | 4 |
| `LUMA_REF` | `link.conditioning` | 4 | 1 |
| `RECRAFT_V3_STYLE` | `link.conditioning` | 4 | 4 |
| `BOUNDING_BOX` | `link.mask` | 4 | 4 |
| `MHR_POSE_DATA` | `link.struct` | 4 | 1 |
| `WAN_CAMERA_EMBEDDING` | `link.conditioning` | 4 | 3 |
| `SPLAT` | `link.mesh3d` | 3 | 1 |
| `PIXVERSE_TEMPLATE` | `link.struct` | 3 | 3 |
| `LATENT_OPERATION` | `link.latent` | 3 | 3 |
| `SAM3D_BODY_MODEL` | `link.mesh3d` | 3 | 1 |
| `AUDIO_ENCODER` | `link.audio` | 3 | 2 |
| `SHAPE_SUBDIVIDES` | `link.struct` | 2 | 2 |
| `MOGE_MODEL` | `link.model` | 2 | 2 |
| `MOGE_GEOMETRY` | `link.mesh3d` | 2 | 2 |
| `GEMINI_INPUT_FILES` | `link.conditioning` | 2 | 1 |
| `KREA_STYLE_REF` | `link.conditioning` | 2 | 1 |
| `STYLE_MODEL` | `link.model` | 2 | 1 |
| `MODEL_PATCH` | `link.model` | 2 | 2 |
| `LATENT_UPSCALE_MODEL` | `link.model` | 2 | 2 |
| `LOAD3D_CAMERA` | `link.struct` | 1 | 1 |
| `LAYERS` | `link.image` | 1 | 1 |
| `COLOR` | `link.scalar` | 1 | 1 |
| `OPENAI_CHAT_CONFIG` | `link.struct` | 1 | 1 |
| `UPSCALE_MODEL` | `link.model` | 1 | 1 |
| `SAM3_TRACK_DATA` | `link.struct` | 1 | 1 |

按 token 汇总（4388 条连线）：image 1579、scalar 668、conditioning 411、video 405、model 329、latent 259、clip 200、vae 169、mesh3d 119、audio 115、mask 92、struct 30、unknown 12。

### 1.3 未覆盖项与理由（208 输出类型中的 9 类 / 212 槽）

| 类型 | 槽数 | 归类 | 理由 |
| --- | --- | --- | --- |
| `*` | 203 | 动态任意 | 自定义节点的通配输出，语义不可知；按设计回落 `link.unknown` |
| `NLFPRED` | 2 | 私有预测数据 | 极低频插件类型，无稳定语义，不为长尾单开色相 |
| `FACE_LANDMARKS` | 1 | 私有结构化数据 | 同上；若后续进入主流工作流，再按 `link.struct` 或新增语义 |
| `simple,sgm_uniform,...,OSS Chroma` | 1 | COMBO 联合串 | 采样器名枚举，作为「值列表」出现，不是真实连线类型 |
| `default,comfy,comfy_chunked` | 1 | COMBO 联合串 | 同上 |
| `unipc,...,vibt_unipc` | 1 | COMBO 联合串 | 同上 |
| `UNIANIMATE_POSE` | 1 | 私有动作数据 | 极低频 |
| `MTVCRAFTERMOTION` | 1 | 私有动作数据 | 极低频 |
| `LYNXIP` | 1 | 私有人脸模型 | 极低频 |

长尾策略：**不按类型无限扩色**。新增类型先走 `typeRules` 正则归并到 13 个语义之一；连续 3 个版本仍在 `link.unknown` 且进入 ≥5% 工作流时，才评估新增语义与色相（见 `spec.md` §7.3）。

---

## 2. 对比度表

口径：WCAG 2.1 非文本对比度（3:1 门槛），色值为 3px 描边色，底色取主题的 canvas 与卡片背景。完整表见 `data/contrast.md`。

### 2.1 luowen-dark（canvas `#141414` / card `#353535`）

| token | hex | L | C | H | 画布 | 卡片 |
| --- | --- | --- | --- | --- | --- | --- |
| link.image | #76BCFF | 0.775 | 0.12 | 248.8 | 9.13:1 | 6.08:1 |
| link.video | #5196D6 | 0.655 | 0.12 | 248.8 | 5.86:1 | 3.90:1 |
| link.latent | #DF9ADE | 0.775 | 0.12 | 327.1 | 8.61:1 | 5.73:1 |
| link.conditioning | #D09244 | 0.705 | 0.12 | 69.8 | 6.91:1 | 4.60:1 |
| link.clip | #C1BA59 | 0.775 | 0.12 | 105.3 | 9.15:1 | 6.10:1 |
| link.vae | #F99692 | 0.775 | 0.12 | 22.9 | 8.60:1 | 5.73:1 |
| link.model | #A192E5 | 0.705 | 0.12 | 291.4 | 6.81:1 | 4.53:1 |
| link.mask | #6EB470 | 0.705 | 0.12 | 144.8 | 7.39:1 | 4.92:1 |
| link.audio | #44CFBD | 0.775 | 0.12 | 182.9 | 9.57:1 | 6.37:1 |
| link.mesh3d | #13B3CA | 0.705 | 0.12 | 211.2 | 7.31:1 | 4.86:1 |
| link.scalar | #89939E | 0.66 | 0.02 | 250 | 5.90:1 | 3.93:1 |
| link.struct | #77818C | 0.60 | 0.02 | 250 | 4.65:1 | 3.10:1 |
| link.unknown | #9BA6B1 | 0.72 | 0.02 | 250 | 7.44:1 | 4.95:1 |

最低：画布 4.65:1（struct）、卡片 3.10:1（struct），均过 3:1。

### 2.2 luowen-cyberpunk（canvas `#0A0A1A` / card `#1A1A3A`）

最低：画布 4.95:1（struct）、卡片 4.23:1（struct）；最高 10.25:1 / 8.76:1（audio）。13 行全 PASS，完整数值见 `data/contrast.md`。

### 2.3 线宽随缩放的实测修正

`connections_width = 3` 在缩放坐标系里生效（`LGraphCanvas.ts:5523` `toCanvasContext`、`:6028` `ctx.lineWidth`），实测有效线宽：

| 缩放 | 有效线宽 |
| --- | --- |
| 100% | 3.00 px |
| 60% | 1.80 px |
| 40% | 1.20 px |

因此「3px ≥3:1」结论只在 100% 成立；对比度比值与线宽无关，但低缩放下的**感知**会下降，这是 §6 动效降级与「最小屏幕宽度」待定项的依据。

---

## 3. 色盲 ΔE 矩阵

- 度量：OKLab 欧氏距离（ΔE_OK），0.02 ≈ 1 JND；仿真用 Machado 2009 severity 1.0 矩阵，在线性 sRGB 下施加后转回 OKLab。
- 覆盖：13 语义 × C(13,2)=78 对 × 4 条件（normal / protan / deutan / tritan）；全表见 `data/cvd-matrix-luowen-dark.csv` 与 `data/cvd-matrix-luowen-cyberpunk.csv`。

### 3.1 最紧 5 对（dark）

| 色对 | normal | protan | deutan | tritan | min |
| --- | --- | --- | --- | --- | --- |
| video / model | 0.1006 | 0.0257 | 0.0548 | 0.1056 | 0.0257 |
| model / unknown | 0.1071 | 0.0997 | 0.0943 | 0.0269 | 0.0269 |
| image / audio | 0.1305 | 0.1090 | 0.1044 | 0.0283 | 0.0283 |
| latent / mesh3d | 0.2161 | 0.0345 | 0.0781 | 0.2124 | 0.0345 |
| mesh3d / unknown | 0.1055 | 0.0351 | 0.0563 | 0.1038 | 0.0351 |

### 3.2 最紧 5 对（cyberpunk）

| 色对 | min |
| --- | --- |
| video / model | 0.0236 |
| model / unknown | 0.0237 |
| image / audio | 0.0305 |
| latent / mesh3d | 0.0309 |
| mesh3d / unknown | 0.0354 |

结论：两主题在三种色盲仿真下**没有 <0.02 的色对**；最紧的 video/model 靠明度带（video 为 image 色相的低明度冗余编码，model 取 lo 带）把差距从最初的 0.0085 拉到 0.0257。相邻色相最差 ΔE 为 0.0585（dark）/ 0.0539（cyberpunk），满足排序可辨。

---

## 4. 三档缩放真实渲染截图

### 4.1 拍摄条件

- 工作流：`video_minimax_h3_r2v.json`（29 节点 / 33 连线 / 16 类型），经 ComfyUI userdata API 载入。
- 视中心固定为世界坐标 `P = (-320, 5450)`，viewport 1600×853，devicePixelRatio 1；三档同一中心。
- 颜色来源：**运行时**在 `LGraphCanvas.prototype.renderLink` 外包一层，按 `link.type` 查 `data/link-colors-luowen-dark.json` 并把色值作为 `color` 实参传入（不改任何文件）。若直接用宿主现状，33 条连线全为插件兜底 `#94A3B8`。
- 主题：宿主 dark（canvas `#141414`、卡片 `#353535`）。

### 4.2 结果

| 档位 | 文件 | 有效线宽 | 同框语义色数 | 描边数 |
| --- | --- | --- | --- | --- |
| 100% | `assets/luowen-dark-100.png` | 3.00 px | 8 | 30 |
| 60% | `assets/luowen-dark-60.png` | 1.80 px | 9 | 32 |
| 40% | `assets/luowen-dark-40.png` | 1.20 px | 9 | 33 |

### 4.3 观察记录

- 100%：VAE 粉红、IMAGE 蓝、MODEL 紫、CONDITIONING 橙、CLIP 黄、LATENT 品红、AUDIO 青、scalar 灰同框；可凭颜色直接判断「哪条线通向采样器的条件口」。
- 60%：29 个节点全部入画；节点标题仍可读，颜色已接管主要的组间区分（蓝=图像流、紫=模型流、橙=条件流）。
- 40%：整图与分组框全部入画；节点文字不可读，颜色成为唯一可用的分组线索，三簇（蓝/紫/橙）仍可分离。
- 40% 下连线仍清晰可见，但 1.20px 的绝对线宽使相邻同簇连线更易粘连；对应规范中的「≤40% 关闭流向动效」。
- 画面内两个红色报错节点来自缺失模型文件，与配色无关；为保留「真实工作流」原貌未做清理。

---

## 5. 计时试验：在 29 节点工作流里找指定连接

### 5.1 目标与条件

- 目标连接：`id=270`，`CONDITIONING`，「MiniMax H3 参考转视频」→「基本引导器」。
- 条件 A（改色前）：全部连线 `#94A3B8`（等于宿主插件当前兜底色）。
- 条件 B（改色后）：13 语义 token，`CONDITIONING = #D09244`（该类型在图中唯一）。
- 视中心 `P=(-320,5450)`，100% 缩放，1600×853。

### 5.2 方法（机器代理，可复算）

对每种条件渲染一帧后：

1. `getImageData` 取全画布像素（1600×853）；
2. 在 RGB 空间以 ±8 容差检索目标色的像素，记录命中数与首次命中坐标；
3. 以 2px 采样 + 4 邻域洪泛，统计同色连通域（≥5 采样点）；
4. 由模型侧统计「与目标同色的连线数」= 候选数；
5. 每条件 20 次（4 组 ABBA 交替，每组 5 次），取中位数。

### 5.3 结果

| 指标 | A 改色前 | B 改色后 | 变化 |
| --- | --- | --- | --- |
| 目标色像素数 | 28330 | 1269 | −95.5% |
| 同色像素占比 | 2.076% | 0.093% | 22.3× |
| 同色连通域（≥5） | 58 / 34 大块 | 5 / 3 大块 | 视觉候选 34 → 3 |
| 同色连线候选（模型侧） | **33** | **1** | 33 → 1 |
| 随机指认错误概率 | 32/33 = 97.0% | 0/1 = 0% | — |
| 检索中位耗时（含取像素） | 2.3 ms | 2.5 ms | 无显著差异 |

解释：

- 改色前「目标色」不具备区分性——任何灰线都是候选，必须逐条读端点才能排除 32 条错线；改色后该色在图中唯一，候选 1 条、错误 0。
- 后 3 个大块是同一条 CONDITIONING 线被节点遮挡/被其他线穿插后断裂的像素段，不是 3 条不同连线；模型侧候选仍为 1。
- 检索耗时两条件相当（毫秒级），因为脚本不受「人眼辨认」约束；**该耗时不能当作人眼计时结论**，只用于证明「同色信噪比」与「候选数」的差异。

### 5.4 人眼计时协议（待执行，N=0）

1. 受试者 ≥5 人，均熟悉 ComfyUI；每人每条件 10 次，条件顺序随机（A/B 交替抵消学习效应）。
2. 每次开始前把视角重置到 `P=(-320,5450)`、100%，隐藏文件路径与节点标题中的类型词（避免文本线索）。
3. 任务：「找到从『MiniMax H3 参考转视频』连到『基本引导器』的那条线」；计时从画面出现到受试者用鼠标点中该连线；命中判定用画布命中测试。
4. 错误定义：点到其他连线、或 30 s 未找到（记为超时错误）。
5. 记录：完成时间（ms）、错误次数、主观可读性 1–5；报告中位数、IQR、错误率。
6. 预期（待验证，不作结论）：B 条件中位时间显著低于 A，错误率接近 0；若 B 与 A 无差异，则说明低缩放下颜色线索不足，需要回到 §2.3 的线宽问题。

---

## 6. 流向动效的渲染成本

- 方法：同一帧循环 30 次强制全量重绘（`setDirty(true,true)` + `draw(true,true)`），对比「实线」与「虚线 + 逐帧 `lineDashOffset`」两种描边；33 条连线、100%。
- 结果：实线 median 6.10 ms / avg 6.18 ms / p95 8.60 ms；流向 median 6.80 ms / avg 7.10 ms / p95 9.72 ms。
- 增量：中位 +0.70 ms（+11.5%），均值 +0.92 ms（+14.9%）。
- 说明：探针为了统一口径对**所有**描边（含 6 条节点描边）加了虚线，因此这是**上界**；只对连线生效时增量更小。该成本与可见连线数线性相关，符合 `spec.md` §6.4 的「O(可见连线)」。
- 降级：`prefers-reduced-motion` 下静止虚线；≤40% 缩放关闭动效（此时有效线宽 1.2px，流动反而制造噪点）。

---

## 7. 接入结论（本轮不改代码，但必须记录）

宿主插件 `luowen/web/adapters/renderLinkAdapter.js:1123`（仓库版与宿主版同位置）：

```js
const stroke = typeof color === 'string' && color ? color : '#94a3b8';
```

- 原生调用 `renderLink` 时第 7 个参数为 `null`，所以**只写 `LGraphCanvas.link_type_colors` / `--color-datatype-*` 不会生效**。
- 实测：不改文件时 33 条连线全部 `#94A3B8`；运行时按 `link.type` 解析 token 并透传该参数后，33 条连线变为 8–9 种语义色（见 §4）。
- 因此 token 的落点必须是 **`renderLink` 的 `color` 实参**（或插件 `tryCustomRender` 内的 `stroke` 解析），再配合 materialize 生成 `LGraphCanvas.link_type_colors` 供原生路径使用。
- 本轮仅验证与记录，不改插件、不改主题文件。

---

## 8. 复算命令

```powershell
cd d:\Workspace\Code\Comfyui-Luowen\docs\specs\link-color-tokens
node verify.mjs --strict --out data --emit-hex --object-info %TEMP%\luowen-tokens\object_info.json
```

产物：`data/contrast.md`、`data/cvd-matrix-*.csv`、`data/coverage.json`、`data/verify-report.json`、`data/link-colors-*.json`。`--strict` 任一门禁失败即退出码 1。

## 9. 已知限制

1. 截图颜色来自运行时注入，不是任何已发布主题的实际输出；换主题是否只换 token，需在 materialize 落地后复测。
2. 人眼计时试验未执行（N=0），§5.4 为协议而非结果。
3. 像素连通域不等于连线数（一条线会被节点遮挡截断），候选数以模型侧为准。
4. 对比度按纯色计算，未考虑抗锯齿边缘与半透明；实际边缘对比度略低于表值。
5. 仅截取 dark 主题；cyberpunk 主题只做了数值复算，未截图。
6. 40% 档有效线宽 1.2px，低于本规范假设的 3px；低缩放可读性需单独验收。
