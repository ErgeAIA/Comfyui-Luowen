"""节点注册聚合。加载与失败表现见 docs/comfyui-dev-conventions.md §2.6。"""
from .example import LuowenExample, LuowenSaveText

NODE_CLASS_MAPPINGS = {
    # key = 全局唯一节点名（进入 /object_info 与前端节点搜索）；value = 实现类。
    # 全局命名空间唯一性自负：发布前先确认无撞名（撞名时后加载包的节点被内建/先载包遮蔽，
    # nodes.py:2367 会把已加载节点名传进 ignore 集合保护内建）。
    # 想让"发布名 ≠ 类名"可学 Impact-Pack（__init__.py:202 "ImpactSwitch": GeneralSwitch）。
    "LuowenExample": LuowenExample,
    "LuowenSaveText": LuowenSaveText,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    # 仅影响 UI 显示名（server.py:853 下发，前端展示）；省略时前端回退用 key。
    "LuowenExample": "Luowen Example",
    "LuowenSaveText": "Luowen Save Text",
}
