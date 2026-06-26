import type { TokenUsageDTO } from '@trace-review/shared';

/** TokenUsage —— 值对象。不可变，提供累加语义。 */
export class TokenUsage {
  constructor(
    readonly input: number = 0,
    readonly output: number = 0,
  ) {}

  get total(): number {
    return this.input + this.output;
  }

  add(other: TokenUsage): TokenUsage {
    return new TokenUsage(this.input + other.input, this.output + other.output);
  }

  toDTO(): TokenUsageDTO {
    return { input: this.input, output: this.output, total: this.total };
  }

  static zero(): TokenUsage {
    return new TokenUsage(0, 0);
  }
}
