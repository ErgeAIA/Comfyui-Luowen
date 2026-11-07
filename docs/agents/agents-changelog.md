---
title: AGENTS.md Changelog
type: agents-changelog
project: 络纹（LuoWen）
updated: 2026-11-07
description: >
  AGENTS.md 的变更记录，AGENTS.md 每改动一次就追加一行，不随日常开发更新。
  只追加，不删除或改写历史。AI 在本文件新增或修改任何条目后，必须同步更新 frontmatter 的 updated 字段为当日日期（YYYY-MM-DD）。
---

# AGENTS.md Changelog

> **AGENTS.md 每改动一次，必须在此追加一行**；无对应记录即视为静默丢失。
> 模式：半程合成
> 来源文件：无（项目根无 AGENTS.md / CLAUDE.md / .cursorrules / GEMINI.md，agent 点目录均不存在）
> 格式：一行一条 `<旧值> → keep|update|drop|merge → <新值/去处/原因>`
> 全新初始化无旧约定可处置时，写一行 `<无旧约定> → 全新初始化 → 直建当前 AGENTS.md`

---

- `<无标准契约文件> → 半程合成 → 直建当前 AGENTS.md；既有约定（PRD 硬约束 §0/§2.3/§9/§10/§18、GLOSSARY.md、docs/comfyui-dev-conventions.md、template/ComfyUI-Luowen/）以 keep 原地保留 + AGENTS.md 指针方式收编，无 update/drop/merge`
- `IMPORTANT 行产品名 落纹（LuoWen） → update → 络纹（LuoWen）：用户裁决产品中文名为"络纹"（全局 38 处同步，PRD/README/CHANGELOG 双语/过程文档/phase0 原型注释一并更新，见 decision-log DEC-004）`
- `Commands 表 3 行（无前端测试命令） → update → 新增「前端单元测试：node --test tests/unit/*.test.mjs」：阶段 1 引入 tests/ 后登记实际可用命令；Windows 上 node --test 传目录会 MODULE_NOT_FOUND，必须显式 glob`
- `Commands 表「前端单元测试」来源列「阶段 1 引入（glob 必需…）」 → update（N4 删日期化出处，保留规则本体） → 现为「glob 必需：Windows 上 node --test 传目录会 MODULE_NOT_FOUND」`
- `Toolchain 表缺前端单测运行时 → update（事实回填） → 新增「Node（前端单测运行时） | 24.22.1 | PATH（node --version）」`
- `References 缺路由算法现状文档指针 → update → 新增「改路由几何 / 核对阶段 1–2 实现现状与实测记录 → 见 docs/routing-algorithm.md」：该文档为阶段 1–2 实现与实测的 spec-of-record，此前只能靠 project-progress 反查`
- `Permissions 无性能验收义务 → update → 新增「YOU MUST 性能与视觉效果并列为验收维度；性能结论须附测量方法、样本布局与数据并写入 docs/agents/performance.md，未测量不得宣称达标」：用户 2026-11-07 明确将性能纳入验收`
- `Conventions 无性能结论落点约定 → update → 新增「性能结论有固定落点」行（写 docs/agents/performance.md，三要素齐全才可下结论，只追加）`
- `References 缺性能验收指针 → update → 新增「性能验收 / 查基准方法 → 见 docs/agents/performance.md」`
- `References 缺连线配色与组交互规格指针 → update → 新增两条：docs/specs/link-color-tokens/（尚未接入代码）、docs/specs/trunk-group-interaction/（组高亮 + 组删除，DEC-021 口径）`
- `References 缺兼容性与第三方共存指针 → update → 新增「查兼容性与生命周期验收 / 第三方共存冲突面 → 见 docs/agents/compatibility-matrix.md」：该文档已成阶段 3 验收与 19 条冲突面的唯一落点，此前只能靠 project-progress 反查`
- `Permissions「禁止自动节点布局、工作流语义分析、通用插件市场（PRD §2.3）」 → update → 「禁止工作流语义分析、通用插件市场（PRD §2.3）；节点自动布局已纳入范围（F-015/DEC-038），实现须用户主动触发、可撤销、不在渲染热路径运行」：用户 2026-11-07 拍板将自动布局从非目标纳入范围，PRD §2.3/§4.2/§4.3 同步修订；实现另行排期（在 A smooth Bezier / B 配色主题 / C fixture / D 性能之后）`
