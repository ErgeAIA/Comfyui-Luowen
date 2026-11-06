# 络纹 LuoWen

ComfyUI 智能连线路由扩展：用更清晰的线路样式、空间感知的路径规划、节点避障与多目标自适应主干/分叉，降低复杂工作流中的"线团"现象。

**核心原则：改善线路表达，不改变工作流本身。** 只改绘制，不改图数据。

## 当前状态

| 项 | 状态 |
|---|---|
| 产品代码 | ✅ 阶段 1–2 已实现并由用户验收（阶段 2 提交 `8614a8a`）；P1 增强 3A/3B 已提交（`b6dab5c`、`603a1b5`） |
| 单元测试 | ✅ 95 项全通过（`node --test tests/unit/*.test.mjs`，2026-11-06 实跑） |
| PRD | v1.0 需求基线，见 [docs/prd/luowen-prd-v1.0.md](docs/prd/luowen-prd-v1.0.md) |
| 开发基线 | ✅ 已建立并验证：[docs/comfyui-dev-conventions.md](docs/comfyui-dev-conventions.md) |
| 宿主验证 | ✅ ComfyUI 0.43.2 + 前端 1.55.18（Windows portable），已装 `custom_nodes` 实测 |
| 阶段 3 | ⬜ 未开始：兼容性矩阵、生命周期与冲突测试、性能基准、发布材料 |

> 3A（拖动对齐吸附）与 3B（交叉枚举 + 离线交叉清理）属于 PRD §4.2 的 P1 增强，不是阶段 3 交付物；顺序抽头（3C）经 A/B 实测无可见差异，已撤除。

## 已实现能力

**阶段 1：线路样式与单条路由**

- 三种线路样式：`orthogonal`（正交折线 + A* 路由）、`smooth`（沿用正交骨架的平滑圆角，非 PRD §5.1 的 Bezier）、`native`（原生渲染）
- 节点避障三档净空：`low` 8 / `standard` 16 / `high` 24 图 px；strict→semi→loose 逐级降级，不穿过节点主体
- 反向连接、端口 stub 收缩、路径简化；拖动期间走轻量正交预览，不跑 A*
- 整线悬停高亮；命中/删除沿用原生读取的 `link.path`
- 路由缓存 + 障碍版本失效；任一线路失败或预算耗尽自动降级原生
- 数据不变性机检：`window.LuoWen.verify()` 对比节点与 Link 五元组

**阶段 2：自适应主干与分叉**

- 按输出端口分组：全部合并 / 部分合并 / 完全独立；独立基准 + 绕行保护（ratio 双阈值滞回）
- 单主干共享几何：端口只出一条线，到分叉点后再分支
- 合法最晚分叉：分叉点取「不顶进最近目标、不撞前方卡片、分支在引脚前仍可辨」的最晚可行位置
- 分叉后公共走廊合并；输入侧多引脚走廊按接近方向嵌套分道（同节点不同引脚不共线）
- 绕障外角大斜切（唯一允许的斜线表达，默认开，可与样式组合关闭）

**P1 增强（已实现，默认策略不同）**

- 3A 拖动对齐吸附：单节点拖动时与相连邻居引脚行对齐，10 图 px 进入 / 15 图 px 脱离，DOM 提示线覆盖层（默认开）
- 3B 交叉枚举与离线交叉清理：布局静止 400ms 后对存在交叉的线路对重解，交叉对严格下降且总长增幅 ≤15% 才采纳（默认关闭，设置项「离线交叉清理（实验）」）

## 已知限制

- 主干组交互未通过验收：点主干只命中单条 link（AT-013/015/017 不通过，属阶段 3 前欠账）
- 手动意图保护未实现：Reroute 排除合并、手动锚点（F-010/AT-018）
- 经典画布与 Nodes 2.0 兼容性未验证（F-014）；对齐吸附仅实现 Vue 节点拖动模式
- 子图、折叠节点、撤销重做、复制粘贴等生命周期测试未覆盖（AT-021/023/025）
- 与 Cable Management / NKD Reroutes / Zip Ties 的冲突测试、性能基准（§14.5）未做
- PRD §14.2 的 10 组算法固定样本目前只做了 2 组
- `smooth` 是本项目自有的圆角折线，不是 PRD §5.1 描述的 Bezier（实现与 PRD 的这一处差异仍未消除）

## 安装

把 `luowen/` 整个目录复制到 ComfyUI 的 `custom_nodes/` 下并重启。纯前端扩展：不注册任何节点，服务端只有 `WEB_DIRECTORY = "./web"`，无第三方依赖。

- 已验证环境：ComfyUI v0.43.2（`D:\AIGC\ComfyUI_windows_portable`）+ 前端 1.55.18 + Python 3.13
- 加载成功时浏览器控制台输出 `[LuoWen] 就绪`；设置面板出现 `LuoWen` 分组

## 设置项

| 设置 | 默认 | 说明 |
|---|---|---|
| 启用络纹 `LuoWen.Enabled` | 开 | 总开关；关闭后完全回归原生线路绘制 |
| 对齐吸附 `LuoWen.SnapAlign` | 开 | 单节点拖动与相连邻居引脚行对齐（10 图 px 进入 / 15 图 px 脱离） |
| 线路样式 `LuoWen.WireStyle` | `orthogonal` | `orthogonal` / `smooth` / `native` |
| 节点避障 `LuoWen.NodeAvoidance` | `standard` | `low` 8 / `standard` 16 / `high` 24 图 px |
| 绕障外角大斜切 `LuoWen.Chamfer` | 开 | 仅正交样式生效；与 `smooth` 圆角互斥 |
| 离线交叉清理（实验） `LuoWen.CrossCleanup` | 关 | 布局静止 400ms 后离线重解交叉对，收益不足则保持原画面 |

来源：[luowen/web/index.js](luowen/web/index.js)（设置注册 `index.js:73-139`）。

## 调试与验证接口

浏览器控制台 `window.LuoWen`：

| 接口 | 用途 |
|---|---|
| `status()` | 绘制计数器、缓存、主干与交叉清理状态 |
| `routes()` / `trace()` | 当前路由折线快照与 trace |
| `verify()` / `rebase()` | 节点与 Link 五元组对比、重建不变性基线 |
| `snapDebug()` / `crossDebug()` | 吸附与交叉清理诊断 |
| `setEnabled()` / `setStyle()` / `setSnapEnabled()` / `setCrossCleanup()` / `crossCleanupNow()` | 运行期开关 |
| `setLanePitch()` / `setTrunkCap()` / `setBevelRatio()` | 调试对照参数，仅内存态、不持久化 |

来源：[luowen/web/index.js](luowen/web/index.js)（`window.LuoWen` 定义 `index.js:165-243`）。

## 开发

| 场景 | 命令 | 验证状态 |
|---|---|---|
| 前端单元测试 | `node --test tests/unit/*.test.mjs`（glob 必需：Windows 上传目录会 MODULE_NOT_FOUND） | [已运行验证]（2026-11-06，95/95） |
| 启动验证宿主 | `run_nvidia_gpu.bat`（宿主根目录，默认端口 8188） | [已运行验证]（历史会话） |
| 查节点 schema | `curl http://127.0.0.1:8188/object_info/<类名>` | [已运行验证]（历史会话） |
| Python 语法自检 | `python_embeded\python.exe -I -m py_compile <files>` | [未经运行验证]（本轮未重跑） |

改动前端后刷新页面即可；改服务端入口需重启 ComfyUI。开发约定、源码行号级引用与常见坑见
[docs/comfyui-dev-conventions.md](docs/comfyui-dev-conventions.md)；术语表见 [GLOSSARY.md](GLOSSARY.md)。

## 文档导航

| 文档 | 内容 |
|---|---|
| [docs/prd/luowen-prd-v1.0.md](docs/prd/luowen-prd-v1.0.md) | 产品需求基线：功能范围、算法方案、验收标准、研发阶段 |
| [docs/routing-algorithm.md](docs/routing-algorithm.md) | 路由算法现状：挂载链路、lane 分配、主干/斜切、缓存降级、实测记录 |
| [docs/comfyui-dev-conventions.md](docs/comfyui-dev-conventions.md) | ComfyUI 开发约定（spec-of-record，file:line 可复核） |
| [GLOSSARY.md](GLOSSARY.md) | 项目术语表 |
| [CHANGELOG.md](CHANGELOG.md) / [CHANGELOG.en.md](CHANGELOG.en.md) | 变更日志（Keep a Changelog） |
| [docs/agents/project-progress.md](docs/agents/project-progress.md) | 当前阶段、进度与已知未完成项 |
| docs/agents/ | AI 协作过程档案（进度 / 决策 / 调试） |

## License

MIT（见 `template/ComfyUI-Luowen/pyproject.toml` 的 license 字段）。根目录 LICENSE 文件与发布包材料随阶段 3 交付（PRD §16）；MIT 复用内核的许可全文在 `luowen/LICENSES/`，第三方归属见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
