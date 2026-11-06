# ComfyUI 自定义节点开发约定（开发基线 · spec-of-record）

> **适用版本档案**（本机实测，2026-11-06）
> - ComfyUI **v0.43.2**，git detached HEAD @ tag v0.43.2（commit `423cbd2`，提交均为官方提交），位于 `D:\AIGC\ComfyUI_windows_portable\ComfyUI`
> - Python **3.13**（embedded）+ torch **2.14.0+cu130**，RTX 5080 16GB
> - 前端包实际安装 **comfyui-frontend-package 1.55.18**（⚠️ requirements.txt 声明 1.57.4 未重装，前端 API 结论一律以 **1.55.18** 为准）
> - 启动方式：根目录 `run_nvidia_gpu.bat`（`--windows-standalone-build`，默认端口 8188）
>
> **引用约定**：`nodes.py:2299` 等行号均指上述本机 checkout（省略前缀 `D:\AIGC\ComfyUI_windows_portable\ComfyUI\`）。前端源码引用来自前端包自带的 sourcemap（内嵌完整 TypeScript 原文，与本机 1.55.18 逐字一致）。
> **交叉验证标注**：`[n/7]` 表示该写法在本机 7 个成熟节点包（KJNodes / VHS / WanVideoWrapper / Impact-Pack / GGUF / Easy-Use / rgthree）中被 n 个采用；≥2 才有资格称"约定"。
> **模板**：`template/ComfyUI-Luowen/`（正本）已安装至 `custom_nodes\ComfyUI-Luowen\` 并通过 §6 全部验证；每条契约在 `template/.../nodes/example.py` 里有带行号的活体示例。

---

## 1. 服务端节点契约（V1 旧式，本文档主体）

两种契约**并存**：V1（`NODE_CLASS_MAPPINGS` 入口）与 V3（`comfy_entrypoint` 入口，见 §7）。V1 是社区主流 [7/7 范例包均为 V1]，加载器把两种风格注册进同一个 `NODE_CLASS_MAPPINGS`（`nodes.py:2305-2341`）。

### 1.1 节点类最小必需四件套

`INPUT_TYPES`（classmethod）、`RETURN_TYPES`、`FUNCTION`、`CATEGORY`。官方教程同口径（docs.comfy.org/custom-nodes/walkthrough）。最小示例见 `comfy_extras/nodes_align_your_steps.py`（65 行，V3）与本模板 `nodes/example.py`。

### 1.2 INPUT_TYPES 结构与输入选项 key

- classmethod，返回 `{"required": {...}, "optional": {...}, "hidden": {...}}`；声明在 `comfy/comfy_types/node_typing.py:253-265`、`200-206`；三段解析在 `comfy_execution/graph.py:94-109`。
- 条目格式 `"名称": ("TYPE", {选项dict})` 或 `"名称": ("TYPE",)`。
- **核心事实：除 `min`/`max`/COMBO 选项表/`rawLink` 外，服务端不解析任何 UI key，全部原样经 `/object_info` JSON 透传给前端**（`node_typing.py:95-169` 是全量类型声明）。

| key | 服务端行为 | 备注 |
|---|---|---|
| `default` | 透传 | |
| `min` / `max` | **入队校验**（`execution.py:1034-1059`） | 仅有的两个被校验的数值 key |
| COMBO 选项列表（类型即 list） | **成员资格校验**（`execution.py:1061-1094`） | >20 项时不回显列表 |
| `rawLink` | **有语义**：输入收到 `[node_id, slot]` 链接本身（`execution.py:179`） | 节点展开类用 |
| `forceInput` | 透传；前端把 widget 渲染成输入 socket | `defaultInput` 已 deprecated，勿用 |
| `tooltip` / `multiline` / `placeholder` / `dynamicPrompts` / `step` / `round` / `label_on` / `label_off` / `control_after_generate` / `image_upload` / `lazy` / `options` | 透传（纯前端） | `lazy` 配合 `check_lazy_status` |
| `multi_select` | multiselect 校验分支（`execution.py:1066-1068`） | |

- 服务端会做**类型强转**：INT/FLOAT/STRING/BOOLEAN 的常量值入队时被重写（`execution.py:1006-1017`）。

### 1.3 类属性全集（读取位置）

| 属性 | 读取位置 | 说明 |
|---|---|---|
| `FUNCTION` | `execution.py:353,300` | 方法名，按命名参数调用；可为协程（async 节点 `execution.py:301-312`） |
| `RETURN_TYPES` / `RETURN_NAMES` | `server.py:851,853` | tuple；无输出写 `()` |
| `CATEGORY` | `server.py:869`（缺省 `'sd'` @858） | 顶层 = 包命名空间 [7/7] |
| `DESCRIPTION` | `server.py:856` | 出现在前端节点搜索结果里（模板已验证） |
| `OUTPUT_NODE` | `server.py:859-862`、`execution.py:1183`、调度优先 `comfy_execution/graph.py:329` | 保存/预览类节点 |
| `DEPRECATED` / `EXPERIMENTAL` / `DEV_ONLY` | `server.py:875-880` | getattr 默认 False |
| `API_NODE` / `SEARCH_ALIASES` / `ESSENTIALS_CATEGORY` / `OUTPUT_TOOLTIPS` / `HAS_INTERMEDIATE_OUTPUT` | `server.py:882-888,872-873,864-867` | 0.43 在册属性 |
| `INPUT_IS_LIST` / `OUTPUT_IS_LIST` | `execution.py:254` / `execution.py:335-336` | 列表批处理 |
| `NOT_IDEMPOTENT` | `comfy_execution/caching.py:118` | node_id 进缓存键 |
| `RELATIVE_PYTHON_MODULE` | 加载时写入 `nodes.py:2309,2339` | 系统注入，勿手写 |

> ⚠️ **`RETURN_IS_LIST` 与 `OUTPUT_TO_LIST` 不存在**（全仓 0 命中）——列表语义只有 `INPUT_IS_LIST` / `OUTPUT_IS_LIST`。

### 1.4 hidden 输入（8 种，`execution.py:216-234`）

`PROMPT` / `DYNPROMPT` / `EXECUTION_LIST` / `EXTRA_PNGINFO` / `UNIQUE_ID` / `AUTH_TOKEN_COMFY_ORG` / `API_KEY_COMFY_ORG` / `COMFY_USAGE_SOURCE`。
注意：声明 `UNIQUE_ID` 会把 node_id 加进缓存键（`caching.py:118`）→ 同一节点每个实例独立缓存。

### 1.5 校验与缓存钩子

- **`VALIDATE_INPUTS`**（`execution.py:1096-1129`）：入队时执行（`server.py:1204`）。返回 `True` 通过；`False`/字符串 = 失败（字符串成为错误详情）。**只接收签名声明的参数**（`**kwargs` 收全量）；签名收了某输入 → 该输入跳过 min/max/选项内置校验（`execution.py:1033`）。⚠️ 链接输入在这里看到 `(None,)`——**拿不到上游值**（`execution.py:1097`）；接收 `input_types` 参数可得 `{输入名: 上游类型}` 字典。
- **`IS_CHANGED`**（`execution.py:74-103`）：只用**常量输入**求值（链接不解析，`execution.py:87`）；返回值直接进缓存签名（`caching.py:117`）；异常自动置 `NaN` → 永不命中、每次重跑。惯例：返回文件 hash（LoadImage 用 sha256，`nodes.py:1808-1813`）。**不要返回 bool**（官方口径）。
- **`check_lazy_status`**（`execution.py:504-523`）：返回"尚未就绪的输入名"列表，配合输入声明 `"lazy": True`。

### 1.6 自定义类型与 socket 匹配

- **没有类型注册表**：类型就是字符串，socket 匹配 = 字符串集合求交集（非 strict），strict 模式为子集判定（`comfy_execution/validation.py:193-246`）。
- `IO.ANY = "*"` 双向放行；`NUMBER = "FLOAT,INT"`、`PRIMITIVE = "STRING,FLOAT,INT,BOOLEAN"`（`node_typing.py:60-68`）。内置类型枚举 `IO` 在 `node_typing.py:10-64`。
- 自定义类型 + 前端 `getCustomWidgets` 同名工厂 = "自带 widget 的自定义输入"（VHS `VHSPATH` 模式，模板已验证）。

### 1.7 custom_nodes 加载机制（`nodes.py:2255-2410`）

- 只扫描 `ComfyUI/custom_nodes/` 一个根目录（`folder_paths.py:45`）；**目录名以 `.disabled` 结尾 = 禁用**（`nodes.py:2379-2380`，Manager 生态通用约定，WanVideoWrapper `utils.py:697-711` 主动适配）；`__pycache__` 跳过；CLI 可 `--disable-all-custom-nodes` / `--whitelist-custom-nodes`。
- 经 `spec_from_file_location` 加载目录 `__init__.py`（相对 import 可用——GGUF/KJNodes 生产验证）；失败 → 完整 traceback + `Cannot import ...`（`nodes.py:2349-2352`），启动末尾汇总标 **`(IMPORT FAILED)`**（`nodes.py:2399-2407`）——本机坑测试包实测复现（§6-d）。
- **核心绝不自动 pip install requirements.txt**（nodes.py 无任何 pip/subprocess 调用，仅 3 处警告文案 @2297/2617/2628）。装依赖是 ComfyUI-Manager 或用户的事。缺依赖的真实表现 = 整包 IMPORT FAILED（本机 Index-TTS 因缺 `soundfile` 实测复现）。
- `WEB_DIRECTORY = "./web"` → `EXTENSION_WEB_DIRS[包名]`（`nodes.py:2299-2302`）；pyproject `[tool.comfy] web = "..."` 亦可（`nodes.py:2280-2297`）。

### 1.8 服务端路由 / 自定义 HTTP API

- `/object_info`（`server.py:892-903`）、`/object_info/{node_class}`（905-911）；`/extensions` 返回全部前端 js 清单（423-435）；静态挂载 `/extensions/<包名>`（1352-1354）。
- 自定义节点加 HTTP API：模块顶层 `@PromptServer.instance.routes.get("/myapi")`——加载时序成立（instance 创建于 `main.py:605`，节点加载于 611，`add_routes()` 在 627）。所有非静态路由自动复制一份 **`/api` 前缀**双路径（`server.py:1341-1348`）。范例 [4/7]：KJNodes `__init__.py:433`、VHS、Impact `:43`、EasyUse。
- 主动推前端消息：`PromptServer.instance.send_sync(type, data)` → 前端 `api.addEventListener(type)`，数据在 `event.detail`。

## 2. 前端扩展 API（以本机 1.55.18 实测为准）

### 2.1 文件加载链与 import 写法

- 包根导出 `WEB_DIRECTORY` → server 挂 `/extensions/<包名>/` → 前端 `GET /api/extensions` 拿全部 `**/*.js` 清单 → 逐个动态 `import()`（extensionService `loadExtensions`，失败仅告警不断链）。**目录下所有 .js 自动注入，.css 等不自动**。
- **import 路径深度按目录层级算**（本机实证三档）：
  - `web/js/x.js`（WEB_DIRECTORY=`./web`）：`import { app } from "../../../scripts/app.js"` —— VHS `VHS.core.js:1`、Goohaitools 同款 [2 处实证]
  - 扁平 `web/x.js`（WEB_DIRECTORY=`./web`）：两级 `../../scripts/app.js` —— rgthree `any_switch.js:1`
  - 全局 shim 免算层级：`const { app } = window.comfyAPI.app` —— KJNodes `jsnodes.js:1`
- 官方文档写两级示例，勿照抄——按自己 WEB_DIRECTORY 层级算，或用 shim。

### 2.2 registerExtension hooks（1.55.18 实际分发的全集）

入口：`app.registerExtension({ name, ... })`（**name 必须全局唯一**）。分发列表从前端 bundle 全部 `invokeExtensions*` 调用点枚举（1.55.18 实测）：

| hook | 时机 | 本地实证 |
|---|---|---|
| `init()` | 页面加载，graph 已建、节点未注册 | docs（易冲突，慎用） |
| `addCustomNodeDefs(defs)` | 后端 defs 到达、逐个注册前 | |
| `beforeRegisterNodeDef(nodeType, nodeData, app)` | **每个节点类型注册前一次**（最常用） | KJNodes `jsnodes.js:37`、rgthree `seed.js:138` |
| `registerCustomNodes()` | defs 注册完，定义纯前端节点 | KJNodes `setgetnodes.js:565` |
| `nodeCreated(node)` | **每个实例**构造完（必须先按类型过滤！） | rgthree `context.js:216` |
| `beforeConfigureGraph` / `afterConfigureGraph` | workflow 加载前/后 | |
| `beforeLoadGraph` / `afterLoadGraph` | graph 级（1.55 新，替代扩展级 onConfigure/onUnconfigure） | |
| `onGraphLoadError(error)` | 加载失败 | |
| `refreshComboInNodes(defs)` | defs 刷新后重算 combo 选项 | |
| `onNodeOutputsUpdated(value)` | 节点输出更新 | |
| `getCanvasMenuItems()` / `getNodeMenuItems(node)` | 右键菜单 | KJNodes `setgetnodes.js:1310` |
| `getCustomWidgets(app)` | **注册时立即调用**（fire-and-forget），返回 `{类型名: 工厂}` | VHS `VHS.core.js:2105` |

静态字段（注册时即消费）：`settings[]`、`keybindings[]`、`commands[]`、`menuCommands`、`bottomPanelTabs`、auth 三 hook。

> ⚠️ **1.55.18 已死/不存在的 hook**（bundle 0 命中，docs 仍写 `loadedGraphNode`——rgthree `context.js:233` 注册了但永远不会被调）：`loadedGraphNode`、扩展级 `onConfigure`/`onUnconfigure`、`onLightBoxShow/Hide`、`logging`、`addCustomNode`。文档（1.57.4 口径）超前于本机安装版，引用前先核对。

### 2.3 widget 三种做法（全部有本地实证）

1. **`node.addWidget(type, name, value, callback, options)`**：内置类型 button/text/toggle/combo/number…（combo 必须给 `options.values`）。实证：KJNodes `jsnodes.js:22`、rgthree `seed.js:42-49`。
2. **`node.addDOMWidget(name, label, element, options)`**：挂 DOM 元素，options 全集 `hideOnZoom/selectOn/onHide/getValue/setValue/getMinHeight/getMaxHeight/getHeight/onDraw/margin/serialize`。实证：KJNodes `hdr_preview.js:415-422`。
3. **自定义 widget 工厂**（`getCustomWidgets`）：服务端 INPUT_TYPES 声明同名自定义类型 → 前端调工厂。工厂签名 `(node, inputName, inputData, app) => widget`，**必须自己 `node.widgets.push(w)` 并返回**。widget 关键成员：`name/type/value/options`、`draw(ctx,node,w,y,H)`、`mouse(event,...):bool`、`computeSize(width)`、`serializeValue()`、`callback`、`onRemove`；`options.serialize` 控制是否进 API prompt。完整活体：模板 `web/js/luowen.js`（已渲染验证）+ VHS `VHS.core.js:2105-2166`。

### 2.4 节点改造惯用法

- **链式包装**（不破坏原逻辑）：`chainCallback(obj, prop, cb)` —— VHS `VHS.core.js:6-14`，模板同款收编。
- 改 prototype 在 `beforeRegisterNodeDef`（每类型一次）；实例级在 `onNodeCreated`（节点方法，hijack）或 `nodeCreated`（扩展 hook，注意过滤）。
- 状态持久化：`onSerialize` / `onConfigure`（节点级）；后端执行结果回传：hijack `nodeType.prototype.onExecuted`（showText.js:52）。
- `ComfyWidgets["STRING"](node, name, ["STRING",{multiline:true}], app).widget` 造内置 widget（showText.js:30）。
- `app.extensions` 数组可读可写（VHS 跨扩展补丁 `VHS.core.js:2380`）。

### 2.5 api 对象（ComfyApi extends EventTarget）

- `api.fetchApi(route, options)`：route 不带 `/api` 前缀会自动补。
- `api.addEventListener(type, cb)`，payload 在 `e.detail`；WS 事件全集（api.ts switch）：`status, executing, execution_start, execution_error, execution_interrupted, execution_cached, execution_success, progress, progress_state, executed, promptQueued, logs, b_preview, b_preview_with_metadata, notification, graphChanged, autoQueueGraphChanged, feature_flags, progress_text, reconnected, reconnecting`；可监听后端 `send_sync` 的自定义类型。
- 其它：`api.apiURL/fileURL`、`queuePrompt`、`getNodeDefs`、`getSettings/getSetting/storeSetting`、`interrupt`、`clientId`。

### 2.6 LiteGraph 几何/命中契约（1.55.18 源码 + 阶段 0/1 实测）

> 证据来自安装包 sourcemap 内嵌 TS（`settingStore-*.js.map` → `src/lib/litegraph/...`），行号按该版本。

- **`node.getBounding()` 返回绝对坐标 `[x, y, w, h]`**（已含 node.pos），不是相对偏移——`LGraphNode.ts:2403-2411`（`out[0] = rect[0]`，rect 即 `boundingRect`）。络纹曾在此叠加一次 `pos`，导致所有避障矩形整体平移（实测 luowen 节点 170,260 被当成 340,550）。坐标换算用 `DragAndScale`：`canvas = (graph + offset) * scale`（`DragAndScale.ts:145-150`）。
- **连线的悬停/命中读“渲染产物”**：`renderLink` 不是自己注册命中区；`_renderAllLinkSegments` 在绘制后 `renderedPaths.add(link)`（`LGraphCanvas.ts:6430`），命中测试 `queryRenderedLinkSegmentsAtPoint` 遍历 `canvas.renderedPaths`，用 `ctx.isPointInStroke(segment.path, x*dpr, y*dpr)` 判断线条（`src/lib/litegraph/src/canvas/hitTesting.ts`）。因此接管绘制时**必须**写入 `link.path`，否则整条线的 shift/alt 点击与右键菜单命中都会丢失。
- **`over_link_center` 只表示中心点 8×8 悬停**：`_getLinkCentreOnPos` 遍历 `renderedPaths` 比较 `_pos` 周围 `8×8`（`LGraphCanvas.ts:5196-5204`、`:3549-3553`）；它不负责整条线的高亮。整线悬停高亮需扩展自行实现（络纹用 pointermove + 折线距离）。
- **`renderLink` 参数**：`(ctx, a, b, link, skip_border, flow, color, start_dir, end_dir, opts)`，方向用 `LinkDirection` 枚举 `NONE=0/UP=1/DOWN=2/LEFT=3/RIGHT=4/CENTER=5`（`types/globalEnums.ts`）；`opts.reroute` 表示共享段，`opts.disabled` 表示 bypass。批量绘制入口是 `_renderAllLinkSegments`（`LGraphCanvas.ts:6299`），非直接调用 `renderLink`。

## 3. 打包与依赖

### 3.1 目录结构（多数派实践 [7/7]）

```
ComfyUI-Luowen/
├── __init__.py          # 瘦入口：聚合 NODE_CLASS_MAPPINGS + NODE_DISPLAY_NAME_MAPPINGS + WEB_DIRECTORY + __all__ [7/7]
├── nodes/               # 实现放子包 [7/7]（仅 GGUF 全扁平）；按功能再拆模块（KJNodes 21 个）
├── web/js/              # 前端扩展，每文件独立 registerExtension [5/7]
├── requirements.txt     # 存在即占位（rgthree 为空文件）[7/7]；核心不装，Manager/用户装
└── pyproject.toml       # Registry 元数据 [6/7]
```

- 注册表写法：字面 dict 为主流；KJNodes 用 `NODE_CONFIG` 中间层生成；**`(class, display_name)` 二元组 0/7 无人用**；GGUF 用类属性 `TITLE` 派生 display 名。
- import 保护：try/except 降级或分级 [5/7]（Impact 硬失败 / Wan required+optional 双档 / KJ 按功能降级 / GGUF 库模式守卫）。

### 3.2 pyproject.toml（Registry 规范，字段与本机 KJNodes/VHS 逐字对齐 + 官方 specifications 页核验）

```toml
[project]
name = "comfyui-luowen"        # registry ID：≤100 字符，字母数字/-/_/.，官方建议不含 "ComfyUI"（本机范例普遍含，随大流）
version = "0.1.0"              # semver；发布后该版本不可变（immutable）
license = { text = "MIT" }     # 必须 {file=}/{text=} 形式
dependencies = []              # 建议同步 requirements.txt

[project.urls]
Repository = "https://github.com/..."   # 官方标记必填

# Used by Comfy Registry https://comfyregistry.org
[tool.comfy]
PublisherId = "luowen"         # 必填，全局唯一不可改
DisplayName = "ComfyUI-Luowen"
Icon = ""                      # ≤400x400 正方形；Banner 21:9 可选
# requires-comfyui = ">=0.43"  # 可选版本约束；includes=['dist'] 可选
```

### 3.3 发布与安装（comfy-cli）

- 发布：`comfy node init`（cookiecutter 脚手架）→ `comfy node publish`（提示粘贴 Publisher API Key，无 login 步骤）。默认打包 **git 追踪的所有文件**；`.comfyignore`（语法同 .gitignore）排除；CI 用 `Comfy-Org/publish-node-action@main`（推 main + 改 pyproject.toml 即发版）。
- 安装：`comfy node install <node-id>` 或 `registry-install`。
- **安全硬标准**（官方 standards 页）：禁 `eval`/`exec`；**禁运行时 subprocess 调 pip install**（依赖统一 Manager 处理）；禁代码混淆。

### 3.4 测试（官方无 pytest 规范）

官方路径 = **工作流级 CI**：ComfyUI-test-framework（测试即工作流 JSON + `Assert *` 断言节点，CLI `comfyci`，明确不支持 pytest）+ Comfy-Action（GitHub Actions 跑 workflow，结果上 ci.comfy.org）。pytest 模式属社区惯例。官方 publish 教程默认把 `tests/` 从发布包排除。

## 4. 执行与缓存语义（决定节点行为正确性）

- **缓存签名**（`comfy_execution/caching.py:110-128`）：`[class_type, IS_CHANGED 结果, (node_id 满足条件时), 逐个 sorted inputs：链接→(key,("ANCESTOR",祖先序号,slot))、常量→(key,值)]` + 祖先同构签名，`to_hashable` 成 frozenset。**输入值直接进键**。
- node_id 进键的三条件（`caching.py:118`）：覆写 `include_node_id_in_input` / `NOT_IDEMPOTENT=True` / hidden 声明含 `UNIQUE_ID`。
- **命中即跳过**（`execution.py:447-452`）：签名一致 → 输出直接复用，**包括 OUTPUT_NODE 节点**（SaveImage 重发同图不重存）。重跑条件：输入值/拓扑变化、IS_CHANGED 变化、任一祖先变化（ANCESTOR 传播）、NaN、NOT_IDEMPOTENT 且实例不同。
- **实例缓存**：`caches.objects` 键 = (node_id, class_type)，节点实例跨 prompt 复用 → `__init__` 必须幂等、`INPUT_TYPES` 里不要有副作用。
- 缓存模式：默认 `RAM_PRESSURE`（`--cache-ram`，0.43 起默认不再是 classic）；`--cache-classic/lru/none`。
- 输出节点返回 `{"ui": {...}, "result": (...)}`：ui 部分（如图片列表）经 WebSocket 送前端展示，result 进下游执行链（模板 `LuowenSaveText` 实测）。
- 工作流重发时签名一致的节点全部命中缓存；命中清单经 `execution_cached` 消息发前端（`execution.py:764-775`）。

## 5. 常见坑（每条有本机实证或源码级证据）

1. **monkey-patch 核心模块 = 升级炸弹**：rgthree-comfy 在本机 0.43.2 上 **IMPORT FAILED**（启动日志实测）——它 patch 的 `execution.recursive_output_delete_if_changed` 已随执行引擎重构迁入 `comfy_execution/`。教训：改核心内部符号的节点活不过重构；只用公共契约。
2. **`VALIDATE_INPUTS` 看不到链接值**：链接输入传 `(None,)`（`execution.py:1097`）。要在校验里看上游类型用 `input_types` 参数。
3. **文档超前于安装版本**：docs（1.57.4 口径）里的 `loadedGraphNode` 在 1.55.18 **不会被调用**；扩展级 `onConfigure/onUnconfigure` 已不存在。前端 API 以 bundle 实测为准。
4. **import 路径随 WEB_DIRECTORY 层级变**：两级/三级/全局 shim 三种写法并存，抄错层级 = js 加载失败（前端只告警，节点无前端功能但不报错——静默坑）。
5. **`custom_nodes` 下的任何目录都会被尝试加载**：本机 `.avalon-trash` 垃圾目录实测触发 Cannot import 警告。临时文件别放 custom_nodes；禁用 = 改名 `.disabled`。
6. **缺依赖 = 整包静默失效**（对用户而言）：核心不装 requirements，Index-TTS 实测因缺 `soundfile` IMPORT FAILED。发布前用干净环境验证依赖清单。
7. **`RETURN_IS_LIST`/`OUTPUT_TO_LIST` 不存在**（0 命中）；`defaultInput` 已 deprecated（前端 v1.16 起标记），改用 `forceInput`。
8. **hidden `UNIQUE_ID` 改变缓存行为**（node_id 进缓存键）——只在确实需要按实例缓存时声明。
9. **前端/模板包版本落后于 requirements 声明**：本机 frontend 1.55.18 vs 声明 1.57.4，UI 启动时弹 Version Compatibility Warning（实测截图）。更新 ComfyUI 代码后要重装包。
10. **widget 值序列化两套开关**：`widget.serialize`（进 workflow JSON）≠ `options.serialize`（进 API prompt），语义不同（前端 widgets.ts 注释明示）。
11. **同节点 widget 名必须唯一**：重名自动加 `#1` 后缀（新前端规则）；重命名直接赋 `widget.name`。
12. **节点实例跨 prompt 复用**：`__init__` 幂等，别在构造器里做有状态初始化。

## 6. 模板验证记录（2026-11-06 实测，证据在 `.verify/`）

目标 `custom_nodes\ComfyUI-Luowen\`（模板正本 `template/ComfyUI-Luowen/`），验证环境 = 本机 0.43.2 实例：

| 项 | 结果 | 证据 |
|---|---|---|
| a. server 启动无 import error | ✅ | 日志 `0.0 seconds: ...\ComfyUI-Luowen`（无 IMPORT FAILED）；`.verify/comfyui_run.log:175` |
| b. /object_info schema 符合 INPUT_TYPES | ✅ | required/optional/min/max/COMBO 选项/自定义类型 `LUOWEN_WIDGET`/output_node/hidden 全部一致 |
| c. 前端可见、可搜、可执行 | ✅ | 扩展注册（151 个中含 `ComfyUI-Luowen.Example`）；搜索列两节点含 DESCRIPTION；画布渲染出 `luowen counter: 0` 自定义 widget + 🎲 按钮；`POST /prompt` 串联两节点 → `history=DONE`，输出文件 `output/luowen_verify_2.txt` 内容逐字节符合预期（含 counter=3、hidden unique_id 进文件名） |
| d. 坑实测 | ✅ | 坑测试包（故意 raise）→ 完整 traceback + `Cannot import`（log:130-134）+ 汇总标 `(IMPORT FAILED)`（log:174）；包已删 |

复验方法：装模板 → `run_nvidia_gpu.bat` → 浏览器搜 "luowen" → 双击添加 → 或 `curl -X POST /prompt --data @.verify/prompt.json`（8188 端口）。

## 7. V3 Schema 摘要（并存，不替换）

- 入口：模块导出 `comfy_entrypoint()`（可 async）→ 返回 `ComfyExtension` → 节点类继承 `io.ComfyNode`，`define_schema()` 声明 `io.Schema`，`execute()` 返回 `io.NodeOutput`（`comfy_api/latest/_io.py:1841-1936,2143+`；官方示例 `comfy_extras/nodes_align_your_steps.py`）。V3 节点自动生成 V1 object_info，注册进同一个全局映射。
- 对应关系：`FUNCTION`→固定 `execute`；`VALIDATE_INPUTS`→`validate_inputs`；`IS_CHANGED`→`fingerprint_inputs`；`NODE_CLASS_MAPPINGS`→`comfy_entrypoint`；hidden 用 `io.Hidden.*`。
- **官方态度**（blog 2025-06-07 + issue #8580）："future extensions to node features will only be added to V3 schema"——新特性只进 V3；**V1 不废弃、无迁移时间表**；docs 主教程仍以 V1 为主。API 版本经 `comfy_api.latest`（不稳定）或 `comfy_api.v0_0_2`（稳定版）导入。
- **本基线模板选 V1**（决策 Q3）：可交叉验证素材最多；PRD 若需 V3 专属能力（动态 slot、无需 JS 的 Vue widget、进程隔离）再切。

## 8. 权威参考清单

- 本机源码（行号基准）：`nodes.py`（加载与契约分发）、`comfy_execution/{caching,graph,validation}.py`（执行/缓存/校验）、`execution.py`（调度入口）、`server.py`（路由）、`comfy/comfy_types/node_typing.py`（类型与选项声明全集）、`comfy_api/latest/_io.py`（V3）。
- 本机活体范例（交叉验证基准）：KJNodes（注册表模式+设置项+HTTP API）、VHS（瘦入口+docstring 注入+自定义 widget）、WanVideoWrapper（required/optional 分级聚合）、Impact-Pack（key≠类名解耦）、GGUF（最小骨架+库模式守卫+TITLE 派生）、Easy-Use（动态 WEB_DIRECTORY）、rgthree（⚠️ 0.43.2 上已损坏，仅作前端写法参考）。
- 官方文档（2025-11 抓取有效）：walkthrough `/custom-nodes/walkthrough`；V1 参考 `/custom-nodes/backend/server_overview`；输入参数全集 `/custom-nodes/backend/more_on_inputs`；JS `/custom-nodes/js/javascript_overview`、`/javascript_hooks`、`/widgets-migration`；Registry `/registry/specifications`、`/registry/publishing`、`/registry/cicd`、`/registry/standards`；V3 `/custom-nodes/v3_migration` + issue `Comfy-Org/ComfyUI#8580` + `blog.comfy.org/p/dependency-resolution-and-custom`；测试 `github.com/Comfy-Org/ComfyUI-test-framework`；总索引 `docs.comfy.org/llms.txt`。
