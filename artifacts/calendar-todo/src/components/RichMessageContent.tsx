import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

function normalizeMathDelimiters(content: string): string {
  return content
    .replace(/\\\[([\s\S]*?)\\\]/g, (_match, expression: string) => {
      return `\n$$\n${expression.trim()}\n$$\n`;
    })
    .replace(/\\\(([\s\S]*?)\\\)/g, (_match, expression: string) => {
      return `$${expression.trim()}$`;
    });
}

export function RichMessageContent({ content }: { content: string }) {
  return (
    <div className="prose prose-sm max-w-none text-inherit prose-headings:text-inherit prose-p:text-inherit prose-strong:text-inherit prose-li:text-inherit prose-headings:mb-2 prose-headings:mt-4 prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-pre:overflow-x-auto prose-pre:rounded-lg prose-pre:bg-background/70 prose-code:break-words prose-a:text-primary dark:prose-invert">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          a: ({ children, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          table: ({ children, ...props }) => (
            <div className="my-3 overflow-x-auto">
              <table {...props}>{children}</table>
            </div>
          ),
        }}
      >
        {normalizeMathDelimiters(content)}
      </ReactMarkdown>
    </div>
  );
}