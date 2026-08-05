/**
 * 极简 .env 加载器（infra，无第三方依赖）。
 *
 * 与 Node 内置 `process.loadEnvFile` / `--env-file` 的关键差别：**文件值优先**。
 * 原因：本工具的使用者往往已在 shell 里为「自己的 Claude Code」导出了
 * ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN。若沿用「环境变量优先」，用户在
 * .env 里为本工具写的评审端点会被那些环境变量静默劫持，改 .env 完全不生效 —— 极难排查。
 * .env 是本工具的显式配置文件，故让它压过环境里的同名变量。
 */

import { readFileSync } from 'node:fs';

/** 解析 .env 文本为键值对（不触碰 process.env，便于测试）。 */
export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, '');
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    // 去引号；未加引号时截掉行尾 ` # 注释`
    const quoted = value.match(/^(['"])([\s\S]*)\1$/);
    if (quoted) value = quoted[2] ?? '';
    else value = value.replace(/\s+#.*$/, '').trim();
    out[key] = value;
  }
  return out;
}

/**
 * 读取并应用 .env：文件里的非空值覆盖 process.env 同名项。
 * 空值（`KEY=`）视为「未配置」，不覆盖 —— 这样 .env.example 里留空的项
 * 不会把环境里已有的合法值擦掉。
 * 文件不存在或不可读时静默返回 null，全部回退到环境变量。
 */
export function loadDotEnv(path: string): Record<string, string> | null {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  const parsed = parseDotEnv(text);
  for (const [k, v] of Object.entries(parsed)) {
    if (v !== '') process.env[k] = v;
  }
  return parsed;
}
