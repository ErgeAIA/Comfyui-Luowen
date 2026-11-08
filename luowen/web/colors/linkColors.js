// 连线配色主题（DEC-029 / docs/specs/link-color-tokens/）：语义 token → renderLink stroke。
// 纯函数模块（可在 Node 单测）：主题关闭返回 null，适配器回退原取色链（原生 color || #94a3b8）。

import { THEMES } from './materialized.js';

let themeId = null;
const ruleCache = new Map();

export function setTheme(id) {
  themeId = id && THEMES[id] ? id : null;
  return themeId;
}

export function getTheme() {
  return themeId;
}

export function listThemes() {
  return Object.keys(THEMES);
}

export function themeInfo(id = themeId) {
  const t = id && THEMES[id];
  return t ? { id: t.id, name: t.name, context: t.context, width: t.width, typeCount: Object.keys(t.types).length } : null;
}

function compiledRules(theme) {
  let rs = ruleCache.get(theme.id);
  if (!rs) {
    rs = (theme.typeRules ?? []).map((r) => ({ re: new RegExp(r.pattern), token: r.token }));
    ruleCache.set(theme.id, rs);
  }
  return rs;
}

// 主题关闭 → null；link.type 优先命中 62 类显式映射 → 宿主升级后的新类型走 13 条有序正则 → link.unknown。
export function resolveLinkColor(link) {
  if (!themeId) return null;
  const theme = THEMES[themeId];
  const t = link && link.type != null ? String(link.type) : '';
  if (t) {
    const hit = theme.types[t];
    if (hit) return hit;
    for (const { re, token } of compiledRules(theme)) {
      if (re.test(t)) return theme.tokens[token] ?? theme.tokens['link.unknown'] ?? null;
    }
  }
  return theme.tokens['link.unknown'] ?? null;
}

// 流向动效（spec §6）：enabled=用户设置（默认关闭）；prefers-reduced-motion 与缩放 ≤0.4 强制关闭。
// 返回 null = 本帧画实线；非 null = 以 dash/gap/speed 沿路径行进（源→目标）。
export function flowParams({ enabled = false, scale = 1, reducedMotion = false } = {}) {
  if (!themeId || !enabled || reducedMotion) return null;
  if (!(Number(scale) > 0.4)) return null;
  const f = THEMES[themeId].flow ?? {};
  const dash = Number(f.dash) || 7;
  const gap = Number(f.gap) || 13;
  return { dash, gap, speed: Number(f.speed) || 48, opacity: Number.isFinite(Number(f.opacity)) ? Number(f.opacity) : 0.92, period: dash + gap };
}

// 动效门禁（v2，DEC-040）：mode=all/selected/executing；生成时禁用开关优先于一切。
// 返回 true = 该线本帧可动（具体线型由适配器绘制）；false = 画实线。
export function shouldAnimate({ mode = 'all', link, selectedIds, executingNode, queueRunning = false, disableAnimOnRun = true, enabled = false, scale = 1, reducedMotion = false, hostAnimationsDisabled = false } = {}) {
  if (!enabled) return false;
  // 主题不作为闸门（用户反馈「所有动效都不生效」）：主题关时对当前描边色（原生 color || #94a3b8）照样动效
  if (reducedMotion || hostAnimationsDisabled) return false;
  if (!(Number(scale) > 0.4)) return false;
  if (queueRunning && disableAnimOnRun) return false;
  const touches = (id) => link && id != null && (String(link.origin_id) === String(id) || String(link.target_id) === String(id));
  if (mode === 'selected') {
    if (!selectedIds || !selectedIds.size) return false;
    let hit = false;
    for (const id of selectedIds) if (touches(id)) { hit = true; break; }
    if (!hit) return false;
  } else if (mode === 'executing') {
    if (executingNode == null || !touches(executingNode)) return false;
  }
  return true;
}

// 虚线相位：屏幕恒速口径（spec §6.2 修订，DEC-040 补充）——speed 为屏幕像素/秒，
// 除以当前缩放换算成图坐标位移，任何缩放下视觉速度一致。
export function dashOffset({ now, speed, scale = 1, period }) {
  const sc = Number(scale) > 0.05 ? Number(scale) : 0.05;
  return (-((Number(now) / 1000) * Number(speed)) / sc % period) || 0;
}
