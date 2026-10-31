import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import rehypeSlug from "rehype-slug";
import rehypeSanitize from "rehype-sanitize";
import { Check, Copy } from "lucide-react";

interface MarkdownProps {
  source: string;
  className?: string;
}

function useAlertBlocks(source: string): string {
  return useMemo(() => source.replace(
    /^(\s*>\s*)\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/gim,
    (_match, quote: string, kind: string) => `${quote}**${kind}:** `,
  ), [source]);
}

function CodeBlock({ children, ...props }: React.ComponentProps<"pre">) {
  const [copied, setCopied] = useState(false);
  const text = String((children as React.ReactElement<{ children?: React.ReactNode }>)?.props?.children ?? "");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text.replace(/\n$/, ""));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1300);
    } catch (error) {
      console.error("Could not copy the code block.", error);
    }
  };
  return (
    <div className="code-frame">
      <button className="code-copy" type="button" onClick={copy} aria-label="Copy code">
        {copied ? <Check size={14} /> : <Copy size={14} />}
        <span>{copied ? "Copied" : "Copy"}</span>
      </button>
      <pre {...props}>{children}</pre>
    </div>
  );
}

interface SelectionRect {
  left: number;
  top: number;
  width: number;
  height: number;
  leaving?: boolean;
}

function SelectionOverlay({ articleRef, source }: { articleRef: React.RefObject<HTMLElement | null>; source: string }) {
  const [selectionRects, setSelectionRects] = useState<SelectionRect[]>([]);

  useEffect(() => {
    const article = articleRef.current;
    if (!article) return;

    let frame = 0;
    let clearTimer = 0;
    let active = true;
    let pointerSelecting = false;
    const updateSelection = () => {
      if (!active || pointerSelecting) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!active || pointerSelecting) return;
        const selection = article.ownerDocument.getSelection();
        const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
        if (!selection || selection.isCollapsed || !range || !article.contains(range.startContainer) || !article.contains(range.endContainer)) {
          setSelectionRects((current) => current.length ? current.map((rect) => ({ ...rect, leaving: true })) : current);
          window.clearTimeout(clearTimer);
          clearTimer = window.setTimeout(() => setSelectionRects([]), 180);
          return;
        }

        window.clearTimeout(clearTimer);
        const nextRects = Array.from(range.getClientRects())
          .filter((rect) => rect.width > 0 && rect.height > 0)
          .map(({ left, top, width, height }) => ({ left, top, width, height }));
        setSelectionRects(nextRects);
      });
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || !(event.target instanceof Node) || !article.contains(event.target)) return;
      pointerSelecting = true;
      cancelAnimationFrame(frame);
      setSelectionRects([]);
    };
    const onPointerEnd = () => {
      if (!pointerSelecting) return;
      pointerSelecting = false;
      updateSelection();
    };

    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateSelection);
    resizeObserver?.observe(article);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointerup", onPointerEnd, true);
    document.addEventListener("pointercancel", onPointerEnd, true);
    document.addEventListener("mouseup", onPointerEnd, true);
    document.addEventListener("selectionchange", updateSelection);
    window.addEventListener("scroll", updateSelection, true);
    window.addEventListener("resize", updateSelection);
    document.fonts?.ready.then(updateSelection);
    updateSelection();

    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(clearTimer);
      resizeObserver?.disconnect();
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointerup", onPointerEnd, true);
      document.removeEventListener("pointercancel", onPointerEnd, true);
      document.removeEventListener("mouseup", onPointerEnd, true);
      document.removeEventListener("selectionchange", updateSelection);
      window.removeEventListener("scroll", updateSelection, true);
      window.removeEventListener("resize", updateSelection);
      active = false;
    };
  }, [articleRef, source]);

  if (!selectionRects.length) return null;
  return createPortal(
    <div className="selection-overlay-layer" aria-hidden="true">
      {selectionRects.map((rect, index) => (
        <div
          className={`selection-overlay-rect${rect.leaving ? " leaving" : ""}`}
          key={index}
          style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
        />
      ))}
    </div>,
    document.body,
  );
}

export default function Markdown({ source, className = "" }: MarkdownProps) {
  const prepared = useAlertBlocks(source);
  const articleRef = useRef<HTMLElement>(null);
  return (
    <>
      <article ref={articleRef} className={`markdown-body ${className}`}>
        <ReactMarkdown
          key={source}
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex, rehypeHighlight, rehypeSanitize, rehypeSlug]}
          components={{
            pre: CodeBlock,
            a: ({ href, children, ...props }) => (
              <a href={href} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>
            ),
            img: ({ src, alt, ...props }) => (
              <img src={src} alt={alt ?? ""} loading="lazy" {...props} />
            ),
          }}
        >
          {prepared}
        </ReactMarkdown>
      </article>
      <SelectionOverlay articleRef={articleRef} source={source} />
    </>
  );
}
