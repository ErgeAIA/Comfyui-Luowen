# 自动布局性能基准（F-015）

自动布局的耗时、扩展性与行为不变性测量工具。**结论与原始数据落 `docs/agents/performance.md`，本目录只放可复现入口。**

## 文件

| 文件 | 作用 |
|---|---|
| `bench-node.mjs` | Node 端全管线（mock LGraph，无 DOM → 无 effH）。模式：`golden` / `scale` / `one` |
| `golden-host.mjs` | 宿主真实 DOM 金标（需 ComfyUI 运行于 127.0.0.1:8188） |
| `summarize.mjs` | 汇总 `.verify/p8` 下的多次运行 → 阶段中位数 / 噪声带 / 幂指数 |

## 前置

- 样本：默认 `.verify/p7/samples`（`LUOWEN_SAMPLES` 覆盖）
- 宿主：默认 `D:/AIGC/ComfyUI_windows_portable/ComfyUI`（`LUOWEN_COMFY` / `LUOWEN_WORKFLOWS` / `LUOWEN_HOST_ENGINE` 覆盖）
- Playwright：优先本地 `playwright`，其次全局 npm 路径；浏览器自动挑最新 `chromium-*`（`LUOWEN_CHROMIUM` 覆盖）
- 输出：默认 `.verify/p8`（gitignored，`LUOWEN_PERF_OUT` 覆盖）

## 命令

```bash
# Node 全管线金标（无 DOM）
node scripts/layout-perf/bench-node.mjs golden .verify/p8/golden-node.json

# 规模矩阵：chain / fan-in / fan-out / dense / 多副本，100–2000 节点
node scripts/layout-perf/bench-node.mjs scale

# 单用例（chain 1000），用于 --cpu-prof
node --cpu-prof --cpu-prof-dir=.verify/p8/profiles scripts/layout-perf/bench-node.mjs one chain1000

# 宿主金标（真实 DOM，effH 生效）
node scripts/layout-perf/golden-host.mjs post .verify/p8/golden-host-post.json

# 汇总
node scripts/layout-perf/summarize.mjs
```

## 口径

- 默认设置：`columnAlign=auto`、`nodeGap=40`、`layerGap=60`、`inlineGap=50`、`componentLayout=vertical`、折叠关。
- 宿主金标协议：`loadGraphData` → fit（scale ≤ 0.9）→ 等 `.lg-node` DOM 就绪 → `autoLayout('full')` → 读 `node.pos`。
- 宿主探针在存在时会额外采集 `test1.json` / `test2.json` / `test3.json`（真实工作负载口径；其余大样本只作压力参照）。
- **噪声**：同机同图重复运行的 total 极差实测 9%–103%（含离群）；任何比较用 ≥3 次中位数，单次 A/B 不作数。
- **金标**：宿主路径的权威基线是 `tests/fixtures/layout-golden/host-path.json`；坐标变化即行为变化，除非用户批准布局改动。
- 阶段计时来自 `runAutoLayout().stages`（只读观测，不参与布局计算）。
