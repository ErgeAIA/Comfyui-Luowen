# Third-Party Notices（PRD §13.6 要求）

本文件登记仓库中每一个实际复制或改编的第三方代码/文件。

## elkjs（自动布局候选算法，预构建产物）

- **来源仓库**：https://github.com/kieler/elkjs （npm 包 `elkjs@0.9.3`，Eclipse Layout Kernel 的 JS 移植）
- **许可证**：EPL-2.0（完整许可文本 `luowen/web/vendor/LICENSE-elkjs.md`）
- **仓库内位置**：`luowen/web/vendor/elk.bundled.js`（官方预构建 bundle，未修改）
- **修改情况**：未修改（原样副本）
- **用途**：自动布局阶段 C 的对照算法（ELK Layered）；终选若为自研，本条目随 vendor 产物一并移除
- **更新策略**：仅手动升级（重新 npm 拉取后覆盖 bundle），版本号在本条目更新

## dagre（自动布局候选算法，预构建产物）

- **来源仓库**：https://github.com/dagrejs/dagre （npm 包 `dagre@0.8.5`）
- **许可证**：MIT（完整许可文本 `luowen/web/vendor/LICENSE-dagre.txt`）
- **仓库内位置**：`luowen/web/vendor/dagre.min.js`（官方 dist，未修改）
- **修改情况**：未修改（原样副本）
- **用途**：自动布局阶段 C 的对照算法（分层布局）；终选若为自研，本条目随 vendor 产物一并移除
- **更新策略**：仅手动升级

## ComfyUI Cable Management（已进入产品代码）

- **来源仓库**：https://github.com/vtokic/comfyui-cable-management （分支 master）
- **许可证**：MIT（Copyright (c) 2026 Vedran Aberle Tokić；完整许可文本已随包附带）
- **仓库内位置**：
  - `luowen/web/geometry/router.js`（上游 `web/pathing/router.js`）
  - `luowen/web/geometry/trace.js`（上游 `web/pathing/trace.js`）
- **修改情况**：`trace.js` 由 LuoWen 把固定 `RADIUS=10` 改为调用方可传参的圆角半径上限（默认 10 保持不变，夹取规则 `min(设定值, 相邻段各 1/3)` 未变），其余逻辑逐字保留；`router.js` 由 LuoWen 增加可选 `strict` 与 `blockRects` 选项（节点框整体/定向禁行，默认关闭，不影响上游行为），其余逻辑逐字保留。文件头已注明修改范围。
- **许可文本**：`luowen/LICENSES/cable-management-MIT.txt`（含复用范围说明）
- **用途**：阶段 1 起作为正交路由（A*）与折线描边/中点几何内核。

## ComfyUI Cable Management（研究参考副本）

- **来源仓库**：https://github.com/vtokic/comfyui-cable-management （分支 master）
- **许可证**：MIT（Copyright (c) 2026 Vedran Aberle Tokić——以上游仓库 LICENSE/README 标注为准，复用进产品代码前须核验并附完整许可文本）
- **本仓库内位置**：`.research/ccm/`（逐字参考副本，含 `web/pathing/router.js`、`trace.js`、`nudge.js`、`registry.js`、`combs.js`、SCHEMA.md 等）
- **用途**：阶段 0 技术调研；其中 `router.js`/`trace.js`/`nudge.js` 为阶段 1 拟直接复用候选
- **修改情况**：未修改（原样副本）
- **复用条件**：MIT 许可要求保留上述版权与许可声明；产品化时将附完整 LICENSE 文本并在本文件更新登记
