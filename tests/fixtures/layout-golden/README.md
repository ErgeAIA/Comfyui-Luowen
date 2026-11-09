# 自动布局行为金标（宿主路径）

- **基线**：commit `2b850e0` 的 `luowen/web/layout/engine.js`（性能插桩之前），宿主 ComfyUI 0.43.2 + comfyui-frontend-package 1.55.18。
- **内容**：6 份真实样本 + `midGroups ×3` 的节点左上角坐标与 SHA1-16 哈希；含渲染真实高度 `effH` 的影响。
- **设置**：`columnAlign=auto`、`nodeGap=40`、`layerGap=60`、`inlineGap=50`、`componentLayout=vertical`、折叠关。
- **复现**：`node scripts/layout-perf/golden-host.mjs <label> <out.json>`（要求宿主运行、样本文件名带 `LW样本-` 前缀）。
- **规则**：任一坐标变化都视为行为变化；除非用户明确批准布局改动，否则按回归处理。
- **样本漂移**：`inputSha256_16` 记录生成时的工作流文件哈希；若宿主样本被编辑，先核对哈希再判断是回归还是样本漂移。
