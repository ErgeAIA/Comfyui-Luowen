#!/usr/bin/env node
/**
 * LuoWen 连线 token 复算脚本（零依赖）
 *
 *   node verify.mjs                     # 校验 luowen-dark + luowen-cyberpunk，输出摘要
 *   node verify.mjs --out data          # 另写出 contrast.md / cvd-matrix.csv / coverage.md
 *   node verify.mjs --object-info <path># 额外检查 208 个输出类型的外推映射
 *   node verify.mjs --strict            # 任一门禁失败则退出码 1
 *
 * 所有公式为公开标准实现，不依赖任何 npm 包：
 *   OKLCH<->sRGB      Björn Ottosson (https://bottosson.github.io/posts/oklab/)
 *   WCAG 2.x          relative luminance, 非文本对比度 3:1
 *   ΔE_OK             Oklab 欧氏距离
 *   CVD 仿真          Machado 2009 severity 1.0 矩阵，在线性 sRGB 上作用
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, 'data');
const GATE = { contrast: 3.0, deltaE: 0.02, hueAdjacent: 0.02, jnd: 0.02 };

// ---------- 颜色科学（标准公式，见文件头）----------
const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

function oklchToLinearRgb(L, C, Hdeg) {
  const h = (Hdeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
}

const inGamut = (L, C, H) => oklchToLinearRgb(L, C, H).every((v) => v >= -0.0005 && v <= 1.0005);

function oklchToHex(L, C, H) {
  const lin = oklchToLinearRgb(L, C, H);
  const bytes = lin.map((v) => {
    const clamped = Math.min(1, Math.max(0, v));
    return Math.round(Math.min(1, Math.max(0, linearToSrgb(clamped))) * 255);
  });
  return '#' + bytes.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
}

const hexToLinearRgb = (hex) => {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => srgbToLinear(parseInt(h.slice(i, i + 2), 16) / 255));
};

function linearRgbToOklab([r, g, b]) {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const [l_, m_, s_] = [l, m, s].map((v) => Math.cbrt(v));
  return [
    0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  ];
}

const deltaEOK = (h1, h2) => {
  const a = linearRgbToOklab(hexToLinearRgb(h1));
  const b = linearRgbToOklab(hexToLinearRgb(h2));
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
};

const relLum = (hex) => {
  const [r, g, b] = hexToLinearRgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (h1, h2) => {
  const a = relLum(h1), b = relLum(h2);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

const CVD = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
};
function cvdHex(type, hex) {
  const lin = hexToLinearRgb(hex);
  const m = CVD[type];
  const out = [0, 1, 2].map((i) =>
    Math.min(1, Math.max(0, m[i][0] * lin[0] + m[i][1] * lin[1] + m[i][2] * lin[2]))
  );
  return '#' + out.map((v) => Math.round(linearToSrgb(v) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
}
const deltaECVD = (type, h1, h2) => deltaEOK(cvdHex(type, h1), cvdHex(type, h2));

// ---------- token 解析 ----------
function loadTheme(id, seen = new Set()) {
  if (seen.has(id)) throw new Error(`extends 循环: ${id}`);
  seen.add(id);
  const file = path.join(HERE, `${id}.tokens.json`);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!raw.extends) return raw;
  const base = loadTheme(raw.extends, seen);
  return {
    ...base,
    ...raw,
    primitive: { ...base.primitive, ...raw.primitive },
    semantic: { ...base.semantic, ...raw.semantic },
    component: { ...base.component, ...raw.component },
    context: { ...base.context, ...raw.context },
    typeMap: raw.typeMap ?? base.typeMap,
    typeRules: raw.typeRules ?? base.typeRules,
  };
}

const pointer = (obj, ref) => ref.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);

const TOKEN_ID_RE = /^link\.[a-z0-9-]+$/;
const SEM_RE = /^primitive\.(hue|luminance|neutralLuminance)\.[a-z0-9_-]+$/;

function validateShape(t, fileId) {
  const errs = [];
  for (const k of ['schemaVersion', 'id', 'name', 'primitive', 'semantic', 'component', 'context']) {
    if (!t[k]) errs.push(`缺少必填键 ${k}`);
  }
  if (t.schemaVersion !== '1.0.0') errs.push('schemaVersion 必须为 1.0.0');
  for (const k of ['hi', 'lo', 'video']) if (typeof t.primitive.luminance?.[k] !== 'number') errs.push(`primitive.luminance.${k} 缺失`);
  for (const k of ['scalar', 'struct', 'unknown']) if (typeof t.primitive.neutralLuminance?.[k] !== 'number') errs.push(`primitive.neutralLuminance.${k} 缺失`);
  for (const [k, v] of Object.entries(t.semantic)) {
    if (!TOKEN_ID_RE.test(k)) errs.push(`语义键非法: ${k}`);
    const refs = v.hue ? [v.hue, v.luminance] : [v.neutral];
    for (const r of refs) {
      if (!SEM_RE.test(r)) errs.push(`${k} 引用格式非法: ${r}`);
      else if (typeof pointer(t.primitive, r.replace('primitive.', '')) !== 'number') errs.push(`${k} 引用不存在: ${r}`);
    }
  }
  for (const [type, tok] of Object.entries(t.typeMap || {})) {
    if (!t.semantic[tok]) errs.push(`typeMap[${type}] 指向未定义语义 ${tok}`);
  }
  for (const [i, r] of (t.typeRules || []).entries()) {
    if (!t.semantic[r.token]) errs.push(`typeRules[${i}] 指向未定义语义 ${r.token}`);
    try { new RegExp(r.pattern); } catch { errs.push(`typeRules[${i}] 正则非法: ${r.pattern}`); }
  }
  if (errs.length) throw new Error(`${fileId} 结构校验失败:\n  - ${errs.join('\n  - ')}`);
}

function resolveColor(t, spec) {
  if (spec.neutral) {
    const L = pointer(t.primitive, spec.neutral.replace('primitive.', ''));
    return { hex: oklchToHex(L, t.primitive.neutralChroma, 250), L, C: t.primitive.neutralChroma, H: 250 };
  }
  const H = pointer(t.primitive, spec.hue.replace('primitive.', ''));
  const L = pointer(t.primitive, spec.luminance.replace('primitive.', ''));
  const C = t.primitive.chroma;
  return { hex: oklchToHex(L, C, H), L, C, H };
}

function mapType(t, type) {
  if (typeof type !== 'string') return { token: 'link.unknown', how: 'union' };
  if (type.includes(',')) return { token: 'link.unknown', how: 'union' };
  if (t.typeMap?.[type]) return { token: t.typeMap[type], how: 'exact' };
  for (const r of t.typeRules || []) if (new RegExp(r.pattern).test(type)) return { token: r.token, how: 'rule' };
  return { token: 'link.unknown', how: 'fallback' };
}

// ---------- 主流程 ----------
const args = process.argv.slice(2);
const outDir = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;
const objInfoPath = args.includes('--object-info') ? args[args.indexOf('--object-info') + 1] : null;
const strict = args.includes('--strict');
// materialize：把语义 token + 62 类实测映射展开成 {TYPE: hex}，供主题装载/截图注入直接消费
const emitHex = args.includes('--emit-hex');

const themes = ['luowen-dark', 'luowen-cyberpunk'].map((id) => loadTheme(id));
const report = { generatedAt: new Date().toISOString(), gate: GATE, themes: {} };
const failures = [];
const md = [];

for (const t of themes) {
  validateShape(t, t.id);
  const colors = {};
  for (const [id, spec] of Object.entries(t.semantic)) colors[id] = resolveColor(t, spec);
  const ids = Object.keys(colors);

  const contrastRows = ids.map((id) => {
    const c = colors[id];
    const cCanvas = contrast(c.hex, t.context.canvas);
    const cCard = contrast(c.hex, t.context.card);
    const ok = cCanvas >= GATE.contrast && cCard >= GATE.contrast;
    if (!ok) failures.push(`${t.id}/${id} 对比度不足: canvas=${cCanvas.toFixed(2)} card=${cCard.toFixed(2)}`);
    return { id, hex: c.hex, L: +c.L.toFixed(3), C: c.C, H: +c.H.toFixed(1), gamut: inGamut(c.L, c.C, c.H), canvas: +cCanvas.toFixed(2), card: +cCard.toFixed(2), ok };
  });

  const matrix = [];
  let worst = { pair: '', value: 2 };
  for (let i = 0; i < ids.length; i++) {
    for (let k = i + 1; k < ids.length; k++) {
      const a = ids[i], b = ids[k];
      const normal = deltaEOK(colors[a].hex, colors[b].hex);
      const protan = deltaECVD('protan', colors[a].hex, colors[b].hex);
      const deutan = deltaECVD('deutan', colors[a].hex, colors[b].hex);
      const tritan = deltaECVD('tritan', colors[a].hex, colors[b].hex);
      const min = Math.min(normal, protan, deutan, tritan);
      if (min < GATE.deltaE) failures.push(`${t.id}/${a}~${b} 色盲不可辨: ΔE=${min.toFixed(4)}`);
      if (min < worst.value) worst = { pair: `${a} / ${b}`, value: min };
      matrix.push({ a, b, normal: +normal.toFixed(4), protan: +protan.toFixed(4), deutan: +deutan.toFixed(4), tritan: +tritan.toFixed(4), min: +min.toFixed(4) });
    }
  }

  // 相邻色相：按色相排序后相邻两族在同明度带下的 ΔE
  const hueRows = Object.entries(t.primitive.hue).sort((x, y) => x[1] - y[1]);
  const hueAdj = [];
  for (let i = 0; i < hueRows.length; i++) {
    const [na, ha] = hueRows[i];
    const [nb, hb] = hueRows[(i + 1) % hueRows.length];
    const l = t.primitive.luminance.lo;
    const ea = oklchToHex(l, t.primitive.chroma, ha);
    const eb = oklchToHex(l, t.primitive.chroma, hb);
    const d = deltaEOK(ea, eb);
    if (d < GATE.hueAdjacent) failures.push(`${t.id}/相邻色相 ${na}~${nb} ΔE 不足: ${d.toFixed(4)}`);
    hueAdj.push({ pair: `${na}(${ha}) / ${nb}(${hb})`, deltaE: +d.toFixed(4) });
  }

  const stats = JSON.parse(fs.readFileSync(path.join(DATA, 'type-frequency.json'), 'utf8'));
  const byToken = {};
  let linkTotal = 0, exact = 0, rule = 0, fallback = 0;
  const coverageRows = stats.linkTypesInWorkflows.map((r) => {
    const m = mapType(t, r.type);
    linkTotal += r.count;
    if (m.how === 'exact') exact += r.count;
    else if (m.how === 'rule') rule += r.count;
    else failures.push(`${t.id}/类型 ${r.type} 未显式映射（${r.count} 条连线）`);
    byToken[m.token] = (byToken[m.token] || 0) + r.count;
    return { type: r.type, token: m.token, how: m.how, links: r.count, workflows: r.workflows };
  });

  report.themes[t.id] = { context: t.context, colors, contrastRows, matrix, worst, hueAdj, coverageRows, byToken, coverage: { linkTotal, exact, rule, fallback } };

  md.push(`## ${t.id}（canvas ${t.context.canvas} / card ${t.context.card}）\n`);
  md.push('| token | hex | L | C | H | 画布对比度 | 卡片对比度 | 门槛 |');
  md.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const r of contrastRows) md.push(`| ${r.id} | ${r.hex} | ${r.L} | ${r.C} | ${r.H} | ${r.canvas}:1 | ${r.card}:1 | ${r.ok ? 'PASS' : 'FAIL'} |`);
  md.push('');
  md.push(`- 色盲全矩阵最差：${worst.pair} @ ΔE ${worst.value.toFixed(4)}（门槛 ${GATE.deltaE}）`);
  md.push(`- 相邻色相最差：${hueAdj.reduce((m, r) => (r.deltaE < m.deltaE ? r : m)).pair} @ ΔE ${Math.min(...hueAdj.map((r) => r.deltaE)).toFixed(4)}`);
  md.push(`- 连线覆盖：${linkTotal} 条，显式 ${exact}、规则 ${rule}、回落 ${linkTotal - exact - rule}`);
  md.push('');
}

if (objInfoPath) {
  const obj = JSON.parse(fs.readFileSync(objInfoPath, 'utf8'));
  const typeSet = new Map();
  for (const def of Object.values(obj)) for (const t0 of def.output || []) {
    const k = Array.isArray(t0) ? t0.join(',') : String(t0);
    if (k) typeSet.set(k, (typeSet.get(k) || 0) + 1);
  }
  const t = themes[0];
  const rows = [...typeSet.entries()].sort((a, b) => b[1] - a[1]).map(([type, slots]) => ({ type, slots, ...mapType(t, type) }));
  const unknown = rows.filter((r) => r.token === 'link.unknown');
  report.outputTypes = { total: rows.length, unknown: unknown.length, unknownRows: unknown };
  md.push(`## 输出类型外推（object_info ${rows.length} 类）\n`);
  md.push(`- 回落 link.unknown：${unknown.length} 类 / ${unknown.reduce((s, r) => s + r.slots, 0)} 槽`);
  if (unknown.length) md.push(`- ${unknown.slice(0, 12).map((r) => `${r.type}(${r.slots})`).join('、')}${unknown.length > 12 ? ' …' : ''}`);
  md.push('');
}

const text = md.join('\n');
if (outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'contrast.md'), text);
  for (const t of themes) {
    const rows = report.themes[t.id].matrix.map((r) => `${r.a},${r.b},${r.normal},${r.protan},${r.deutan},${r.tritan},${r.min}`);
    fs.writeFileSync(path.join(outDir, `cvd-matrix-${t.id}.csv`), ['a,b,normal,protan,deutan,tritan,min', ...rows].join('\n') + '\n');
  }
  fs.writeFileSync(path.join(outDir, 'coverage.json'), JSON.stringify(
    Object.fromEntries(themes.map((t) => [t.id, report.themes[t.id].coverageRows])), null, 2) + '\n');
  fs.writeFileSync(path.join(outDir, 'verify-report.json'), JSON.stringify(report, null, 2) + '\n');
}

if (emitHex) {
  const dir = outDir || DATA;
  fs.mkdirSync(dir, { recursive: true });
  const freq = JSON.parse(fs.readFileSync(path.join(DATA, 'type-frequency.json'), 'utf8'));
  for (const t of themes) {
    const colors = report.themes[t.id].colors;
    const tokens = Object.fromEntries(Object.entries(colors).map(([k, v]) => [k, v.hex]));
    const types = Object.fromEntries(freq.linkTypesInWorkflows.map((r) => [r.type, colors[mapType(t, r.type).token].hex]));
    fs.writeFileSync(path.join(dir, `link-colors-${t.id}.json`),
      JSON.stringify({ theme: t.id, width: t.component.connection.width, tokens, types }, null, 2) + '\n');
  }
}

console.log(text);
if (failures.length) {
  console.error(`\n门禁失败 ${failures.length} 项：`);
  for (const f of failures.slice(0, 20)) console.error(`  - ${f}`);
  if (strict) process.exit(1);
} else {
  console.log('全部门禁通过。');
}
