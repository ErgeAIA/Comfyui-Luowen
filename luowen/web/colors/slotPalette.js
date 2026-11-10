// 槽点调色板同步（DEC-061）：主题开启时把 62 类类型色写入宿主调色板，
// 让节点槽点圆点与连线同色；关闭/切换主题时原样还原宿主配色。
// 只接管 slot/link 取色层，不改节点卡片、标题、画布、菜单。
import { THEMES } from './materialized.js';

let hostSnapshot = null; // { byType: Map, ltc: Map, css: Map }
let applied = null;      // { byTypeKeys:Set, ltcKeys:Set, cssNames:Set }

function lgc() {
  return (typeof window !== 'undefined' && window.LiteGraph && window.LiteGraph.LGraphCanvas) || null;
}

/** 纯函数：主题的 62 类颜色表（便于单测）。 */
export function themeSlotColors(id) {
  const t = id && THEMES[id];
  return t ? { ...t.types } : null;
}

function captureHost(app, theme) {
  if (hostSnapshot) return;
  const canvas = app?.canvas;
  const byType = canvas?.default_connection_color_byType;
  const ltc = lgc()?.link_type_colors;
  const snap = { byType: new Map(), ltc: new Map(), css: new Map() };
  for (const type of Object.keys(theme.types)) {
    if (byType) snap.byType.set(type, Object.prototype.hasOwnProperty.call(byType, type) ? { had: true, value: byType[type] } : { had: false });
    if (ltc) snap.ltc.set(type, Object.prototype.hasOwnProperty.call(ltc, type) ? { had: true, value: ltc[type] } : { had: false });
    if (typeof document !== 'undefined' && type !== '*') {
      const name = `--color-datatype-${type.toUpperCase()}`;
      const style = document.documentElement.style;
      snap.css.set(name, { value: style.getPropertyValue(name), priority: style.getPropertyPriority(name) });
    }
  }
  hostSnapshot = snap;
}

export function applySlotPalette(app, themeId) {
  const theme = themeId && THEMES[themeId];
  if (!theme) { clearSlotPalette(app); return false; }
  // 切换主题：先还原宿主，再以宿主原值重新快照
  if (hostSnapshot) clearSlotPalette(app);
  captureHost(app, theme);
  const canvas = app?.canvas;
  const byType = canvas?.default_connection_color_byType;
  const ltc = lgc()?.link_type_colors;
  applied = applied ?? { byTypeKeys: new Set(), ltcKeys: new Set(), cssNames: new Set() };
  for (const [type, hex] of Object.entries(theme.types)) {
    if (byType) { byType[type] = hex; applied.byTypeKeys.add(type); }
    if (ltc) { ltc[type] = hex; applied.ltcKeys.add(type); }
    if (typeof document !== 'undefined' && type !== '*') {
      const name = `--color-datatype-${type.toUpperCase()}`;
      document.documentElement.style.setProperty(name, hex);
      applied.cssNames.add(name);
    }
  }
  canvas?.setDirty?.(true, true);
  return true;
}

export function clearSlotPalette(app) {
  if (!hostSnapshot) return false;
  const canvas = app?.canvas;
  const byType = canvas?.default_connection_color_byType;
  const ltc = lgc()?.link_type_colors;
  for (const [type, prev] of hostSnapshot.byType) {
    if (!byType) break;
    if (prev.had) byType[type] = prev.value; else delete byType[type];
  }
  for (const [type, prev] of hostSnapshot.ltc) {
    if (!ltc) break;
    if (prev.had) ltc[type] = prev.value; else delete ltc[type];
  }
  if (typeof document !== 'undefined') {
    const style = document.documentElement.style;
    for (const [name, prev] of hostSnapshot.css) {
      if (prev.value) style.setProperty(name, prev.value, prev.priority); else style.removeProperty(name);
    }
  }
  hostSnapshot = null;
  applied = null;
  canvas?.setDirty?.(true, true);
  return true;
}
