# 更新日志 — 络纹（LuoWen）

本项目所有值得注意的变更都记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
并且本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added

- 产品包 `luowen/`：纯前端连线路由扩展（`WEB_DIRECTORY` 最小服务端，不注册任何节点）
- 线路样式三选一：正交折线（A* 路由）/ 平滑圆角 / 原生渲染
- 节点避障：low / standard / high 三档净空，节点移动后自动重算（障碍哈希版本化 + 路由缓存失效）
- 同引脚多线 lane 阶梯分离（上行最贴引脚，pitch 5px）
- 总开关：关闭即刻回滚 ComfyUI 原生线路绘制；单线异常/A* 失败自动降级原生
- 前端单元测试 17 项（`node --test tests/unit/*.test.mjs`）：正交性、避障、反向连接、lane、缓存、trace 几何
- 文档 `docs/routing-algorithm.md`；MIT 复用的 Cable Management 几何内核登记于 `THIRD_PARTY_NOTICES.md`

### Fixed

- 障碍矩形坐标错误（`getBounding()` 已返回绝对坐标，之前重复叠加了 `pos`），导致线路从节点下方穿过
- 新增路由严格模式：节点框禁行；无净空路径的线自动降级原生，不再穿过节点
- 拖动节点时连接线保持正交（两折预览），不再变回贝塞尔曲线
- 悬停线路任意位置即高亮整条线（此前只有中心圆点可感知）

[Unreleased]: https://github.com/ErgeAIA/Comfyui-Luowen/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ErgeAIA/Comfyui-Luowen/releases/tag/v0.1.0
