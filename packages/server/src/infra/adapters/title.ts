import type { Event } from '../../domain/index.js';
import { TextBlock } from '../../domain/index.js';

/** 整段都是 environment_context / 命令包裹等样板，不宜作标题。 */
const BOILERPLATE_RE = /^<(environment_context|command-name|command-message|local-command|user-prompt-submit-hook|system-reminder)\b/i;

/** 去掉首尾 XML 包裹标签，提取可读正文。 */
function cleanText(raw: string): string {
  let t = raw.trim();
  if (BOILERPLATE_RE.test(t)) return ''; // 整段样板，跳过
  // 去掉零散的 <tag>…</tag> 包裹，仅保留可读文字
  t = t.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return t;
}

/**
 * 从用户消息推断标题：跳过 environment_context 等样板，
 * 取第一条有真实内容的用户文本。供各 adapter 复用。
 */
export function deriveTitle(events: Event[]): string | null {
  for (const e of events) {
    if (e.role !== 'user') continue;
    for (const b of e.blocks) {
      if (b instanceof TextBlock) {
        const text = cleanText(b.text);
        if (text) return text.slice(0, 80);
      }
    }
  }
  return null;
}
