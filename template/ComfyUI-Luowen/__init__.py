"""ComfyUI-Luowen — 最小约定模板包（ComfyUI v0.43.2 / 前端 1.55.18 实测验证）。

结构遵循本机 7 个成熟节点包的多数派实践（交叉验证表见 docs/comfyui-dev-conventions.md §5）：
瘦 __init__ 只做注册聚合 + nodes/ 子包放实现 + web/js 前端扩展 + pyproject/requirements 元数据。
"""
from .nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS

# 固定名，不可改：nodes.py:2299-2302 读取；本包 web/ 将挂载到 /extensions/ComfyUI-Luowen/
WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
