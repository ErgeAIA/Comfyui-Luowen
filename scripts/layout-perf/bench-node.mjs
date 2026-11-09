// Stage 0 基准：Node 端全管线（runAutoLayout + mock LGraph，无 DOM → 无 effH）。
// 用途：①优化前金标  ②规模矩阵（阶段耗时 / T(N) 指数）  ③CPU 采样入口。
// 口径：与宿主同设置默认值（auto 对齐 / NodeGap 40 / LayerGap 60 / InlineGap 50 / 竖排）。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { runAutoLayout } from '../../luowen/web/layout/engine.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLES = process.env.LUOWEN_SAMPLES ?? path.join(ROOT, '.verify/p7/samples');
const OUT = process.env.LUOWEN_PERF_OUT ?? path.join(ROOT, '.verify/p8');

export const SAMPLE_FILES = {
  largest: 'UP节点__B站 Work-Fisher__图生视频流-支持单图+_+双图+_+三图+出视频（最高支持五图）.json',
  mostGroups: 'flux-2-klein__安仔先生666__flux+klein多合一全能编辑工作流-局部重绘、万物迁移、多图编辑、扩图等.json',
  mostReroute: 'UP节点__B站 Work-Fisher__Work-Fisher-WanAnimate_Sec-人物迁移_动作迁移_长视频循环.json',
  mostComponents: 'Qwen-image-edit__千问Qwen-Edit2511 图生图+局部重绘+洗图.json',
  midGroups: 'MinimaxH3l全功能加速工作流（lightx2V版加速lora）.json',
  largeCollection: 'Qwen-Image-2512-大合集.json',
};

const OPTS = { scope: 'full', collapseNotes: false, columnAlign: 'auto', nodeGap: 40, layerGap: 60, inlineGap: 50, componentLayout: 'vertical' };

// ---------- 宿主 LGraph 的最小 duck-type（snapshotFromGraph 只读这些字段） ----------
export function fakeApp(wf) {
  const nodes = (wf.nodes ?? []).map((n) => ({
    id: n.id,
    type: String(n.type ?? ''),
    pos: [n.pos?.[0] ?? 0, n.pos?.[1] ?? 0],
    size: [n.size?.[0] ?? 0, n.size?.[1] ?? 0],
    inputs: n.inputs ?? [],
    outputs: n.outputs ?? [],
    pinned: !!n.pinned,
    collapsed: !!n.collapsed,
  }));
  const links = new Map();
  for (const l of wf.links ?? []) links.set(l[0], { id: l[0], origin_id: l[1], origin_slot: l[2], target_id: l[3], target_slot: l[4] });
  const groups = (wf.groups ?? []).map((g, i) => ({ id: g.id ?? `g${i}`, title: g.title ?? '', _bounding: (g.bounding ?? [0, 0, 0, 0]).slice(), setDirtyCanvas() {} }));
  const graph = { _nodes: nodes, links, groups };
  return { canvas: { graph, ds: { scale: 1 }, selectedItems: new Set(), setDirty() {} } };
}

export function entriesOf(app) {
  return app.canvas.graph._nodes
    .map((n) => [String(n.id), Number(n.pos[0]), Number(n.pos[1])])
    .sort((a, b) => a[0].localeCompare(b[0], 'en', { numeric: true }));
}

export function hashOf(entries) {
  const s = entries.map(([id, x, y]) => `${id}:${x.toFixed(3)},${y.toFixed(3)}`).join(';');
  return crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
}

export async function runCase(wf, opts = OPTS) {
  const app = fakeApp(wf);
  const t = performance.now();
  const rep = await runAutoLayout(app, opts);
  const wall = performance.now() - t;
  const entries = entriesOf(app);
  return { app, rep, wall, entries, hash: hashOf(entries) };
}

function loadWf(file) {
  return JSON.parse(fs.readFileSync(path.join(SAMPLES, file), 'utf8'));
}

// ---------- 多副本（模拟「一个文件多份工作流」） ----------
export function replicate(wf, copies) {
  const nodes = [], links = [], idMap = new Map();
  let nextId = 1;
  for (let c = 0; c < copies; c++) {
    const off = [c * 8000, 0];
    const local = new Map();
    for (const n of wf.nodes ?? []) {
      const nid = nextId++;
      local.set(String(n.id), nid);
      idMap.set(`${c}:${n.id}`, nid);
      nodes.push({ ...n, id: nid, pos: [(n.pos?.[0] ?? 0) + off[0], (n.pos?.[1] ?? 0) + off[1]] });
    }
    for (const l of wf.links ?? []) {
      const s = local.get(String(l[1])), d = local.get(String(l[3]));
      if (s == null || d == null) continue;
      links.push([nextId++, s, l[2] ?? 0, d, l[4] ?? 0, l[5] ?? '*']);
    }
  }
  const groups = [];
  for (let c = 0; c < copies; c++) {
    for (const g of wf.groups ?? []) {
      const b = g.bounding ?? [0, 0, 0, 0];
      groups.push({ ...g, bounding: [b[0] + c * 8000, b[1], b[2], b[3]] });
    }
  }
  return { nodes, links, groups };
}

// ---------- 合成样本 ----------
const NODE = { type: 'SyntheticNode', size: [240, 100] };

function node(id, pos, inputs, outputs) {
  return { id, ...NODE, pos, inputs, outputs };
}

export function chainWf(n) {
  const nodes = [], links = [];
  for (let i = 0; i < n; i++) {
    nodes.push(node(i + 1, [(i % 12) * 320, Math.floor(i / 12) * 220],
      i === 0 ? [] : [{ name: 'in', type: '*' }],
      i === n - 1 ? [] : [{ name: 'out', type: '*' }]));
  }
  let lid = 1;
  for (let i = 1; i < n; i++) links.push([lid++, i, 0, i + 1, 0, '*']);
  return { nodes, links, groups: [] };
}

// 扇入 K 源 → hub → tail 链；hub 入度 K
export function fanInWf(k, tail = 20) {
  const nodes = [], links = [];
  let id = 1, lid = 1;
  const srcIds = [];
  for (let i = 0; i < k; i++) { srcIds.push(id); nodes.push(node(id, [i * 300, 0], [], [{ name: 'out', type: '*' }])); id++; }
  const hub = id++; nodes.push(node(hub, [0, 600], Array.from({ length: k }, () => ({ name: 'in', type: '*' })), [{ name: 'out', type: '*' }]));
  for (let i = 0; i < k; i++) links.push([lid++, srcIds[i], 0, hub, i, '*']);
  let prev = hub;
  for (let i = 0; i < tail; i++) {
    const cur = id++; nodes.push(node(cur, [600 + i * 320, 600], [{ name: 'in', type: '*' }], i === tail - 1 ? [] : [{ name: 'out', type: '*' }]));
    links.push([lid++, prev, 0, cur, 0, '*']);
    prev = cur;
  }
  return { nodes, links, groups: [] };
}

// 扇出 1 → K 分支，每分支 tailLen 链（侧组密集）
export function fanOutWf(k, tailLen = 8) {
  const nodes = [], links = [];
  let id = 1, lid = 1;
  const root = id++; nodes.push(node(root, [0, 0], [], [{ name: 'out', type: '*' }]));
  for (let b = 0; b < k; b++) {
    let prev = root;
    for (let i = 0; i < tailLen; i++) {
      const cur = id++;
      nodes.push(node(cur, [(i + 1) * 320, b * 220], i === 0 ? [{ name: 'in', type: '*' }] : [{ name: 'in', type: '*' }], i === tailLen - 1 ? [] : [{ name: 'out', type: '*' }]));
      links.push([lid++, prev, 0, cur, 0, '*']);
      prev = cur;
    }
  }
  return { nodes, links, groups: [] };
}

// 分层稠密 DAG：每层 width 节点，每节点连下一层 2 个（确定性 LCG）
export function denseWf(layers, width) {
  const nodes = [], links = [];
  let id = 1, lid = 1, seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const grid = [];
  for (let L = 0; L < layers; L++) {
    const row = [];
    for (let i = 0; i < width; i++) {
      const nid = id++;
      row.push(nid);
      nodes.push(node(nid, [L * 320, i * 160], L === 0 ? [] : [{ name: 'in', type: '*' }], L === layers - 1 ? [] : [{ name: 'out', type: '*' }]));
    }
    grid.push(row);
  }
  for (let L = 0; L + 1 < layers; L++) {
    for (const s of grid[L]) {
      for (let e = 0; e < 2; e++) {
        const d = grid[L + 1][Math.floor(rnd() * width)];
        links.push([lid++, s, 0, d, 0, '*']);
      }
    }
  }
  return { nodes, links, groups: [] };
}

// ---------- 统计 ----------
const q = (arr, p) => { const a = arr.slice().sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(p * a.length))]; };
const r2 = (v) => Math.round(v * 100) / 100;

async function bench(wf, { reps = 5, warm = 1, opts = OPTS } = {}) {
  for (let i = 0; i < warm; i++) await runCase(wf, opts);
  const walls = [], stages = {};
  let hash = null, report = null;
  for (let i = 0; i < reps; i++) {
    const r = await runCase(wf, opts);
    walls.push(r.wall);
    hash = hash || r.hash;
    report = r.rep;
    if (r.hash !== hash) throw new Error(`non-deterministic layout: ${r.hash} != ${hash}`);
    for (const [k, v] of Object.entries(r.rep.stages ?? {})) (stages[k] ??= []).push(v);
  }
  const stageOut = {};
  for (const [k, v] of Object.entries(stages)) stageOut[k] = r2(q(v, 0.5));
  return {
    reps,
    wall_ms: { p50: r2(q(walls, 0.5)), p95: r2(q(walls, 0.95)), max: r2(Math.max(...walls)) },
    stages_p50: stageOut,
    nodes: wf.nodes.length,
    links: wf.links.length,
    report: report ? { moved: report.moved, overlaps: report.overlaps, components: report.components ?? null, metrics: report.metrics } : null,
    hash,
  };
}

// ---------- 模式 ----------
async function modeGolden(outFile) {
  const out = { meta: { generatedAt: new Date().toISOString(), path: 'node (no DOM → no effH)', opts: OPTS, fixtures: 'positions rounded to 1e-3' }, samples: {} };
  for (const [tag, file] of Object.entries(SAMPLE_FILES)) {
    const wf = loadWf(file);
    const r = await runCase(wf);
    out.samples[tag] = { nodes: wf.nodes.length, links: wf.links.length, hash: r.hash, ms: r2(r.wall), positions: Object.fromEntries(r.entries.map(([id, x, y]) => [id, [r2(x), r2(y)]])) };
    console.log(`${tag}: nodes=${wf.nodes.length} links=${wf.links.length} hash=${r.hash} ms=${r2(r.wall)}`);
  }
  // 多副本（midGroups ×3）
  const wf3 = replicate(loadWf(SAMPLE_FILES.midGroups), 3);
  const r3 = await runCase(wf3);
  out.samples.midGroups_x3 = { nodes: wf3.nodes.length, links: wf3.links.length, hash: r3.hash, ms: r2(r3.wall), positions: Object.fromEntries(r3.entries.map(([id, x, y]) => [id, [r2(x), r2(y)]])) };
  console.log(`midGroups_x3: nodes=${wf3.nodes.length} links=${wf3.links.length} hash=${r3.hash} ms=${r2(r3.wall)}`);
  fs.writeFileSync(outFile, JSON.stringify(out));
  console.log('written', outFile);
}

async function modeScale() {
  const cases = [];
  for (const n of [100, 250, 500, 1000]) cases.push([`chain_${n}`, chainWf(n), n > 500 ? 3 : 5]);
  for (const n of [100, 250, 500]) cases.push([`fanin10_${n}`, fanInWf(10, n - 11), n > 500 ? 3 : 5]);
  for (const n of [100, 250, 500]) cases.push([`fanout8_${n}`, fanOutWf(8, Math.floor((n - 1) / 8)), n > 500 ? 3 : 5]);
  for (const n of [100, 250, 500]) { const w = 10, l = Math.max(2, Math.floor(n / w)); cases.push([`dense_${l}x${w}`, denseWf(l, w), n > 500 ? 3 : 5]); }
  for (const c of [1, 3, 5]) cases.push([`midGroups_x${c}`, replicate(loadWf(SAMPLE_FILES.midGroups), c), 3]);
  const out = {};
  for (const [tag, wf, reps] of cases) {
    const t0 = performance.now();
    const r = await bench(wf, { reps });
    out[tag] = r;
    console.log(`${tag}: nodes=${r.nodes} links=${r.links} p50=${r.wall_ms.p50}ms p95=${r.wall_ms.p95}ms stages=${JSON.stringify(r.stages_p50)} (bench ${Math.round(performance.now() - t0)}ms)`);
  }
  fs.writeFileSync(`${OUT}/scale.json`, JSON.stringify(out, null, 1));
  console.log('written scale.json');
}

async function modeOne(tag) {
  const n = Number(tag?.replace(/\D/g, '')) || 1000;
  const wf = chainWf(n);
  for (let i = 0; i < 2; i++) {
    const r = await runCase(wf);
    console.log(`${tag} run${i}: ${r2(r.wall)}ms stages=${JSON.stringify(r.rep.stages ?? {})}`);
  }
}

// 作为库被探针 import 时不执行 CLI 模式
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('/bench-node.mjs')) {
  const mode = process.argv[2] ?? 'golden';
  if (mode === 'golden') await modeGolden(process.argv[3] ?? `${OUT}/golden-node-pre.json`);
  else if (mode === 'scale') await modeScale();
  else if (mode === 'one') await modeOne(process.argv[3]);
  else throw new Error(`unknown mode ${mode}`);
}
