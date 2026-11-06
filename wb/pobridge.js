(function(){
/**
 * ProcessOn 运行时桥接层 —— 在浏览器控制台/扩展注入环境中执行
 *
 * 已实测通过的能力：
 *   readGraph()            读取完整语义图（节点 + 连线 + 泳道）
 *   createNode(opts)       创建节点（红色标记），立即渲染
 *   updateNode(id, patch)  修改节点属性/样式
 *   removeNodes([ids])     删除节点
 *   createEdge(opts)       创建连线
 *
 * 关键机制（都是踩坑换来的）：
 *   1. 必须走 MessageSource.executeMessages(action, init=true)
 *      —— 它内部会调 Schema.initShapeFunctions() + Designer.painter.renderShape()
 *      —— 直接用 Model.addMulti() 只会改数据，画布不重绘
 *   2. 坐标必须落在 Utils.canvasViewBox 内
 *      —— renderShape 第一行就是 isInCanvasView()，不在视口内直接 remove() 并 return
 *      —— viewBox.x === layout.scrollLeft - 1200
 *   3. 颜色格式是 RGB 逗号串，不是 #hex
 *      fillStyle:    { drawType:'fill', fill:'255,0,0', alpha:1 }
 *      lineStyle:    { lineWidth:2, lineColor:'255,0,0', lineStyle:'solid' }
 *      fontStyle:    { fontColor:'255,0,0' }
 *   4. 节点要带 children:[] 和 attribute 完整对象，否则渲染器可能跳过
 */
(function (global) {
  'use strict';

  // ---------- 颜色常量 ----------
  var RED = {
    fill: '255,235,235',
    line: '255,0,0',
    font: '255,0,0'
  };

  function ensureRuntime() {
    var missing = [];
    if (!global.Model) missing.push('Model');
    if (!global.Designer) missing.push('Designer');
    if (!global.Utils) missing.push('Utils');
    if (!global.MessageSource) missing.push('MessageSource');
    if (missing.length) {
      throw new Error('ProcessOn 运行时未就绪，缺少: ' + missing.join(', ') +
        '。请确认当前页面是 wps.processon.com/diagrams/edit');
    }
  }

  // ---------- 读取 ----------
  function readGraph() {
    ensureRuntime();
    var els = global.Model.define.elements || {};
    var nodes = [], edges = [];

    Object.keys(els).forEach(function (id) {
      var e = els[id];
      if (!e) return;
      var isEdge = (e.name === 'linker') || !!e.from || !!e.to;
      var text = '';
      if (e.textBlock) {
        for (var i = 0; i < e.textBlock.length; i++) {
          if (e.textBlock[i] && e.textBlock[i].text) {
            text += (text ? ' ' : '') + e.textBlock[i].text;
          }
        }
      }
      if (isEdge) {
        edges.push({
          id: id,
          from: (e.from && e.from.id) || '',
          to: (e.to && e.to.id) || '',
          text: e.text || text || '',
          points: e.points || []
        });
      } else {
        var p = e.props || {};
        nodes.push({
          id: id,
          name: e.name || '',
          title: e.title || '',
          text: text,
          x: p.x || 0, y: p.y || 0, w: p.w || 0, h: p.h || 0,
          zindex: p.zindex || 0,
          parent: e.parent || '',
          isLane: /Lane|Pool/i.test(e.name || '')
        });
      }
    });

    return {
      page: global.Model.define.page,
      nodes: nodes,
      edges: edges
    };
  }

  // ---------- 视口工具 ----------
  // canvasViewBox 可能是半初始化状态（NaN），必须在源头断言，
  // 否则夹取结果会是 NaN，节点静默消失，排查起来极难。
  function getViewBox() {
    ensureRuntime();
    var vb = global.Utils.canvasViewBox;
    if (!vb || typeof vb.w !== 'number' || typeof vb.h !== 'number' ||
        !isFinite(vb.x) || !isFinite(vb.y) || !isFinite(vb.w) || !isFinite(vb.h)) {
      throw new Error('VIEWBOX_INVALID: canvasViewBox 不可用 —— ' + JSON.stringify(vb));
    }
    return vb;
  }

  // 把视口滚动到能看见 rect 的位置。只改 scrollLeft/scrollTop，不调 fitTheCanvas —— 
  // fitTheCanvas 会重置用户的缩放并阻塞重绘，是真正的"打扰"。
  function focusRect(x, y, w, h) {
    ensureRuntime();
    if (![x, y, w, h].every(function (v) { return typeof v === 'number' && isFinite(v); })) {
      throw new Error('FOCUS_RECT_INVALID: 需要 4 个有限数，收到 ' + JSON.stringify([x, y, w, h]));
    }
    var layout = document.getElementById('designer_layout');
    if (!layout) throw new Error('FOCUS_NO_LAYOUT: 找不到 #designer_layout');

    var vb = global.Utils.canvasViewBox;
    var before = { scrollLeft: layout.scrollLeft, scrollTop: layout.scrollTop };

    // 让目标矩形居中；ProcessOn 的 viewBox 已含 expand margin，直接用即可
    var targetLeft = x + w / 2 - vb.w / 2;
    var targetTop = y + h / 2 - vb.h / 2;

    layout.scrollLeft = targetLeft;
    layout.scrollTop = targetTop;

    // 同步缓存，避免后续读坐标用旧 viewBox
    try { global.Utils.canvasViewBoxUpdate(); } catch (e) { /* 只读刷新失败不影响滚动 */ }

    var after = { scrollLeft: layout.scrollLeft, scrollTop: layout.scrollTop };
    return {
      requested: { scrollLeft: targetLeft, scrollTop: targetTop },
      actual: after,
      before: before,
      viewBox: global.Utils.canvasViewBox
    };
  }

  // 把任意坐标夹取到当前视口内，保证能被渲染。
  // 返回值带 requested/actual/clamped —— 调用方必须能看见"被夹了"，而不是只拿到结果坐标。
  function clampIntoView(x, y, w, h) {
    var vb = getViewBox();
    var margin = 60;
    var minX = vb.x + margin, maxX = vb.x + vb.w - w - margin;
    var minY = vb.y + margin, maxY = vb.y + vb.h - h - margin;
    var nx = (maxX < minX) ? (vb.x + (vb.w - w) / 2) : Math.max(minX, Math.min(x, maxX));
    var ny = (maxY < minY) ? (vb.y + (vb.h - h) / 2) : Math.max(minY, Math.min(y, maxY));
    var ax = Math.round(nx), ay = Math.round(ny);
    return {
      x: ax,
      y: ay,
      requested: { x: x, y: y },
      actual: { x: ax, y: ay },
      clamped: (Math.abs(ax - x) > 1) || (Math.abs(ay - y) > 1)
    };
  }

  // ---------- 创建节点 ----------
  function buildNode(opts) {
    var o = opts || {};
    var w = o.w || 220;
    var h = o.h || 90;

    var pos = clampIntoView(o.x || 0, o.y || 0, w, h);
    var __reqX = o.x, __reqY = o.y;

    var fill = o.fill || RED.fill;
    var line = o.line || RED.line;
    var font = o.font || RED.font;

    var __node = {
      id: o.id || ('ai_node_' + Date.now() + '_' + Math.floor(Math.random() * 1e6)),
      name: o.name || 'process',
      title: o.title || '流程',
      parent: '',
      container: '',
      link: '',
      children: [],
      shapeStyle: { alpha: 1 },
      fillStyle: fill ? { drawType: 'fill', fill: fill, alpha: 1 } : {},
      lineStyle: { lineWidth: o.lineWidth || 2, lineColor: line, lineStyle: 'solid' },
      fontStyle: font ? { fontColor: font } : {},
      textBlock: [{
        position: { w: 'w-20', x: 10, h: 'h', y: 0 },
        text: o.text || ''
      }],
      anchors: [
        { x: 'w/2', y: '0' }, { x: 'w/2', y: 'h' },
        { x: '0', y: 'h/2' }, { x: 'w', y: 'h/2' }
      ],
      dataAttributes: [],
      props: {
        zindex: o.zindex || 900,
        x: pos.x, y: pos.y,
        w: w, h: h,
        angle: 0
      },
      path: [{
        fillStyle: { type: 'none' },
        actions: [
          { x: '0', action: 'move', y: '0' },
          { x: 'w', action: 'line', y: '0' },
          { x: 'w', action: 'line', y: 'h' },
          { x: '0', action: 'line', y: 'h' },
          { x: '0', action: 'line', y: '0' }
        ]
      }],
      attribute: {
        container: false, rotatable: true, visible: true,
        fixedLink: false, collapsable: false, collapsed: false,
        linkable: true, markerOffset: 5
      },
      resizeDir: '',
      group: '',
      locked: false,
      category: 'default',
      theme: {}
    };
    // 记录"我要放哪"和"实际放哪"，让调用方能判断是否被夹
    if (pos.clamped) {
      __node.__clamped = true;
      __node.__requested = { x: __reqX != null ? __reqX : pos.x, y: __reqY != null ? __reqY : pos.y };
    }
    return __node;
  }

  function createNode(opts) {
    ensureRuntime();
    var node = buildNode(opts);
    global.MessageSource.executeMessages([{ action: 'create', content: [node] }], true);
    return {
      id: node.id,
      rendered: !!document.getElementById(node.id),
      props: node.props,
      // 被静默夹走时调用方必须知道 —— 否则会以为放对了
      clamped: node.__clamped === true,
      requested: node.__requested || null,
      actual: { x: node.props.x, y: node.props.y }
    };
  }

  // ---------- 更新节点 ----------
  function updateNode(id, patch) {
    ensureRuntime();
    var src = global.Model.define.elements[id];
    if (!src) throw new Error('节点不存在: ' + id);
    var next = JSON.parse(JSON.stringify(src));
    var p = patch || {};
    ['x', 'y', 'w', 'h', 'zindex'].forEach(function (k) {
      if (p[k] !== undefined) next.props[k] = p[k];
    });
    if (p.text !== undefined && next.textBlock && next.textBlock[0]) {
      next.textBlock[0].text = p.text;
    }
    if (p.fill !== undefined) {
      next.fillStyle = p.fill ? { drawType: 'fill', fill: p.fill, alpha: 1 } : {};
    }
    if (p.line !== undefined) {
      next.lineStyle = Object.assign({}, next.lineStyle, { lineColor: p.line });
    }
    if (p.font !== undefined) {
      next.fontStyle = Object.assign({}, next.fontStyle, { fontColor: p.font });
    }
    global.MessageSource.executeMessages(
      [{ action: 'update', content: { shapes: [next], updates: [next] } }],
      true
    );
    return { id: id, updated: true };
  }

  // ---------- 删除 ----------
  function removeNodes(ids) {
    ensureRuntime();
    var list = (ids || []).map(function (id) { return global.Model.define.elements[id]; })
                         .filter(Boolean);
    if (!list.length) return { removed: 0 };
    global.MessageSource.executeMessages([{ action: 'remove', content: list }], true);
    return { removed: list.length };
  }

  // ---------- 连线 ----------
  function createEdge(opts) {
    ensureRuntime();
    var o = opts || {};
    var from = global.Model.define.elements[o.from];
    var to = global.Model.define.elements[o.to];
    if (!from || !to) throw new Error('连线端点不存在: ' + o.from + ' -> ' + o.to);

    var fx = from.props.x + from.props.w / 2, fy = from.props.y + from.props.h / 2;
    var tx = to.props.x + to.props.w / 2, ty = to.props.y + to.props.h / 2;

    var edge = {
      id: o.id || ('ai_edge_' + Date.now()),
      name: 'linker',
      text: o.text || '',
      points: [{ x: fx, y: fy }, { x: tx, y: ty }],
      dataAttributes: [],
      props: { zindex: 950, x: 0, y: 0 },
      linkerType: 'broken',
      lineStyle: { lineWidth: o.lineWidth || 2, lineColor: o.line || RED.line },
      from: { x: fx, y: fy, angle: 0, id: o.from },
      to: { x: tx, y: ty, angle: 0, id: o.to },
      textBlock: o.text
        ? [{ position: { w: 'w', x: 0, h: 'h', y: 0 }, text: o.text }]
        : [],
      group: '',
      locked: false
    };
    global.MessageSource.executeMessages([{ action: 'create', content: [edge] }], true);
    return { id: edge.id };
  }

  // ---------- 导出 ----------
  global.POBridge = {
    RED: RED,
    readGraph: readGraph,
    createNode: createNode,
    updateNode: updateNode,
    removeNodes: removeNodes,
    createEdge: createEdge,
    getViewBox: getViewBox,
    clampIntoView: clampIntoView,
    focusRect: focusRect
  };

  return global.POBridge;
})(window);
})();
