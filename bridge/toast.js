/**
 * 书签/控制台注入成功后的提示条。
 *
 * 单独成文件是因为它只属于「人工点书签」这条路 —— AI 自动化不需要吐司
 * （改动直接出现在用户眼前，弹个提示反而干扰）。
 */
(function () {
  var old = document.getElementById('__dc_toast__');
  if (old) old.remove();

  var d = document.createElement('div');
  d.id = '__dc_toast__';
  d.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;'
    + 'background:#10b981;color:#fff;padding:12px 20px;border-radius:9px;'
    + 'font:600 14px -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;'
    + 'box-shadow:0 8px 28px rgba(16,185,129,.4)';

  try {
    var g = POBridge.readGraph();
    d.textContent = 'ProcessOn AI 助手已就绪 · ' + g.nodes.length + ' 个图元';
  } catch (e) {
    d.style.background = '#dc2626';
    d.textContent = '注入失败：' + String(e && e.message || e).slice(0, 60);
  }

  document.body.appendChild(d);
  setTimeout(function () {
    d.style.transition = 'opacity .4s';
    d.style.opacity = '0';
    setTimeout(function () { d.remove(); }, 400);
  }, 3000);
})();
