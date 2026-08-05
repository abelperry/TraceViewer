import { describe, it, expect } from 'vitest';
import { parseDotEnv } from './loadDotEnv.js';

describe('parseDotEnv', () => {
  it('parses simple KEY=VALUE pairs', () => {
    expect(parseDotEnv('A=1\nB=two')).toEqual({ A: '1', B: 'two' });
  });

  it('skips comments and blank lines', () => {
    expect(parseDotEnv('# note\n\n  \nA=1\n#B=2')).toEqual({ A: '1' });
  });

  it('keeps empty values (meaning "unset")', () => {
    expect(parseDotEnv('A=\nB=1')).toEqual({ A: '', B: '1' });
  });

  it('strips quotes and trailing inline comments', () => {
    expect(parseDotEnv('A="a b"')).toEqual({ A: 'a b' });
    expect(parseDotEnv("A='a b'")).toEqual({ A: 'a b' });
    expect(parseDotEnv('A=1 # why')).toEqual({ A: '1' });
    // 引号内的 # 必须保留
    expect(parseDotEnv('A="v#1"')).toEqual({ A: 'v#1' });
  });

  it('preserves URLs and tokens verbatim', () => {
    const p = parseDotEnv(
      'ANTHROPIC_BASE_URL=https://open.bigmodel.cn/api/anthropic\nT=ab.cd-ef_gh',
    );
    expect(p.ANTHROPIC_BASE_URL).toBe('https://open.bigmodel.cn/api/anthropic');
    expect(p.T).toBe('ab.cd-ef_gh');
  });

  it('tolerates `export ` prefix and ignores malformed lines', () => {
    expect(parseDotEnv('export A=1\nnoequals\n=novalue\n1BAD=x')).toEqual({ A: '1' });
  });
});
