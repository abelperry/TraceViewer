import { useState } from 'react';

/** 等宽代码框，超长可折叠。可选语言标签。 */
export function CodeBox({ text, language }: { text: string; language?: string }) {
  const lines = text.split('\n');
  const long = lines.length > 30;
  const [expanded, setExpanded] = useState(false);
  const shown = long && !expanded ? lines.slice(0, 30).join('\n') : text;
  return (
    <div className="codebox">
      {language && <div className="codebox-lang">{language}</div>}
      <pre>
        <code>{shown}</code>
      </pre>
      {long && (
        <button className="codebox-more" onClick={() => setExpanded((e) => !e)}>
          {expanded ? '收起' : `展开剩余 ${lines.length - 30} 行`}
        </button>
      )}
    </div>
  );
}
