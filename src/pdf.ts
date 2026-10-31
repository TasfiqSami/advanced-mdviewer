import pdfMake from "pdfmake/build/pdfmake";
import pdfFonts from "pdfmake/build/vfs_fonts";
import type { Content, ContentText, TDocumentDefinitions } from "pdfmake/interfaces";

const pdfMakeWithFonts = pdfMake as typeof pdfMake & { vfs: Record<string, string> };
const fontMap = pdfFonts as unknown as { pdfMake?: { vfs?: Record<string, string> }; vfs?: Record<string, string> };
pdfMakeWithFonts.vfs = fontMap.pdfMake?.vfs ?? fontMap.vfs ?? {};

function plainText(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/<([^>]+)>/g, "$1")
    .replace(/[*_~`]/g, "")
    .trim();
}

function inlineContent(text: string): ContentText {
  const parts: ContentText["text"] = [];
  const expression = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*]+\*|_[^_]+_|\[[^\]]+\]\([^)]+\))/g;
  let cursor = 0;
  for (const match of text.matchAll(expression)) {
    const index = match.index ?? 0;
    if (index > cursor) parts.push({ text: plainText(text.slice(cursor, index)) });
    const token = match[0];
    if (token.startsWith("**") || token.startsWith("__")) {
      parts.push({ text: token.slice(2, -2), bold: true });
    } else if (token.startsWith("`")) {
      parts.push({ text: token.slice(1, -1), font: "Roboto", color: "#087da8", background: "#eef4f7" });
    } else if (token.startsWith("*") || token.startsWith("_")) {
      parts.push({ text: token.slice(1, -1), italics: true });
    } else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      if (link) {
        const url = /^(https?:|mailto:)/i.test(link[2]) ? link[2] : undefined;
        parts.push(url ? { text: link[1], color: "#087da8", link: url } : { text: `${link[1]} (${link[2]})` });
      }
    }
    cursor = index + token.length;
  }
  if (cursor < text.length) parts.push({ text: plainText(text.slice(cursor)) });
  return parts.length ? { text: parts } : { text: plainText(text) };
}

function tableCells(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

async function toBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export async function makePdf(markdown: string, title: string): Promise<Blob> {
  const lines = markdown.split(/\r?\n/);
  const content: Content[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    if (/^\s*```/.test(line)) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*```/.test(lines[index])) code.push(lines[index++]);
      if (index < lines.length) index += 1;
      content.push({
        text: code.join("\n"),
        style: "code",
        margin: [0, 7, 0, 11],
        ...(code.join("\n").length < 1400 ? { unbreakable: true } : {}),
      });
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      content.push({
        text: plainText(heading[2]),
        style: `h${Math.min(level, 3)}`,
        margin: [0, level === 1 ? 16 : 12, 0, 6],
        unbreakable: true,
      });
      index += 1;
      continue;
    }
    if (index + 1 < lines.length && line.includes("|") && /^\s*\|?\s*:?-{2,}/.test(lines[index + 1])) {
      const headers = tableCells(line);
      const body: Content[][] = [[
        ...headers.map((header) => ({ text: plainText(header), bold: true, color: "#162032" })),
      ]];
      index += 2;
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        const cells = tableCells(lines[index]);
        body.push(headers.map((_, column) => ({ text: plainText(cells[column] ?? ""), color: "#374254" })));
        index += 1;
      }
      content.push({
        table: { headerRows: 1, dontBreakRows: true, widths: headers.map(() => "*"), body },
        layout: {
          hLineColor: () => "#d8dee8",
          vLineColor: () => "#d8dee8",
          fillColor: (rowIndex: number) => rowIndex === 0 ? "#edf3f7" : rowIndex % 2 ? "#ffffff" : "#f7f9fb",
          paddingLeft: () => 6,
          paddingRight: () => 6,
          paddingTop: () => 5,
          paddingBottom: () => 5,
        },
        margin: [0, 5, 0, 12],
      });
      continue;
    }
    const image = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(line.trim());
    if (image && image[2].startsWith("/api/v1/attachments/")) {
      const response = await fetch(image[2], { credentials: "same-origin" });
      if (response.ok) {
        const base64 = await toBase64(await response.blob());
        const mimeType = response.headers.get("content-type") ?? "image/png";
        content.push({ image: `data:${mimeType};base64,${base64}`, width: 470, alignment: "center", margin: [0, 8, 0, 12] });
      } else {
        content.push({ text: `[Image unavailable: ${image[1]}]`, italics: true, color: "#6b7280" });
      }
      index += 1;
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) quote.push(lines[index++].replace(/^\s*>\s?/, ""));
      content.push({ text: quote.map(plainText).join("\n"), margin: [10, 4, 0, 9], color: "#566277", italics: true });
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      content.push({ canvas: [{ type: "line", x1: 0, y1: 4, x2: 495, y2: 4, lineWidth: 0.6, lineColor: "#ccd5df" }], margin: [0, 9, 0, 11] });
      index += 1;
      continue;
    }
    const listMatch = /^\s*([-*+]|\d+\.)\s+(.+)$/.exec(line);
    if (listMatch) {
      const ordered = /^\d/.test(listMatch[1]);
      const items: Content[] = [];
      while (index < lines.length) {
        const item = /^\s*([-*+]|\d+\.)\s+(.+)$/.exec(lines[index]);
        if (!item || ordered !== /^\d/.test(item[1])) break;
        items.push(inlineContent(item[2]));
        index += 1;
      }
      content.push(ordered ? { ol: items, margin: [0, 2, 0, 10] } : { ul: items, margin: [0, 2, 0, 10] });
      continue;
    }
    const paragraph: string[] = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !/^(#{1,6}\s|```|\s*>|\s*[-*+]\s|\s*\d+\.\s)/.test(lines[index])) {
      paragraph.push(lines[index++]);
    }
    const formattedParagraph = inlineContent(paragraph.join(" "));
    content.push({ ...formattedParagraph, margin: [0, 0, 0, 9], lineHeight: 1.35 });
  }

  const definition: TDocumentDefinitions = {
    info: { title, subject: "Markdown export", creator: "Syxlor MD Viewer" },
    pageSize: "A4",
    pageMargins: [48, 52, 48, 52],
    content: [
      { text: title, style: "documentTitle", margin: [0, 0, 0, 18], unbreakable: true },
      ...content,
    ],
    defaultStyle: { font: "Roboto", fontSize: 10, color: "#374254", lineHeight: 1.35 },
    styles: {
      documentTitle: { fontSize: 24, bold: true, color: "#152033", lineHeight: 1.15 },
      h1: { fontSize: 20, bold: true, color: "#152033", lineHeight: 1.2 },
      h2: { fontSize: 16, bold: true, color: "#152033", lineHeight: 1.2 },
      h3: { fontSize: 13, bold: true, color: "#152033", lineHeight: 1.2 },
      code: { font: "Roboto", fontSize: 8, color: "#ecf1f8", fillColor: "#141b26", margin: [8, 7, 8, 7] },
    },
    footer: (currentPage, pageCount) => ({
      columns: [
        { text: "SYXLOR MD VIEWER", color: "#8a95a5", fontSize: 7 },
        { text: `${currentPage} / ${pageCount}`, alignment: "right", color: "#8a95a5", fontSize: 7 },
      ],
      margin: [48, 12, 48, 0],
    }),
  };
  return new Promise((resolve, reject) => {
    try {
      pdfMake.createPdf(definition).getBlob((blob) => resolve(blob));
    } catch (error) {
      reject(error);
    }
  });
}
