# AGENTS.md

<!-- mode: 半程合成 -->

## Permissions

IMPORTANT: 落纹（LuoWen）是 ComfyUI 纯前端连线路由扩展——只改线路绘制表达，禁止改变任何原生工作流数据。
YOU MUST 会话开始先读 docs/agents/ 三件套与 docs/handoff/ 最新一份
YOU MUST 先复述现状与待确认项，再动手
YOU MUST 改码前先读 docs/prd/luowen-prd-v1.0.md 与 docs/agents/decision-log.md
YOU MUST 改 ComfyUI 相关代码前先读 docs/comfyui-dev-conventions.md
YOU MUST 每次会话更新 docs/agents/project-progress.md
YOU MUST 改 AGENTS.md 前先读、改后追加 docs/agents/agents-changelog.md
YOU MUST 改某领域代码前先读 docs/agents/experience/<领域>/（存在时）
YOU MUST 每次只推进一个阶段，完成即停，等用户验证
YOU MUST 术语用法先对齐 GLOSSARY.md，新术语先入表再使用
禁止自行宣称已修复，修复结果须由用户验证
禁止整文件重写既有文件，只做最小精确补丁
禁止修改 Link ID、origin/target slot、节点数据或创建/移动 Reroute（PRD §9.2）
禁止自动节点布局、工作流语义分析、通用插件市场（PRD §2.3）
禁止在渲染热路径运行 A*、候选树搜索或全图重规划（PRD §10.1）
禁止凭记忆写 ComfyUI 契约代码，绕过 docs/comfyui-dev-conventions.md
禁止擅自更改 PRD 的产品边界、连接语义与验收原则
禁止把变更日志、人读说明、决策叙事写进本文件
禁止不记录就改动 AGENTS.md 的约定

## Toolchain

| 工具 | 精确版本 | 锁定位置 |
| ---- | -------- | -------- |
| ComfyUI（验证宿主） | v0.43.2 | D:\AIGC\ComfyUI_windows_portable\ComfyUI\comfyui_version.py |
| comfyui-frontend-package（宿主实装） | 1.55.18 | 宿主 python_embeded\Lib\site-packages（requirements 声明 1.57.4 未重装） |
| Python（宿主 embedded） | 3.13 | D:\AIGC\ComfyUI_windows_portable\python_embeded |
| torch | 2.14.0+cu130 | 宿主 python_embeded\Lib\site-packages\torch\version.py |
| codegraph | 1.6.2 | PATH |

## Commands

| 场景 | 命令原文 | 来源 |
| ---- | -------- | ---- |
| 启动验证宿主 | run_nvidia_gpu.bat | D:\AIGC\ComfyUI_windows_portable\run_nvidia_gpu.bat |
| 查节点 schema | curl http://127.0.0.1:8188/object_info/<类名> | docs/comfyui-dev-conventions.md §6 |
| Python 语法自检 | python_embeded\python.exe -I -m py_compile <files> | docs/comfyui-dev-conventions.md §6 |

## Conventions

| 观察到的现象 | 要求 Agent 的行为 |
| ------------ | ----------------- |
| 会话文档体系固定 | 进度写 docs/agents/project-progress.md；决策写 docs/agents/decision-log.md；两者只追加不删历史 |
| bug 追加 docs/agents/debug-log.md | 格式 BUG-NNN；只追加不删历史 |
| 交接写 docs/handoff | 命名 handoff-YYYY-MM-DD-*.md |
| 交接文档同日多份 | 按文件名里的日期取最新（兼容 `YYYY-MM-DD` 与 `YYYYMMDD` 两种写法）；同日多份再取 frontmatter `updated` 最新者，仍不可判则列出问用户 |
| 改 docs/agents 或 handoff 须同步 updated | 改完立刻把 frontmatter updated 改为当日 |
| 改 AGENTS.md 须留一行变更记录 | 在 docs/agents/agents-changelog.md 追加「旧值 → 处置 → 去处」，无记录视为静默丢失 |
| 经验库按领域分目录 | 可复用经验落 docs/agents/experience/<领域>/；正文可改写、历史靠 changelog.md，与 docs/agents 其余三份的「只追加」不同 |
| AGENTS.md 杂音归宿 | 变更日志 → CHANGELOG.md（无则 decision-log.md）；人读说明 → README.md（无则不写）；决策叙事与踩坑 → decision-log.md 与 debug-log.md；执行流水 → init-report.md 与 project-progress.md |
| 仓库文档归属 | README 生成或优化 → shuxu；CHANGELOG 建立、改结构、归档版本 → changelog-manager，日常只按既有格式追加 `[Unreleased]`；.gitignore 新增或修正 → git-manager；其他角色只报告缺口，不代写 |
| 开发结论须可复核 | 新的 ComfyUI 契约结论写入 docs/comfyui-dev-conventions.md，附源码 file:line，≥2 个成熟节点交叉验证（[n/7] 标注） |
| 目标环境锁定 | 开发与验证只用 D:\AIGC\ComfyUI_windows_portable（0.43.2）；不动 TE 实例；不改宿主环境依赖 |
| 模板为起点 | 新节点代码从 template/ComfyUI-Luowen/ 起步，契约写法对齐 nodes/example.py 注释 |

## References

- 实现功能 / 判断产品边界 → 见 docs/prd/luowen-prd-v1.0.md：功能范围、算法方案、验收标准与研发阶段
- 写 ComfyUI 契约代码 / 查前端 API / 排查坑 → 见 docs/comfyui-dev-conventions.md：V1/V3 契约、1.55.18 前端 API、file:line 可复核
- 术语分歧 / 命名取舍 → 见 GLOSSARY.md：项目术语与 Avoid 词
- 起步新节点 / 对照契约写法 → 见 template/ComfyUI-Luowen/：已验证的最小插件包
- 会话开始复述现状 → 见 docs/agents/project-progress.md：当前分支、阶段与最近进展
- 核对最近交接 → 见 docs/handoff/：上一轮做到哪、卡在哪
- 规则冲突、回溯口径 → 见 docs/agents/decision-log.md：技术与流程决策记录，只追加
- 反复踩坑排查 → 见 docs/agents/debug-log.md：BUG-NNN 格式的根因与预防规则
- 查 AGENTS 自身变更 → 见 docs/agents/agents-changelog.md：契约改动的「旧值 → 处置 → 新值」
- 同领域可复用做法 → 见 docs/agents/experience/：按领域分的可复用经验沉淀

## Self-Maintenance

1. 改变规则的 PR 须同步改本文件，否则视为规则漂移
2. 规则写入错误发生处最近作用域，monorepo 进对应子包
3. 命令更名、重构后，提交前核对本文件并更新过期示例
4. 随发布或固定周期清除失效条目
5. 本文件修改走 PR/Review，与代码同等纪律
