import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import TurndownService from "turndown";
import { safeFilename, stripMarkdown } from "./utils";
import Markdown from "./Markdown";

export type ConversionFormat = "md" | "txt" | "html" | "pdf" | "docx" | "zip";

export const conversionFormats: { value: ConversionFormat; label: string; extension: string }[] = [
  { value: "md", label: "Markdown", extension: ".md" },
  { value: "txt", label: "Plain text", extension: ".txt" },
  { value: "html", label: "HTML", extension: ".html" },
  { value: "pdf", label: "PDF", extension: ".pdf" },
  { value: "docx", label: "Word document", extension: ".docx" },
  { value: "zip", label: "ZIP package", extension: ".zip" },
];

const maxFileSize = 20 * 1024 * 1024;
const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });

function documentTitle(filename: string): string {
  return filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Converted document";
}

export async function readAsMarkdown(file: File): Promise<string> {
  if (file.size > maxFileSize) throw new Error("Choose a file smaller than 20 MB.");
  const extension = file.name.split(".").pop()?.toLowerCase();

  if (extension === "md" || extension === "markdown" || extension === "txt") {
    return file.text();
  }
  if (extension === "html" || extension === "htm") {
    return turndown.turndown(await file.text());
  }
  if (extension === "docx") {
    const mammoth = await import("mammoth");
    const arrayBuffer = await file.arrayBuffer();
    const input = typeof window === "undefined"
      ? { buffer: Buffer.from(arrayBuffer) }
      : { arrayBuffer };
    const result = await mammoth.convertToHtml(input);
    return turndown.turndown(result.value);
  }
  if (extension === "pdf") {
    const pdfjs = typeof window === "undefined"
      ? await import("pdfjs-dist/legacy/build/pdf.mjs")
      : await import("pdfjs-dist");
    if (typeof window !== "undefined") {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
    }
    const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
    const document = await loadingTask.promise;
    try {
      const pages: string[] = [];
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        const text = await page.getTextContent();
        pages.push(text.items
          .map((item) => "str" in item ? `${item.str}${item.hasEOL ? "\n" : " "}` : "")
          .join("")
          .replace(/[ \t]+\n/g, "\n")
          .trim());
      }
      const extracted = pages.join("\n\n").trim();
      if (!extracted) throw new Error("No selectable text was found in this PDF. Scanned-image OCR is not supported.");
      return extracted;
    } finally {
      await loadingTask.destroy();
    }
  }
  if (extension === "zip") {
    const { default: JSZip } = await import("jszip");
    const archive = await JSZip.loadAsync(await file.arrayBuffer());
    const markdownEntry = Object.values(archive.files)
      .filter((entry) => !entry.dir && /\.(md|markdown)$/i.test(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name))[0];
    if (!markdownEntry) throw new Error("This ZIP package does not contain a Markdown file.");
    const metadata = Object.getOwnPropertyDescriptor(markdownEntry, "_data")?.value;
    if (metadata && typeof metadata === "object" && "uncompressedSize" in metadata
      && typeof metadata.uncompressedSize === "number" && metadata.uncompressedSize > maxFileSize) {
      throw new Error("The Markdown file inside this ZIP is larger than 20 MB.");
    }
    const markdown = await markdownEntry.async("string");
    if (markdown.length > maxFileSize) throw new Error("The Markdown file inside this ZIP is larger than 20 MB.");
    return markdown;
  }
  throw new Error("Choose a Markdown, text, HTML, PDF, DOCX, or ZIP file.");
}

export async function createConvertedFile(
  format: ConversionFormat,
  source: string,
  filename: string,
): Promise<{ blob: Blob; filename: string }> {
  const title = documentTitle(filename);
  const formatInfo = conversionFormats.find((item) => item.value === format);
  if (!formatInfo) throw new Error("Choose a supported output format.");
  const outputName = safeFilename(title, formatInfo.extension);

  if (format === "md") {
    return { blob: new Blob([source], { type: "text/markdown;charset=utf-8" }), filename: outputName };
  }
  if (format === "txt") {
    return { blob: new Blob([stripMarkdown(source)], { type: "text/plain;charset=utf-8" }), filename: outputName };
  }
  if (format === "html") {
    const article = renderToStaticMarkup(React.createElement(Markdown, { source }));
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title.replace(/[<>&"]/g, "")}</title><style>body{max-width:780px;margin:64px auto;padding:0 28px;color:#182132;font:16px/1.75 system-ui,sans-serif}h1,h2,h3{line-height:1.3}pre{padding:18px;background:#111827;color:#e5e7eb;border-radius:8px;overflow:auto}code{font-family:Consolas,monospace}table{border-collapse:collapse;width:100%}td,th{border:1px solid #d5dbe5;padding:8px;text-align:left}blockquote{border-left:3px solid #2cbde5;margin-left:0;padding-left:18px;color:#687386}img{max-width:100%}</style></head><body>${article}</body></html>`;
    return { blob: new Blob([html], { type: "text/html;charset=utf-8" }), filename: outputName };
  }
  if (format === "pdf") {
    const { makePdf } = await import("./pdf");
    return { blob: await makePdf(source, title), filename: outputName };
  }
  if (format === "docx") {
    const { buildDocx } = await import("./docx");
    return { blob: await buildDocx(source, title), filename: outputName };
  }

  const { default: JSZip } = await import("jszip");
  const archive = new JSZip();
  archive.file(`${safeFilename(title, ".md").replace(/\.md$/, "")}.md`, source);
  return { blob: await archive.generateAsync({ type: "blob" }), filename: outputName };
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1200);
}
