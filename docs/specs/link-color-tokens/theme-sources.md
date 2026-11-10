# 连线主题来源与 ThemeVault 对应关系

> 取色源：ThemeVault（`D:\Workspace\Code\ThemeVault`）。**只取底色与色相家族**；连线的明度/彩度由 `verify.mjs` 按对比度、色盲 ΔE、相邻色相门槛重算，不直接抄 palette hex。
> 关联：DEC-059 / DEC-060 / DEC-062 / DEC-063。

| LuoWen 主题 | 来源 | ThemeVault 编号 | 底色 / 卡片 | 说明 |
|---|---|---|---|---|
| `luowen-dark` | LuoWen 自有（ComfyUI Dark 量级） | — | `#141414` / `#353535` | **仅 token 母版**（不再出现在选择器；旧存档迁移到夜灯） |
| `luowen-cyberpunk` | 用户提供的旧 `cyberpunk.json`（宿主三段式调色板） | 非 ThemeVault（`#019 ergemd/cyberpunk` 仅同名风格，未取色） | `#0A0A1A` / `#1A1A3A` | 色相锚沿用旧 JSON（DEC-060 重排） |
| `luowen-nightlight` | **ThemeVault #001 erge/dark**（用户自有品牌） | **#001** | `#16120E` / `#241F1B` | **LuoWen 默认**；暖色主导、低蓝；DEC-062 |
| `luowen-jellyfish` | ThemeVault #057 jellyfish/dark | **#057** | `#00002C` / `#171520` | 霓虹粉/黄/青（DEC-063） |
| `luowen-solarized` | ThemeVault #137 opencode/solarized | **#137** | `#002B36` / `#073642` | Solarized Dark 色相（DEC-063） |
| `luowen-light` | ThemeVault **#002 erge/light**（用户自有品牌） | **#002** | `#FAF1E9` / `#FFFFFF` | 浅色主题（DEC-064）；旧「暗色」选项由它替代 |

## 对应口径

1. **底色/卡片**：取 ThemeVault `bg` / `card`（半透明 card 取不透明近似）。
2. **色相家族**：从该主题的 `accent` / `accent-secondary` / 功能色（ok/warn/danger/info/queued）/ 语法色（syntax-*）中选锚；允许为分离度微调色相。
3. **明度/彩度**：按门槛重算——常用类型至少满足 `ΔH ≥ 60°` 或 `ΔL ≥ 0.10`；对比度 canvas/card ≥3:1，色盲 ΔE ≥0.02。
4. **不直接使用** palette hex：ThemeVault 是 UI 调色板，没有“连线数据类型色”；直接抄会过不了门槛。

## 新增主题清单

1. `luowen-<id>.tokens.json`（`extends: luowen-dark`，覆盖 context/primitive/semantic 差异）
2. `verify.mjs` 的 `themes` 数组 + 运行 `--strict --emit-hex --out data`
3. `materialize.mjs` 的主题列表 + 重新生成 `materialized.js`
4. `index.js` 的 `ColorTheme` options / onChange 白名单 + `i18n.js` 名称
5. `tests/unit/linkColors.test.mjs` 的 `listThemes()` 期望
6. 本文件补一行来源；台账补 DEC 条目
