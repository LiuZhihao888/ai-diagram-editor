#!/usr/bin/env node
/**
 * 验收脚本 —— 画完图必须跑这个，贴输出才算完成。
 *
 *   node test/verify-layout.mjs                # 检查全部 10 页
 *   node test/verify-layout.mjs 0 3 7          # 只检查指定页
 *   node test/verify-layout.mjs --json         # 输出机器可读 JSON
 *
 * 设计原则：
 *   - 判定逻辑与 lib/page.mjs 的 auditLayoutExpr **同源**，不在这里重写一套
 *   - 页面必须加载稳定才采样（两次元素数一致），否则结论不可信
 *   - 失败退出码为 1，方便 CI / 子代理判断
 *
 * 用法前提：ProcessOn 图已打开、桥接层已注入、本机有 DSH browser_* 工具。
 * 本脚本通过 dsh 的 browser_evaluate 驱动，不是独立进程 —— 见文件末尾说明。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.resolve(HERE, '..');

export const PAGE_NAMES = [
  '0-端到端流程',
  '1混凝土配合比管理',
  '2混凝土需求计划管理',
  '3混凝土原材料需求计划管理',
  '4混凝土生产准备管理',
  '5混凝土生产及发运管理',
  '6混凝土生产确认管理',
  '7混凝土试块跟踪管理',
  '8混凝土养护管理',
  '9混凝土原材料管理',
];

/** 验收阈值 —— 与 bridge/pobridge.js 的 LAYOUT 保持一致。 */
export const THRESHOLDS = {
  badAnchor: 0,
  crossings: 0,
  tightGaps: 0,
  overlaps: 0,
  lkSkipped: 0,
  minGap: 60,
};

/**
 * 判定一页是否合格。纯函数，可离线单测。
 * @param {object} r auditLayoutExpr 的返回值
 * @returns {{pass: boolean, failures: string[]}}
 */
export function judge(r) {
  const failures = [];
  if (!r || typeof r !== 'object') return { pass: false, failures: ['结果不是对象'] };
  if (r.error) return { pass: false, failures: ['NO_BRIDGE 或页面异常: ' + r.error] };
  for (const k of ['badAnchor', 'crossings', 'tightGaps', 'overlaps', 'lkSkipped']) {
    if (r[k] === undefined) { failures.push(k + ' 缺失'); continue; }
    if (r[k] !== THRESHOLDS[k]) failures.push(k + '=' + r[k] + '（要求 ' + THRESHOLDS[k] + '）');
  }
  if (r.minGap === undefined || r.minGap === null) failures.push('minGap 缺失');
  else if (r.minGap < THRESHOLDS.minGap) failures.push('minGap=' + r.minGap + '（要求 >= ' + THRESHOLDS.minGap + '）');
  return { pass: failures.length === 0, failures };
}

/** 把判定结果格式化成一行报告。 */
export function formatRow(page, r) {
  const j = judge(r);
  const flag = j.pass ? 'PASS' : 'FAIL';
  const name = PAGE_NAMES[page] || ('p' + page);
  const parts = [
    'p' + page + ' ' + name,
    flag,
    'nodes=' + (r.nodes ?? '?'),
    'edges=' + (r.edges ?? '?'),
    'anchor=' + (r.badAnchor ?? '?'),
    'cross=' + (r.crossings ?? '?'),
    'tight=' + (r.tightGaps ?? '?'),
    'minGap=' + (r.minGap ?? '?'),
    'overlaps=' + (r.overlaps ?? '?'),
  ];
  let line = parts.join(' ');
  if (!j.pass) line += '\n      未达标: ' + j.failures.join('; ');
  return line;
}

/** 汇总多页结果。 */
export function summarize(rows) {
  const total = rows.length;
  const passed = rows.filter((x) => judge(x.r).pass).length;
  return {
    total,
    passed,
    failed: total - passed,
    allPass: passed === total,
    lines: rows.map((x) => formatRow(x.page, x.r)),
  };
}

// ---------------------------------------------------------------- CLI
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  const pages = argv.filter((a) => /^\d+$/.test(a)).map(Number);
  const targets = pages.length ? pages : PAGE_NAMES.map((_, i) => i);

  console.error('这个脚本只提供判定逻辑与报告格式。');
  console.error('真正驱动浏览器的是 DSH 的 browser_* 工具，请在 agent 会话里这样用：');
  console.error('');
  console.error('  import { judge, formatRow, summarize } from "./test/verify-layout.mjs";');
  console.error('  // 对每一页：切页 -> 等稳定 -> browser_evaluate(auditLayoutExpr(prefix, p))');
  console.error('  // 然后 judge(result) 判定，formatRow(p, result) 打印');
  console.error('');
  console.error('要检查的页: ' + targets.join(', '));
  console.error('阈值: ' + JSON.stringify(THRESHOLDS));
  if (asJson) {
    console.log(JSON.stringify({ targets, thresholds: THRESHOLDS }, null, 2));
  }
  process.exit(2);
}

export default { judge, formatRow, summarize, THRESHOLDS, PAGE_NAMES };
