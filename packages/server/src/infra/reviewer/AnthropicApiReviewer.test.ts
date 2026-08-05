import { describe, it, expect } from 'vitest';
import {
  AnthropicApiReviewer,
  DEFAULT_REVIEW_MODEL,
  extractJsonObject,
} from './AnthropicApiReviewer.js';

describe('AnthropicApiReviewer', () => {
  it('is not ready without a credential', () => {
    expect(new AnthropicApiReviewer({}).isReady()).toBe(false);
    expect(new AnthropicApiReviewer({ apiKey: '   ' }).isReady()).toBe(false);
    expect(new AnthropicApiReviewer({ authToken: '  ' }).isReady()).toBe(false);
  });

  it('is ready with either an api key or an auth token', () => {
    expect(new AnthropicApiReviewer({ apiKey: 'sk-test' }).isReady()).toBe(true);
    expect(new AnthropicApiReviewer({ authToken: 'tok-test' }).isReady()).toBe(true);
  });

  it('defaults model to claude-opus-5, overridable', () => {
    expect(new AnthropicApiReviewer({}).model).toBe(DEFAULT_REVIEW_MODEL);
    expect(DEFAULT_REVIEW_MODEL).toBe('claude-opus-5');
    expect(new AnthropicApiReviewer({ model: 'claude-sonnet-5' }).model).toBe('claude-sonnet-5');
    expect(new AnthropicApiReviewer({ model: '  ' }).model).toBe(DEFAULT_REVIEW_MODEL);
  });

  it('rejects review() when not ready', async () => {
    const reviewer = new AnthropicApiReviewer({});
    await expect(
      reviewer.review({ session: {} as never, events: [] }),
    ).rejects.toThrow(/not ready/);
  });
});

describe('extractJsonObject', () => {
  const obj = '{"score":4,"findings":[{"a":1}]}';

  it('passes through bare JSON', () => {
    expect(extractJsonObject(obj)).toBe(obj);
    expect(extractJsonObject(`  ${obj}\n`)).toBe(obj);
  });

  it('strips ```json fences (the third-party gateway case)', () => {
    expect(extractJsonObject('```json\n' + obj + '\n```')).toBe(obj);
    expect(extractJsonObject('```\n' + obj + '\n```')).toBe(obj);
  });

  it('strips surrounding prose and keeps nested braces', () => {
    expect(extractJsonObject(`好的，评审结果如下：\n${obj}\n希望有帮助。`)).toBe(obj);
  });

  it('throws with a snippet when no object is present', () => {
    expect(() => extractJsonObject('对不起，我无法评审。')).toThrow(/no JSON object/);
    expect(() => extractJsonObject('')).toThrow(/no JSON object/);
  });
});
