// Stage 0 宿主金标：6 样本 + midGroups×3，真实 DOM（effH 生效）。
// 用法：node golden-host.mjs <label> <out.json>
// 口径：默认设置（auto / 40 / 60 / 50 / 竖排）；每次 reload 禁缓存；同浏览器同视口。
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { SAMPLE_FILES, replicate, hashOf } from './bench-node.mjs';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch {
  const { execFileSync } = await import('node:child_process');
  playwright = require(path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'playwright'));
}
const { chromium } = playwright;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = process.env.LUOWEN_PERF_OUT ?? path.join(ROOT, '.verify/p8');
const COMFY = process.env.LUOWEN_COMFY;
if (!COMFY) throw new Error('请先设置 LUOWEN_COMFY=<ComfyUI 根目录>');
const WORKFLOWS = process.env.LUOWEN_WORKFLOWS ?? path.join(COMFY, 'user/default/workflows');
const HOST_ENGINE = process.env.LUOWEN_HOST_ENGINE ?? path.join(COMFY, 'custom_nodes/luowen/web/layout/engine.js');
const label = process.argv[2] ?? 'run';
const outFile = process.argv[3] ?? path.join(OUT, `golden-host-${label}.json`);

// 本机 Playwright 版本与已装浏览器不匹配时，回退到已装 chromium-* 的完整 chrome
function findChromium() {
  if (process.env.LUOWEN_CHROMIUM) return process.env.LUOWEN_CHROMIUM;
  const base = path.join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
  try {
    const dirs = fs.readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse();
    for (const d of dirs) { const exe = path.join(base, d, 'chrome-win64/chrome.exe'); if (fs.existsSync(exe)) return exe; }
  } catch { /* 未装则交给 Playwright 默认 */ }
  return undefined;
}

const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex').slice(0, 16);
const meta = { label, generatedAt: new Date().toISOString(), hostEngineSha: sha(HOST_ENGINE), files: {} };

const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message.slice(0, 200)));

await page.goto('http://127.0.0.1:8188/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => !!window.LuoWen && !!window.LuoWen.autoLayout, null, { timeout: 60000 });
await page.waitForTimeout(1500);

const set = (k, v) => page.evaluate(([k, v]) => window.comfyAPI.app.app.ui.settings.setSettingValue(k, v), [k, v]);
await set('LuoWen.AutoLayout.CollapseNotes', false);
await set('LuoWen.AutoLayout.ColumnAlign', 'auto');
await set('LuoWen.AutoLayout.NodeGap', 40);
await set('LuoWen.AutoLayout.LayerGap', 60);
await set('LuoWen.AutoLayout.InlineGap', 50);
await set('LuoWen.AutoLayout.ComponentLayout', 'vertical');

const loadWf = async (wf) => {
  await page.evaluate(async (json) => { await window.comfyAPI.app.app.loadGraphData(json); }, wf);
  // 等 Vue 节点 DOM 就绪（effH 读取依赖它）；最多 8s
  await page.waitForFunction((n) => document.querySelectorAll('.lg-node').length >= n, wf.nodes.length, { timeout: 8000 }).catch(() => {});
  await page.evaluate(() => {
    const c = window.comfyAPI.app.app.canvas;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of c.graph._nodes) { minX = Math.min(minX, n.pos[0]); minY = Math.min(minY, n.pos[1]); maxX = Math.max(maxX, n.pos[0] + n.size[0]); maxY = Math.max(maxY, n.pos[1] + n.size[1]); }
    const vw = c.canvas.width, vh = c.canvas.height;
    const scale = Math.min(0.9, Math.min(vw / Math.max(1, maxX - minX + 80), vh / Math.max(1, maxY - minY + 80)));
    c.ds.scale = scale; c.ds.offset = [80 - minX * scale, 80 - minY * scale];
    c.setDirty(true, true);
  });
  await page.waitForTimeout(500);
};

const read = () => page.evaluate(() => {
  const nodes = window.comfyAPI.app.app.canvas.graph._nodes;
  return { nodes: nodes.length, entries: nodes.map((n) => [String(n.id), Number(n.pos[0]), Number(n.pos[1])]).sort((a, b) => a[0].localeCompare(b[0], 'en', { numeric: true })) };
});

const res = { meta, samples: {} };
// 用户工作流金标待 test2 验收后建立（test1 为旧备份、test2 随刷新变化）；当前只跑压力样本
const USER_GOLDEN = {};
const ONLY_USER = process.env.LUOWEN_ONLY_USER === '1';
if (!ONLY_USER) for (const [tag, file] of Object.entries(SAMPLE_FILES)) {
  const wf = JSON.parse(fs.readFileSync(`${WORKFLOWS}/LW样本-${file}`, 'utf8'));
  await loadWf(wf);
  const rep = await page.evaluate(() => window.LuoWen.autoLayout('full'));
  await page.waitForTimeout(300);
  const got = await read();
  res.samples[tag] = { nodes: got.nodes, hash: hashOf(got.entries), ms: rep?.ms ?? null, stages: rep?.stages ?? null, scale: rep?.scale ?? null, positions: Object.fromEntries(got.entries.map(([id, x, y]) => [id, [x, y]])) };
  console.log(`${tag}: nodes=${got.nodes} hash=${res.samples[tag].hash} ms=${rep?.ms} stages=${JSON.stringify(rep?.stages ?? null)}`);
}

// 多副本：midGroups ×3
if (!ONLY_USER) {
  const base = JSON.parse(fs.readFileSync(`${WORKFLOWS}/LW样本-${SAMPLE_FILES.midGroups}`, 'utf8'));
  const wf3 = replicate(base, 3);
  await loadWf(wf3);
  const rep3 = await page.evaluate(() => window.LuoWen.autoLayout('full'));
  await page.waitForTimeout(400);
  const got3 = await read();
  res.samples.midGroups_x3 = { nodes: got3.nodes, hash: hashOf(got3.entries), ms: rep3?.ms ?? null, stages: rep3?.stages ?? null, scale: rep3?.scale ?? null, positions: Object.fromEntries(got3.entries.map(([id, x, y]) => [id, [x, y]])) };
  console.log(`midGroups_x3: nodes=${got3.nodes} hash=${res.samples.midGroups_x3.hash} ms=${rep3?.ms} stages=${JSON.stringify(rep3?.stages ?? null)}`);
}

for (const [tag, file] of Object.entries(USER_GOLDEN)) {
  const p = path.join(WORKFLOWS, file);
  if (!fs.existsSync(p)) { console.log(`${tag}: missing, skipped`); continue; }
  const wf = JSON.parse(fs.readFileSync(p, 'utf8'));
  await loadWf(wf);
  const rep = await page.evaluate(() => window.LuoWen.autoLayout('full'));
  await page.waitForTimeout(300);
  const got = await read();
  res.samples[tag] = { nodes: got.nodes, hash: hashOf(got.entries), ms: rep?.ms ?? null, stages: rep?.stages ?? null, scale: rep?.scale ?? null, positions: Object.fromEntries(got.entries.map(([id, x, y]) => [id, [x, y]])) };
  console.log(`${tag}: nodes=${got.nodes} hash=${res.samples[tag].hash} ms=${rep?.ms} stages=${JSON.stringify(rep?.stages ?? null)}`);
}

res.errors = errors;
fs.writeFileSync(outFile, JSON.stringify(res));
console.log('written', outFile);
await browser.close();
