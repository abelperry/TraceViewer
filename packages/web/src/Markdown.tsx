import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import { CodeBox } from './CodeBox';

/**
 * Markdown 渲染（用于 assistant/user 的 text block）。
 *
 * - remark-gfm：支持表格、删除线、任务列表、自动链接
 * - 默认不渲染原始 HTML（react-markdown 安全默认），规避 XSS
 * - 围栏代码块复用 CodeBox（等宽 + 折叠 + 语言标签）
 */
const components: Components = {
  // 围栏代码块用 CodeBox 渲染；pre 仅作透传，避免 div 嵌在 pre 里（非法 HTML）
  pre({ children }) {
    return <>{children}</>;
  },
  code({ className, children, ...props }) {
    const text = String(children).replace(/\n$/, '');
    const lang = /language-(\w+)/.exec(className ?? '')?.[1];
    // react-markdown v9 移除了 inline 标志：无语言类且单行 → 视为行内代码
    const isInline = !lang && !text.includes('\n');
    if (isInline) {
      return (
        <code className="md-inline-code" {...props}>
          {children}
        </code>
      );
    }
    return <CodeBox text={text} language={lang} />;
  },
  a({ children, href }) {
    return (
      <a href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    );
  },
};

export function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
