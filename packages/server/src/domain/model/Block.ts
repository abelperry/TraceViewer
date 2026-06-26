/**
 * Block —— 值对象（Value Object）。
 *
 * 不可变、无身份标识，由内容决定相等性。所有「块」语义内聚于此，
 * 例如工具调用与结果的配对判断 {@link ToolCallBlock.pairsWith}。
 *
 * 这是 domain 内核的一部分：零框架依赖，可独立单测。
 */

import type { BlockDTO, BlockType, Role } from '@trace-review/shared';

export abstract class Block {
  abstract readonly type: BlockType;
  abstract toDTO(): BlockDTO;
}

export class TextBlock extends Block {
  override readonly type = 'text' as const;
  constructor(readonly text: string) {
    super();
  }
  override toDTO(): BlockDTO {
    return { type: 'text', text: this.text };
  }
}

export class ThinkingBlock extends Block {
  override readonly type = 'thinking' as const;
  constructor(readonly text: string) {
    super();
  }
  override toDTO(): BlockDTO {
    return { type: 'thinking', text: this.text };
  }
}

export class ToolCallBlock extends Block {
  override readonly type = 'tool_call' as const;
  constructor(
    readonly callId: string,
    readonly name: string,
    readonly input: unknown,
  ) {
    super();
  }

  /** 判断给定结果块是否为本次调用的返回。配对语义内聚在领域。 */
  pairsWith(result: ToolResultBlock): boolean {
    return result.callId === this.callId;
  }

  override toDTO(): BlockDTO {
    return { type: 'tool_call', callId: this.callId, name: this.name, input: this.input };
  }
}

export class ToolResultBlock extends Block {
  override readonly type = 'tool_result' as const;
  constructor(
    readonly callId: string,
    readonly output: string,
    readonly isError: boolean,
  ) {
    super();
  }
  override toDTO(): BlockDTO {
    return { type: 'tool_result', callId: this.callId, output: this.output, isError: this.isError };
  }
}

export class ImageBlock extends Block {
  override readonly type = 'image' as const;
  constructor(
    readonly placeholder: string,
    readonly mediaType?: string,
  ) {
    super();
  }
  override toDTO(): BlockDTO {
    return { type: 'image', placeholder: this.placeholder, mediaType: this.mediaType };
  }
}

export type { BlockType, Role };
