// Luowen 前端扩展示例 —— 仅使用前端 1.55.18 实测存在的 API。
// 加载链：server 把 WEB_DIRECTORY 挂到 /extensions/ComfyUI-Luowen（server.py:1352-1354），
// 前端 GET /api/extensions 拿 js 清单后逐个动态 import（extensionService.loadExtensions）。
// 本文件在 web/js/ 下、比包根深一层，import 需上跳三级 —— VHS.core.js / Goohaitools
// 同款（扁平 web/ 的包如 rgthree 才用两级 ../../scripts/app.js）。
import { app } from "../../../scripts/app.js";

// 链式包装：不破坏节点已有的 onNodeCreated 等方法（VHS.core.js:6-14 同款思路）
function chainCallback(obj, prop, cb) {
    if (!obj) return;
    const orig = obj[prop];
    obj[prop] = function (...args) {
        const r = orig?.apply(this, args);
        cb.apply(this, args);
        return r;
    };
}

app.registerExtension({
    name: "ComfyUI-Luowen.Example",

    // 静态设置项写法（本模板不实际注册，避免在用户设置面板里留下示例项）：
    // 注册时即被 extensionService 消费（完整示例：KJNodes vue_combo.js / VHS VHS.core.js）。
    // settings: [
    //     {
    //         // 建议沿用既有 id，避免用户已保存的设置值失效
    //         id: "<扩展名>.<设置名>",
    //         name: "<显示名>",
    //         // 三级分类：第 1 段为导航项，第 2 段为页内分组，第 3 段为组内唯一键
    //         // 只用一段分类会让同组设置折叠成一项（见 docs/comfyui-dev-conventions.md §2.9）
    //         category: ["<扩展名>", "<组名>", "<唯一键>"],
    //         tooltip: "<说明>",
    //         type: "boolean", // boolean / number / combo / text 等
    //         defaultValue: false,
    //     },
    // ],

    // 每个节点类型注册前调用一次；nodeData.name 即服务端 NODE_CLASS_MAPPINGS 的 key
    // （KJNodes jsnodes.js:37、rgthree seed.js:138 同款入口）
    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name !== "LuowenExample") return;
        chainCallback(nodeType.prototype, "onNodeCreated", function () {
            // node.addWidget(type, name, value, callback, options)
            this.addWidget("button", "🎲 随机 seed", null, () => {
                const seed = this.widgets?.find((w) => w.name === "seed");
                if (seed) seed.value = Math.floor(Math.random() * 2 ** 31);
            });
        });
    },

    // 自定义 widget：服务端 INPUT_TYPES 出现同名类型（"LUOWEN_WIDGET"）时，
    // 前端调这里的工厂渲染 widget（VHS 的 VHSPATH 同款机制，VHS.core.js:2105-2166）。
    // 工厂必须自己把 widget 挂上 node.widgets 并返回。
    getCustomWidgets() {
        return {
            LUOWEN_WIDGET(node, inputName, inputData) {
                const w = {
                    name: inputName,
                    type: "LUOWEN_WIDGET",
                    value: inputData?.[1]?.default ?? 0,
                    options: { serialize: true }, // true：随工作流保存 & 进 API prompt
                    draw(ctx, node, widgetWidth, y, widgetHeight) {
                        ctx.save();
                        ctx.fillStyle = "#2a2a2a";
                        ctx.beginPath();
                        ctx.roundRect(8, y + 4, widgetWidth - 16, widgetHeight - 8, 6);
                        ctx.fill();
                        ctx.fillStyle = "#8ab4f8";
                        ctx.font = "12px sans-serif";
                        ctx.textAlign = "center";
                        ctx.fillText(
                            `luowen counter: ${w.value}`,
                            widgetWidth / 2,
                            y + widgetHeight / 2 + 4,
                        );
                        ctx.restore();
                    },
                    // 点击 +1；返回 true 表示事件已消费
                    mouse(event) {
                        if (event.type === "pointerdown" || event.type === "mousedown") {
                            w.value = (Number(w.value) || 0) + 1;
                            if (w.callback) w.callback(w.value);
                            return true;
                        }
                        return false;
                    },
                    computeSize(width) {
                        return [width, 26];
                    },
                };
                node.widgets.push(w);
                return w;
            },
        };
    },
});
