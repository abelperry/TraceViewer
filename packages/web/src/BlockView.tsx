import type { BlockDTO } from '@trace-review/shared';
import { CodeBox } from './CodeBox';
import { ToolCallView } from './ToolRenderers';
import { Markdown } from './Markdown';

export function BlockView({ block }: { block: BlockDTO }) {
  switch (block.type) {
    case 'text':
      return (
        <div className="block block-text">
          <Markdown text={block.text} />
        </div>
      );

    case 'thinking':
      return (
        <div className="block block-thinking">
          <details>
            <summary className="label">thinking</summary>
            <div className="block-text" style={{ marginTop: 6 }}>
              {block.text}
            </div>
          </details>
        </div>
      );

    case 'tool_call':
      return <ToolCallView block={block} />;

    case 'tool_result':
      return (
        <div className={`block tool-result ${block.isError ? 'error' : ''}`}>
          <div className="result-label">{block.isError ? '✕ error' : 'result'}</div>
          <CodeBox text={truncate(block.output, 8000)} />
        </div>
      );

    case 'image':
      return (
        <div className="block">
          {block.dataUrl ? (
            <a href={block.dataUrl} target="_blank" rel="noreferrer">
              <img className="block-image" src={block.dataUrl} alt={block.mediaType ?? 'image'} />
            </a>
          ) : (
            <span className="img-placeholder">🖼 {block.mediaType ?? 'image'}（无数据）</span>
          )}
        </div>
      );

    default:
      return null;
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}\n… [truncated ${s.length - max} chars]` : s;
}
