/** 极简参数解析（无依赖）。支持 `--key value` / `--key=value` / `--flag`。 */

export function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { args._.push(...argv.slice(i + 1)); break; }
    if (!a.startsWith('--')) { args._.push(a); continue; }
    const eq = a.indexOf('=');
    if (eq > -1) { args[a.slice(2, eq)] = a.slice(eq + 1); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) args[key] = true;
    else { args[key] = next; i++; }
  }
  return args;
}

/** 数字参数：undefined/true → undefined，避免 `Number(true)===1` 这类暗坑。 */
export function num(v) {
  if (v === undefined || v === true || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** 布尔参数：`--x` 为 true，`--x false` / `--x 0` 为 false。 */
export function flag(v) {
  if (v === undefined) return false;
  if (v === true) return true;
  return !/^(false|0|no|off)$/i.test(String(v));
}
