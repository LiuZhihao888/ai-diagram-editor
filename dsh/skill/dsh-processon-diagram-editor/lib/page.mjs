/**
 * DSH 侧的页面 JS 片段（传输无关）。
 *
 * 这些字符串交给会话内的 browser_evaluate 执行。集中在这里的好处：
 *   1. 可以离线做语法检查（见 ../test/selftest.mjs）
 *   2. 参数一律 JSON.stringify 转义，文案里带引号/换行/</script> 都安全
 *   3. AI 不用每次现场重编 JS —— SKILL.md 引用这里，行为可复现
 *
 * 硬规矩：**片段内部不允许出现反斜杠**。
 *   JS 模板字符串会把 \d 这类无效转义悄悄吃成 d，正则就从 (\d+) 变成 (d+)，
 *   静默失效、不报错。所以这里一律用 [0-9]、[/]、[ ] 这类写法。
 *   selftest 里有专门的断言守着这条。
 *
 * 与 WorkBuddy 侧 wb/lib/page.mjs 的区别：那边走 Playwright page.evaluate，
 * 这边走 browser_evaluate。**页面侧逻辑完全一致**（同一份 bridge/pobridge.js）。
 */

/** 把桥接层源码包成一次性执行的表达式，返回注入结果。 */
export function injectExpr(src) {
  return '(function(){' + src + '\n;return {bridge: typeof window.POBridge, keys: window.POBridge ? Object.keys(window.POBridge) : null};})()';
}

/** 页面是否就绪（Model 有图元）。顺便把"登录墙/只读"这类文案带出来。 */
export const READY = [
  '(function(){',
  '  var m = window.Model;',
  '  var n = (m && m.define && m.define.elements) ? Object.keys(m.define.elements).length : -1;',
  "  var txt = ((document.body && document.body.innerText) || '').replace(/[ ][ ]+/g, ' ').slice(0, 400);",
  '  var gate = /扫码登录|请登录|登录后|无权限|没有权限|仅可查看|只读模式/.exec(txt);',
  '  var fid = /file_id=([0-9]+)/.exec(location.href);',
  '  return JSON.stringify({',
  '    ready: n > 0,',
  '    elements: n,',
  '    hasBridge: typeof window.POBridge,',
  '    title: document.title,',
  '    gate: gate ? gate[0] : null,',
  '    fileId: fid ? fid[1] : null,',
  '    bodySample: n > 0 ? null : txt',
  '  });',
  '})()',
].join('\n');

/** 读完整语义图。 */
export const READ_GRAPH = [
  '(function(){',
  "  if (typeof window.POBridge !== 'object') return JSON.stringify({error:'NO_BRIDGE'});",
  '  var g = POBridge.readGraph();',
  '  return JSON.stringify({page: g.page, nodes: g.nodes, edges: g.edges});',
  '})()',
].join('\n');

/** 图元计数（比 readGraph 轻，用于改动前后对比）。 */
export const COUNT = [
  '(function(){',
  '  var e = window.Model && Model.define && Model.define.elements;',
  "  if (!e) return JSON.stringify({error:'NO_MODEL'});",
  '  var n = 0, l = 0;',
  "  for (var k in e) { var x = e[k]; (x.name === 'linker' || x.from || x.to) ? l++ : n++; }",
  '  return JSON.stringify({nodes: n, edges: l});',
  '})()',
].join('\n');

/** 建节点。返回请求坐标与实际坐标，并标记是否被视口夹过（ProcessOn 会静默夹取）。 */
export function createNodeExpr(o) {
  return [
    '(function(o){',
    "  if (typeof window.POBridge !== 'object') return JSON.stringify({error:'NO_BRIDGE'});",
    '  var c = POBridge.createNode({',
    '    id: o.id, text: o.text, x: o.x, y: o.y, w: o.w, h: o.h, name: o.name,',
    '    fill: o.fill, line: o.line, font: o.font',
    '  });',
    '  var el = window.Model.define.elements[c.id];',
    "  if (!el) return JSON.stringify({error:'NOT_CREATED', id: c.id, hint:'渲染器没接受这个图元（坐标或字段被拒）'});",
    '  var p = (el && el.props) || {};',
    '  var clamped = (o.x != null && Math.abs(p.x - o.x) > 1) || (o.y != null && Math.abs(p.y - o.y) > 1);',
    '  return JSON.stringify({',
    '    id: c.id, rendered: c.rendered,',
    '    requested: {x: o.x, y: o.y, w: o.w, h: o.h},',
    '    actual: {x: p.x, y: p.y, w: p.w, h: p.h},',
    '    clamped: clamped',
    '  });',
    '})(' + JSON.stringify(o) + ')',
  ].join('\n');
}

/** 连线。 */
export function createEdgeExpr(o) {
  return [
    '(function(o){',
    "  if (typeof window.POBridge !== 'object') return JSON.stringify({error:'NO_BRIDGE'});",
    '  var e = POBridge.createEdge({id: o.id, from: o.from, to: o.to, text: o.text});',
    '  return JSON.stringify({id: e.id, exists: !!window.Model.define.elements[e.id]});',
    '})(' + JSON.stringify(o) + ')',
  ].join('\n');
}

/** 改节点。 */
export function updateNodeExpr(id, patch) {
  return [
    '(function(id, patch){',
    "  if (typeof window.POBridge !== 'object') return JSON.stringify({error:'NO_BRIDGE'});",
    "  if (!window.Model.define.elements[id]) return JSON.stringify({error:'NOT_FOUND', id: id});",
    '  var r = POBridge.updateNode(id, patch);',
    '  var el = window.Model.define.elements[id];',
    '  var p = (el && el.props) || {};',
    "  var t = (el && el.textBlock && el.textBlock[0] && el.textBlock[0].text) || '';",
    '  return JSON.stringify({id: r.id, updated: r.updated, actual: {x: p.x, y: p.y, w: p.w, h: p.h}, text: t});',
    '})(' + JSON.stringify(id) + ', ' + JSON.stringify(patch) + ')',
  ].join('\n');
}

/** 删除节点。空数组直接拒绝 —— 某些版本传空数组会清空整张画布。 */
export function removeNodesExpr(ids) {
  return [
    '(function(ids){',
    "  if (typeof window.POBridge !== 'object') return JSON.stringify({error:'NO_BRIDGE'});",
    "  if (!Array.isArray(ids) || !ids.length) return JSON.stringify({error:'EMPTY_IDS'});",
    '  var r = POBridge.removeNodes(ids);',
    '  var left = ids.filter(function(i){ return !!window.Model.define.elements[i]; });',
    '  return JSON.stringify({removed: r.removed, stillThere: left});',
    '})(' + JSON.stringify(ids) + ')',
  ].join('\n');
}

/** 某 id 是否还在。用于 eval 超时后决定能否重试 —— 防重复图元的关键。 */
export function existsExpr(id) {
  return [
    '(function(id){',
    '  var e = window.Model && Model.define && Model.define.elements;',
    '  return !!(e && e[id]);',
    '})(' + JSON.stringify(id) + ')',
  ].join('\n');
}

/**
 * 整页适应。
 * ⚠️ 这是**显式请求**才用的，不要自动调用：
 *   - 会把用户的滚动位置拉走（实测 1730 → 967）
 *   - 会重置用户手动调好的缩放
 *   - 重绘阻塞，实测超时 114ms
 * 想"让用户看见某处"请用 FOCUS_RECT。
 */
export const FIT_CANVAS = [
  '(function(){',
  "  try { Designer.fitTheCanvas(); return 'ok'; } catch(e) { return 'err:' + String(e); }",
  '})()',
].join('\n');

/**
 * 把视口滚到某个矩形。只改 scrollLeft/scrollTop + 同步 viewBox 缓存，
 * 不动缩放、不重绘、不超时 —— 这是"不打扰用户"的跳转方式。
 * 返回 requested/actual/before，调用方能判断是否真滚到位。
 */
export function focusRectExpr(x, y, w, h) {
  return [
    '(function(x, y, w, h){',
    "  if (typeof window.POBridge !== 'object') return JSON.stringify({error:'NO_BRIDGE'});",
    '  try {',
    '    var r = POBridge.focusRect(x, y, w, h);',
    '    return JSON.stringify(r);',
    '  } catch (e) {',
    "    return JSON.stringify({error: String(e && e.message || e)});",
    '  }',
    ')(' + [x, y, w, h].map(v => JSON.stringify(v)).join(', ') + ')',
  ].join('\n');
}

/** 滚到指定图元。 */
export function focusExpr(ids) {
  return [
    '(function(ids){',
    "  try { Designer.scrollShapesToView(ids); return 'ok'; } catch(e) { return 'err:' + String(e); }",
    '})(' + JSON.stringify(ids) + ')',
  ].join('\n');
}

/** 视口范围，用来解释"坐标为什么被夹"。 */
export const VIEWBOX = [
  '(function(){',
  '  var vb = (window.Utils && Utils.canvasViewBox) || null;',
  '  return JSON.stringify(vb);',
  '})()',
].join('\n');

/** 泳道池边界（"图的下面"到底在哪）。 */
export const POOL_BOTTOM = [
  '(function(){',
  '  var e = window.Model.define.elements, id = null;',
  "  for (var k in e) { if (/horizontalPool/i.test(e[k].name || '')) { id = k; break; } }",
  "  if (!id) return JSON.stringify({error:'NO_POOL'});",
  '  var p = e[id].props;',
  '  return JSON.stringify({id: id, x: p.x, y: p.y, w: p.w, h: p.h, bottom: p.y + p.h});',
  '})()',
].join('\n');

/** 候选标签页标识（多图场景第一步：先认清有哪些图）。 */
export const TAB_IDENT = [
  '(function(){',
  // 只回传非敏感标识：绝不把 location.href / iframe.src 这类带
  // encrypted_session 票据的完整 URL 送进 AI 会话或日志。
  '  var out = {title: document.title, fileId: null, kdocsDoc: null};',
  '  var m = /file_id=([0-9]+)/.exec(location.href);',
  '  if (m) out.fileId = m[1];',
  '  var k = /kdocs[.]cn[/]l[/]([A-Za-z0-9]+)/.exec(location.href);',
  '  if (k) out.kdocsDoc = k[1];',
  "  var f = document.querySelector('#dotviewIframe');",
  '  if (f && f.src) {',
  '    var m2 = /file_id=([0-9]+)/.exec(f.src);',
  '    if (m2) out.fileId = m2[1];',
  '  }',
  '  return JSON.stringify(out);',
  '})()',
].join('\n');
