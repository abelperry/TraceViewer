import type { BlockDTO } from '@trace-review/shared';

export function BlockView({ block }: { block: BlockDTO }) {
  switch (block.type) {
    case 'text':
      return <div className="block block-text">{block.text}</div>;

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
      return (
        <div className="block tool">
          <div className="tool-call-head">
            <span>🔧 {block.name}</span>
            <span style={{ color: 'var(--text-dim)' }}>{block.callId.slice(0, 12)}</span>
          </div>
          <pre>{formatInput(block.input)}</pre>
        </div>
      );

    case 'tool_result':
      return (
        <div className="block tool">
          <div className={`result ${block.isError ? 'error' : ''}`}>
            <div className="result-label">{block.isError ? 'error' : 'result'}</div>
            <pre>{truncate(block.output, 4000)}</pre>
          </div>
        </div>
      );

    case 'image':
      return (
        <div className="block">
          <span className="img-placeholder">🖼 {block.mediaType ?? 'image'}</span>
        </div>
      );

    default:
      return null;
  }
}

function formatInput(input: unknown): string {
  if (input == null) return '';
  if (typeof input === 'string') return input;
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}\n… [truncated ${s.length - max} chars]` : s;
}
