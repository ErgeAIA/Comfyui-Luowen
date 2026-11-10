"""络纹 LuoWen — ComfyUI 智能连线路由扩展（阶段 1：单条 A* 路由 + 样式切换）。

纯前端扩展最小入口（PRD §11.1）：不注册节点、无第三方依赖，仅暴露 web 目录。
功能全部在 web/ 下的 JS：geometry/（纯几何）→ routing/（缓存与 lane 分配）
→ adapters/（renderLink 适配）→ index.js（扩展注册）。

安装：复制本目录到 ComfyUI 的 custom_nodes/ 下并重启。
"""

__version__ = "0.1.0"

WEB_DIRECTORY = "./web"

__all__ = ["WEB_DIRECTORY", "__version__"]
