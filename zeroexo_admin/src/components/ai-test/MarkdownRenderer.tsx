import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Image, Tooltip } from "antd";
import { Check, Copy } from "lucide-react";
import "highlight.js/styles/atom-one-dark.css";

interface MarkdownRendererProps {
  content: string;
}

/* ──────────────────────────────────────────── */
/*  Styles                                      */
/* ──────────────────────────────────────────── */

const styles: Record<string, React.CSSProperties> = {
  container: {
    fontSize: 14,
    lineHeight: 1.7,
    color: "#262626",
    wordBreak: "break-word",
  },
  h1: {
    fontSize: 20,
    fontWeight: 600,
    margin: "16px 0 8px",
    paddingBottom: 6,
    borderBottom: "1px solid #f0f0f0",
  },
  h2: {
    fontSize: 17,
    fontWeight: 600,
    margin: "14px 0 6px",
  },
  h3: {
    fontSize: 15,
    fontWeight: 600,
    margin: "12px 0 4px",
  },
  p: {
    margin: "4px 0 8px",
  },
  ul: {
    paddingLeft: 20,
    margin: "4px 0 8px",
  },
  ol: {
    paddingLeft: 20,
    margin: "4px 0 8px",
  },
  li: {
    marginBottom: 2,
  },
  blockquote: {
    borderLeft: "3px solid #1677ff",
    margin: "8px 0",
    padding: "6px 12px",
    background: "#f9f9ff",
    borderRadius: "0 4px 4px 0",
    color: "#595959",
  },
  hr: {
    border: "none",
    borderTop: "1px solid #f0f0f0",
    margin: "16px 0",
  },
  table: {
    borderCollapse: "collapse" as const,
    width: "100%",
    margin: "8px 0",
    fontSize: 13,
  },
  th: {
    border: "1px solid #e8e8e8",
    padding: "6px 10px",
    background: "#fafafa",
    fontWeight: 600,
    textAlign: "left" as const,
  },
  td: {
    border: "1px solid #e8e8e8",
    padding: "6px 10px",
  },
  inlineCode: {
    background: "#f5f5f5",
    border: "1px solid #e8e8e8",
    borderRadius: 3,
    padding: "1px 5px",
    fontSize: "0.92em",
    fontFamily:
      "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace",
    color: "#d63384",
  },
  preWrapper: {
    position: "relative" as const,
    margin: "8px 0",
    borderRadius: 6,
    overflow: "hidden",
    background: "#1e1e1e",
  },
  preHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "6px 12px",
    background: "#2d2d2d",
    color: "#999",
    fontSize: 11,
    borderBottom: "1px solid #3d3d3d",
  },
  pre: {
    padding: "12px 14px",
    margin: 0,
    overflow: "auto",
    fontSize: 13,
    lineHeight: 1.5,
    fontFamily:
      "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace",
    color: "#d4d4d4",
  },
  copyBtn: {
    border: "none",
    background: "transparent",
    color: "#999",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: 4,
    fontSize: 11,
    padding: "2px 6px",
    borderRadius: 3,
  },
  strong: {
    fontWeight: 600,
  },
  em: {
    fontStyle: "italic",
  },
  del: {
    textDecoration: "line-through",
    color: "#8c8c8c",
  },
  link: {
    color: "#1677ff",
    textDecoration: "none",
  },
  imgWrapper: {
    margin: "8px 0",
  },
};

/* ──────────────────────────────────────────── */
/*  Components                                  */
/* ──────────────────────────────────────────── */

function CodeBlock({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const [copied, setCopied] = React.useState(false);
  const codeText = String(children).replace(/\n$/, "");
  const lang = className?.replace("language-", "") || "";

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(codeText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  return (
    <div style={styles.preWrapper}>
      <div style={styles.preHeader}>
        <span>{lang || "code"}</span>
        <Tooltip title={copied ? "已复制" : "复制代码"}>
          <button style={styles.copyBtn} onClick={handleCopy}>
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? "已复制" : "复制"}
          </button>
        </Tooltip>
      </div>
      <pre style={styles.pre}>
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
}

/* ──────────────────────────────────────────── */
/*  Main Component                             */
/* ──────────────────────────────────────────── */

export default function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <div style={styles.container}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          h1: ({ children }) => <h1 style={styles.h1}>{children}</h1>,
          h2: ({ children }) => <h2 style={styles.h2}>{children}</h2>,
          h3: ({ children }) => <h3 style={styles.h3}>{children}</h3>,
          h4: ({ children }) => (
            <h4 style={{ ...styles.h3, fontSize: 14 }}>{children}</h4>
          ),
          p: ({ children }) => <p style={styles.p}>{children}</p>,
          ul: ({ children }) => <ul style={styles.ul}>{children}</ul>,
          ol: ({ children }) => <ol style={styles.ol}>{children}</ol>,
          li: ({ children }) => <li style={styles.li}>{children}</li>,
          blockquote: ({ children }) => (
            <blockquote style={styles.blockquote}>{children}</blockquote>
          ),
          hr: () => <hr style={styles.hr} />,
          table: ({ children }) => (
            <div style={{ overflow: "auto" }}>
              <table style={styles.table}>{children}</table>
            </div>
          ),
          th: ({ children }) => <th style={styles.th}>{children}</th>,
          td: ({ children }) => <td style={styles.td}>{children}</td>,
          strong: ({ children }) => (
            <strong style={styles.strong}>{children}</strong>
          ),
          em: ({ children }) => <em style={styles.em}>{children}</em>,
          del: ({ children }) => <del style={styles.del}>{children}</del>,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              style={styles.link}
            >
              {children}
            </a>
          ),
          img: ({ src, alt }) => {
            if (!src) return null;
            // 判断是否为 SVG
            const isSvg =
              src.endsWith(".svg") || src.startsWith("data:image/svg");
            const handleImageError = (
              e: React.SyntheticEvent<HTMLImageElement>,
            ) => {
              e.currentTarget.style.display = "none";
            };
            return (
              <div style={styles.imgWrapper}>
                {isSvg ? (
                  <img
                    src={src}
                    alt={alt || ""}
                    style={{ maxWidth: "100%", borderRadius: 6 }}
                    onError={handleImageError}
                  />
                ) : (
                  <Image
                    src={src}
                    alt={alt || ""}
                    style={{ maxWidth: "100%", borderRadius: 6 }}
                    preview={{ mask: "点击预览" }}
                    fallback="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='100'%3E%3Crect width='200' height='100' fill='%23f5f5f5'/%3E%3Ctext x='50%25' y='50%25' text-anchor='middle' dy='.3em' fill='%23bfbfbf' font-size='12'%3E图片加载失败%3C/text%3E%3C/svg%3E"
                  />
                )}
              </div>
            );
          },
          code: ({ className, children }) => {
            const isInline = !className;
            if (isInline) {
              return <code style={styles.inlineCode}>{children}</code>;
            }
            return <CodeBlock className={className}>{children}</CodeBlock>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
