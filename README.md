# 络纹 LuoWen

ComfyUI 智能连线路由扩展：用更清晰的线路样式、空间感知的路径规划、节点避障与多目标自适应主干/分叉，降低复杂工作流中的"线团"现象。

**核心原则：改善线路表达，不改变工作流本身。** 只改绘制，不改图数据。

## 当前状态

> **开发尚未开始**——项目当前处于 PRD 基线 + 开发基线已验证阶段。

| 项 | 状态 |
|---|---|
| PRD | v1.0 需求基线，见 [docs/prd/luowen-prd-v1.0.md](docs/prd/luowen-prd-v1.0.md) |
| 开发基线 | ✅ 已建立并验证：[docs/comfyui-dev-conventions.md](docs/comfyui-dev-conventions.md) |
| 最小插件模板 | ✅ 已在本机 ComfyUI 实测可加载/可执行：[template/ComfyUI-Luowen/](template/ComfyUI-Luowen) |
| 产品代码 | ❌ 未开始。第一步是 PRD 阶段 0（绘制 API 技术可行性验证），见 PRD §15 |

## 规划能力（PRD P0，尚未实现）

- 两种线路样式：平滑曲线（Bezier/Spline）与正交折线（Orthogonal/PCB），可切换
- 单条线路空间路由 + 节点避障 + 线路分道
- 多目标连接自适应主干/分叉：全部合并 / 部分合并 / 完全独立，由空间成本决定
- 单目标绕行保护：不为总长度牺牲任何一条连接
- 悬停 / 选中 / 命中测试 / 删除语义与原生一致
- 手动意图优先：不覆盖用户 Reroute 与手动线束
- 任一环节失败安全降级回原生绘制；不改变任何原生 Link 数据

## 安装（当前模板形态）

把 `template/ComfyUI-Luowen/` 整个目录复制到 ComfyUI 的 `custom_nodes/` 下并重启。无第三方依赖。

- 已验证环境：ComfyUI v0.43.2（`D:\AIGC\ComfyUI_windows_portable`）+ 前端 1.55.18 + Python 3.13 + RTX 5080
- 验证节点：`Luowen Example`（V1 契约演示）、`Luowen Save Text`（输出节点演示）

## 开发

| 场景 | 命令 | 说明 |
|---|---|---|
| 启动验证宿主 | `run_nvidia_gpu.bat`（宿主根目录） [已运行验证] | ComfyUI 0.43.2，默认端口 8188 |
| 查节点 schema | `curl http://127.0.0.1:8188/object_info/LuowenExample` [已运行验证] | 校验 INPUT_TYPES 契约 |
| 语法自检 | `python_embeded\python.exe -I -m py_compile <files>` [已运行验证] | 模板 Python 文件编译检查 |

改动节点代码后需重启 ComfyUI。开发约定、源码行号级引用与常见坑见
[docs/comfyui-dev-conventions.md](docs/comfyui-dev-conventions.md)；术语表见 [GLOSSARY.md](GLOSSARY.md)。

## 文档导航

| 文档 | 内容 |
|---|---|
| [docs/prd/luowen-prd-v1.0.md](docs/prd/luowen-prd-v1.0.md) | 产品需求基线：功能范围、算法方案、验收标准、研发阶段 |
| [docs/comfyui-dev-conventions.md](docs/comfyui-dev-conventions.md) | ComfyUI 开发约定（spec-of-record，file:line 可复核） |
| [GLOSSARY.md](GLOSSARY.md) | 项目术语表 |
| [CHANGELOG.md](CHANGELOG.md) | 变更日志（Keep a Changelog） |
| docs/agents/ | AI 协作过程档案（进度 / 决策 / 调试） |

## License

MIT（见 `template/ComfyUI-Luowen/pyproject.toml` 的 license 字段）。LICENSE 文件与第三方声明（THIRD_PARTY_NOTICES.md）随阶段 3 发布交付，见 PRD §16。
