// Stage 0 汇总：宿主 3 次重复的阶段中位数 + Node 规模矩阵的幂指数。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = process.env.LUOWEN_PERF_OUT ?? path.join(ROOT, '.verify/p8');
const files = ['golden-host-post.json', 'golden-host-post2.json', 'golden-host-post3.json', 'golden-host-post4.json', 'golden-host-post5.json', 'golden-host-post6.json'].filter((f) => fs.existsSync(`${OUT}/${f}`));
const runs = files.map((f) => JSON.parse(fs.readFileSync(`${OUT}/${f}`, 'utf8')));
const pre = JSON.parse(fs.readFileSync(`${OUT}/golden-host-pre.json`, 'utf8'));

const med = (a) => { const b = a.slice().sort((x, y) => x - y); return b[Math.floor((b.length - 1) / 2)]; };
const r1 = (v) => Math.round(v * 10) / 10;

const tags = Object.keys(runs[0].samples);
// 阶段表只用「拆分了 apply」的运行（capture1/write/capture2 存在），避免旧 apply 混入中位数
const split = runs.filter((r) => r.samples.largest.stages?.capture1 != null);
const useRuns = split.length ? split : runs;

const STAGES = ['snapGraph', 'effH', 'model', 'plan', 'elk', 'straighten', 'tracks', 'anchor', 'capture1', 'write', 'capture2', 'refresh', 'metrics', 'total'];

let md = '# Stage 0 汇总\n\n## 宿主阶段耗时（中位数，ms）\n\n';
md += `阶段表运行 ${useRuns.map((r) => r.meta.label).join(', ')}（中位数）；引擎 SHA ${runs[0].meta.hostEngineSha}\n\n`;
md += '| 样本 | 节点 | ' + STAGES.join(' | ') + ' |\n|---|' + '---|'.repeat(STAGES.length + 1) + '\n';
const hostStage = {};
for (const tag of tags) {
  const s = useRuns.map((r) => r.samples[tag].stages);
  const vals = {};
  for (const k of STAGES) vals[k] = med(s.map((x) => x?.[k] ?? 0));
  hostStage[tag] = vals;
  md += `| ${tag} | ${useRuns[0].samples[tag].nodes} | ` + STAGES.map((k) => r1(vals[k])).join(' | ') + ' |\n';
}

md += '\n## 运行间噪声（total ms，同引擎同图）\n\n';
md += '| 样本 | 最小 | 中位 | 最大 | 极差/中位 |\n|---|---|---|---|---|\n';
for (const tag of tags) {
  const all = runs.map((r) => r.samples[tag].ms);
  const m = med(all);
  md += `| ${tag} | ${r1(Math.min(...all))} | ${r1(m)} | ${r1(Math.max(...all))} | ${((Math.max(...all) - Math.min(...all)) / m * 100).toFixed(0)}% |\n`;
}

md += '\n## 宿主阶段占比（中位数）\n\n';
md += '| 样本 | ELK | capture1+capture2 | effH | model | write | 其余 |\n|---|---|---|---|---|---|---|\n';
for (const tag of tags) {
  const v = hostStage[tag], t = v.total || 1;
  const cap = v.capture1 + v.capture2;
  const other = t - v.elk - cap - v.effH - v.model - v.write;
  md += `| ${tag} | ${(v.elk / t * 100).toFixed(1)}% | ${(cap / t * 100).toFixed(1)}% | ${(v.effH / t * 100).toFixed(1)}% | ${(v.model / t * 100).toFixed(1)}% | ${(v.write / t * 100).toFixed(1)}% | ${(other / t * 100).toFixed(1)}% |\n`;
}

md += '\n## 行为不变（插桩前 vs 插桩后）\n\n';
md += '| 样本 | 节点 | 哈希 | 坐标逐点一致 | 前 ms | 后 ms（中位） |\n|---|---|---|---|---|---|\n';
for (const tag of tags) {
  const a = pre.samples[tag];
  const b = useRuns[0].samples[tag];
  const afterMs = med(useRuns.map((r) => r.samples[tag].ms));
  let exact = true;
  for (const id of Object.keys(a.positions)) {
    const p = a.positions[id], q = b.positions[id];
    if (!q || Math.abs(p[0] - q[0]) > 1e-9 || Math.abs(p[1] - q[1]) > 1e-9) { exact = false; break; }
  }
  md += `| ${tag} | ${a.nodes} | ${a.hash}${a.hash === b.hash ? '=' : '≠'} | ${exact ? '是' : '否'} | ${a.ms} | ${r1(afterMs)} |\n`;
}

// Node 规模矩阵
const scale = JSON.parse(fs.readFileSync(`${OUT}/scale.json`, 'utf8'));
md += '\n## Node 规模矩阵（p50，ms）\n\n';
md += '| 用例 | 节点 | 连线 | total | elk | tracks | model | metrics |\n|---|---|---|---|---|---|---|---|\n';
for (const [tag, r] of Object.entries(scale)) {
  const s = r.stages_p50;
  md += `| ${tag} | ${r.nodes} | ${r.links} | ${r.wall_ms.p50} | ${s.elk ?? '-'} | ${s.tracks ?? '-'} | ${s.model ?? '-'} | ${s.metrics ?? '-'} |\n`;
}

// 幂指数：以 chain 系列做 log-log 最小二乘
const chain = Object.entries(scale).filter(([t]) => t.startsWith('chain_')).sort((a, b) => a[1].nodes - b[1].nodes);
const expo = (key) => {
  const pts = chain.map(([, r]) => [Math.log(r.nodes), Math.log((key === 'total' ? r.wall_ms.p50 : r.stages_p50[key]) || 1e-3)]);
  const n = pts.length, sx = pts.reduce((s, p) => s + p[0], 0), sy = pts.reduce((s, p) => s + p[1], 0);
  const sxx = pts.reduce((s, p) => s + p[0] * p[0], 0), sxy = pts.reduce((s, p) => s + p[0] * p[1], 0);
  return (n * sxy - sx * sy) / (n * sxx - sx * sx);
};
md += '\n## T(N) 幂指数（chain 100→2000 拟合）\n\n';
md += `total=${expo('total').toFixed(2)} elk=${expo('elk').toFixed(2)} tracks=${expo('tracks').toFixed(2)} model=${expo('model').toFixed(2)} metrics=${expo('metrics').toFixed(2)}\n`;
md += '\n> 注：ELK 含约 13–17ms 固定开销（模块内初始化），小 N 端会把指数压低；1000→2000 段：tracks≈2.1、model≈1.7、metrics≈1.9。\n';

fs.writeFileSync(`${OUT}/summary.md`, md);
console.log(md);
