/**
 * 页面侧 JS 片段（传输无关）。
 *
 * 这些字符串既给 Playwright 后端用（page.evaluate），也可以原样丢给
 * 会话内的原生 browser_evaluate 工具 —— 两条后端共用同一份逻辑，
 * 行为一致，测试一次即可覆盖两者。
 */

/** 把 pobridge 源码包成一次性执行的表达式，返回注入结果。 */
export function injectExpr(src) {
  return `(function(){${src}
;return {bridge: typeof window.POBridge, keys: window.POBridge ? Object.keys(window.POBridge) : null};})()`;
}

/** 页面是否就绪（Model 有图元）。顺便把"登录墙/无权限"这类文案带出来。 */
export const READY = `(function(){
  var m = window.Model;
  var n = (m && m.define && m.define.elements) ? Object.keys(m.define.elements).length : -1;
  var txt = (document.body && document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 400);
  var gate = /扫码登录|请登录|登录后|无权限|没有权限|仅可查看|只读模式/.exec(txt);
  return JSON.stringify({
    ready: n > 0,
    elements: n,
    hasBridge: typeof window.POBridge,
    title: document.title,
    gate: gate ? gate[0] : null,
    bodySample: n > 0 ? null : txt
  });
})()`;

/** 读完整语义图。 */
export const READ_GRAPH = `(function(){
  if (typeof window.POBridge !== 'object') return JSON.stringify({error:'NO_BRIDGE'});
  var g = POBridge.readGraph();
  return JSON.stringify({page: g.page, nodes: g.nodes, edges: g.edges});
})()`;

/** 图元计数（比 readGraph 轻，用于 verify 与改动前后对比）。 */
export const COUNT = `(function(){
  var e = window.Model && Model.define && Model.define.elements;
  if (!e) return JSON.stringify({error:'NO_MODEL'});
  var n = 0, l = 0;
  for (var k in e) { var x = e[k]; (x.name === 'linker' || x.from || x.to) ? l++ : n++; }
  return JSON.stringify({nodes: n, edges: l});
})()`;

/**
 * 建节点。返回请求坐标与实际坐标，顺带标记是否被视口夹过 ——
 * ProcessOn 会把越界坐标悄悄夹进 canvasViewBox，不报错。
 */
export function createNodeExpr(o) {
  return `(function(o){
  if (typeof window.POBridge !== 'object') return JSON.stringify({error:'NO_BRIDGE'});
  var c = POBridge.createNode({
    id: o.id, text: o.text, x: o.x, y: o.y, w: o.w, h: o.h, name: o.name,
    fill: o.fill, line: o.line, font: o.font
  });
  var el = window.Model.define.elements[c.id];
  if (!el) return JSON.stringify({error:'NOT_CREATED', id: c.id, hint:'渲染器没接受这个图元（坐标或字段被拒）'});
  var p = (el && el.props) || {};
  var clamped = (o.x != null && Math.abs(p.x - o.x) > 1) || (o.y != null && Math.abs(p.y - o.y) > 1);
  return JSON.stringify({
    id: c.id, rendered: c.rendered,
    requested: {x:o.x, y:o.y, w:o.w, h:o.h},
    actual: {x:p.x, y:p.y, w:p.w, h:p.h},
    clamped: clamped
  });
})(${JSON.stringify(o)})`;
}

/** 连线。 */
export function createEdgeExpr(o) {
  return `(function(o){
  if (typeof window.POBridge !== 'object') return JSON.stringify({error:'NO_BRIDGE'});
  var e = POBridge.createEdge({id:o.id, from:o.from, to:o.to, text:o.text});
  return JSON.stringify({id: e.id, exists: !!window.Model.define.elements[e.id]});
})(${JSON.stringify(o)})`;
}

/** 改节点。 */
export function updateNodeExpr(id, patch) {
  return `(function(id, patch){
  if (typeof window.POBridge !== 'object') return JSON.stringify({error:'NO_BRIDGE'});
  if (!window.Model.define.elements[id]) return JSON.stringify({error:'NOT_FOUND', id: id});
  var r = POBridge.updateNode(id, patch);
  var el = window.Model.define.elements[id];
  var p = (el && el.props) || {};
  var t = (el && el.textBlock && el.textBlock[0] && el.textBlock[0].text) || '';
  return JSON.stringify({id: r.id, updated: r.updated, actual: {x:p.x, y:p.y, w:p.w, h:p.h}, text: t});
})(${JSON.stringify(id)}, ${JSON.stringify(patch)})`;
}

/** 删除节点。 */
export function removeNodesExpr(ids) {
  return `(function(ids){
  if (typeof window.POBridge !== 'object') return JSON.stringify({error:'NO_BRIDGE'});
  if (!Array.isArray(ids) || !ids.length) return JSON.stringify({error:'EMPTY_IDS'});
  var r = POBridge.removeNodes(ids);
  var left = ids.filter(function(i){ return !!window.Model.define.elements[i]; });
  return JSON.stringify({removed: r.removed, stillThere: left});
})(${JSON.stringify(ids)})`;
}

/** 某 id 是否还在。用于超时重试前的幂等探测。 */
export function existsExpr(id) {
  return `(function(id){
  var e = window.Model && Model.define && Model.define.elements;
  return !!(e && e[id]);
})(${JSON.stringify(id)})`;
}

/** 整页适应（重绘会阻塞，调用方不要当失败处理）。 */
export const FIT_CANVAS = `(function(){
  try { Designer.fitTheCanvas(); return 'ok'; } catch(e) { return 'err:' + String(e); }
})()`;

/** 滚到指定图元。 */
export function focusExpr(ids) {
  return `(function(ids){
  try { Designer.scrollShapesToView(ids); return 'ok'; } catch(e) { return 'err:' + String(e); }
})(${JSON.stringify(ids)})`;
}

/** 视口范围，用来解释"坐标为什么被夹"。 */
export const VIEWBOX = `(function(){
  var vb = (window.Utils && Utils.canvasViewBox) || null;
  return JSON.stringify(vb);
})()`;

/** 泳道池边界（判断"图的下面"到底在哪）。 */
export const POOL_BOTTOM = `(function(){
  var e = window.Model.define.elements, id = null;
  for (var k in e) { if (/horizontalPool/i.test(e[k].name || '')) { id = k; break; } }
  if (!id) return JSON.stringify({error:'NO_POOL'});
  var p = e[id].props;
  return JSON.stringify({id: id, x: p.x, y: p.y, w: p.w, h: p.h, bottom: p.y + p.h});
})()`;

