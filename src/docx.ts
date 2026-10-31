import { Packer, Document as WordDocument, Paragraph, TextRun, HeadingLevel } from "docx";
import { stripMarkdown } from "./utils";

export async function buildDocx(markdown: string, title: string): Promise<Blob> {
  const children: Paragraph[] = [];
  const lines = markdown.split(/\r?\n/);
  let inCode = false;
  let codeLines: string[] = [];
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      if (inCode) {
        children.push(new Paragraph({
          children: [new TextRun({ text: codeLines.join("\n"), font: "Consolas", size: 18 })],
          shading: { fill: "F1F4F8" },
          spacing: { before: 120, after: 160 },
        }));
        codeLines = [];
      }
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const levelMap = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];
      children.push(new Paragraph({ text: heading[2], heading: levelMap[heading[1].length - 1], spacing: { before: 240, after: 100 } }));
    } else if (/^\s*[-*+]\s+/.test(line)) {
      children.push(new Paragraph({ text: line.replace(/^\s*[-*+]\s+/, ""), bullet: { level: 0 } }));
    } else if (/^\s*\d+\.\s+/.test(line)) {
      children.push(new Paragraph({ text: line.replace(/^\s*\d+\.\s+/, ""), numbering: { reference: "default-numbering", level: 0 } }));
    } else if (/^\s*>\s?/.test(line)) {
      children.push(new Paragraph({ children: [new TextRun({ text: line.replace(/^\s*>\s?/, ""), italics: true, color: "657386" })], indent: { left: 480 } }));
    } else if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      children.push(new Paragraph({ text: " " }));
    } else if (line.trim()) {
      children.push(new Paragraph({ text: stripMarkdown(line), spacing: { after: 140, line: 300 } }));
    }
  }
  const doc = new WordDocument({
    title,
    sections: [{ children: children.length ? children : [new Paragraph("")] }],
    numbering: {
      config: [{
        reference: "default-numbering",
        levels: [{
          level: 0,
          format: "decimal",
          text: "%1.",
          alignment: "start",
          style: { paragraph: { indent: { left: 720, hanging: 360 } } },
        }],
      }],
    },
  });
  return Packer.toBlob(doc);
}
