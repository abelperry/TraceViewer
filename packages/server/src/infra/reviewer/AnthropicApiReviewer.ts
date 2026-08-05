/**
 * AnthropicApiReviewer —— Reviewer 端口的默认实现（infra，反向依赖 domain）。
 *
 * 用官方 @anthropic-ai/sdk 调用 Messages API，产出 ReviewDraft（zod 校验）。
 * 鉴权支持两种：apiKey（x-api-key）或 authToken（Authorization: Bearer，适配代理网关）；
 * baseURL 可指向中转端点。任一凭据缺失时 isReady()=false，例行跳过、手动 409。
 * 读 ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / ANTHROPIC_BASE_URL / REVIEW_MODEL。
 *
 * 兼容性：官方端点用原生结构化输出 + adaptive thinking；自定义 baseURL（第三方
 * Anthropic 兼容网关，如 GLM/Kimi 中转）自动降级为「提示词约定 JSON + 宽松解析」，
 * 因为网关通常忽略 output_config 且会回带 ```json 围栏。
 *
 * 依赖方向：实现 domain 端口，唯一的对外数据出口（把裁剪后的 trace 文本发给 Anthropic）。
 */

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
// SDK 的 zodOutputFormat 基于 zod v4 类型；zod 3.25+ 通过 zod/v4 子路径提供。
import { z } from 'zod/v4';
import {
  ReviewInputBuilder,
  type Reviewer,
  type ReviewInput,
  type ReviewDraft,
} from '../../domain/index.js';

/** REVIEW_MODEL 未配置时的默认模型（质量优先）。 */
export const DEFAULT_REVIEW_MODEL = 'claude-opus-5';

const DraftSchema = z.object({
  score: z.number().int().min(1).max(5).describe('总体质量分，1（差）到 5（优）'),
  summary: z.string().describe('一句话总体评价，用于信息流那一行'),
  findings: z
    .array(
      z.object({
        category: z.enum(['agent', 'prompt']).describe('agent=agent 不足；prompt=人类 prompt 不足'),
        severity: z.enum(['high', 'medium', 'low']),
        title: z.string().describe('一句话问题'),
        detail: z.string().describe('展开说明'),
        suggestion: z.string().describe('针对本条的可操作建议'),
        evidenceEventIndexes: z
          .array(z.number().int())
          .describe('证据事件序号（transcript 中的 #index），拿不到给空数组'),
      }),
    )
    .describe('问题列表，可为空数组'),
});

const SYSTEM_PROMPT = `你是一名严格的 agent 运行轨迹（trace）评审员。给你一段 Claude Code / Codex 的运行轨迹，
每个事件以 "#index <role>" 开头，index 是证据序号。请从两个维度审阅并给出可操作反馈：

【agent 侧（agent 的不足）】
- 是否正确理解任务；工具使用是否高效（重复读同一文件、无效命令、走弯路）；
- 是否有幻觉或未验证即声称完成；是否忽略了错误信号；自主程度是否得当。

【prompt 侧（人类 prompt 的不足）】
- 需求是否清晰；是否缺少必要上下文与约束；目标是否可验证；是否频繁改需求或打断。

评分口径（1–5 的整数）：5=近乎无瑕；4=良好小瑕；3=中等、有明显可改进项；2=较多问题；1=严重失败。
每条 finding 必须：category/severity 合法，title/detail/suggestion 都非空，尽量给出 evidenceEventIndexes
（引用相关事件的 #index；确实无法定位则给空数组）。summary 用一句话概括整体表现。
只输出结构化结果，不要额外解释。`;

/** 非原生结构化输出（第三方网关）时追加的 JSON 契约说明。 */
const JSON_CONTRACT = `

只输出一个 JSON 对象，不要 markdown 代码围栏、不要前后任何解释文字。格式：
{"score":<1-5 整数>,"summary":"<一句话>","findings":[{"category":"agent"|"prompt","severity":"high"|"medium"|"low","title":"...","detail":"...","suggestion":"...","evidenceEventIndexes":[<整数>]}]}
findings 可以是空数组 []。`;

/**
 * 从模型回复里抽出 JSON 对象文本。
 *
 * 兼容第三方网关的常见包装：```json 围栏、前后寒暄文字。
 * 策略：先剥围栏，再取第一个 `{` 到最后一个 `}`（findings 内含嵌套对象，故不能取第一个 `}`）。
 */
export function extractJsonObject(raw: string): string {
  let s = raw.trim();
  // 剥 ``` / ```json 围栏
  const fence = s.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);
  if (fence?.[1]) s = fence[1].trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`reviewer returned no JSON object: ${raw.slice(0, 200)}`);
  }
  return s.slice(start, end + 1);
}

export interface AnthropicApiReviewerOptions {
  apiKey?: string;
  /** 代理网关鉴权令牌 → Authorization: Bearer <token>。 */
  authToken?: string;
  /** 自定义 / 中转端点；留空用官方默认。 */
  baseURL?: string;
  model?: string;
  /**
   * 是否使用 Anthropic 原生特性（output_config 结构化输出 + adaptive thinking）。
   * 默认按端点推断：官方端点=true；自定义 baseURL（第三方网关，如 GLM/Kimi 中转）=false，
   * 因为网关通常忽略 output_config 并回带 ```json 围栏，改走「提示词约定 + 宽松解析」。
   */
  nativeFeatures?: boolean;
  /** 生成上限（findings 通常不多，8k 足够）。 */
  maxTokens?: number;
  builder?: ReviewInputBuilder;
}

export class AnthropicApiReviewer implements Reviewer {
  readonly model: string;
  private readonly apiKey: string;
  private readonly authToken: string;
  private readonly baseURL: string | undefined;
  private readonly nativeFeatures: boolean;
  private readonly maxTokens: number;
  private readonly builder: ReviewInputBuilder;
  private client: Anthropic | null = null;

  constructor(opts: AnthropicApiReviewerOptions = {}) {
    this.apiKey = (opts.apiKey ?? '').trim();
    this.authToken = (opts.authToken ?? '').trim();
    this.baseURL = opts.baseURL?.trim() || undefined;
    this.model = (opts.model && opts.model.trim()) || DEFAULT_REVIEW_MODEL;
    this.nativeFeatures = opts.nativeFeatures ?? !this.baseURL;
    this.maxTokens = opts.maxTokens ?? 8000;
    this.builder = opts.builder ?? new ReviewInputBuilder();
  }

  isReady(): boolean {
    return this.apiKey.length > 0 || this.authToken.length > 0;
  }

  async review(input: ReviewInput): Promise<ReviewDraft> {
    if (!this.isReady())
      throw new Error(
        'AnthropicApiReviewer not ready: missing ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY',
      );
    const client = (this.client ??= new Anthropic({
      ...(this.apiKey ? { apiKey: this.apiKey } : {}),
      ...(this.authToken ? { authToken: this.authToken } : {}),
      ...(this.baseURL ? { baseURL: this.baseURL } : {}),
    }));
    const transcript = this.builder.render(input.session, input.events);

    // 统一走 create()，自己做宽松解析 + zod 校验：原生端点也能用，网关不会因
    // parsed_output 缺失而整体失败。原生特性仅在官方端点开启（网关多不支持）。
    const response = await client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system: this.nativeFeatures ? SYSTEM_PROMPT : SYSTEM_PROMPT + JSON_CONTRACT,
      messages: [{ role: 'user', content: transcript }],
      ...(this.nativeFeatures
        ? {
            thinking: { type: 'adaptive' as const },
            output_config: { format: zodOutputFormat(DraftSchema) },
          }
        : {}),
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    if (!text) throw new Error('reviewer returned empty response');

    return DraftSchema.parse(JSON.parse(extractJsonObject(text))) as ReviewDraft;
  }
}
