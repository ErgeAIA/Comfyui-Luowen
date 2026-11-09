# 自动布局行为金标（宿主路径）

宿主 ComfyUI 0.43.2 + comfyui-frontend-package 1.55.18；设置 `columnAlign=auto`、`nodeGap=40`、`layerGap=60`、`inlineGap=50`、`componentLayout=vertical`、折叠关。

| 文件 | 样本 | 基线 | 用途 |
|---|---|---|---|
| `user-tests.json` | test1/2/3（14–56 节点） | `c511e1e` | **真实工作负载**回归金标 |
| `host-path.json` | 6 份大样本 + midGroups×3 | `2b850e0`（插桩前） | 压力/回归参照（含大量 Reroute / Set/Get / 人工注释，不作优化目标） |

- **内容**：节点左上角坐标与 SHA1-16 哈希；含渲染真实高度 `effH` 的影响。
- **大样本基线说明**：`2b850e0` 的 `engine.js` 为性能插桩之前版本；插桩前后 7/7 哈希与坐标逐点一致。
- **复现**：`node scripts/layout-perf/golden-host.mjs <label> <out.json>`（要求宿主运行、样本文件名带 `LW样本-` 前缀）。
- **规则**：任一坐标变化都视为行为变化；除非用户明确批准布局改动，否则按回归处理。
- **样本漂移**：`inputSha256_16` 记录生成时的工作流文件哈希；若宿主样本被编辑，先核对哈希再判断是回归还是样本漂移。
