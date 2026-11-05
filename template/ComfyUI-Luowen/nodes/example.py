"""Luowen 示例节点 —— 旧式（V1）契约的活体模板。

每段契约都标注了它在 ComfyUI v0.43.2 源码里的读取位置（本机 checkout），
完整语义见 docs/comfyui-dev-conventions.md；标注 [n/7] 表示该写法在本机
7 个成熟节点包中被 n 个采用（交叉验证细节见同文档 §5）。
"""


class LuowenExample:
    """演示完整 V1 节点契约的最小节点：按模式加工 text 后返回。

    mapping key 与类名保持一致（KJNodes/GGUF 派做法）；display 名走
    NODE_DISPLAY_NAME_MAPPINGS（显式 dict，6/7 包采用）。
    """

    @classmethod
    def INPUT_TYPES(cls) -> dict:
        """类方法（comfy/comfy_types/node_typing.py:253-265）。

        返回三段结构 required / optional / hidden
        （声明见 node_typing.py:200-206，解析见 comfy_execution/graph.py:94-109）。
        """
        return {
            "required": {
                # STRING：服务端只做 str() 强转（execution.py:1012-1014）；
                # multiline/dynamicPrompts/placeholder 等是纯前端 key，
                # 服务端不解析，经 /object_info 原样透传给前端（node_typing.py:95-169）
                "text": ("STRING", {
                    "default": "",
                    "multiline": True,
                    "tooltip": "输入文本",
                }),
                # FLOAT/INT：min/max 是仅有的两个服务端会主动校验的 UI key
                # （execution.py:1034-1059，越界报 value_smaller_than_min 等）
                "strength": ("FLOAT", {
                    "default": 1.0, "min": 0.0, "max": 10.0,
                    "step": 0.01, "round": 0.01,
                    "tooltip": "0-10 的强度",
                }),
                # COMBO：选项列表即类型本身；服务端校验成员资格
                # （execution.py:1061-1094；>20 项时不回显列表 1077-1081）
                "mode": (["append", "upper", "repeat"], {"default": "append"}),
                "enabled": ("BOOLEAN", {
                    "default": True,
                    "label_on": "开", "label_off": "关",
                }),
            },
            "optional": {
                # INT + control_after_generate 是"种子"惯例组合
                # （control_after_generate 是纯前端行为，核心用例 nodes.py:1612）
                "seed": ("INT", {
                    "default": 0, "min": 0, "max": 2**31 - 1,
                    "control_after_generate": True,
                }),
                # 自定义类型 = 任意字符串，socket 按"类型字符串集合求交集"匹配
                # （comfy_execution/validation.py:193-246；IO.ANY="*" 双向放行）。
                # 这里故意声明自定义类型 LUOWEN_WIDGET：前端 getCustomWidgets
                # 用同名工厂把它渲染成 widget（web/js/luowen.js），VHS 的 VHSPATH 同款机制
                "counter": ("LUOWEN_WIDGET", {"default": 0}),
            },
            # hidden：把执行上下文注入函数，不出现在 UI（execution.py:216-234，共 8 种）。
            # 注意：声明 UNIQUE_ID 会把 node_id 加进缓存键（caching.py:118）→ 每个实例独立缓存。
            # "hidden": {"unique_id": "UNIQUE_ID"},
        }

    RETURN_TYPES = ("STRING",)      # 链接类型校验 execution.py:948；object_info server.py:851
    RETURN_NAMES = ("text",)        # 仅进 /object_info（server.py:853），供前端显示出口名
    FUNCTION = "run"                # 执行入口方法名（execution.py:353）；协程方法也可（async 节点）
    CATEGORY = "Luowen"             # 顶层 = 包命名空间 [7/7]；缺省值是 'sd'（server.py:858）
    DESCRIPTION = "Luowen 模板示例节点：演示完整 V1 契约。"

    # —— 可选契约（默认注释；要启用时取消注释并删除重复定义）——
    # OUTPUT_NODE = True          # 输出节点：调度优先（comfy_execution/graph.py:329），
    #                             # 结果走 ui 通道（server.py:859-862，见 LuowenSaveText）
    # NOT_IDEMPOTENT = True       # node_id 进缓存键 → 同一节点每个实例各自缓存（caching.py:118）
    # INPUT_IS_LIST = True        # 输入按列表收到（前端批量连线，execution.py:254）
    # OUTPUT_IS_LIST = (False,)   # 返回值按列表展开合并（execution.py:335-336）
    # DEPRECATED = True           # UI 标灰提示（server.py:875-878，均为 getattr 默认 False）
    # EXPERIMENTAL = True
    # SEARCH_ALIASES = ["luowen"]  # 前端搜索别名（server.py:885，0.43 新属性）
    # OUTPUT_TOOLTIPS = ["结果文本"]  # 出口 tooltip（server.py:872-873）

    def run(self, text: str, strength: float, mode: str, enabled: bool,
            seed: int = 0, counter: int = 0) -> tuple:
        """FUNCTION 指向的方法：按 INPUT_TYPES 的输入名以 kwargs 收值。"""
        if not enabled:
            return (text,)
        if mode == "upper":
            return (text.upper(),)
        if mode == "repeat":
            return (text * max(1, int(strength)),)
        return (f"{text} [luowen s={strength:.2f} seed={seed} counter={counter}]",)

    # —— 校验：入队时执行（server.py:1204 → execution.py:1096-1129）。
    # 返回 True 通过；返回 False / 字符串 = 失败（字符串成为错误详情）。
    # 只接收签名里声明的参数；链接输入在这里看到 (None,)——拿不到上游值！
    # def VALIDATE_INPUTS(self, strength):
    #     if strength < 0:
    #         return "strength 不能为负"
    #     return True

    # —— 缓存指纹：只用"常量输入"求值（execution.py:87，链接不解析），
    # 返回值直接进缓存签名（caching.py:117）；相同 → 命中缓存跳过执行；
    # 返回 NaN（异常时自动如此）→ 每次重跑。LoadImage 用它返回文件 sha256（nodes.py:1808-1813）。
    # def IS_CHANGED(self, text, strength, mode, enabled, **kwargs):
    #     import hashlib
    #     return hashlib.sha256(f"{text}|{strength}|{mode}|{enabled}".encode()).hexdigest()

    # —— 惰性求值：返回"尚未就绪的输入名"列表（配合输入声明 "lazy": True）；
    # 流程 execution.py:508-523。V3 对应同名方法，默认返回所有为 None 的 kwargs。
    # def check_lazy_status(self, text, **kwargs):
    #     return [] if text is not None else ["text"]


class LuowenSaveText:
    """输出节点示例：把文本写进 ComfyUI output 目录（演示 OUTPUT_NODE 契约）。"""

    OUTPUT_NODE = True       # server.py:859-862 下发；执行结果走 ui 通道（execution.py:1183）
    RETURN_TYPES = ()
    FUNCTION = "save"
    CATEGORY = "Luowen"
    DESCRIPTION = "把输入文本保存为 output 目录下的 .txt 文件。"

    @classmethod
    def INPUT_TYPES(cls) -> dict:
        return {
            "required": {
                # forceInput：让前端把 widget 渲染成输入 socket（node_typing.py:111-112，
                # 纯前端行为；defaultInput 已 deprecated，勿用）
                "text": ("STRING", {"forceInput": True}),
                "filename_prefix": ("STRING", {"default": "luowen"}),
            },
            # hidden 声明后：函数收到本节点 id 字符串（execution.py:216-234）；
            # 同时 node_id 进入缓存键（caching.py:118）——SaveImage 正是这么声明 prompt/extra_pnginfo
            "hidden": {"unique_id": "UNIQUE_ID"},
        }

    def save(self, text: str, filename_prefix: str, unique_id: str = "") -> dict:
        import os

        import folder_paths  # ComfyUI 核心模块，进程内必可用

        out_dir = folder_paths.get_output_directory()
        path = os.path.join(out_dir, f"{filename_prefix}_{unique_id}.txt")
        with open(path, "w", encoding="utf-8") as f:
            f.write(text or "")
        # 输出节点返回 ui/result 字典；ui 部分经 WebSocket 送前端，result 进执行链
        return {"ui": {"string": [text or ""]}, "result": ()}
