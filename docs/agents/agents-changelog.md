---
title: AGENTS.md Changelog
type: agents-changelog
project: 络纹（LuoWen）
updated: 2026-11-06
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
