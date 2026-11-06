#!/usr/bin/env node
/**
 * 打包「给同事的成品包」：两个方案各自一个 zip，互不纠缠。
 *
 *   node tools/build-dist.mjs          # 生成两个目录 + 两个 zip
 *   node tools/build-dist.mjs --no-zip # 只生成目录
 *
 * 为什么拆成两个包而不是一个：
 *   两个方案的安装门槛差一个量级 —— WorkBuddy 只要 Node，DSH 要先装 DSH 本体
 *   + 第三方浏览器扩展。塞进一个包里，只想画图的同事会被 DSH 那一坨劝退。
 *   拆开之后每个包的「装什么」都能一页写完。
 *
 *   另外这个扩展（DSH Browser Control）是插件市场里的第三方作品，
 *   不是本项目原创，不随仓库分发 —— 两个包都不含它。
 *
 * 源全部来自仓库（可复现）：
 *   dsh/            → 01-DSH方案
 *   wb/ + 技能文档   → 02-WorkBuddy方案
 *   packaging/*.md  → 各安装指南与总 README
 *   packaging/     → 03-通用工具（书签代码由 bridge/build.mjs 生成）
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');   // 仓库根（脚本在 wb/tools/ 下）
const DIST = path.join(ROOT, 'dist');
// 两个方案 = 两个独立包。名字对齐产物，同事下载后一眼知道装哪个。
const PKG_DSH = path.join(DIST, 'DSH方案');
const PKG_WB = path.join(DIST, 'WorkBuddy方案');
const ZIP_DSH = path.join(DIST, 'DSH方案.zip');
const ZIP_WB = path.join(DIST, 'WorkBuddy方案.zip');
const SKILL_DIR = process.env.PO_SKILL_DIR
  || path.join(os.homedir(), '.workbuddy', 'skills', 'wb-processon-diagram-editor');

const noZip = process.argv.includes('--no-zip');

/**
 * 自底向上手动删除，删完校验。
 *
 * 为什么不用 fs.rmSync(recursive)：
 *   Windows 上目录被 Explorer / 杀软 / 索引服务持有句柄时，rmSync 会「返回成功但没删掉」——
 *   不抛异常、不报错，dist/ 里就会残留上一版的文件（真的踩过：
 *   改名后 dist 里同时存在新旧两个技能目录，分发包把废弃技能一起发给了同事）。
 *   手动遍历 + 删后校验能把这种情况变成明确失败，而不是静默半成品。
 */
function rmrf(p) {
  if (!fs.existsSync(p)) return;
  const walk = (target) => {
    let st;
    try { st = fs.lstatSync(target); } catch { return; }
    if (st.isDirectory()) {
      for (const name of fs.readdirSync(target)) walk(path.join(target, name));
      try { fs.rmdirSync(target); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    } else {
      try { fs.unlinkSync(target); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
  };
  walk(p);
  if (fs.existsSync(p)) {
    throw new Error('删除失败：' + p + ' 仍然存在（可能有程序占用该目录）。请关掉资源管理器预览/杀软实时扫描后重试。');
  }
}
function mkdir(p) { fs.mkdirSync(p, { recursive: true }); }
function copyDir(from, to, filter = () => true) {
  mkdir(to);
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (!filter(e)) continue;
    const s = path.join(from, e.name);
    const d = path.join(to, e.name);
    if (e.isDirectory()) copyDir(s, d, filter);
    else fs.copyFileSync(s, d);
  }
}
function copyFile(from, to) {
  mkdir(path.dirname(to));
  fs.copyFileSync(from, to);
}
function mustExist(p, what) {
  if (!fs.existsSync(p)) {
    console.error(`✗ 缺少${what}：${p}`);
    process.exit(2);
  }
  return p;
}

// ---------- DSH 方案 ----------
// 只放「技能包 + 安装指南」。浏览器扩展是第三方作品，不随包分发。
rmrf(PKG_DSH);
mkdir(PKG_DSH);
copyDir(mustExist(path.join(ROOT, 'dsh', 'skill', 'dsh-processon-diagram-editor'), 'DSH 技能包'),
  path.join(PKG_DSH, 'dsh-processon-diagram-editor'));
copyFile(mustExist(path.join(ROOT, 'packaging', '01-DSH方案-安装指南.md'), 'DSH 安装指南'),
  path.join(PKG_DSH, '安装指南.md'));
// 通用工具（书签 / 控制台）跟着 DSH 包一起走：两者都不需要任何扩展
{
  const common = path.join(PKG_DSH, '通用工具');
  rmrf(common);
  mkdir(common);
  const skillRoot = path.join(ROOT, 'dsh', 'skill', 'dsh-processon-diagram-editor');
  copyFile(mustExist(path.join(skillRoot, 'pobridge.min.js'), '桥接层压缩版'),
    path.join(common, 'pobridge.min.js'));
  copyFile(mustExist(path.join(skillRoot, 'scripts', 'bookmarklet.txt'), '书签代码'),
    path.join(common, '书签代码.txt'));
  {
    // 控制台代码：同一个书签内容，去掉 javascript: 前缀即可直接贴控制台
    const bm = fs.readFileSync(path.join(skillRoot, 'scripts', 'bookmarklet.txt'), 'utf8');
    fs.writeFileSync(path.join(common, '控制台代码.js'), decodeURIComponent(bm.replace(/^javascript:/, '')) + '\n');
  }
  copyFile(mustExist(path.join(ROOT, 'packaging', '03-书签安装页.html'), '书签安装页'),
    path.join(common, '书签安装页.html'));
  copyFile(mustExist(path.join(ROOT, 'packaging', '03-通用工具-说明.md'), '通用工具说明'),
    path.join(common, '说明.md'));
}

// ---------- WorkBuddy 方案 ----------
rmrf(PKG_WB);
mkdir(PKG_WB);
copyDir(path.join(ROOT, 'wb', 'bin'), path.join(PKG_WB, 'bin'));
copyDir(path.join(ROOT, 'wb', 'lib'), path.join(PKG_WB, 'lib'));
copyFile(path.join(ROOT, 'wb', 'pobridge.js'), path.join(PKG_WB, 'pobridge.js'));
{
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'wb', 'package.json'), 'utf8'));
  fs.writeFileSync(path.join(PKG_WB, 'package.json'), JSON.stringify({
    name: 'pocli', version: pkg.version, private: true, type: 'module',
    description: 'ProcessOn 画布增量改图 CLI（WorkBuddy 后端）',
    bin: { pocli: './bin/pocli.mjs' },
    scripts: { smoke: 'node test/smoke.mjs', selftest: 'node test/selftest.mjs' },
    dependencies: pkg.dependencies,
  }, null, 2) + '\n');
}
copyDir(path.join(ROOT, 'wb', 'test'), path.join(PKG_WB, 'test'), (e) => e.name !== 'out');
// 技能包（自带运行时源码，不含 node_modules）
{
  const skillOut = path.join(PKG_WB, 'wb-processon-diagram-editor');
  rmrf(skillOut);
  copyFile(path.join(SKILL_DIR, 'SKILL.md'), path.join(skillOut, 'SKILL.md'));
  copyDir(path.join(SKILL_DIR, 'runtime'), path.join(skillOut, 'runtime'),
    (e) => e.name !== 'node_modules' && e.name !== '.pocli-state.json' && e.name !== 'package-lock.json');
}
copyFile(mustExist(path.join(ROOT, 'packaging', '02-WorkBuddy方案-安装指南.md'), 'WorkBuddy 安装指南'),
  path.join(PKG_WB, '安装指南.md'));

// ---------- zip ----------
if (!noZip) {
  // 用相对路径：bsdtar 会把 "D:\..." 里的盘符当成远程主机名
  const jobs = [[PKG_DSH, ZIP_DSH], [PKG_WB, ZIP_WB]];
  for (const [pkgDir, zipPath] of jobs) {
    rmrf(zipPath);
    try {
      execFileSync('tar', ['-a', '-c', '-f', path.basename(zipPath), path.basename(pkgDir)],
        { cwd: DIST, stdio: 'inherit' });
    } catch {
      console.error('✗ 打包失败（tar -a 需要 Windows 10+ 自带的 bsdtar）');
      process.exit(3);
    }
  }
}

const count = (d) => fs.readdirSync(d, { recursive: true })
  .filter((f) => fs.statSync(path.join(d, f)).isFile()).length;
for (const [pkgDir, zipPath] of [[PKG_DSH, ZIP_DSH], [PKG_WB, ZIP_WB]]) {
  const kb = fs.existsSync(zipPath) ? (fs.statSync(zipPath).size / 1024).toFixed(0) + ' KB' : '-';
  console.log('✓ ' + path.basename(zipPath) + '  ' + count(pkgDir) + ' 个文件  ' + kb);
}
