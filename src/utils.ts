export function safeFilename(title: string, extension: string): string {
  const normalizedExtension = extension.startsWith(".") ? extension : `.${extension}`;
  const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

  let base = title
    .normalize("NFC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/[. ]+$/g, "")
    .trim();

  base = base.replace(new RegExp(`${normalizedExtension.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"), "").slice(0, 120).trim();

  if (!base || base === "." || reserved.test(base)) {
    base = "syxlor-document";
  }

  return `${base}${normalizedExtension}`;
}

export function formatBytes(bytes: number): string {
  const safeBytes = Number.isFinite(bytes) ? bytes : 0;
  const sign = safeBytes < 0 ? "-" : "";
  const absolute = Math.abs(safeBytes);
  const units = ["B", "KB", "MB", "GB", "TB"];

  if (absolute === 0) return "0 B";

  let value = absolute;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const decimals = unitIndex === 0 ? 0 : unitIndex <= 2 ? 1 : 2;
  return `${sign}${value.toFixed(decimals)} ${units[unitIndex]}`;
}

export function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, "")
    .replace(/~~~[\s\S]*?~~~/g, "")
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "$1")
    .replace(/(?<!\!)\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/^ {0,3}#{1,6}\s+/gm, "")
    .replace(/^ {0,3}(?:[-*+]\s+|\d+[.)]\s+)/gm, "")
    .replace(/^ {0,3}>\s?/gm, "")
    .replace(/^[ \t]*[-*_]{3,}[ \t]*$/gm, "")
    .replace(/[*_~`]/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function headingSlug(value: string): string {
  const sanitized = value
    .normalize("NFC")
    .replace(/<[^>]+>/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/[\s-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return sanitized || "section";
}
