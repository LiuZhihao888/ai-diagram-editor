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
    '  var e = POBridge.createEdge({id: o.id, from: o.from, to: o.to, text: o.text,',
    '    fromSide: o.fromSide, toSide: o.toSide});',
    '  return JSON.stringify({id: e.id, exists: !!window.Model.define.elements[e.id],',
    '    fromSide: e.fromSide, toSide: e.toSide, points: e.points});',
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

/** 只读：读一个泳道池的行数/每行字段（不写画布，验证机制首选）。 */
export function getPoolRowsExpr(poolId) {
  return [
    '(function(id){',
    "  if (typeof window.POBridge !== 'object') return JSON.stringify({error:'NO_BRIDGE'});",
    "  try {",
    "    var r = POBridge.getPoolRows(id);",
    "    if (!r) return JSON.stringify({error:'POOL_NOT_FOUND', id: id});",
    "    return JSON.stringify(r);",
    "  } catch(e) { return JSON.stringify({error:'GET_FAILED', message:String(e && e.message || e)}); }",
    '})(' + JSON.stringify(poolId) + ')',
  ].join('\n');
}

/** 创建「一个池 + N 行」的泳道池（写操作；id 由调用方生成以便超时探测/回滚）。 */
export function createPoolExpr(o) {
  return [
    '(function(o){',
    "  if (typeof window.POBridge !== 'object') return JSON.stringify({error:'NO_BRIDGE'});",
    "  if (window.Model.define.elements[o.id]) return JSON.stringify({error:'DUPLICATE_ID', id: o.id});",
    "  try {",
    "    var r = POBridge.createPool(o);",
    "    return JSON.stringify(r);",
    "  } catch(e) { return JSON.stringify({error:'CREATE_FAILED', message:String(e && e.message || e)}); }",
    '})(' + JSON.stringify(o) + ')',
  ].join('\n');
}

/** 把已有泳道池改成 N 行（写操作；rows 长度 1..50）。 */
export function setPoolRowsExpr(poolId, rows, opts) {
  return [
    '(function(id, rows, opts){',
    "  if (typeof window.POBridge !== 'object') return JSON.stringify({error:'NO_BRIDGE'});",
    "  if (!window.Model.define.elements[id]) return JSON.stringify({error:'POOL_NOT_FOUND', id: id});",
    "  try {",
    "    var r = POBridge.setPoolRows(id, rows, opts || {});",
    "    return JSON.stringify(r);",
    "  } catch(e) { return JSON.stringify({error:'SET_FAILED', message:String(e && e.message || e)}); }",
    '})(' + JSON.stringify(poolId) + ', ' + JSON.stringify(rows) + ', ' + JSON.stringify(opts || {}) + ')',
  ].join('\n');
}

/** 删除一个池及其全部 lane（写操作；仅删 ai_ 前缀的测试池，用于清理）。 */
export function removePoolExpr(poolId) {
  return [
    '(function(id){',
    "  if (typeof window.POBridge !== 'object') return JSON.stringify({error:'NO_BRIDGE'});",
    "  if (!/^ai_/.test(id)) return JSON.stringify({error:'REFUSE_NON_AI', id: id});",
    "  var D = window.Model.define.elements, p = D[id];",
    "  if (!p) return JSON.stringify({error:'POOL_NOT_FOUND', id: id});",
    "  var ids = [id].concat((p.children || []).filter(function(c){ return !!D[c]; }));",
    "  var r = POBridge.removeNodes(ids);",
    "  var left = ids.filter(function(i){ return !!D[i]; });",
    "  return JSON.stringify({removed: r.removed, left: left});",
    '})(' + JSON.stringify(poolId) + ')',
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

/** 重排单条连线：端点纠正到边中点 + 正确 angle（锚点绑定）。 */
export function rebindEdgeExpr(id) {
  return [
    '(function(id){',
    "  if (typeof window.POBridge !== 'object') return JSON.stringify({error:'NO_BRIDGE'});",
    "  if (!window.Model.define.elements[id]) return JSON.stringify({error:'NOT_FOUND', id: id});",
    '  var r = POBridge.rebindEdge(id);',
    '  return JSON.stringify(r);',
    '})(' + JSON.stringify(id) + ')',
  ].join('\n');
}

/** 批量重排一组连线（一次 updateMulti + 一次 resetBrokenLinker）。 */
export function rebindEdgesExpr(ids) {
  return [
    '(function(ids){',
    "  if (typeof window.POBridge !== 'object') return JSON.stringify({error:'NO_BRIDGE'});",
    "  if (!ids || !ids.length) return JSON.stringify({error:'EMPTY_IDS'});",
    '  var r = POBridge.rebindEdges(ids);',
    '  return JSON.stringify(r);',
    '})(' + JSON.stringify(ids) + ')',
  ].join('\n');
}

/** 列出连线 id（可按前缀过滤）。 */
export function listEdgesExpr(prefix) {
  return [
    '(function(prefix){',
    "  if (typeof window.POBridge !== 'object') return JSON.stringify({error:'NO_BRIDGE'});",
    '  var ids = POBridge.listEdges(prefix);',
    '  return JSON.stringify({count: ids.length, ids: ids});',
    '})(' + JSON.stringify(prefix || '') + ')',
  ].join('\n');
}

/** 检测连线是否穿过非端点节点（交叉 = 视觉硬伤）。 */
export function detectCrossingsExpr(prefix) {
  return [
    '(function(prefix){',
    "  if (typeof window.POBridge !== 'object') return JSON.stringify({error:'NO_BRIDGE'});",
    '  var r = POBridge.detectCrossings(prefix);',
    '  return JSON.stringify(r);',
    '})(' + JSON.stringify(prefix || '') + ')',
  ].join('\n');
}

/** 让渲染器重算折线路径（改完 endpoints/points 后必须调用）。 */
export function resetBrokenLinkersExpr() {
  return [
    '(function(){',
    "  if (typeof window.POBridge !== 'object') return JSON.stringify({error:'NO_BRIDGE'});",
    '  var ok = POBridge.resetBrokenLinkers();',
    '  return JSON.stringify({reset: ok});',
    '})()',
  ].join('\n');
}

/** 间距重排：按行把「边到边」间隙撑到 target（默认 80，超宽降级 60）。 */
export function reflowSpacingExpr(prefix, opts) {
  return [
    '(function(prefix, o){',
    "  if (typeof window.POBridge !== 'object') return JSON.stringify({error:'NO_BRIDGE'});",
    '  return JSON.stringify(POBridge.reflowSpacing(prefix, o));',
    '})(' + JSON.stringify(prefix || '') + ', ' + JSON.stringify(opts || {}) + ')',
  ].join('\n');
}

/** 一条龙：间距重排 + 连线重连 + 交叉改道（子代理首选入口）。 */
export function polishLayoutExpr(prefix, opts) {
  return [
    '(function(prefix, o){',
    "  if (typeof window.POBridge !== 'object') return JSON.stringify({error:'NO_BRIDGE'});",
    '  return JSON.stringify(POBridge.polishLayout(prefix, o));',
    '})(' + JSON.stringify(prefix || '') + ', ' + JSON.stringify(opts || {}) + ')',
  ].join('\n');
}

/** 页面体检：间距/交叉/锚点三项一次算完（验收标准就在这里，别在别处重复实现）。
 *
 *  【为什么必须传 pageIndex】ProcessOn 的 Model.define.elements 只装「当前页」，
 *  但切页是懒加载的：刚点完标签页时，元素会从上一页的残留逐步换成目标页。
 *  这个过渡窗口里做全局 /^ai_/ 统计会**混入上一页的元素**，得出假失败或假通过。
 *  实测踩过：p9 在过渡态报 crossings=6，稳定后实际是 0。
 *  传 pageIndex 后按 '_pN_' 子串做页内作用域，边界clear。
 */
export function auditLayoutExpr(prefix, pageIndex) {
  var scope = (typeof pageIndex === 'number')
    ? JSON.stringify('_p' + pageIndex + '_')
    : 'null';
  return [
    '(function(prefix, scopeSub){',
    "  if (typeof window.POBridge !== 'object') return JSON.stringify({error:'NO_BRIDGE'});",
    '  var E = window.Model.define.elements, nodes = {}, badAnchor = 0, cross = 0, tight = 0, minGap = 9999;',
    '  var id, i;',
    '  function inScope(x) {',
    '    if (prefix && x.indexOf(prefix) !== 0) return false;',
    '    if (scopeSub && x.indexOf(scopeSub) < 0) return false;',
    '    return true;',
    '  }',
    '  for (id in E) {',
    '    if (!inScope(id)) continue;',
    '    var e = E[id];',
    '    if (!e || !e.props) continue;',
    '    if (/pool|lane|linker/i.test(e.name || "")) continue;',
    '    if (/_hdr_|_note_/.test(id)) continue;',
    '    nodes[id] = e.props;',
    '  }',
    '  function onMid(x, y, p) {',
    '    var eps = 2;',
    '    return (Math.abs(x - p.x) < eps && Math.abs(y - (p.y + p.h / 2)) < eps) ||',
    '           (Math.abs(x - (p.x + p.w)) < eps && Math.abs(y - (p.y + p.h / 2)) < eps) ||',
    '           (Math.abs(y - p.y) < eps && Math.abs(x - (p.x + p.w / 2)) < eps) ||',
    '           (Math.abs(y - (p.y + p.h)) < eps && Math.abs(x - (p.x + p.w / 2)) < eps);',
    '  }',
    '  var boxes = [];',
    '  for (var n in nodes) boxes.push({ id: n, x: nodes[n].x, y: nodes[n].y, w: nodes[n].w, h: nodes[n].h });',
    '  function hitSeg(x1, y1, x2, y2, r) {',
    '    var pad = 2, rx1 = r.x + pad, ry1 = r.y + pad, rx2 = r.x + r.w - pad, ry2 = r.y + r.h - pad;',
    '    if (Math.abs(y1 - y2) < 0.5) {',
    '      if (y1 < ry1 || y1 > ry2) return false;',
    '      var a = Math.min(x1, x2), b = Math.max(x1, x2); return b > rx1 && a < rx2;',
    '    }',
    '    if (Math.abs(x1 - x2) < 0.5) {',
    '      if (x1 < rx1 || x1 > rx2) return false;',
    '      var c = Math.min(y1, y2), d = Math.max(y1, y2); return d > ry1 && c < ry2;',
    '    }',
    '    return false;',
    '  }',
    '  var edgeCount = 0, skipped = 0;',
    '  for (id in E) {',
    '    if (!inScope(id)) continue;',
    '    if (id.indexOf("_lk_") < 0) continue;',
    '    var g = E[id];',
    '    if (!g || !g.from || !g.to) { skipped++; continue; }',
    '    if (!nodes[g.from.id] || !nodes[g.to.id]) { skipped++; continue; }',
    '    edgeCount++;',
    '    if (!onMid(g.from.x, g.from.y, nodes[g.from.id]) || !onMid(g.to.x, g.to.y, nodes[g.to.id])) badAnchor++;',
    '    var pts = [{ x: g.from.x, y: g.from.y }].concat(g.points || []).concat([{ x: g.to.x, y: g.to.y }]);',
    '    for (i = 1; i < pts.length; i++) {',
    '      for (var b2 = 0; b2 < boxes.length; b2++) {',
    '        if (boxes[b2].id === g.from.id || boxes[b2].id === g.to.id) continue;',
    '        if (hitSeg(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y, boxes[b2])) cross++;',
    '      }',
    '    }',
    '  }',
    '  var rows = {};',
    '  for (var n2 in nodes) { var k = Math.round(nodes[n2].y); (rows[k] = rows[k] || []).push({ x: nodes[n2].x, w: nodes[n2].w }); }',
    '  for (var k2 in rows) {',
    '    var arr = rows[k2].sort(function (a, b) { return a.x - b.x; });',
    '    for (var i2 = 1; i2 < arr.length; i2++) {',
    '      var gp = arr[i2].x - (arr[i2 - 1].x + arr[i2 - 1].w);',
    '      if (gp < minGap) minGap = gp;',
    '      if (gp < 60) tight++;',
    '    }',
    '  }',
    '  return JSON.stringify({ nodes: Object.keys(nodes).length, edges: edgeCount, lkSkipped: skipped,',
    '    badAnchor: badAnchor, crossings: cross, tightGaps: tight, minGap: minGap,',
    '    pass: (badAnchor === 0 && cross === 0 && tight === 0 && minGap >= 60) });',
    '})(' + JSON.stringify(prefix || '') + ', ' + scope + ')',
  ].join('\n');
}
