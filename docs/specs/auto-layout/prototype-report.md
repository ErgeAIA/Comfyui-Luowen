# 自动布局 Phase D：真实画布原型报告 v1.0

> 分支 `auto-layout`，2026-11-08。原型探针 `.verify/p7/prototype/phase-d-proto.mjs`（页面级注入 ELK vendor bundle，**不改任何生产文件**）；截图 `proto-e1-*.png`/`proto-e2-local.png`/`proto-e3-after.png`；数据 `proto-result.json`。
> 样本：midGroups（23 节点/7 Group，主实验）、largeCollection（209 节点，大图实验）。ELK 参数与 Phase C 相同（LR + 端口 FIXED_SIDE）。

## 1. 硬约束机检（全部通过）

| 约束 | 方法 | 结果 |
|---|---|---|
| 拓扑不变 | `LuoWen.verify()`（布局后 diffs 空、位移如实进 moved） | ✅ 三实验全 ok（midGroups moved 23、e2 moved 21、largeCollection moved 209） |
| **可撤销** | **captureCanvasState 前后双采 + tracker.undo()** | ✅ **23/23 位置精确恢复**，verify ok（undoQueue 0→1 实证） |
| 幂等/确定性 | 同图二次布局逐位置比对 | ✅ 23/23 相同（ELK 确定性 + 输入不含坐标） |
| 固定节点不动 | 钉住 2 节点（首节点+最高度数）→ 子图布局 | ✅ fixedMoved=0、其余 21 节点重排 |
| 大图性能 | largeCollection 209 节点 | ✅ ELK 布局 95–117ms（一次性操作，非热路径） |
| 生命周期 | 探针结束 reload | ✅ `verify()` ok，无残留 |

## 2. 关键发现（修正 Phase A 假设）

1. **撤销真实链路**（Phase A 假设「`graph.beforeChange/afterChange` → undo」**被证伪**：实测该事务不产生 undo 记录）。真实机制 = Pinia `workflow` store → `activeWorkflow.changeTracker`：
   - `captureCanvasState()` 采用 **activeState 模型**：调用时把「上一个 activeState」压入 undoQueue——因此正确序列 = **布局前 capture + 布局后 capture（双采）**，undo() 才能弹出布局前状态；
   - `changeCount>0`（事务内）时 capture 被跳过——事务包裹反而有害；
   - 可达路径（运行时实证）：`app.extensionManager._p._s`（Pinia）→ `workflow` store → `activeWorkflow.changeTracker`；API：`captureCanvasState()/undo()/redo()`。
   - 语义：撤销为**整图快照恢复**（与我方已知「undo=loadGraphData 重建」口径一致），对自动布局即「整次布局 = 一条 undo」——恰满足 F-015「单条 undo」。
2. **折叠（智能尺寸）机制**：`node.collapse(true)` 置位 `collapsed` 标志（渲染收窄由宿主负责），**`node.size` 不自动变化**——布局要「智能缩小」必须显式写 size（如 [原宽, 标题高]），该写入经 Phase A 双向桥同步 layoutStore，属「pos+size」写入范畴。
3. ELK 输出坐标为绝对值（flat 图），直接可写 `pos`（Float64Array 索引写收敛，BUG-007 既证）。

## 3. 尺寸优化（用户需求）原型结论

- **收益模型**（可计算）：折叠一个 Note/说明节点节省 `size.h − 标题高(~30px)`；largeCollection 含 5 个 Note（原始高度由样本数据可得）→ 全折叠的画布高度收益 = Σ节省。Phase D 实测：单 Note [280,375] 折叠后渲染高度 ~30 → 单点节省 ~345px。
- **实现口径**（若批准）：`collapsed=true` + `size[1]=~30`（显式），随布局输出一并写入——超出 F-015「仅 pos」的边界，**需 PRD 修订（决策项）**：允许写入「折叠标志 + 折叠尺寸」，默认关闭、用户可选「整理时折叠说明节点」。
- **语义规则（未决）**：「哪些节点只需显示一点点」——MVP 建议**只折叠 Note/Markdown 类**（低风险、无计算语义）；通用节点的智能折叠（如无激活 widget 的节点）误判代价高，列为可选增强。**待用户拍板**。

## 4. 剩余风险与未决（进 Phase E）

1. 障碍规避后处理（局部场景 fixed 与新布局重叠）未实现——Phase E/实施轮首项。
2. 认知验证（人类可读性）样本不足——按任务书 §6 只能标注「尚未验证」，已交付盲测协议模板（motion-research §六 可复用）。
3. 环流工作流（反馈边）的视觉流向确认——本批样本折叠口径下全为 DAG，反向边归零，无环案例留待真实使用反馈。
