// 主链判据对照材料：longest（旧）vs sink-coverage（新）在同一图上的布局差异。
// 产出 .verify/p8/spine-compare.html / .png；只读运行，不改任何产品代码。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { runAutoLayout } from '../../luowen/web/layout/engine.js';
import { fromWorkflowJson } from '../../luowen/web/layout/graph-model.js';
import { spineOf, movableComponents } from '../../luowen/web/layout/refine.js';
import { fakeApp } from './bench-node.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(process.env.LUOWEN_PERF_OUT ?? path.join(ROOT, '.verify/p8'), 'spine-compare');

const N = (id, type, pos, size = [140, 70]) => ({ id, type, pos, size, inputs: [{ name: 'in', type: '*' }], outputs: [{ name: 'out', type: '*' }] });
const L = (id, from, fromSlot, to, toSlot) => [id, from, fromSlot, to, toSlot, '*'];

// A：同一分量内，外围 7 节点链 vs 主流程 5 节点（主流程汇点祖先 16）
function caseA() {
  const nodes = [], links = [];
  let lid = 1;
  nodes.push(N(1, 'Source', [0, 1000]));
  for (let i = 2; i <= 12; i++) nodes.push(N(i, 'Source', [i * 170, 1000]));
  nodes.push(N(13, 'Hub', [2100, 1000]), N(14, 'Main1', [2350, 1000]), N(15, 'Main2', [2600, 1000]), N(16, 'SaveMain', [2850, 1000]));
  for (let i = 17; i <= 23; i++) nodes.push(N(i, i === 23 ? 'SavePer' : `Per${i - 16}`, [(i - 17) * 260, 0]));
  links.push(L(lid++, 1, 0, 13, 0), L(lid++, 1, 0, 17, 0));
  for (let i = 2; i <= 12; i++) links.push(L(lid++, i, 0, 13, 0));
  links.push(L(lid++, 13, 0, 14, 0), L(lid++, 14, 0, 15, 0), L(lid++, 15, 0, 16, 0));
  for (let i = 17; i < 23; i++) links.push(L(lid++, i, 0, i + 1, 0));
  return { nodes, links, groups: [] };
}

// B：同一分量内两条等长 5 节点路径；主链汇点祖先 13，侧链汇点祖先 5
function caseB() {
  const nodes = [], links = [];
  let lid = 1;
  nodes.push(N(1, 'S', [0, 0]), N(2, 'Side1', [240, 0]), N(3, 'Side2', [480, 0]), N(4, 'Side3', [720, 0]), N(5, 'SaveSide', [960, 0]));
  for (let i = 6; i <= 13; i++) nodes.push(N(i, 'Src', [i * 170, 700]));
  nodes.push(N(14, 'Hub', [1500, 700]), N(15, 'Main1', [1750, 700]), N(16, 'Main2', [2000, 700]), N(17, 'SaveMain', [2250, 700]));
  links.push(L(lid++, 1, 0, 2, 0), L(lid++, 2, 0, 3, 0), L(lid++, 3, 0, 4, 0), L(lid++, 4, 0, 5, 0));
  links.push(L(lid++, 1, 0, 14, 0));
  for (let i = 6; i <= 13; i++) links.push(L(lid++, i, 0, 14, 0));
  links.push(L(lid++, 14, 0, 15, 0), L(lid++, 15, 0, 16, 0), L(lid++, 16, 0, 17, 0));
  return { nodes, links, groups: [] };
}

const CASES = [
  { key: 'A', title: 'A · 外围 7 节点链 vs 主流程 5 节点（16 个祖先）', wf: caseA() },
  { key: 'B', title: 'B · 等长双链：主链 13 祖先 / 侧链 5 祖先', wf: caseB() },
];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function renderPanel({ title, wf, positions, chains, stats }) {
  const nodes = wf.nodes;
  const pad = 60;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    const p = positions.get(String(n.id));
    if (!p) continue;
    minX = Math.min(minX, p[0]); minY = Math.min(minY, p[1]);
    maxX = Math.max(maxX, p[0] + n.size[0]); maxY = Math.max(maxY, p[1] + n.size[1]);
  }
  const vx = minX - pad, vy = minY - pad, vw = maxX - minX + pad * 2, vh = maxY - minY + pad * 2;
  const chainSet = new Set(chains.flat());
  const chainEdges = new Set();
  for (const c of chains) for (let i = 1; i < c.length; i++) chainEdges.add(`${c[i - 1]}|${c[i]}`);
  const byId = new Map(nodes.map((n) => [String(n.id), n]));
  const parts = [];
  for (const l of wf.links) {
    const s = byId.get(String(l[1])), d = byId.get(String(l[3]));
    const ps = positions.get(String(l[1])), pd = positions.get(String(l[3]));
    if (!s || !d || !ps || !pd) continue;
    const x1 = ps[0] + s.size[0], y1 = ps[1] + s.size[1] / 2;
    const x2 = pd[0], y2 = pd[1] + d.size[1] / 2;
    const hot = chainEdges.has(`${l[1]}|${l[3]}`);
    parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${hot ? '#f87171' : '#475569'}" stroke-width="${hot ? 7 : 4}" />`);
  }
  for (const n of nodes) {
    const p = positions.get(String(n.id));
    if (!p) continue;
    const hot = chainSet.has(String(n.id));
    parts.push(`<rect x="${p[0]}" y="${p[1]}" width="${n.size[0]}" height="${n.size[1]}" rx="14" fill="${hot ? '#1e3a5f' : '#1f2937'}" stroke="${hot ? '#f87171' : '#64748b'}" stroke-width="${hot ? 6 : 3}" />`);
    parts.push(`<text x="${p[0] + n.size[0] / 2}" y="${p[1] + n.size[1] / 2 + 8}" text-anchor="middle" font-size="26" fill="#e5e7eb">${esc(n.type)}</text>`);
    parts.push(`<text x="${p[0] + n.size[0] / 2}" y="${p[1] + n.size[1] / 2 + 36}" text-anchor="middle" font-size="18" fill="#94a3b8">#${esc(n.id)}</text>`);
  }
  const chainText = chains.map((c) => c.map((id) => `${id}[${byId.get(String(id))?.type ?? '?'}]`).join(' → ')).join(' ｜ ');
  return `<figure>
    <figcaption><b>${esc(title)}</b><br><span class="dim">${esc(chainText)}</span><br><span class="dim">${esc(stats)}</span></figcaption>
    <svg viewBox="${vx} ${vy} ${vw} ${vh}" width="100%" preserveAspectRatio="xMidYMid meet">${parts.join('')}</svg>
  </figure>`;
}

const panels = [];
for (const c of CASES) {
  for (const strategy of ['longest', 'sink-coverage']) {
    const app = fakeApp(c.wf);
    const rep = await runAutoLayout(app, { spineStrategy: strategy });
    const positions = new Map(app.canvas.graph._nodes.map((n) => [String(n.id), [n.pos[0], n.pos[1]]]));
    const chains = rep.spineChains ?? [];
    panels.push({ section: c.key, title: `${c.title} · ${strategy}`, wf: c.wf, positions, chains, stats: `链长 ${chains.flat().length} · 重叠 ${rep.overlaps} · ${rep.ms}ms` });
    console.log(`${c.key} ${strategy}: chains=${JSON.stringify(chains)} overlaps=${rep.overlaps}`);
  }
}

// test1：宿主金标坐标（与旧判据几何一致），按分量复算主链用于展示
const t1 = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/layout-golden/test1.json'), 'utf8'));
const TEST1 = process.env.LUOWEN_TEST1;
if (!TEST1) throw new Error('请先设置 LUOWEN_TEST1=<test1.json 路径>');
const t1wf = fromWorkflowJson(JSON.parse(fs.readFileSync(TEST1, 'utf8')));
const t1pos = new Map(Object.entries(t1.samples.test1.positions));
const t1chains = movableComponents(t1wf, t1pos).map((comp) => spineOf(t1wf, t1pos, new Set(comp), { strategy: 'sink-coverage' }).chain).filter((c) => c.length);
panels.push({
  section: 'test1',
  title: 'test1 · 宿主金标（sink-coverage；哈希与旧判据一致）',
  wf: { nodes: [...t1wf.nodes.values()].map((n) => ({ id: n.id, type: n.type, size: n.size })), links: t1wf.edges.map((e) => [e.id, e.src, e.srcPort, e.dst, e.dstPort]) },
  positions: t1pos, chains: t1chains, stats: `哈希 ${t1.samples.test1.hash}（未变）`,
});
console.log(`test1: chains=${JSON.stringify(t1chains)}`);

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>主链判据对照</title>
<style>
body{margin:0;padding:28px;background:#0b1220;color:#e5e7eb;font-family:"Segoe UI",system-ui,sans-serif}
h1{font-size:24px;margin:0 0 6px}p{color:#94a3b8;margin:0 0 22px}
section{margin:0 0 30px}h2{font-size:18px;border-left:4px solid #f87171;padding-left:10px}
.row{display:grid;grid-template-columns:1fr 1fr;gap:18px}
figure{margin:0;background:#0f172a;border:1px solid #1e293b;border-radius:12px;padding:12px}
figcaption{font-size:13px;line-height:1.6;margin-bottom:8px}
.dim{color:#94a3b8}
</style></head><body>
<h1>主链判据对照：longest（旧） vs sink-coverage（新）</h1>
<p>红框/红线 = 判据选出的主链；左旧右新。A/B 为同一连通分量内的竞争（生产中按分量求主链）；test1 为宿主金标坐标，两判据几何一致。</p>
${['A', 'B', 'test1'].map((k) => {
  const list = panels.filter((p) => p.section === k);
  return `<section><h2>${k}</h2><div class="row">${list.map(renderPanel).join('')}</div></section>`;
}).join('')}
</body></html>`;

fs.writeFileSync(`${OUT}.html`, html);
console.log('written', `${OUT}.html`);

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch {
  const { execFileSync } = await import('node:child_process');
  playwright = require(path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'playwright'));
}
const exe = process.env.LUOWEN_CHROMIUM ?? (() => {
  const base = path.join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
  try { for (const d of fs.readdirSync(base).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse()) { const f = path.join(base, d, 'chrome-win64/chrome.exe'); if (fs.existsSync(f)) return f; } } catch { /* 默认 */ }
  return undefined;
})();
const browser = await playwright.chromium.launch({ headless: true, executablePath: exe });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
await page.goto(pathToFileURL(`${OUT}.html`).href, { waitUntil: 'load' });
await page.screenshot({ path: `${OUT}.png`, fullPage: true });
await browser.close();
console.log('written', `${OUT}.png`);
