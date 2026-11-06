/**
 * 集成冒烟（只读，不改文档）：真正打开 ProcessOn、注入桥接层、读图、截图。
 * 运行：node test/smoke.mjs
 * 需要先 `node bin/pocli.mjs set-url "<编辑页URL>"`；没有 URL 时自动跳过。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PwDriver, findChromium } from '../lib/pw.mjs';
import * as P from '../lib/page.mjs';
import { resolveBridgeFile } from '../lib/paths.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATE = process.env.PO_STATE || path.join(ROOT, '.pocli-state.json');
const BRIDGE = resolveBridgeFile(ROOT);
const URL_FILE = process.env.PO_URL;

function readUrl() {
  if (URL_FILE) return URL_FILE;
  try { return JSON.parse(fs.readFileSync(STATE, 'utf8')).url; } catch { return null; }
}

const url = readUrl();
if (!url) {
  console.log('SKIP  没有配置文档 URL（先跑 pocli set-url）');
  process.exit(0);
}

const t0 = Date.now();
const driver = new PwDriver({ headless: true });
let failed = false;

try {
  console.log('· chromium :', findChromium() || '（默认解析）');
  const st = await driver.open(url);
  const tOpen = Date.now() - t0;
  console.log(`· 打开页面 : ${st.ready ? 'OK' : 'FAIL'}  图元 ${st.elements}  ${tOpen}ms`);

  const inj = await driver.inject(fs.readFileSync(BRIDGE, 'utf8'));
  console.log(`· 注入桥接 : ${inj.bridge}（${inj.keys.join('/')}）`);

  const g = await driver.evalJson(P.READ_GRAPH);
  const total = g.nodes.length + g.edges.length;
  console.log(`· 读图     : ${g.nodes.length} 节点 / ${g.edges.length} 连线 / 页面 ${g.page.width}×${g.page.height}`);
  if (total !== st.elements) { console.error('  ✗ 读图数量与 Model 不一致'); failed = true; }

  const pool = await driver.evalJson(P.POOL_BOTTOM);
  console.log(`· 泳道池   : bottom=${pool.bottom} x=${pool.x} w=${pool.w}`);

  const shot = path.join(ROOT, 'test', 'out', 'smoke.png');
  await driver.screenshot(shot);
  const bytes = fs.statSync(shot).size;
  console.log(`· 截图     : ${shot}  ${bytes} bytes`);
  if (bytes < 5000) { console.error('  ✗ 截图太小，可能是空白帧'); failed = true; }

  const vb = await driver.evalJson(P.VIEWBOX);
  console.log(`· 视口     : ${JSON.stringify(vb)}`);
  console.log(`· 总耗时   : ${Date.now() - t0}ms`);
} catch (e) {
  console.error('FAIL ', e.code || '', e.message);
  if (e.detail) console.error(JSON.stringify(e.detail).slice(0, 400));
  failed = true;
} finally {
  await driver.close();
}

console.log(failed ? '\n冒烟失败\n' : '\n冒烟通过\n');
process.exit(failed ? 1 : 0);
