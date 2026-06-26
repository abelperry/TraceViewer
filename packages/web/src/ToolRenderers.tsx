import type { ToolCallBlockDTO } from '@trace-review/shared';
import { CodeBox } from './CodeBox';

/**
 * 工具调用渲染分发：每种工具按其语义定制展示（参考 Claude 桌面端）。
 * 未知工具回退到通用 JSON 渲染。
 */
export function ToolCallView({ block }: { block: ToolCallBlockDTO }) {
  const input = (block.input ?? {}) as Record<string, unknown>;
  const name = block.name;
  const renderer = RENDERERS[name] ?? (name.startsWith('mcp__') ? renderMcp : renderGeneric);

  return (
    <div className="block tool-call">
      <div className="tool-call-head">
        <span className="tool-name">{iconFor(name)} {name}</span>
        <span className="tool-id">{block.callId.slice(0, 12)}</span>
      </div>
      {renderer(input, name)}
    </div>
  );
}

type Renderer = (input: Record<string, unknown>, name: string) => JSX.Element;

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v));

function iconFor(name: string): string {
  const m: Record<string, string> = {
    Bash: '⌘', bash: '⌘', exec_command: '⌘', shell: '⌘', Read: '📖', Edit: '✏️', MultiEdit: '✏️', Write: '📝',
    Glob: '🔍', Grep: '🔍', WebFetch: '🌐', WebSearch: '🌐',
    Agent: '🤖', Skill: '✨', Workflow: '🔀',
  };
  if (m[name]) return m[name];
  if (name.startsWith('Task')) return '✓';
  if (name.startsWith('mcp__')) return '🔌';
  return '🔧';
}

/** Bash / Codex exec_command：终端样式。 */
const renderBash: Renderer = (input) => {
  const cmd = str(input.command ?? input.cmd);
  const desc = str(input.description);
  const workdir = str(input.workdir);
  return (
    <div className="tool-body">
      {desc && <div className="tool-desc">{desc}</div>}
      <div className="terminal">
        <span className="prompt">$</span>
        <code>{cmd}</code>
      </div>
      {workdir && <div className="file-line"><span className="chip">cwd: {workdir}</span></div>}
    </div>
  );
};

/** Read：文件 + 行范围 chip。 */
const renderRead: Renderer = (input) => {
  const file = str(input.file_path);
  const offset = input.offset;
  const limit = input.limit;
  const range =
    offset != null || limit != null
      ? `行 ${offset ?? 0}${limit != null ? `–${Number(offset ?? 0) + Number(limit)}` : '+'}`
      : null;
  return (
    <div className="tool-body file-line">
      <FilePath path={file} />
      {range && <span className="chip">{range}</span>}
    </div>
  );
};

/** Edit/MultiEdit：红绿 diff。 */
const renderEdit: Renderer = (input) => {
  const file = str(input.file_path);
  const edits = Array.isArray(input.edits)
    ? (input.edits as Record<string, unknown>[])
    : [{ old_string: input.old_string, new_string: input.new_string }];
  return (
    <div className="tool-body">
      {file && (
        <div className="file-line">
          <FilePath path={file} />
          {input.replace_all === true && <span className="chip">replace all</span>}
        </div>
      )}
      {edits.map((e, i) => (
        <DiffView key={i} oldStr={str(e.old_string)} newStr={str(e.new_string)} />
      ))}
    </div>
  );
};

/** Write：文件 header + 内容。 */
const renderWrite: Renderer = (input) => {
  const file = str(input.file_path);
  return (
    <div className="tool-body">
      <div className="file-line">
        <FilePath path={file} />
        <span className="chip">新建/覆盖</span>
      </div>
      <CodeBox text={str(input.content)} language={guessLang(file)} />
    </div>
  );
};

/** Glob/Grep：搜索条件。 */
const renderSearch: Renderer = (input) => {
  const pattern = str(input.pattern ?? input.query);
  const path = str(input.path ?? input.glob ?? input.include);
  return (
    <div className="tool-body file-line">
      <code className="pattern">{pattern}</code>
      {path && <span className="chip">{path}</span>}
    </div>
  );
};

/** Web：URL/查询 + 提示。 */
const renderWeb: Renderer = (input) => {
  const url = str(input.url);
  const query = str(input.query);
  const prompt = str(input.prompt);
  return (
    <div className="tool-body">
      {url && (
        <a className="weblink" href={url} target="_blank" rel="noreferrer">
          {url}
        </a>
      )}
      {query && <div className="tool-desc">🔎 {query}</div>}
      {prompt && <div className="tool-desc">{prompt}</div>}
    </div>
  );
};

/** Task*：任务管理摘要。 */
const renderTask: Renderer = (input) => {
  const fields = ['subject', 'description', 'activeForm', 'status', 'taskId', 'task_id'];
  return (
    <div className="tool-body tool-args">
      {fields
        .filter((k) => input[k] != null)
        .map((k) => (
          <div key={k} className="tool-arg">
            <span className="arg-key">{k}</span>
            <span className="arg-val">{str(input[k])}</span>
          </div>
        ))}
    </div>
  );
};

/** MCP：紧凑键值。 */
const renderMcp: Renderer = (input) => renderGeneric(input);

/** 通用：键值表，长字符串进代码框。 */
function renderGeneric(input: Record<string, unknown>): JSX.Element {
  const entries = Object.entries(input);
  if (entries.length === 0) return <div className="tool-body tool-desc">（无参数）</div>;
  return (
    <div className="tool-body tool-args">
      {entries.map(([k, v]) => {
        const s = str(v);
        if (s.length > 80 || s.includes('\n')) {
          return (
            <div key={k}>
              <div className="arg-key" style={{ marginBottom: 4 }}>{k}</div>
              <CodeBox text={s} />
            </div>
          );
        }
        return (
          <div key={k} className="tool-arg">
            <span className="arg-key">{k}</span>
            <span className="arg-val">{s}</span>
          </div>
        );
      })}
    </div>
  );
}

const RENDERERS: Record<string, Renderer> = {
  Bash: renderBash,
  bash: renderBash,
  exec_command: renderBash,
  shell: renderBash,
  Read: renderRead,
  Edit: renderEdit,
  MultiEdit: renderEdit,
  Write: renderWrite,
  Glob: renderSearch,
  Grep: renderSearch,
  WebFetch: renderWeb,
  WebSearch: renderWeb,
  TaskCreate: renderTask,
  TaskUpdate: renderTask,
  TaskGet: renderTask,
};

/** 行级 diff：old 全红删除、new 全绿新增（Claude 桌面端风格）。 */
function DiffView({ oldStr, newStr }: { oldStr: string; newStr: string }) {
  const oldLines = oldStr ? oldStr.split('\n') : [];
  const newLines = newStr ? newStr.split('\n') : [];
  return (
    <div className="diff">
      <pre>
        {oldLines.map((l, i) => (
          <div key={`o${i}`} className="diff-line del">
            <span className="diff-sign">-</span>
            <span>{l}</span>
          </div>
        ))}
        {newLines.map((l, i) => (
          <div key={`n${i}`} className="diff-line add">
            <span className="diff-sign">+</span>
            <span>{l}</span>
          </div>
        ))}
      </pre>
    </div>
  );
}

function FilePath({ path }: { path: string }) {
  if (!path) return null;
  const parts = path.split('/');
  const name = parts[parts.length - 1];
  const dir = parts.slice(0, -1).join('/');
  return (
    <span className="filepath" title={path}>
      {dir && <span className="filepath-dir">{dir}/</span>}
      <span className="filepath-name">{name}</span>
    </span>
  );
}

export function guessLang(file: string | null): string | undefined {
  if (!file) return undefined;
  const ext = file.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    ts: 'ts', tsx: 'tsx', js: 'js', jsx: 'jsx', py: 'python', go: 'go',
    rs: 'rust', java: 'java', json: 'json', md: 'md', css: 'css', html: 'html',
    sh: 'bash', yml: 'yaml', yaml: 'yaml', sql: 'sql', toml: 'toml',
  };
  return ext ? map[ext] : undefined;
}
