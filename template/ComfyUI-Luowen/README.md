# ComfyUI-Luowen

Luowen 的 ComfyUI 自定义节点包。当前为**最小约定模板**，已在
`%ComfyUIPortable%\ComfyUI`（v0.43.2 / 前端 1.55.18）上验证：
可加载、/object_info 可查、前端可搜索、可入队执行。

## 结构

```
ComfyUI-Luowen/
├── __init__.py        # 瘦入口：NODE_CLASS_MAPPINGS 聚合 + WEB_DIRECTORY
├── nodes/             # 节点实现（多数派结构，7/7 包采用子包形态）
│   ├── __init__.py    # 注册表：key=全局唯一节点名，value=实现类
│   └── example.py     # V1 契约活体模板（每行附源码 file:line）
├── web/js/luowen.js   # 前端扩展：registerExtension / 自定义 widget / settings
├── requirements.txt   # 依赖（核心不自动安装，Manager 或用户装）
└── pyproject.toml     # Registry 发布元数据（[tool.comfy]）
```

## 节点

- **Luowen Example** — 完整 V1 契约演示：STRING/FLOAT/COMBO/BOOLEAN/INT 输入、
  自定义类型 `LUOWEN_WIDGET`（前端 widget 渲染 + 点击计数）、随机 seed 按钮。
- **Luowen Save Text** — OUTPUT_NODE 演示：`forceInput` 文本入口，写入 output 目录。

## 安装

把本目录整体复制到 ComfyUI 的 `custom_nodes/` 下并重启。无第三方依赖，无安装步骤。

## 注

- 开发约定的权威文档：工作区 `docs/comfyui-dev-conventions.md`（每条结论带源码 file:line 与交叉验证标注）。
- PRD 阶段将在此基础上开发正式节点，本 README 届时由项目文档体系接管。
