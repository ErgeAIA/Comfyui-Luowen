# Third-Party Notices（PRD §13.6 要求）

本文件登记仓库中每一个实际复制或改编的第三方代码/文件。

## ComfyUI Cable Management（已进入产品代码）

- **来源仓库**：https://github.com/vtokic/comfyui-cable-management （分支 master）
- **许可证**：MIT（Copyright (c) 2026 Vedran Aberle Tokić；完整许可文本已随包附带）
- **仓库内位置**：
  - `luowen/web/geometry/router.js`（上游 `web/pathing/router.js`）
  - `luowen/web/geometry/trace.js`（上游 `web/pathing/trace.js`）
- **修改情况**：`trace.js` 未修改（仅前置归属头）；`router.js` 由 LuoWen 增加可选 `strict` 与 `blockRects` 选项（节点框整体/定向禁行，默认关闭，不影响上游行为），其余逻辑逐字保留。文件头已注明修改范围。
- **许可文本**：`luowen/LICENSES/cable-management-MIT.txt`（含复用范围说明）
- **用途**：阶段 1 起作为正交路由（A*）与折线描边/中点几何内核。

## ComfyUI Cable Management（研究参考副本）

- **来源仓库**：https://github.com/vtokic/comfyui-cable-management （分支 master）
- **许可证**：MIT（Copyright (c) 2026 Vedran Aberle Tokić——以上游仓库 LICENSE/README 标注为准，复用进产品代码前须核验并附完整许可文本）
- **本仓库内位置**：`.research/ccm/`（逐字参考副本，含 `web/pathing/router.js`、`trace.js`、`nudge.js`、`registry.js`、`combs.js`、SCHEMA.md 等）
- **用途**：阶段 0 技术调研；其中 `router.js`/`trace.js`/`nudge.js` 为阶段 1 拟直接复用候选
- **修改情况**：未修改（原样副本）
- **复用条件**：MIT 许可要求保留上述版权与许可声明；产品化时将附完整 LICENSE 文本并在本文件更新登记
