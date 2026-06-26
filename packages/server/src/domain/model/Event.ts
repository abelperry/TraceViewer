/**
 * Event —— 实体（Entity）。
 *
 * 有身份标识（id），通过 parentId 与其他事件构成树。承载一组内容块，
 * 并提供围绕这些块的领域行为（是否含思考、是否含工具调用等）。
 */

import type { EventDTO, Role } from '@trace-review/shared';
import {
  type Block,
  ThinkingBlock,
  ToolCallBlock,
  ToolResultBlock,
} from './Block.js';

export class Event {
  constructor(
    readonly id: string,
    readonly parentId: string | null,
    readonly sessionId: string,
    readonly role: Role,
    readonly timestamp: Date | null,
    readonly isSidechain: boolean,
    readonly blocks: Block[],
  ) {}

  hasThinking(): boolean {
    return this.blocks.some((b) => b instanceof ThinkingBlock);
  }

  toolCalls(): ToolCallBlock[] {
    return this.blocks.filter((b): b is ToolCallBlock => b instanceof ToolCallBlock);
  }

  toolResults(): ToolResultBlock[] {
    return this.blocks.filter((b): b is ToolResultBlock => b instanceof ToolResultBlock);
  }

  hasToolCall(): boolean {
    return this.blocks.some((b) => b instanceof ToolCallBlock);
  }

  /** 是否为空事件（无任何有效块），用于过滤纯元数据记录。 */
  isEmpty(): boolean {
    return this.blocks.length === 0;
  }

  toDTO(): EventDTO {
    return {
      id: this.id,
      parentId: this.parentId,
      sessionId: this.sessionId,
      role: this.role,
      timestamp: this.timestamp ? this.timestamp.toISOString() : null,
      isSidechain: this.isSidechain,
      blocks: this.blocks.map((b) => b.toDTO()),
    };
  }
}
