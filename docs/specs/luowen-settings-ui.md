# 络纹设置界面：调研与需求对齐（v0.2）

> 状态：方案 A 已确认并实施（2026-11-07）；调研内容保留，实施后的分类与证据见 §4.1、§7。
> 取证环境：ComfyUI v0.43.2 + comfyui-frontend-package **1.55.18**（本机 `D:\AIGC\ComfyUI_windows_portable`）。
> 前端源码引用来自前端包自带 sourcemap（`static/assets/settingStore-DZ2-HL-F.js.map`），路径为 sourcemap 内的 TypeScript 原文路径。
> 实测时间：2026-11-07，用 Playwright 访问本机 8188 端口的运行实例；未安装、未部署、未提交。

---

## 1. 现状盘点

### 1.1 已注册设置项（本仓库 `luowen/`）

> 下表记录**实施前**（调研阶段）的原始声明与可见性；A 方案实施后的分类、组名与顺序见 §4.1，实施证据见 §7。

| id | 显示名 | 类型 | 默认值 | 可选值 | 声明分类 | 浏览可见 |
|---|---|---|---|---|---|---|
| `LuoWen.Enabled` | 启用络纹 | boolean | `true` | — | `['LuoWen']` | 否（仅搜索） |
| `LuoWen.SnapAlign` | 对齐吸附 | boolean | `true` | — | `['LuoWen']` | 否（仅搜索） |
| `LuoWen.WireStyle` | 线路样式 | combo | `orthogonal` | `orthogonal` / `smooth` / `native` | `['LuoWen']` | 否（仅搜索） |
| `LuoWen.NodeAvoidance` | 节点避障 | combo | `standard` | `low` / `standard` / `high` | `['LuoWen']` | 否（仅搜索） |
| `LuoWen.Chamfer` | 绕障外角大斜切 | boolean | `true` | — | `['LuoWen']` | 否（仅搜索） |
| `LuoWen.CrossCleanup` | 离线交叉清理（实验） | boolean | `false` | — | `['LuoWen']` | **是（唯一幸存的最后一条）** |

来源：`luowen/web/index.js:21-26`（id 常量）、`:68-139`（`settings[]` 注册块）。

另有宿主里单独安装的模板包（`custom_nodes/ComfyUI-Luowen`，正本在 `template/ComfyUI-Luowen/`）：

| id | 显示名 | 类型 | 默认值 | 声明分类 | 浏览可见 |
|---|---|---|---|---|---|
| `ComfyUI-Luowen.greeting` | Luowen 问候语 | text | `hello from luowen` | `['Luowen','Example']` | 是（导航 `Luowen` → 分组 `Example`） |

来源：`template/ComfyUI-Luowen/web/js/luowen.js:24-33`（**已于 2026-11-07 移除**，模板改为注释写法样例；宿主导航不再出现 `Luowen / Example / 问候语`，见 DEC-023）。

### 1.2 实测：设置树的折叠行为（关键发现）

- 1.55.18 的设置导航中，本仓库 6 项设置被折叠进 **`其他（Other） → LuoWen`** 一个页面，页面上**只剩 `LuoWen.CrossCleanup` 一项**（最后注册者覆盖同节点 `data`）。
- 用设置搜索框输入 `LuoWen`，6 项全部出现在搜索结果里；输入 tooltip 独有词 `净空`，结果为空。
- 根因链：
  1. 分类树由 `category || id.split('.')` 建树：`useSettingUI.ts:62-70`。
  2. `buildTree` 对同一路径复用节点，并把最后一个 key 写成叶子：`treeUtil.ts:14-38`（`parent.leaf = ...`、`parent.data = item`，见 `:36-37`）。
  3. 单元素分类 `['LuoWen']` 只生成一个叶子节点；同分类的第二条设置复用同一节点并覆盖 `data`，因此只剩最后一条。
  4. 单元素分类的叶子随后被挪进合成节点 `Other`：`useSettingUI.ts:72-81`。
- 对照：核心设置使用 **3 级分类**（第 3 段是每条设置唯一的 key），例如 `['Comfy','Error System','IssuesTab']`；这样分组标题是第 2 段、第 3 段保证每条设置各占一个叶子。实测读取 `Comfy.RightSidePanel.ShowErrorsTab` 的分类即为该形式。

**结论**：当前「散落、只能搜索」的主因不是设置项太多，而是分类声明形式错误——单元素 `category` 会让同组设置互相覆盖。

### 1.3 命名与分类不一致（只列出，未改动）

| 现象 | 位置 | 说明 |
|---|---|---|
| 分类名 `LuoWen` 与 `Luowen` 并存 | `luowen/web/index.js:75` vs 模板 `web/js/luowen.js:28` | 大小写不一致，来自两个不同包；导航里表现为 `LuoWen`（藏在 Other 下）与 `Luowen`（独立项） |
| id 前缀 `LuoWen.` 与 `ComfyUI-Luowen.` 并存 | 同上 | 模板残留包造成 |
| 模板遗留 `Example` 分类 | 模板 `web/js/luowen.js:28` | 已随模板装进验证宿主，出现在导航 `Luowen → Example` |
| 显示名「绕障外角大斜切」 | `luowen/web/index.js:123` | 用户口头称为「线隙外角大斜切」；两者指同一设置，需定口径 |
| 避障档位 `standard` | `luowen/web/index.js:117` | 用户描述为 `low/medium/high`，代码实际是 `low/standard/high` |

**处置（D3 / DEC-022）**：显示名统一为「绕障外角大斜切」；避障档位内部值保持 `low/standard/high`，展示文案改用「低 / 标准 / 高」；`Luowen/Example` 属模板包，按 D4 不动，仅从验收口径排除。

### 1.4 未暴露的常量与调试入口（候选变设置项）

| 参数 | 当前值 | 定位 | 现状 |
|---|---|---|---|
| 斜切比例 `bevelRatio` | `0.6` | `geometry/chamfer.js:18` | 仅 `window.LuoWen.setBevelRatio()`，不持久化（`web/index.js:214-218`） |
| 输入侧线距 `lanePitch` | `8` | `routing/laneAssign.js:20` | 仅 `window.LuoWen.setLanePitch()`，不持久化（`web/index.js:219-225`） |
| 主干上限 `trunkCap` | `null`（合法最晚分叉） | `adapters/renderLinkAdapter.js:51` | 仅 `window.LuoWen.setTrunkCap()`（`web/index.js:226-230`） |
| 吸附进入容差 | `10` | `snap/alignSnap.js:21` | 硬编码 |
| 吸附脱离容差 | `15` | `snap/alignSnap.js:22` | 硬编码 |
| 避障净空 | `low=8 / standard=16 / high=24` | `adapters/renderLinkAdapter.js:29` | 随避障档位固定 |
| 直线捷径容差 | `3` | `adapters/renderLinkAdapter.js:34` | 硬编码 |
| 走廊/切角留白 | `NODE_PAD=6`、`LINE_PAD=10`、`MIN_LEG=24`、`MIN_CUT=24` | `geometry/chamfer.js:20-26` | 硬编码 |
| 清理去抖/增幅/轮数/成本 | `400ms / 0.15 / 2 / 60` | `adapters/renderLinkAdapter.js:39-42`；`routing/crossCleanup.js:13-15` | 硬编码 |

---

## 2. 宿主设置系统能力（1.55.18，均可复核）

### 2.1 注册与读写

- **推荐注册路径**：`app.registerExtension({ name, settings: [...] })`，注册时由 `extensionService` 直接消费。依据：`src/services/extensionService.ts:156`（`extension.settings?.forEach(addSetting)`）+ `src/platform/settings/settingStore.ts:332-352`（`addSetting`）；本仓库活体在 `luowen/web/index.js:68-139`。
- **旧入口仍可用但已弃用**：`app.ui.settings.addSetting(...)`，源码明确「Deprecated for external callers/extensions. Use `ComfyExtension.settings` field instead」：`src/scripts/ui/settings.ts:96-129`。pysssss 仍在用（`custom_nodes/ComfyUI-Custom-Scripts/web/js/autocompleter.js:320`）。
- **读取/写入**：`settingStore.get(id)` / `set(id, value)`：`src/platform/settings/settingStore.ts:215-222`、`:255-258`；扩展侧可用 `app.extensionManager.setting`（本机实测该键存在）或旧接口 `app.ui.settings.getSettingValue`（本仓库在用，`luowen/web/index.js:59-66`）。`set` 会写回后端 store：`settingStore.ts:218`。

### 2.2 分类、分组与折叠

- 导航结构 = 设置分类树；扩展分类没有「自带顶级面板」，只有分类节点。核心分类 `Comfy / LiteGraph / Appearance / 3D / Mask Editor / Other` 固定顺序，其余扩展分类统一归入导航组 `Other`：`useSettingUI.ts:92-115`、`:324-333`。
- 单元素分类会进入合成 `Other` 节点：`useSettingUI.ts:72-81`。多段分类则形成独立导航项（如模板 `['Luowen','Example']` 形成 `Luowen` 导航项，页内分组 `Example`）。
- **分组无折叠**：`SettingGroup.vue:1-26` 只有标题 + 行列表，没有 accordion/展开收起。
- **排序**：分组按其内设置最大 `sortOrder` 降序，组内设置也按 `sortOrder` 降序，并列按组名 `localeCompare`：`SettingDialog.vue:181-198`。
- **分类显示名翻译**：`settingsCategories.<normalize(label)>`，缺失时原样显示：`useSettingUI.ts:292-298`。

### 2.3 搜索匹配范围

- 匹配字段仅：`id`、`name`、翻译后的 `name`、分类名、子分类名；**不匹配 tooltip/描述**：`src/platform/settings/composables/useSettingSearch.ts:75-97`。
- 实测验证：`净空`（仅出现在 `LuoWen.Enabled` 的 tooltip 里）→ 0 结果；`LuoWen` → 6 条全中。
- 搜索时把 `activeCategoryKey` 置空、直接展示跨分类结果：`SettingDialog.vue:200-207`。

### 2.4 控件类型与自定义渲染

- 内置类型：`boolean`、`number`、`slider`、`knob`、`combo`、`radio`、`image`、`color`、`url`、`backgroundImage`、`text`（默认），以及不渲染的 `hidden`：`src/components/common/FormItem.vue`（类型分派段）。
- **支持自定义渲染**：`type` 可以是函数 `(name, setValue, value, attrs) => HTMLElement`，由 `CustomFormValue.vue:8-19` 挂载；扩展可借此放任意 DOM 控件（滑块、按钮组等）。真实第三方用法：pysssss `web/js/autocompleter.js:324-330`（返回 `<tr>` 的自定义控件）。
- `experimental: true` 会显示实验徽章（`SettingItem.vue:14-25`），可用于替代名称里的「（实验）」后缀。
- 未发现公开的「每条设置恢复默认值」按钮；`SettingItem.vue` 的检索只命中 `experimental` 与 tooltip 翻译（`SettingItem.vue:9-25`、`:77-78`）。

### 2.5 独立面板 / 页面

- 设置对话框右侧的特殊面板（About / Credits / User / Workspace / Keybinding / Extension / Server-Config / Secrets）是**硬编码列表**：`useSettingUI.ts:253-262`，面板查找仅在该列表内进行：`SettingDialog.vue:176-179`；未发现 `registerSettingsPanel` 一类扩展 API（全 bundle 检索无命中）。
- **扩展不能往设置对话框加顶级面板**；能做的是注册分类，或自己实现 UI。

### 2.6 侧边栏 Tab（可承载独立 UI）

- 公开入口：`app.extensionManager.registerSidebarTab(...)` 与 `unregisterSidebarTab`、`getSidebarTabs`（本机实测 `extensionManager` 上存在这三个方法）。
- 实现侧：`registerSidebarTab` 定义在 `src/stores/workspace/sidebarTabStore.ts`；`workspaceStore.ts:73-83` 在 `extensionManager` 上挂载。
- 渲染支持两种形态：`type:'vue'` + `component`（核心 JobHistory / Assets 用），或 `type:'custom'` + `render(el)` / `destroy`（`ExtensionSlot.vue:1-34`）。
- 真实第三方用例：EasyUse 以 `type:'custom', render:e=>{...}` 注册 `NodesMap` 侧边栏，并由 `EasyUse.NodesMap.Enable` 设置控制是否注册：`custom_nodes/ComfyUI-Easy-Use/web_version/v2/easyuse.js:2`（压缩文件，第 2 行）。
- 侧边栏 tab 不参与原生设置搜索。

### 2.7 其他可用入口

- 设置对话框可用命令打开：`app.extensionManager.command.execute('Comfy.ShowSettingsDialog')`（本机实测存在该命令）。
- 设置对话框内部支持 `scrollToSettingId` 定位与高亮，但该 prop 属内部组件（`SettingDialog.vue:109-113`、`:217-239`），未发现扩展调用它的公开入口。
- 未发现扩展注册 i18n 文案的公开 API（全 bundle 检索 `addTranslation` / `mergeLocaleMessage` / `customNodeLocales` 无命中）。因此当前设置 `name`/`tooltip`/分类名在英文界面仍显示中文原文——**待进一步取证**（可能通过扩展静态目录约定实现，本次未验证）。

### 2.8 交叉验证汇总

| 结论 | 证据 A | 证据 B |
|---|---|---|
| `settings[]` 注册即消费 | `extensionService.ts:156` | `settingStore.ts:332-352` + 本仓库 `index.js:68` |
| 单元素分类折叠 | `treeUtil.ts:36-37` | `useSettingUI.ts:62-81` + 1.55.18 实测仅剩 `CrossCleanup` |
| 搜索不含 tooltip | `useSettingSearch.ts:75-97` | 实测 `净空` 无结果 |
| 不能新增设置面板 | `useSettingUI.ts:253-262` | `SettingDialog.vue:176-179` + 无注册 API |
| 侧边栏可自绘 UI | `ExtensionSlot.vue:1-34` | `workspaceStore.ts:73-83` + EasyUse 实例 |
| 自定义控件可行 | `FormItem.vue` 分派 + `CustomFormValue.vue:8-19` | pysssss `autocompleter.js:324-330` |

---

## 3. 同类扩展的做法（本机已安装包）

| 扩展 | 做法 | 依据 |
|---|---|---|
| KJNodes | 3 级分类；第 2 段为组名、第 3 段为逐设置唯一键（用显示名当第 3 段） | `ComfyUI-KJNodes/web/js/vue_combo.js:583` |
| VideoHelperSuite | 同样 3 级分类，例如 `['🎥🅥🅗🅢','Previews','Advanced Previews']`，组内多条同组设置 | `ComfyUI-VideoHelperSuite/web/js/VHS.core.js:1766-1845` |
| pysssss（Custom-Scripts） | 旧 `addSetting` 分散在各功能文件；分类由 id 点号派生（`pysssss.*` 各占独立子段）；自定义渲染做带说明的控件 | `web/js/snapToGrid.js:21-29`、`web/js/autocompleter.js:320-330` |
| EasyUse | 自带侧边栏 tab（`type:'custom'` + `render`），用设置项控制 tab 是否注册 | `web_version/v2/easyuse.js:2` |
| ComfyUI-Manager | **不注册设置项**，用自有 `ComfyDialog` 与菜单命令承载管理 UI | `js/comfyui-manager.js:823`、`:1504-1522` |
| rgthree | 本机包内未检索到设置注册（本次检索 `settings:` / `addSetting` 无命中） | 待取证 |

**可借鉴的结论**：
1. 主流做法仍是「原生设置 + 多级分类」，3 级分类是让多条设置全部可见的关键。
2. 低频、参数多的扩展（EasyUse）才自建侧边栏；Manager 直接用自己的对话框，完全脱离设置体系。
3. 原生设置的分组不能折叠，想「高级参数收起来」只能自建 UI 或依赖搜索。

---

## 4. 可选方案与权衡（已定：A）

| 方案 | 内容 | 优点 | 代价 / 风险 |
|---|---|---|---|
| A. 只修原生分类 | 把所有设置改为 3 级 `['LuoWen', 组名, 唯一键]`；顺手用 `experimental` 徽章 | 改动最小；保留原生搜索；无新 UI 维护 | 导航仍归在「其他」组；无折叠；高级参数只能继续堆行 |
| B. 全量独立侧边栏 | 常用与高级项全部搬进自绘侧边栏 tab | 分组/折叠/文案完全可控；不占画布（可收起） | 失去原生搜索与设置体系；需自写 UI、同步设置值、主题适配；PRD 要求「轻量」 |
| C. 混合（推荐起点） | 常用项留在原生设置（修好分类），低频/调试项放独立侧边栏或自定义对话框 | 常用项保留搜索与原生体验；高级项可折叠收纳 | 两套入口需明确边界，避免重复控件 |
| D. 独立对话框按钮 | 自建 modal（类似 Manager），从菜单/状态栏进入 | 不改设置体系；可放任意内容 | 入口不显眼；需自管样式与快捷键；仍无搜索 |

**倾向**：先做 A 解决「5 项只能搜索」这一确定缺陷；再按用户对「独立界面」的诉求在 B/C 中选一层增量。若选 C，建议把「实验/调试类」放侧边栏，常用开关保留原生。

### 4.1 A 方案下的分组（已确认）

三级分类第 2 段是页内分组标题，第 3 段只用于逐设置唯一（不显示）。第 3 段建议直接用 id 后缀，避免改名时影响唯一键。`sortOrder` 取降序，用于固定组与组内顺序。

| 组（第 2 段） | 设置 | 分类路径 | sortOrder |
|---|---|---|---|
| 基础 | 启用络纹 | `['LuoWen','基础','Enabled']` | 100 |
| 基础 | 对齐吸附 | `['LuoWen','基础','SnapAlign']` | 90 |
| 线路外观 | 线路样式 | `['LuoWen','线路外观','WireStyle']` | 80 |
| 线路外观 | 节点避障 | `['LuoWen','线路外观','NodeAvoidance']` | 70 |
| 线路外观 | 绕障外角大斜切 | `['LuoWen','线路外观','Chamfer']` | 60 |
| 实验 | 离线交叉清理 | `['LuoWen','实验','CrossCleanup']`（`experimental: true`） | 50 |

分组理由：6 项里 4 项直接改变线条外观，归一组可减少页内标题碎片；吸附属于拖动交互，和总开关同放「基础」；实验项单独隔开，避免与稳定项混淆。

### 4.2 A 方案边界（已确认）

**达成**：
- 设置导航「其他」组下出现独立 `LuoWen` 项，点开是络纹专属设置页；
- 页内按「基础 / 线路外观 / 实验」三组展示 6 项，全部可见、顺序固定；
- 原生设置搜索继续可用，`LuoWen` 与各主名词均可命中；
- 设置值仍按原 id 存取，已保存值不失效。

**不达成**：
- 不能把 `LuoWen` 提升为设置对话框的一级导航（宿主不允许扩展注册面板）；
- 不能在设置对话框之外提供入口；
- 页内分组不能折叠，布局仍是原生「标题 + 行」。

**后续可选（不在本轮）**：
- 侧边栏 tab 只读展示当前生效值 + 「打开设置」按钮。注意：未发现公开 API 能把设置对话框直接定位到指定分类，打开后仍需手动点 `LuoWen`；
- 若验收后仍嫌入口深，再评估把低频/调试项搬进侧边栏（C 方案），但不复制常用控件。

---

## 5. 已达成一致的决定

- **D1（Q1）方案 A 起步**：每条设置改为三级分类 `['LuoWen', 组名, 唯一键]`，目标是在导航中出现独立的 `LuoWen` 设置页且 6 项全部可见；不做侧边栏起步。C（混合）仅作为 A 验收后的可选增量，届时只搬低频/调试项。
- **D2（Q2）本轮不新增低层参数**：斜切比例、输入侧线距、主干上限、吸附容差、避障净空、清理阈值继续留在常量或 `window.LuoWen.*` 调试入口；以后若加，优先斜切比例与输入侧线距并放入「高级」组。
- **D3（Q3）只改分类不改 id**：统一分类名为 `LuoWen`，补二级组名；保留现有 id，避免用户已保存的设置值失效；显示名统一为「绕障外角大斜切」；避障档位内部值不动、展示文案用「标准」。`Luowen/Example` 不在本仓库处理。
- **D4（Q4）不删除宿主模板副本**：先只在验收口径里排除 `Luowen/Example` 组；删除目录需用户单独授权（红线）。

---

## 6. 后续候选（不在本轮）

1. 侧边栏只读状态入口：展示当前生效值，提供「打开设置」按钮；不做控件复制。
2. 恢复默认值：如需，先做全局命令「恢复络纹默认值」，不做逐项重置。
3. 低层参数暴露：如确有必要，优先斜切比例与输入侧线距，放入「高级」组；其余保持常量/调试入口。

## 7. 实施记录（2026-11-07）

- **代码改动**：仅 `luowen/web/index.js` 的设置注册块——6 项分类改为三级路径、补齐 `sortOrder`、显示名与避障档位选项文案调整、实验项改用 `experimental: true`。未改 id、默认值、onChange 语义与路由代码。
- **验证环境**：ComfyUI 0.43.2 + 前端 1.55.18；把修改后的 `index.js` 同步到验证宿主 `custom_nodes/luowen/web/index.js` 后做页面级实测（未安装新扩展、未删目录、未提交）。
- **实测结果**：
  - 导航出现独立 `root/LuoWen` 项（位于「其他」组），页内分组与顺序为：基础（启用络纹、对齐吸附）→ 线路外观（线路样式、节点避障、绕障外角大斜切）→ 实验（离线交叉清理）；
  - 6 项全部可见；`experimental` 徽章实测渲染为烧瓶图标（无文字）；
  - 搜索命中：`LuoWen` 返回 6 项；`启用`→`LuoWen.Enabled`；`吸附`→`LuoWen.SnapAlign`；`样式`→`LuoWen.WireStyle`；`避障`→`LuoWen.NodeAvoidance`；`斜切`→`LuoWen.Chamfer`；`清理`/`交叉`→`LuoWen.CrossCleanup`；
  - 旧 id 持久化：先把 `LuoWen.WireStyle` 设为 `smooth`，刷新页面后仍为 `smooth`（截图下拉框显示 smooth）；
  - 单元测试 `node --test tests/unit/*.test.mjs`：97/97 通过；
  - 截图：`docs/specs/assets/luowen-settings-verified-2026-11-06T17-18-21-299Z.png`。
- **模板示例项处置（2026-11-07 补记）**：宿主导航原有的 `Luowen → Example → 问候语` 已从模板源头移除并同步宿主副本，导航「其他」组下只剩 `LuoWen`（DEC-023）；模板副本目录本身未删除。

---

## 8. 未取证与边界

- 扩展 i18n 文案注入：未找到公开 API，未验证是否存在目录约定。
- rgthree 本机包设置注册：本次检索无命中，未继续深挖。
- 设置对话框「直接定位到指定分类」的公开入口：未发现，按不可用处理。
- 1.55.18 与 `requirements.txt` 声明的 1.57.4 存在版本差，上述结论仅对 1.55.18 负责（与仓库既有口径一致）。

---

## 9. 提示框排版（2026-11-07）

- **现状**：提示框由 PrimeVue `v-tooltip` 渲染，默认 `max-width: var(--p-tooltip-max-width)` = 200px；`.p-tooltip-text` 为 `white-space: pre-line` 且 `word-break: break-word`；`escape=true` 按纯文本渲染。问号图标来自宿主 `FormItem.vue:15` 的 `i.pi-info-circle`，不是本插件代码。
- **改动**：6 项 `tooltip` 改为对象形式 `{ value, class: 'luowen-tooltip' }`，在句号/分号/逗号处显式插入 `\n`，一句一行；加载时注入 `.p-tooltip.luowen-tooltip{width:max-content;max-width:min(560px,calc(100vw - 2rem))}`，只作用于带标记的提示框。实测指令根节点带内联 `width: fit-content`，内联优先，因此实际生效的是「`fit-content` 内容自适应 + `max-width` 封顶 560px」，与「内容自适应 + 上限封顶」等价。
- **实测**：1600×1000 下六项宽 406 / 491 / 282 / 373 / 416 / 352px，行数 2 / 3 / 3 / 3 / 5 / 6，自动折行 0 处（含行尾孤字 0 处）；1100×1000 与 900×800 均 0 折行，900 下最大 `right=861`、`bottom=732`，未溢出视口；核心设置提示框仍 200px。
- **降级**：宿主若不再支持对象 `class`，提示框回落 200px，换行仍生效；若 `pre-line` 改变，换行折叠为空格，文本仍完整。
- **对比截图**：`docs/specs/assets/luowen-tooltip-before-2026-11-07-2026-11-06T17-35-38-171Z.png`（改前）、`luowen-tooltip-after2-2026-11-07-2026-11-06T17-37-24-646Z.png`（第一轮改后，448px 上限）、`luowen-tooltip-560-2026-11-07.png-2026-11-06T17-55-57-120Z.png`（第二轮改后，560px 上限）。
- **契约**：`docs/comfyui-dev-conventions.md` §2.10；决策见 DEC-024。

---

## 10. 增量：圆角半径设置（2026-11-07）

- 新增 `LuoWen.CornerRadius`，归「线路外观」组，`sortOrder: 75`（线路样式 80 与节点避障 70 之间）；`type: 'slider'`，`attrs: { min: 0, max: 24, step: 1 }`，默认 10（等于改前实际生效半径）。
- 页内实测：7 项，顺序为 基础（启用络纹、对齐吸附）→ 线路外观（线路样式、圆角半径、节点避障、绕障外角大斜切）→ 实验（离线交叉清理）；滑块聚焦后 Home 写入 0、End 写入 24，数字框与 `LuoWen.status().cornerRadius` 同步。
- 提示框：400×116px、5 行、每行单行盒（无自动折行/孤字行），900×800 视口下无溢出。
- 语义与几何夹取、截图与决策见 `docs/agents/decision-log.md` DEC-025。

---

## 11. 增量：信息架构重排与带区编号（2026-11-10，DEC-066）

> 本节覆盖 §4.1 的页序（§4.1 保留为 2026-11-07 的历史记录）。机制与取舍见 `docs/agents/decision-log.md` DEC-066。

### 11.1 机制

- 宿主排序规则不变（`SettingDialog.vue:181-198`）：组序 = 组内最大 `sortOrder` 降序，并列按组名 `localeCompare`；组内 `sortOrder` 降序。
- 因此编号改为**带区**：`sortOrder = 组号×100 + 组内序`（组内序 9→1 递减），组号步长 10。
- **不变量**：一组的全部值落在 `[band, band+99]`；组最大值两两不同 → 组序只由组号决定，新设置插在组内不会改变组序。
- 唯一真相：`luowen/web/settings-layout.js`（`SETTINGS_GROUPS`）；`index.js` 每项写 `...layoutOf(ID)`，不再手写 `category` / `sortOrder`。
- 守护：`tests/unit/settingsOrder.test.mjs` 断言页序逐项相等、带区不变量、越区/未登记必报、同组唯一键不重复。

### 11.2 页序

| 组 | 带 | 行（组内 9→1） |
|---|---|---|
| 基础 | 8000 | 启用络纹 8009 / 对齐吸附 8008 / 界面语言 8007 |
| 线路外观 | 7000 | 线路样式 7009 / 节点避障 7008 / 绕障外角大斜切 7007 / 圆角半径 7006 / 兄弟线间距 7005 |
| 连线配色 | 6000 | 主题 6009 / 配色范围 6008 |
| 自动布局 | 5000 | 多工作流排布 5009 / 整理时列内对齐 5008 / 整理时主链水平间距 5007 / 整理时单进单出节点间距 5006 / 整理时列内上下间距 5005 / 整理时折叠说明节点 5004 |
| 动效 | 4000 | 启用动效 4009 / 动效模式 4008 / 动效线型 4007 / 生成时禁用动效 4006 |
| 动效·光束 | 3000 | 光束·流速 3009 / 光束·长度 3008 / 光束·间距 3007 |
| 动效·虚线 | 2000 | 虚线·流速 2009 / 虚线·长度 2008 / 虚线·间距 2007 |
| 实验 | 1000 | 离线交叉清理 1009 |

判据（按序应用）：门控项先于依赖项 → 常驻视觉先于按需工具 → 稳定项先于实验项 → 组内宏观先于微观。

### 11.3 本轮命名调整（zh）

| 旧 | 新 | 理由 |
|---|---|---|
| 拐角曲线 | 圆角半径 | 与自身 tooltip「只对 smooth 圆角样式生效」和 en `Corner Radius` 一致 |
| 连线配色主题 | 主题 | 组名已是「连线配色」，行名去重 |
| 主题范围 | 配色范围 | 同上；en 仍为 `Theme Scope` |

id、默认值、枚举值、`onChange` 语义均未变；已保存的设置值不受影响。

### 11.4 边界

- 组名是 category 字面量，宿主未提供扩展翻译 API → en 界面组标题仍显示中文（既有问题，本轮不做 hack）。
- zh 主题名已去掉英文括注（夜灯 / 晨光 / 赛博朋克 / 水母 / 日晒）：此前「赛博朋克（Cyberpunk）」在 240px 下拉溢出 5px（可用 198 / 需要 203），去括注后选中值 198/198 无截断。

### 11.5 验收记录（2026-11-10）

- **页序**：1600×1000 与 900×800 的真实 DOM 行序均 27/27 与 §11.2 一致；截图 `assets/luowen-settings-order-1600x1000-2026-11-10.png`、`assets/luowen-settings-order-900x800-2026-11-10.png`。
- **双语**：en 界面 27 行名全英文、无中文泄漏（`assets/luowen-settings-order-en-2026-11-10.png`）；组标题仍中文，原因见 §11.4。
- **搜索命中（zh，输入即测）**：

  | 词 | 命中 | 说明 |
  |---|---|---|
  | `LuoWen` | 27 | 全量 |
  | `配色` | 2 | 组名「连线配色」+ 行「配色范围」 |
  | `整理` | 5 | 5 个「整理时…」行（「多工作流排布」不含该词） |
  | `动效` | 10 | 动效组 4 行 + 组名含「动效」的光束/虚线两组各 3 行 |
  | `吸附` / `圆角` / `主题` / `避障` | 1 | 各自唯一 |
  | `拐角` / `曲线` | **0** | 旧名「拐角曲线」更名为「圆角半径」；tooltip 不参与搜索 |

- **持久化**：自动布局三项间距写入 → 刷新 → 读回一致；探针后还原 40/60/50。
- **单测**：172/172（`settingsOrder` 4 条 + `i18n` 键集相等 1 条）。
