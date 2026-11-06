"""络纹 LuoWen — 阶段 0 技术可行性验证原型（PRD §15 阶段 0 交付物之一）。

纯前端扩展的最小 Python 入口：不注册任何节点，仅暴露 web 目录给
ComfyUI 的前端扩展发现机制（nodes.py:2299-2302 读取 WEB_DIRECTORY，
server.py:1352-1354 挂载到 /extensions/luowen-phase0/）。

安装：复制本目录到 ComfyUI/custom_nodes/ 并重启。
卸载/验证：见 docs/phase0/（适配说明与兼容性风险清单）。
"""

# PRD §11.1：纯前端扩展，最小 Python 入口；无节点、无第三方依赖
WEB_DIRECTORY = "./web"

__all__ = ["WEB_DIRECTORY"]
