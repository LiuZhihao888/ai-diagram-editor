/**
 * 路径解析：同一份代码要能在两种部署形态下找到注入层。
 *
 *   仓库内        wb/{bin,lib} + wb/pobridge.js
 *   技能运行时    <skill>/runtime/{bin,lib} + runtime/pobridge.js
 */

import fs from 'node:fs';
import path from 'node:path';

/** 注入层位置：显式指定 > 同级 > 上一级（兼容历史上的仓库根布局）。 */
export function resolveBridgeFile(root, env = process.env) {
  if (env.PO_BRIDGE_FILE && fs.existsSync(env.PO_BRIDGE_FILE)) return env.PO_BRIDGE_FILE;
  const candidates = [
    path.join(root, 'pobridge.js'),
    path.resolve(root, '..', 'pobridge.js'),
  ];
  return candidates.find((f) => fs.existsSync(f)) || candidates[0];
}
