import { useState } from "react";
import { ArrowDownToLine, ArrowRightLeft, FileText, LockKeyhole, Upload } from "lucide-react";
import { conversionFormats, createConvertedFile, downloadBlob, readAsMarkdown, type ConversionFormat } from "./converter";

export default function ConverterPage({ onConverted }: { onConverted: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [markdown, setMarkdown] = useState("");
  const [format, setFormat] = useState<ConversionFormat>("md");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);

  const selectFile = async (selected?: File) => {
    setFile(selected ?? null);
    setMarkdown("");
    setError("");
    setReady(false);
    if (!selected) return;
    setBusy(true);
    try {
      setMarkdown(await readAsMarkdown(selected));
      setReady(true);
    } catch (reason) {
      setFile(null);
      setError(reason instanceof Error ? reason.message : "Could not read this file.");
    } finally {
      setBusy(false);
    }
  };

  const convert = async () => {
    if (!file || !ready) return;
    setBusy(true);
    setError("");
    try {
      const result = await createConvertedFile(format, markdown, file.name);
      downloadBlob(result.blob, result.filename);
      onConverted();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not convert this file.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="converter-page">
      <div className="info-page-heading">
        <p className="eyebrow">FILE CONVERTER</p>
        <h1>Bring a file. Take a new format.</h1>
        <p>Convert a supported document into Markdown, plain text, HTML, PDF, DOCX, or a ZIP package. Files are processed in this browser and are not uploaded.</p>
      </div>
      <section className="converter-card">
        <label className="converter-upload" htmlFor="converter-file">
          <span className="converter-upload-icon"><Upload size={20} /></span>
          <strong>{file ? file.name : "Choose a file to convert"}</strong>
          <span>{busy && !ready ? "Reading file…" : "MD, TXT, HTML, PDF, DOCX, or ZIP · up to 20 MB"}</span>
          <input
            id="converter-file"
            type="file"
            accept=".md,.markdown,.txt,.html,.htm,.pdf,.docx,.zip"
            disabled={busy}
            onChange={(event) => void selectFile(event.target.files?.[0])}
          />
        </label>
        <div className="converter-arrow"><ArrowRightLeft size={18} /></div>
        <div className="converter-output">
          <label htmlFor="converter-format">Convert to</label>
          <select id="converter-format" value={format} onChange={(event) => setFormat(event.target.value as ConversionFormat)}>
            {conversionFormats.map((item) => <option key={item.value} value={item.value}>{item.label} ({item.extension})</option>)}
          </select>
        </div>
        <button className="primary-button converter-submit" disabled={!ready || busy} onClick={() => void convert()}>
          <ArrowDownToLine size={16} /> {busy ? "Working…" : "Convert and download"}
        </button>
        {error && <p className="converter-error" role="alert">{error}</p>}
        {ready && !error && <p className="converter-ready"><FileText size={14} /> Ready to convert · {file?.size ? `${(file.size / 1024).toFixed(0)} KB` : ""}</p>}
      </section>
      <div className="converter-notes">
        <p><LockKeyhole size={15} /> <span><strong>Private by design</strong> — parsing and conversion run locally in your browser.</span></p>
        <p><strong>Notes:</strong> PDF and DOCX imports extract text; complex layout, images, and embedded media may not carry over. ZIP input uses the first Markdown file it finds. ZIP output contains the converted Markdown file.</p>
      </div>
    </main>
  );
}
