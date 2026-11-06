# 绘制 API 适配说明与已验证版本（PRD 阶段 0 交付物）

> **状态**：阶段 0 已完成实测验证（2026-11-06）。本文是络纹接管线路绘制的权威技术依据，行号引用基于本机安装的 **comfyui-frontend-package 1.55.18** sourcemap（内嵌完整 TypeScript 原文，与运行版本逐字一致）。
> 实测代码：`prototype/luowen-phase0/`（已装至本机 `custom_nodes\luowen-phase0\`）；验证记录见 §5 与 `.verify/` 截图。

## 1. 已验证版本

| 项 | 版本 | 备注 |
|---|---|---|
| ComfyUI | v0.43.2 | `D:\AIGC\ComfyUI_windows_portable` |
| comfyui-frontend-package | **1.55.18**（实际安装） | requirements 声明 1.57.4 未重装；API 结论以 1.55.18 为准 |
| 验证宿主 GPU | RTX 5080 / torch 2.14.0+cu130 | 经典画布 + Nodes 2.0 双形态实测 |

## 2. 线路绘制调用链（1.55.18 实测）

```
LGraphCanvas.draw (LGraphCanvas.ts:4970)
  → drawBackCanvas:5616 / drawFrontCanvas:5173   ← drawConnections 两处调用
    → _renderAllLinkSegments:6299
      → renderLink:6492                           ← ★ 络纹 wrap 点
        → linkRenderer.renderLinkDirect           (litegraphLinkAdapter.ts:198-361)
          → CanvasPathRenderer.drawLink           (pathRenderer.ts:93-166)
              mode: linear→buildLinearPath / straight→buildStraightPath / spline→buildSplinePath
```

**renderLink 签名**（LGraphCanvas.ts:6492-6519）：

```ts
renderLink(ctx, a, b, link, skip_border, flow, color, start_dir, end_dir,
           { startControl?, endControl?, reroute?, num_sublines?=1, disabled?=false })
```

- `a`/`b`：起终点（graph 坐标）；`link: LLink | null`（**null = 拖拽预览线**）
- `start_dir/end_dir`：0 NONE / 1 UP / 2 DOWN / 3 LEFT / 4 RIGHT / 5 CENTER
- `opts.reroute` 非空时该调用是 reroute 共享段，`seg = opts.reroute ?? link`
- 形状由 `canvas.links_render_mode`（LinkRenderType，构造默认 SPLINE=2；`-1` HIDDEN 时整链跳过）经 `buildLinkRenderContext():6456` 传入——**官方 `Comfy.LinkRenderMode` 设置即"每帧读画布属性、零数据改动"的先例**（coreSettings.ts:685 → useLitegraphSettings.ts:74）

## 3. 命中测试机制（决定"改绘制 ⇒ 必须覆写渲染产物"）

1.55.18 **无** `getLinkAtPoint`。命中分两层，全部读**上帧渲染产物**：

- **几何命中（权威）**：`queryRenderedLinkSegmentsAtPoint`（hitTesting.ts:31-61）遍历 `canvas.renderedPaths`（Set）→ `ctx.isPointInStroke(segment.path, x*dpr, y*dpr)`，容差 = `connections_width + 7`。
- **中心命中**：`_getLinkCentreOnPos`（LGraphCanvas.ts:5196-5209）对 `segment._pos` 做 8×8 判定 → 线上右键菜单/悬停 tooltip 锚点。
- 渲染器把 `Path2D` 写进 `linkSegment.path`（litegraphLinkAdapter.ts:309-311）、中心写进 `linkSegment._pos`（313-323）。

**推论（已实测证实）**：自定义渲染改变可见形状后，**必须把自建 Path2D 覆写回 `seg.path`、中心覆写回 `seg._pos`**——命中立即跟随，无需自己实现命中测试。`path`/`_pos` 是纯渲染产物，覆写不触碰图数据（数据不变性实测通过）。

## 4. 络纹适配方案（prototype/luowen-phase0 已验证）

**单点 wrap：`LGraphCanvas.prototype.renderLink`**，经 `Object.getPrototypeOf(app.canvas)` 获取（不依赖全局导出名，不碰会随 `setGraph` 重建的 `linkRenderer` 实例——实例级 wrap 进出子图即失效）。

| 环节 | 做法 |
|---|---|
| 能力检测 | `app.canvas` 存在 + `proto.renderLink` 为函数 + `canvas.linkRenderer.renderLinkDirect` 为函数；失败→不安装、保持原生并告警 |
| 安装 | 保存 `originalRenderLink`；wrap 挂 `luowen_wrapped` 标记防双包 |
| 绘制 | native/拖拽预览（`link==null`）/floating（`id<0`）/bypass（`disabled`）→ 原函数直通；orthogonal → 自建折线 Path2D + 中心点，**覆写 `seg.path`/`seg._pos`** |
| 异常隔离 | 单线 try/catch，失败回退原函数并只告警一次（防刷屏） |
| 回滚 | `uninstall()` 还原原型属性（仅当仍是我们自己的 wrap）；实测视觉恢复原生贝塞尔 |
| 子图 | 原型层 wrap 自动覆盖根图与全部子图（全前端唯一 LGraphCanvas 实例换 graph；`app.graph` 已废弃，活动图取 `app.canvas.graph`） |
| 数据不变性 | 扩展提供 `LuoWenPhase0.rebase()/verify()`（link 五元组快照比对），实测切换/拖拽/删除全程零图改动 |

## 5. 实测验证记录（2026-11-06，截图在 `.verify/`）

| # | 验证 | 结果 | 证据 |
|---|---|---|---|
| 1 | 扩展加载 + 能力检测 | ✅ | `status(): installed=true, capability.ok=true` |
| 2 | 原生↔正交切换 | ✅ | `phase0_orthogonal.png`（直角肘形+中心点）vs `phase0_rollback_native.png`（贝塞尔） |
| 3 | 数据不变性 | ✅ | 切换/拖拽全程 `verify(): ok`；删除时精确报 `link-removed: 75` |
| 4 | 节点拖拽跟随 | ✅ | UNet 节点位移 (-240,110)→(-173,154)，线路逐帧跟随 |
| 5 | 命中→菜单→删除 | ✅ | 右键自绘线段 → 原生线上菜单（隐藏连线/Add Node/Add Reroute/Delete/Convert to Set/Get）→ Delete 生效 |
| 6 | ghost 防护 | ✅ | 删除后 `renderedPaths` 残留 = 0 |
| 7 | 回滚/重入 | ✅ | `uninstall()` 恢复原生；`install()` 可重入（防双包生效） |
| 8 | Nodes 2.0 兼容 | ✅ | `Comfy.VueNodes.Enabled=true` 重载后 `capability OK`，orthogonal 正常渲染（`phase0_nodes2_orthogonal.png`：Vue 节点 + 正交线同框） |
| 9 | 悬停（合成鼠标） | ⚠️ 见风险清单 R1 | 原生/自定义同构：合成事件不激活 `over_link_center`（`processMouseMove` 在 1.55.18 指针门面下不执行，pm=4/pmm=0 实测）；匹配器直接调用秒中（`_getLinkCentreOnPos({canvasX:180.5,canvasY:124}) → 72`） |

## 6. 已知限制（demo 形态）

- 正交样例是 O(1) 单拐肘形（stub=12），无避障/分道/共享树——那是阶段 1/2 的算法内容，本阶段只验证"接管能力"
- 流动小圆点动画（`drawFlowAnimation`，pathRenderer.ts:520）固定走贝塞尔数学，自定义路径下未复刻（数据无关，纯视觉）
- 线宽/颜色取自参数直通（`color` 非字符串时回退 `#94a3b8`）；选中态高亮未实现（demo 范围）
- reroute 共享段按独立段处理（每段 a/b 已是段端点），未做连续性保证——阶段 1 课题
