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
- **Reroute 链挂在单条 Link 上，不是独立图形节点**：`LLink.getReroutes(graph, link)` 在 `link.parentId === undefined` 时返回空数组，否则从 `graph.reroutes.get(link.parentId)` 沿 `reroute.parentId` 回溯（`LLink.ts:326-332`；`parentId` getter/setter `LLink.ts:214-219`）；`LGraph.reroutes` 是 `reroutesInternal` 的只读 getter（`LGraph.ts:709-712`），创建入口 `LGraph.createReroute`（`LGraph.ts:2038`），绘制的逐段遍历在 `LGraphCanvas.ts:6299`。判定「连接含手动 Reroute 链」用 `link.parentId !== undefined`；`opts.reroute` 只表示链内共享段，不能用来判定整条 Link 是否带链。运行时实测 1.55.18：`graph.reroutes` 为 `Map`（无链时 size 0），`link.parentId` 在无链时为 `null`、建链后为数字。

### 2.7 节点拖动挂载点与磁吸可行性（3A-0 查证，2026-11-06）

> 取证：安装包 sourcemap 内嵌 TS（同 §2.6 来源）+ 宿主运行时读取（Playwright 连 `http://127.0.0.1:8188`，读 `window.LiteGraph`、`window.comfyAPI.app.app`、`app.ui.settings`）。行号按前端 1.55.18。
> 运行时实测（2026-11-06）：`LiteGraph.vueNodesMode = true`（`Comfy.VueNodes.Enabled = true`，DOM 存在 `.lg-node[data-node-id]`）；`LiteGraph.alt_drag_do_clone_nodes = true`；`LiteGraph.alwaysSnapToGrid = false`；`Comfy.SnapToGrid.GridSize = 10`；`pysssss.SnapToGrid = false`；`canvas.ds.scale ≈ 0.8264`；`canvas.onDrawForeground` 已被其他扩展链式占用（typeof function）。

**当前宿主生效的拖动路径（Vue 节点模式）**

- `_processNodeClick` 在 `LiteGraph.vueNodesMode` 为真时直接 `return`（`LGraphCanvas.ts:2784-2788`），节点拖动完全由 Vue 组件处理，legacy `item.move` 循环不参与。
- 生命周期：`useNodePointerInteractions.ts:63-98`（pointermove 超过 5px 阈值才进入拖动；阈值定义 `useClickDragGuard.ts:20`）、`:123-150`（pointerup）、`:152-155`（pointercancel）。
- 位置写入：`useNodeDrag.ts:137-192` `updateNodePositions` → `mutations.batchMoveNodes`（`:181`）；delta 由 `transformState.screenToCanvas` 求出（`:143-153`），是**图坐标**。
- 写入频率：每帧最多一次，`handleDrag` 用 rAF 去重（`useNodeDrag.ts:194-230`，注释 `:213-214`）。
- 收尾：`endDrag`（`useNodeDrag.ts:232-298`）只在 `shouldSnap(event)`（`:235`）时再写一次网格吸附位置（`:291`）；未执行的 rAF 会被取消（`:312-315`）。**最终位置 = 最后一次执行的 rAF，可能比指针落后 ≤1 帧**。
- 多选：`startDrag` 记录其他选中节点起点并按同一 delta 更新（`useNodeDrag.ts:58-95`）。v1 需按 `canvas.selectedItems` 跳过（Vue 选中会同步到 legacy canvas：`useNodeEventHandlers.ts:32-52`）。

**原生覆盖关系（决定能否在回调里改位置）**

- Vue 模式每帧都从 `dragStartPos + canvasDelta` **绝对重算**（`useNodeDrag.ts:137-153`），先写的值会在下一帧被覆盖；吸附必须「晚于原生 rAF 再写一次」。
- Vue 模式可用的写入口：`node.setPos`（`LGraphNode.ts:752-768`）→ `setNodePosition/commitNodePosition`（`graphLayoutAttachment.ts:170-196`）→ `layoutStore.applyOperation('moveNode')`（`:451-461`）。`node.pos` 是 layoutStore 投影，`serialize()` 直接读它（`LGraphNode.ts:752-754`、`:1257`），写入会经 `onGeometryChange` 触发 `canvas.setDirty(true,true)`（`notifyLayoutChanges.ts:21-26`）。
- Legacy 路径（关闭 Vue 节点时才走）：`processMouseMove` 每个 pointermove 用 `delta/ds.scale` 调 `item.move`（`LGraphCanvas.ts:3577-3592`），无 rAF 节流；`_startDraggingItems` 用 `beforeChange/afterChange` 包住整段（`:3645-3659`）。改位置要么改 `move` 入参、要么包装 `move`。
- **没有可用的逐帧节点移动回调**：`onNodeMoved` 已标 `@deprecated`、只处理单节点、只在拖动结束触发一次（`LGraphCanvas.ts:871`、`:3701-3711`）；Vue 模式没有调用点（`useNodeDrag.ts:232-298` 无该调用），运行时 `canvas.onNodeMoved === undefined`。`graphChanged` 在 `captureCanvasState` 提交后才派发（`changeTracker.ts:425-436`），此时 undo 快照已形成，不能用于改位置。

**undo 次数（一次拖动）**

- 正常情况 = 一条：Vue 拖动期间不进入 `before/after-change`（`useNodeDrag.ts` 无调用），只由 `window mouseup` 的 `captureState` 记一次（`changeTracker.ts:588-590`）；Legacy 由 `changeCount` 抑制中间快照（`:409-418`、`:507-515`），结束一次 capture。
- **例外会拆成多条**：Vue 拖动中松开 Ctrl/Shift/Alt/Meta，`keyup` 会主动 `captureState()`（`changeTracker.ts:559-564`、`:580-585`），把半途位置记成一条 undo。
- 适配器收尾写入必须同步发生在 `pointerup` 内、早于 `window mouseup`；用 rAF 延后收尾会多记一条 undo。

**坐标量纲**

- Vue：`screenToCanvas` 差分（`useNodeDrag.ts:143-153`）；Legacy：`delta/ds.scale`（`LGraphCanvas.ts:3584-3585`）。两套都是**图坐标**，`snapTol=10px` 应按图坐标。
- 后果：缩放 0.826 时 10 图 px ≈ 8.3 屏幕 px，200% 时 = 20 屏幕 px；迟滞 15px 同理随缩放变化。

**修饰键占用（Alt 与 Shift 都不空）**

- Alt：Vue 节点 pointerdown + `altKey` → `cloneNodes([node])` 并开拖克隆（`LGraphNode.vue:438-454`；运行时 `alt_drag_do_clone_nodes=true`）；Legacy Alt+拖克隆（`LGraphCanvas.ts:2488-2501`）；Alt+点 link 建 Reroute（`:2600-2613`）；Alt 框选减选（`:4395-4456`）。
- Shift：拖动结束用 `shiftKey` 触发原生网格吸附（`useNodeSnap.ts:24-26`、`useNodeDrag.ts:235`、Legacy `LGraphCanvas.ts:3703-3704`）；拖动期间 `trackShiftKey` 向 canvas 派发合成 Shift 键事件（`useShiftKeySync.ts:37-54`、`useNodeDrag.ts:29,57`），使 `_shiftDown`（`LGraphCanvas.ts:4001`）→ `_snapToGrid`（`:5082-5085`）→ 网格吸附提示线（`:5139-5148`）。Shift/Ctrl/Meta 同时是多选键（`selectionUtils.ts:8-10`）。
- 结论：四个修饰键在 pointerdown 阶段全部被占用；Alt 会克隆节点，Shift 会多选 + 网格吸附。原方案「默认 Alt，被占用改 Shift」两条都不成立，需要重选交互。
- **3A-1 拍板（2026-11-06，DEC-014）**：不绑任何修饰键。改为设置项「对齐吸附 开/关」（默认开），由 `alignSnap` 的 `enabled` 入参控制；Alt/Shift/Ctrl/Meta 的原生行为一律不动。理由：Alt 克隆拖动、Shift 多选 + 网格吸附，且拖动中松开修饰键会额外 `captureState` 拆 undo（见上节），交互代价不可接受。

**提示线绘制入口**

> **3A-1 拍板（2026-11-06，DEC-014）：提示线改走 DOM overlay，不用 `canvas.onDrawForeground`。** 下列 canvas 入口与重绘事实保留备查，不作为实现方案；overlay 容器/插槽的宿主接入点在 3A-2 实查后再定，未查证前不宣称可复用。

- 已否决入口：`canvas.onDrawForeground(ctx, visible_area)`（声明 `LGraphCanvas.ts:713-717`；在 `drawFrontCanvas` 内、`ds.toCanvasContext` 之后调用 `:5135`、`:5186`，图坐标，位于节点/连线之上）。不随缩放的是 `onDrawOverlay(ctx)`（`:881-882`、调用 `:5191`，屏幕坐标）。
- 该入口已被其他扩展链式占用（运行时是包装后的函数），必须继续链式包装，不能覆盖（参考 `DomWidgets.vue` 的 `useChainCallback`）。
- 原生 `drawSnapGuides`（`LGraphCanvas.ts:5139-5148`）与 `drawSnapGuide`（`:5961` 起）只服务网格吸附（Shift/alwaysSnap），不能用于邻居对齐；对齐提示线需自绘。
- Vue 拖动期间 canvas 会重绘：`notifyLayoutChanges.ts:21-26` 的 `onGeometryChange` → `canvas.setDirty(true,true)`。
- 1px 建议按屏幕像素：`lineWidth = 1/ds.scale`、`setLineDash([4/ds.scale, 4/ds.scale])`；按图坐标写 1 会随缩放变粗/变细。

**可落地适配器形态（供 3A-2，非本次实现）**

- 吸附内核已落地：`luowen/web/snap/alignSnap.js`（纯函数，图坐标；`enabled` 控制设置开关、`multiSelect` 由调用方跳过、`state` 承载 10→15 迟滞）。3A-2 只做宿主适配与提示线，不改内核契约。
- Vue（当前宿主）：画布容器 capture 监听 `pointerdown` 命中 `.lg-node[data-node-id]` 记起点；`pointermove` 后排一个 rAF（晚于原生 rAF）→ 用 `ds.scale` 算 raw 图坐标 → `alignSnap` → `node.setPos()`；`pointerup` 同步收尾；`canvas.selectedItems.size > 1` 直接跳过；拖动阈值对齐 5px（`useClickDragGuard.ts:20`）。
- Legacy（关闭 Vue 节点时）：包装 `LGraphNode.prototype.move`，在 `canvas.isDragging && selectedItems.size === 1` 时把 delta 改成吸附后的 delta。
- 提示线：DOM overlay（`pointer-events:none`，z-index 高于 Vue 节点卡片层），按 `canvas.ds` 同步平移/缩放；拖动结束立即清空。不复用 canvas `onDrawForeground`。
- 提示线数据只存内存，不写图数据；1px 虚线在 CSS px 下即 1 屏幕 px，不随缩放变粗。

**交叉验证清单（每条 ≥2 个独立位置）**

| 结论 | 证据 A | 证据 B |
| --- | --- | --- |
| 宿主为 Vue 拖动 | 运行时 `vueNodesMode=true`、`.lg-node` 存在 | `LGraphCanvas.ts:2784-2788` 提前 return |
| Vue 每帧绝对重算并覆盖 | `useNodeDrag.ts:137-153` | `layoutStore.ts:1380-1411`（批量事务） |
| 坐标是图坐标 | `useNodeDrag.ts:143-153` | `LGraphCanvas.ts:3584-3585` |
| 无逐帧移动回调 | `LGraphCanvas.ts:871`、`:3701-3711` | `useNodeDrag.ts:232-298` 无 onNodeMoved |
| 一次拖动一条 undo | `changeTracker.ts:409-418`、`:507-515` | `changeTracker.ts:588-590`（mouseup） |
| 修饰键冲突 | `LGraphNode.vue:438-454`、运行时 clone 标志 | `useNodeSnap.ts:24-26`、`useShiftKeySync.ts:37-54`、`LGraphCanvas.ts:5082-5085` |
| 提示线入口（canvas，已否决） | `LGraphCanvas.ts:713-717`、`:5135`、`:5186` | `notifyLayoutChanges.ts:21-26`、运行时 `onDrawForeground` 为函数 |
| 提示线改 DOM overlay（决策，待 3A-2 实查） | DEC-014 | 用户拍板：`pointer-events:none`、z-index 高于节点卡片层、随 `ds` 变换 |

**3A-2 宿主实测：overlay 接入点与层序（2026-11-06）**

- **接入点 = 运行时 DOM `#graph-canvas-container`**。该 id 在本机前端源码包（`.verify/*.ts`）中没有字符串命中，属于模板产物，**只能以运行时 DOM 为准**；不宣称存在可复用的宿主 overlay 插槽，自建 overlay 挂在容器末尾。
- 运行时容器实测：`position: relative`、`overflow: clip`；子级含 `CANVAS#graph-canvas`、选择框（z=9999）、`.node-tooltip`（z=99999）、`.comfy-menu`（z=999）、`.lg-node` 卡片。
- 运行时 z 实测：`.lg-node` 卡片 **19~34**（选中/悬停会抬高，不是固定 1）；自建 `#luowen-snap-overlay` 用 **z=500**，高于全部卡片，低于选择框/菜单/提示框。
- 位置换算沿用 `screen = (graph + ds.offset) * ds.scale`（`DragAndScale.ts:145-150`）；提示线按 `canvas.ds` 每帧同步。
- 命中测试：`elementFromPoint` 在提示线上返回 `CANVAS#graph-canvas`（overlay `pointer-events:none`），证明不参与交互。
- 代码位置：`luowen/web/snap/dragSnap.js:125-168`（host/ensureGuides）、`:170-191`（updateGuides）、`:211-249`（每帧吸附写入）、`:285-321`（`pointerup` 同步收尾）、`:333-374`（install/uninstall/开关）。
- 拖动挂载顺序复核：window 冒泡监听 + 自排 rAF，晚于原生 `handleDrag` 的 rAF（`useNodeDrag.ts:194-230`）；收尾早于 changeTracker 的 `mouseup` 快照（`changeTracker.ts:588-590`）。

### 2.8 链路命中 / 选中 / 删除 / 悬停契约（P0 主干组交互查证，2026-11-07）

> 取证：前端 1.55.18 安装包 sourcemap 内嵌 TS（行号按该版本）+ 本机宿主 0.43.2。结论用于 PRD AT-013/015/017 的口径修订（DEC-021）。

**命中链路**

- 命中测试读渲染产物：先 `layoutStore.queryLinkSegmentAtPoint`，再遍历 `canvas.renderedPaths` 用 `ctx.isPointInStroke(segment.path, x*dpr, y*dpr)`（`hitTesting.ts:41-55`）。
- 命中线宽 = `canvas.connections_width + 7`（`hitTesting.ts:39`）。
- 中心 marker 只有 8×8，且只服务 `over_link_center`（`LGraphCanvas.ts:5196-5209`、`:3549-3553`）。
- `_getPositionableOnPos` 不包含 link（`LGraphCanvas.ts:2439-2445`）；链路不进入通用命中。
- 络纹已接管 `renderLink` 并写 `link.path`，命中跟随实际折线；主干段命中返回哪条 link 由绘制/遍历顺序决定，无法表达「组」。

**选中模型（无 link 选中）**

- 可选中类型枚举只有 `node / group / reroute / io`，不含 link（`selectionState.ts:7`）。
- `selectedItems` 是 `Set<Positionable>`，link 不是 `Positionable`（`LGraphCanvas.ts:746`）。
- `deleteSelected()` 只处理 node / group / reroute，不处理 link（`LGraphCanvas.ts:4787-4821`）。
- 结论：无法把组内 link 放进原生选中集，也无法依赖 `deleteSelected` 做组删除；组高亮/组删除必须由络纹自建。

**悬停高亮**

- 原生只有 `over_link_center` 与 tooltip（`LGraphCanvas.ts:3549-3553`、`:5268-5269`），没有 link 级 hover 状态。
- `highlighted_links` 只由「选中节点的邻接」填充（`LGraphCanvas.ts:4556,4563,4617,4625,4749,4760,4765,4814`），渲染链为 `:6469` → `litegraphLinkAdapter.ts:123` → `pathRenderer.ts:101-102,173-175`。
- 结论：整组/单支悬停高亮必须自绘，不能复用原生 hover。

**删除语义**

- 右键链路菜单入口 `showLinkMenu`（`LGraphCanvas.ts:6674-6788`），右键调用点 `:8777`（`showLinkMenu(linkSegment ?? link, event, link)`）。
- 单条 Delete 分支：`graph.removeLink(linkId)` + `layoutStore.deleteLinkLayout(linkId)`（`LGraphCanvas.ts:6760-6775`）。
- 无批量删除接口；多次 `removeLink` 会各自失效缓存，undo 粒度由事务边界决定。
- Reroute 包裹成员可按真实 link id 安全批量删除：`LGraph.ts:2133-2141` → `LLink.disconnect`（`LLink.ts:549-591`）；`:582` 从 `graph.links` 移除、`:584` 删 layout、`:586-590` 仅在 `reroute.totalLinks === 0` 时回收 reroute。输入侧 floating link 由 `LGraphNode.ts:3472-3479` 断开；`graph.links` 外的 floating link 不参与。
- 菜单项注入点：`ContextMenu.ts:311-341` 先跑 global callback、再跑单项 callback；`Proxy` 包装构造可临时插入组删除项，且不破坏 `changeTracker.ts:625-630` 对 `ContextMenu.prototype.close` 的补丁。

**undo 粒度**

- `changeTracker.ts:409-438` 全图序列化快照；`:508-513` `beforeChange/afterChange` 用 `changeCount` 抑制中间快照；`:602-607` `processMouseUp` 后 capture。
- 结论：`emitBeforeChange + graph.beforeChange … graph.afterChange + emitAfterChange` 包住整组删除，只留一条 undo（与 `deleteSelected` 同型，`LGraphCanvas.ts:4791-4792,4819-4820`）。

**Vue 节点模式**

- `_processNodeClick` 在 `LiteGraph.vueNodesMode` 为真时直接 return（`LGraphCanvas.ts:2784-2788`）；Vue 画布挂载见 `GraphCanvas.vue:93-98,342-346`。
- `LinkOverlayCanvas.vue:3-4` 的 overlay 为 `pointer-events:none`，不拦截 canvas 命中。
- 结论：链路命中仍走 canvas 逻辑，自绘 hover 与 canvas 重绘一致，不与 DOM overlay 冲突。

**交叉验证**

| 结论 | 证据 A | 证据 B |
| --- | --- | --- |
| 选中类型不含 link | `selectionState.ts:7` | `LGraphCanvas.ts:746`、`:4787-4821` |
| 命中读渲染产物 | `hitTesting.ts:41-55` | `hitTesting.ts:39`、`LGraphCanvas.ts:5196-5209` |
| 无原生 link hover | `LGraphCanvas.ts:3549-3553` | `:4556-4814` 仅邻接填充 |
| 删除走 `removeLink` | `LGraphCanvas.ts:6760-6775` | `LGraph.ts:2133-2141` |
| Reroute 可安全删 | `LLink.ts:582-590` | `LGraphNode.ts:3472-3482` |
| 菜单可注入 | `ContextMenu.ts:311-341` | `changeTracker.ts:625-630` |
| Vue 不拦链路 | `LGraphCanvas.ts:2784-2788` | `LinkOverlayCanvas.vue:3-4` |

### 2.9 设置系统契约（1.55.18 实测，2026-11-07）

**注册**：`app.registerExtension({ name, settings: [...] })` 在注册时即被消费（`extensionService.ts:156` → `settingStore.ts:332-352`）。旧入口 `app.ui.settings.addSetting` 源码标注 deprecated，扩展应改用 `settings[]`（`src/scripts/ui/settings.ts:96-129`）。读写用 `settingStore.get/set`（`settingStore.ts:215-222`、`:255-258`），扩展侧可用 `app.extensionManager.setting` 或旧 `app.ui.settings.getSettingValue`。

**分类树（关键坑）**：分类由 `category || id.split('.')` 建树（`useSettingUI.ts:62-70`），`buildTree` 对同路径复用节点并写叶子（`treeUtil.ts:14-38`，`parent.leaf`/`parent.data` 在 `:36-37`）。因此：

- **单元素分类 `['X']` 会把同分类的多条设置折叠成一个叶子，只保留最后注册的一条**；该叶子随后被塞进合成导航组 `Other`（`useSettingUI.ts:72-81`）。
- 要让多条设置同时可见，必须用 **3 级分类**：`[扩展名, 组名, 逐设置唯一键]`（核心范式：`['Comfy','Error System','IssuesTab']`；KJNodes `web/js/vue_combo.js:583`；VHS `web/js/VHS.core.js:1766-1845`）。
- 扩展分类不能成为设置对话框的顶级面板：面板列表硬编码（`useSettingUI.ts:253-262`、`SettingDialog.vue:176-179`），未发现注册 API；扩展分类统一归入导航组 `Other`（`useSettingUI.ts:324-333`）。
- 分组无折叠，只有标题 + 行（`SettingGroup.vue:1-26`）；排序按 `sortOrder` 降序（`SettingDialog.vue:181-198`）。

**搜索**：仅匹配 `id`、`name`、翻译名、分类名、子分类名，**不匹配 tooltip**（`useSettingSearch.ts:75-97`；实测 tooltip 独有词 `净空` 返回 0 条，`LuoWen` 返回全部 6 条）。

**控件**：内置 `boolean/number/slider/knob/combo/radio/image/color/url/backgroundImage/text/hidden`（`FormItem.vue` 分派）；`type` 可为自定义渲染函数 `(name, setValue, value, attrs) => HTMLElement`（`CustomFormValue.vue:8-19`；第三方实例 pysssss `web/js/autocompleter.js:324-330`）。`experimental: true` 显示实验徽章（`SettingItem.vue:14-25`）。

- **`slider` 的 attrs**（2026-11-07 补测）：设置定义里的 `attrs` 对象经 `FormItem.vue` 的 `getFormAttrs` 原样 `v-bind` 到控件；`InputSlider.vue` 按 `min/max/step` 三个 prop 接收并同时驱动 PrimeVue Slider 与 InputNumber。实例：`LuoWen.CornerRadius` 用 `type:'slider'` + `attrs:{min:0,max:24,step:1}`，运行时数字框回读值与滑块一致。（证据：`settingStore-DZ2-HL-F.js.map` 的 `FormItem.vue` / `InputSlider.vue` 源内容 + 宿主设置页实测 id=`LuoWen.CornerRadius` 的 `.input-slider` DOM。）

**独立 UI**：侧边栏 tab 公开入口 `app.extensionManager.registerSidebarTab`（`workspaceStore.ts:73-83`、`sidebarTabStore.ts`），支持 `type:'vue'+component` 或 `type:'custom'+render(el)`（`ExtensionSlot.vue:1-34`；第三方实例 EasyUse `web_version/v2/easyuse.js:2`）。侧边栏内容不参与原生设置搜索。设置对话框可用命令 `Comfy.ShowSettingsDialog` 打开。

**交叉验证汇总**

| 结论 | 证据 A | 证据 B |
|---|---|---|
| `settings[]` 注册即消费 | `extensionService.ts:156` | `settingStore.ts:332-352` |
| 单元素分类折叠 | `treeUtil.ts:36-37` | `useSettingUI.ts:62-81` + 1.55.18 实测 |
| 搜索不含 tooltip | `useSettingSearch.ts:75-97` | 实测 `净空` 0 结果 |
| 不能新增设置面板 | `useSettingUI.ts:253-262` | `SettingDialog.vue:176-179` |
| 侧边栏可自绘 UI | `ExtensionSlot.vue:1-34` | EasyUse `easyuse.js:2` |
| 自定义控件可行 | `FormItem.vue` 分派 | `CustomFormValue.vue:8-19` |

详细调研与方案见 `docs/specs/luowen-settings-ui.md`。

### 2.10 设置项提示框契约（1.55.18 实测，2026-11-07）

- **渲染链路**：设置行由 `SettingItem.vue` 把 `setting.tooltip` 传给 `FormItem.vue`；`FormItem.vue:13-15` 在标签后渲染 `i.pi-info-circle` 并挂 `v-tooltip="props.item.tooltip"`。问号图标由宿主渲染，不是扩展代码。
- **指令实现**：PrimeVue `tooltip-directive`（`vendor-primevue-DgZFaBSX.js`，`beforeMount` @669696、`create` @675556）。字符串值走默认分支：`escape=true`、无附加 class。对象值 `{ value, class, fitContent, escape, showDelay, hideDelay }` 走对象分支：`class` 会追加到 tooltip 根节点（@670154 读取，@675969 拼接到根 class）。
- **文本与样式**：`escape=true` 用 `document.createTextNode`，纯文本、不解析 HTML（@675556）。默认样式为 inline `@layer primevue`：`.p-tooltip{max-width:var(--p-tooltip-max-width)}`、`.p-tooltip-text{white-space:pre-line;word-break:break-word}`；根变量 `--p-tooltip-max-width:12.5rem`（=200px，运行时实测）。
- **换行**：`\n` 在 `white-space: pre-line` 下渲染为换行（实测 2–6 行，`innerText` 保留 `\n`）。
- **受控放宽（内容自适应 + 上限封顶）**：对象形式传 `class:'luowen-tooltip'`，再注入未分层规则 `.p-tooltip.luowen-tooltip{width:max-content;max-width:min(560px,calc(100vw - 2rem))}`。未分层 CSS 优先于 `@layer primevue`，但指令会在根节点写内联 `style="width: fit-content"`（实测 @675556 分支），内联优先级更高 → 实际生效的是 `fit-content`（内容自适应）叠加我们的 `max-width`（封顶 560px），等效于「内容自适应 + 上限封顶」；注入的 `width:max-content` 仅在宿主去掉内联宽度时才会接管，作为回退保留。实测内容宽 282–491px（未触达 560px 上限）；视口 900px 时 `fit-content` 按剩余空间封到 465px。其他设置提示框仍为 200px（class 为 `p-tooltip p-component`，无标记 class）。
- **降级**：宿主若不再支持对象 `class`，规则不命中 → 回落 200px，换行仍生效；若 `pre-line` 改变，`\n` 折叠为空格，文本仍完整；不崩溃。
- **交叉验证**：`FormItem.vue:13-15` ↔ 运行时 `i.pi-info-circle` 与 `.p-tooltip`；vendor 对象分支 @670154 ↔ 运行时 tooltip class 含 `luowen-tooltip`；`.p-tooltip-text` 的 `pre-line` ↔ 实测多行渲染。

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
