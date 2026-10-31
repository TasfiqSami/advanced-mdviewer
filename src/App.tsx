import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, Archive, ArrowDownToLine, ArrowLeft, ArrowRight, ArrowRightLeft, BookOpen, Check, CheckCircle2,
  ChevronDown, ChevronRight, CircleHelp, Clock3, Code2, Copy, Download, FilePlus2, FileText,
  Folder, FolderPlus, Heart, ImagePlus, LayoutDashboard, ListTree, LogOut, Menu, Pencil,
  PanelLeftClose, PanelLeftOpen, Pin, Plus, ScrollText, Search, Settings2, ShieldCheck, Sparkles, Sun,
  ExternalLink, Trash2, Upload, Volume2, VolumeX, X,
} from "lucide-react";
import { formatBytes, headingSlug, safeFilename, stripMarkdown } from "./utils";
import { EditorView } from "@codemirror/view";
import Editor from "./Editor";
import Markdown from "./Markdown";
import { api, jsonBody } from "./api";
import { SoundManager, type UiSound } from "./sound";
import { ApiError, type AdminStats, type AuditEvent, type DocumentItem, type FolderItem, type RevisionItem, type Theme, type View } from "./types";
import { appPageLabels, type AppPage } from "./pages";
import InfoPage from "./InfoPage";

const ConverterPage = lazy(() => import("./ConverterPage"));

type ExportFormat = "md" | "txt" | "html" | "pdf" | "docx" | "zip";
type SaveState = "saved" | "saving" | "unsaved" | "error";
type AppMode = "workspace" | "admin";
type ToastKind = "success" | "error" | "warning" | "info";

type ToastMessage = {
  message: string;
  kind: ToastKind;
};

const themeLabels: Record<Theme, string> = {
  "syxlor-dark": "SYXLOR Dark",
  "normal-dark": "Normal Dark",
  "syxlor-light": "SYXLOR Light",
  "normal-light": "Normal Light",
};
const exportExtensions: Record<ExportFormat, string> = {
  md: ".md", txt: ".txt", html: ".html", pdf: ".pdf", docx: ".docx", zip: ".zip",
};
const exportLabels: Record<ExportFormat, string> = {
  md: "Markdown", txt: "Plain text", html: "HTML", pdf: "PDF", docx: "Word document", zip: "Markdown + assets",
};

function dateLabel(date?: string | null): string {
  if (!date) return "Just now";
  const elapsed = Date.now() - new Date(date).getTime();
  if (elapsed < 60_000) return "Just now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(date));
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1200);
}

function IconButton({
  label, onClick, children, className = "", disabled = false, title,
}: {
  label: string; onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  children: React.ReactNode; className?: string; disabled?: boolean; title?: string;
}) {
  return <button aria-label={label} title={title ?? label} type="button" className={`icon-button ${className}`} onClick={onClick} disabled={disabled}>{children}</button>;
}

function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [username, setUsername] = useState("syxlor");
  const [loginError, setLoginError] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginRecovery, setLoginRecovery] = useState(false);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [activeDoc, setActiveDoc] = useState<DocumentItem | null>(null);
  const activeDocRef = useRef(activeDoc);
  activeDocRef.current = activeDoc;
  const editorRef = useRef<EditorView | null>(null);
  const pendingSaveRef = useRef<Promise<boolean> | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const contentRef = useRef(content);
  contentRef.current = content;
  const titleRef = useRef(title);
  titleRef.current = title;
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState("");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<View>("all");
  const [folderFilter, setFolderFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem("syxlor-theme") as Theme) || "syxlor-dark");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<"editor" | "preview">("editor");
  const [focusMode, setFocusMode] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(true);
  const [mode, setMode] = useState<AppMode>("workspace");
  const [page, setPage] = useState<AppPage>("workspace");
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(() => localStorage.getItem("syxlor-sound-enabled") !== "false");
  const [soundVolume, setSoundVolume] = useState(() => {
    const stored = Number(localStorage.getItem("syxlor-sound-volume") ?? "0.4");
    return Number.isFinite(stored) ? Math.min(1, Math.max(0, stored)) : 0.4;
  });
  const [exportFormat, setExportFormat] = useState<ExportFormat | null>(null);
  const [filename, setFilename] = useState("");
  const [folderDialog, setFolderDialog] = useState(false);
  const [passwordDialog, setPasswordDialog] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [revisions, setRevisions] = useState<RevisionItem[]>([]);
  const [adminStats, setAdminStats] = useState<AdminStats | null>(null);
  const [activity, setActivity] = useState<AuditEvent[]>([]);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [adminLoading, setAdminLoading] = useState(false);
  const [tagEntry, setTagEntry] = useState("");
  const [attachments, setAttachments] = useState<{ id: string; filename: string; mime_type: string; file_size: number }[]>([]);
  const [readingWidth, setReadingWidth] = useState(850);
  const [wordCount, setWordCount] = useState(0);
  const [cursorPosition, setCursorPosition] = useState("Ln 1, Col 1");
  const [listLoading, setListLoading] = useState(false);
  const [maxUploadMb, setMaxUploadMb] = useState<number | null>(null);
  const [uploadConfigError, setUploadConfigError] = useState("");

  const navigatePage = (nextPage: AppPage) => {
    setPage(nextPage);
    setMode("workspace");
    setFocusMode(false);
    setMobileMenuOpen(false);
    setExportFormat(null);
  };

  const soundRef = useRef(new SoundManager());

  const inferToastKind = useCallback((message: string): ToastKind => {
    const lower = message.toLowerCase();
    if (/could not|failed|invalid|incorrect|error|not found|not allowed|unavailable|expired/.test(lower)) return "error";
    if (/warning|maintenance|archived|reset|removed|deleted/.test(lower)) return "warning";
    return "success";
  }, []);

  const notify = useCallback((message: string, kind: ToastKind = inferToastKind(message)) => {
    setToast({ message, kind });
  }, [inferToastKind]);

  const playUiSound = useCallback((kind: UiSound = "success") => {
    if (!soundEnabled) return;
    soundRef.current.setEnabled(soundEnabled);
    soundRef.current.setVolume(soundVolume);
    soundRef.current.play(kind);
  }, [soundEnabled, soundVolume]);

  const refreshDocuments = useCallback(async (nextSearch = search, nextView = view, nextFolder = folderFilter, nextTag = tagFilter) => {
    const params = new URLSearchParams();
    if (nextSearch.trim()) params.set("search", nextSearch.trim());
    if (nextView !== "all") params.set("view", nextView);
    if (nextFolder) params.set("folder", nextFolder);
    if (nextTag) params.set("tag", nextTag);
    setListLoading(true);
    try {
      const result = await api<DocumentItem[]>(`/documents?${params}`);
      setDocuments(result);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not load documents.");
    } finally {
      setListLoading(false);
    }
  }, [folderFilter, notify, search, tagFilter, view]);

  const refreshFolders = useCallback(async () => {
    try {
      setFolders(await api<FolderItem[]>("/folders"));
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not load folders.");
    }
  }, [notify]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("syxlor-theme", theme);
  }, [theme]);

  useEffect(() => {
    void api<{ maxUploadMb: number }>("/config")
      .then(({ maxUploadMb: configuredLimit }) => {
        if (!Number.isSafeInteger(configuredLimit) || configuredLimit < 1) {
          throw new Error("The server returned an invalid upload limit.");
        }
        setMaxUploadMb(configuredLimit);
        setUploadConfigError("");
      })
      .catch((error) => {
        setUploadConfigError(error instanceof Error ? error.message : "Could not load upload settings.");
      });
  }, []);

  useEffect(() => {
    soundRef.current.setEnabled(soundEnabled);
    soundRef.current.setVolume(soundVolume);
    localStorage.setItem("syxlor-sound-enabled", String(soundEnabled));
    localStorage.setItem("syxlor-sound-volume", String(soundVolume));
  }, [soundEnabled, soundVolume]);

  useEffect(() => {
    if (!authenticated) return;
    void api("/settings", {
      method: "PUT",
      body: jsonBody({
        sound_enabled: String(soundEnabled),
        sound_volume: String(soundVolume),
      }),
    }).catch(() => undefined);
  }, [authenticated, soundEnabled, soundVolume]);

  useEffect(() => {
    void api<{ authenticated: boolean; username?: string }>("/auth/session")
      .then((session) => {
        setAuthenticated(session.authenticated);
        if (session.username) setUsername(session.username);
      })
      .catch(() => setAuthenticated(false));
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    void refreshDocuments();
    void refreshFolders();
    void api<Record<string, string>>("/settings").then(setSettings).catch(() => undefined);
  }, [authenticated, refreshDocuments, refreshFolders]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (authenticated) void refreshDocuments(search, view, folderFilter, tagFilter);
    }, search ? 180 : 0);
    return () => window.clearTimeout(timer);
  }, [authenticated, search, view, folderFilter, tagFilter]);

  useEffect(() => {
    if (!activeDoc) return;
    const draftKey = `syxlor-draft-${activeDoc.id}`;
    const timer = window.setTimeout(() => {
      if (content !== activeDoc.content || title !== activeDoc.title) {
        localStorage.setItem(draftKey, JSON.stringify({ title, content, updatedAt: Date.now() }));
        setSaveState("unsaved");
      }
    }, 850);
    return () => window.clearTimeout(timer);
  }, [activeDoc, content, title]);

  const saveDocument = useCallback(() => {
    if (pendingSaveRef.current) return pendingSaveRef.current;
    const doc = activeDocRef.current;
    if (!doc) return Promise.resolve(true);
    const nextTitle = titleRef.current.trim() || "Untitled document";
    const nextContent = contentRef.current;
    if (nextTitle === doc.title && nextContent === doc.content) {
      setSaveState("saved");
      return Promise.resolve(true);
    }
    setSaveState("saving");
    setSaveError("");
    const pending = (async (): Promise<boolean> => {
      try {
        const saved = await api<DocumentItem>(`/documents/${doc.id}`, {
          method: "PUT",
          body: jsonBody({
            title: nextTitle,
            content: nextContent,
            folderId: doc.folder_id,
            isFavorite: doc.is_favorite,
            isPinned: doc.is_pinned,
            tags: doc.tags,
            expectedRevision: doc.revision_number,
          }),
        });
        if (activeDocRef.current?.id === doc.id) {
          activeDocRef.current = saved;
          setActiveDoc(saved);
          setDocuments((current) => current.map((item) => item.id === saved.id ? saved : item));
          if (titleRef.current === nextTitle && contentRef.current === nextContent) {
            localStorage.removeItem(`syxlor-draft-${doc.id}`);
            setSaveState("saved");
          } else {
            setSaveState("unsaved");
          }
          setSaveError("");
        }
        return true;
      } catch (error) {
        setSaveState("error");
        const message = error instanceof Error ? error.message : "Save failed.";
        setSaveError(message);
        if (error instanceof ApiError && error.status === 401) {
          setAuthenticated(false);
        } else {
          notify(message);
        }
        return false;
      } finally {
        pendingSaveRef.current = null;
      }
    })();
    pendingSaveRef.current = pending;
    return pending;
  }, [notify]);

  useEffect(() => {
    if (!activeDoc || (title === activeDoc.title && content === activeDoc.content)) return;
    setSaveState("unsaved");
    const timer = window.setTimeout(() => void saveDocument(), 900);
    return () => window.clearTimeout(timer);
  }, [activeDoc, content, saveDocument, title]);

  useEffect(() => {
    setWordCount(stripMarkdown(content).split(/\s+/).filter(Boolean).length);
  }, [content]);

  useEffect(() => {
    const view = editorRef.current;
    if (!view) return;
    const updatePosition = () => {
      const position = view.state.doc.lineAt(view.state.selection.main.head);
      setCursorPosition(`Ln ${position.number}, Col ${view.state.selection.main.head - position.from + 1}`);
    };
    view.dom.addEventListener("keyup", updatePosition);
    view.dom.addEventListener("click", updatePosition);
    return () => {
      view.dom.removeEventListener("keyup", updatePosition);
      view.dom.removeEventListener("click", updatePosition);
    };
  }, [activeDoc]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const selectDocument = useCallback(async (id: string) => {
    if (activeDocRef.current && (saveState !== "saved" || pendingSaveRef.current)) {
      let saved = await saveDocument();
      if (saved && activeDocRef.current && (titleRef.current !== activeDocRef.current.title || contentRef.current !== activeDocRef.current.content)) {
        saved = await saveDocument();
      }
      if (!saved && !window.confirm("The latest changes could not be saved. A recovery draft is kept in this browser. Open another document anyway?")) return;
    }
    try {
      const result = await api<DocumentItem>(`/documents/${id}`);
      const draftText = localStorage.getItem(`syxlor-draft-${id}`);
      if (draftText) {
        const draft = JSON.parse(draftText) as { title: string; content: string; updatedAt: number };
        if (draft.updatedAt > new Date(result.updated_at).getTime() && window.confirm("A recovered draft is available. Restore it?")) {
          result.title = draft.title;
          result.content = draft.content;
        }
      }
      activeDocRef.current = result;
      setActiveDoc(result);
      setPage("workspace");
      setTitle(result.title);
      setContent(result.content);
      setTagEntry(result.tags.join(", "));
      setMobilePanel("editor");
      setMode("workspace");
      playUiSound("info");
      void refreshDocuments();
      void api<typeof attachments>(`/attachments?documentId=${encodeURIComponent(result.id)}`).then(setAttachments).catch(() => setAttachments([]));
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not open document.");
    }
  }, [attachments, notify, playUiSound, refreshDocuments, saveDocument, saveState]);

  const createDocument = async () => {
    try {
      const result = await api<DocumentItem>("/documents", {
        method: "POST",
        body: jsonBody({ title: "Untitled document", content: "", folderId: folderFilter || null }),
      });
      setPage("workspace");
      setView("all");
      setFolderFilter("");
      playUiSound("success");
      await refreshDocuments(search, "all", "", tagFilter);
      await selectDocument(result.id);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not create document.");
    }
  };

  const changeDocument = async (patch: Partial<Pick<DocumentItem, "is_favorite" | "is_pinned" | "folder_id" | "title" | "content">>) => {
    await saveDocument();
    const doc = activeDocRef.current;
    if (!doc) return;
    const updated = { ...doc, ...patch };
    try {
      const saved = await api<DocumentItem>(`/documents/${doc.id}`, {
        method: "PUT",
        body: jsonBody({
          title: patch.title ?? titleRef.current,
          content: patch.content ?? contentRef.current,
          folderId: updated.folder_id,
          isFavorite: updated.is_favorite,
          isPinned: updated.is_pinned,
          tags: doc.tags,
          expectedRevision: doc.revision_number,
        }),
      });
      setActiveDoc(saved);
      activeDocRef.current = saved;
      setDocuments((current) => current.map((item) => item.id === saved.id ? saved : item));
      playUiSound("success");
      notify("Document updated.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not update document.");
    }
  };

  const saveTags = async () => {
    await saveDocument();
    const doc = activeDocRef.current;
    if (!doc) return;
    const tags = [...new Set(tagEntry.split(",").map((tag) => tag.trim().replace(/^#/, "")).filter(Boolean))].slice(0, 20);
    try {
      const updated = await api<DocumentItem>(`/documents/${doc.id}`, {
        method: "PUT",
        body: jsonBody({
          title: doc.title,
          content: doc.content,
          folderId: doc.folder_id,
          isFavorite: doc.is_favorite,
          isPinned: doc.is_pinned,
          tags,
          expectedRevision: doc.revision_number,
        }),
      });
      activeDocRef.current = updated;
      setActiveDoc(updated);
      setDocuments((current) => current.map((item) => item.id === updated.id ? updated : item));
      setTagEntry(updated.tags.join(", "));
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not update tags.");
    }
  };

  const createFolder = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = folderName.trim();
    if (!name) return;
    try {
      await api("/folders", { method: "POST", body: jsonBody({ name }) });
      setFolderName("");
      setFolderDialog(false);
      await refreshFolders();
      notify("Folder created.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not create folder.");
    }
  };

  const renameFolder = async (folder: FolderItem) => {
    const name = window.prompt("Rename folder", folder.name)?.trim();
    if (!name || name === folder.name) return;
    try {
      await api(`/folders/${folder.id}`, { method: "PUT", body: jsonBody({ name }) });
      await refreshFolders();
      notify("Folder renamed.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not rename folder.");
    }
  };

  const deleteFolder = async (folder: FolderItem) => {
    if (!window.confirm(`Move “${folder.name}” to the folder archive? Documents stay in your library.`)) return;
    try {
      await api(`/folders/${folder.id}`, { method: "DELETE" });
      if (folderFilter === folder.id) setFolderFilter("");
      await refreshFolders();
      await refreshDocuments(search, view, folderFilter === folder.id ? "" : folderFilter, tagFilter);
      notify("Folder archived.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not archive folder.");
    }
  };

  const importMarkdown = async (file?: File) => {
    if (!file) return;
    try {
      const source = await file.text();
      const result = await api<DocumentItem>("/documents", {
        method: "POST",
        body: jsonBody({ title: file.name.replace(/\.(md|markdown)$/i, "") || "Imported document", content: source }),
      });
      setView("all");
      setFolderFilter("");
      await refreshDocuments("", "all", "", "");
      await selectDocument(result.id);
      notify("Markdown document imported.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not import this Markdown file.");
    }
  };

  const duplicateDocument = async () => {
    const doc = activeDocRef.current;
    if (!doc) return;
    try {
      const copy = await api<DocumentItem>(`/documents/${doc.id}/duplicate`, { method: "POST", body: "{}" });
      await refreshDocuments();
      await selectDocument(copy.id);
      notify("Document duplicated.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not duplicate document.");
    }
  };

  const changeTheme = async (nextTheme: Theme) => {
    setTheme(nextTheme);
    try {
    playUiSound("info");
    await api("/settings", { method: "PUT", body: jsonBody({ theme: nextTheme }) });
    } catch (error) {
    notify(error instanceof Error ? error.message : "Theme preference could not be saved.");
    }
  };

  const login = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoginBusy(true);
    setLoginError("");
    const form = new FormData(event.currentTarget);
    try {
      const result = await api<{ authenticated: boolean; username: string }>("/auth/login", {
        method: "POST",
        body: jsonBody({ username: form.get("username"), password: form.get("password") }),
      });
      playUiSound("success");
      setUsername(result.username);
      setAuthenticated(true);
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "Sign-in failed.");
    } finally {
      setLoginBusy(false);
    }
  };

  const recoverAccount = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoginBusy(true);
    setLoginError("");
    const form = new FormData(event.currentTarget);
    try {
      await api("/auth/recover", {
        method: "POST",
        body: jsonBody({ recoveryKey: form.get("recovery-key"), newPassword: form.get("new-password") }),
      });
      setLoginRecovery(false);
      setLoginError("Password reset. Sign in with your new password.");
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "Account recovery failed.");
    } finally {
      setLoginBusy(false);
    }
  };

  const changePassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await api("/auth/password", {
        method: "PUT",
        body: jsonBody({ currentPassword: form.get("current-password"), newPassword: form.get("new-password") }),
      });
      setPasswordDialog(false);
      playUiSound("success");
      notify("Owner password changed. Other sessions were signed out.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not change the password.");
    }
  };

  const logout = async () => {
    try {
      await api("/auth/logout", { method: "POST", body: "{}" });
      playUiSound("info");
    } finally {
      setAuthenticated(false);
      setActiveDoc(null);
      setMode("workspace");
    }
  };

  const onEditorChange = (nextContent: string) => {
    contentRef.current = nextContent;
    setContent(nextContent);
  };

  const applyFormatting = (before: string, after = "", placeholder = "text") => {
    const editor = editorRef.current;
    if (!editor) return;
    const selection = editor.state.selection.main;
    const selected = editor.state.sliceDoc(selection.from, selection.to);
    const inserted = `${before}${selected || placeholder}${after}`;
    editor.dispatch({
      changes: { from: selection.from, to: selection.to, insert: inserted },
      selection: { anchor: selection.from + before.length, head: selection.from + before.length + (selected || placeholder).length },
      scrollIntoView: true,
    });
    editor.focus();
  };

  const uploadImage = async (file?: File) => {
    const doc = activeDocRef.current;
    if (!file || !doc) return;
    if (uploadConfigError) {
      notify(`Cannot upload until the server settings load: ${uploadConfigError}`, "error");
      return;
    }
    if (maxUploadMb === null) {
      notify("Upload settings are still loading. Please try again in a moment.", "warning");
      return;
    }
    if (file.size > maxUploadMb * 1024 * 1024) {
      notify(`This image is larger than the ${maxUploadMb} MB upload limit.`, "error");
      return;
    }
    const form = new FormData();
    form.append("file", file);
    try {
      const result = await api<{ id: string; filename: string; url: string }>(`/attachments?documentId=${encodeURIComponent(doc.id)}`, { method: "POST", body: form });
      const alt = result.filename.replace(/\.[^.]+$/, "");
      applyFormatting(`![${alt}](${result.url})`, "", "");
      setAttachments(await api<typeof attachments>(`/attachments?documentId=${encodeURIComponent(doc.id)}`));
      notify("Image uploaded and inserted.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Image upload failed.");
    }
  };

  const openExport = (format: ExportFormat, shift = false) => {
    const defaultName = safeFilename(title || "syxlor-document", exportExtensions[format]);
    if (shift) {
      setExportFormat(null);
      void performExport(format, defaultName);
      return;
    }
    setExportFormat(format);
    setFilename(defaultName.replace(new RegExp(`${exportExtensions[format].replace(".", "\\.")}$`), ""));
  };

  const performExport = async (format: ExportFormat, fullFilename: string) => {
    if (!activeDocRef.current) return;
    const filenameWithExt = safeFilename(fullFilename, exportExtensions[format]);
    const markdownText = contentRef.current;
    try {
      if (format === "md") triggerDownload(new Blob([markdownText], { type: "text/markdown;charset=utf-8" }), filenameWithExt);
      if (format === "txt") triggerDownload(new Blob([stripMarkdown(markdownText)], { type: "text/plain;charset=utf-8" }), filenameWithExt);
      if (format === "html") {
        const article = document.querySelector(".preview-content .markdown-body")?.innerHTML ?? "";
        const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title.replace(/[<>&"]/g, "")}</title><style>body{max-width:780px;margin:64px auto;padding:0 28px;color:#182132;font:16px/1.75 system-ui,sans-serif}h1,h2,h3{line-height:1.3}pre{padding:18px;background:#111827;color:#e5e7eb;border-radius:8px;overflow:auto}code{font-family:Consolas,monospace}table{border-collapse:collapse;width:100%}td,th{border:1px solid #d5dbe5;padding:8px;text-align:left}blockquote{border-left:3px solid #2cbde5;margin-left:0;padding-left:18px;color:#687386}img{max-width:100%}</style></head><body>${article}</body></html>`;
        triggerDownload(new Blob([html], { type: "text/html;charset=utf-8" }), filenameWithExt);
      }
      if (format === "docx") {
        const { buildDocx } = await import("./docx");
        triggerDownload(await buildDocx(markdownText, title || "Untitled"), filenameWithExt);
      }
      if (format === "pdf") {
        const { makePdf } = await import("./pdf");
        triggerDownload(await makePdf(markdownText, title), filenameWithExt);
      }
      if (format === "zip") {
        const { default: JSZip } = await import("jszip");
        const zip = new JSZip();
        let source = markdownText;
        for (const attachment of attachments) {
          const response = await fetch(`/api/v1/attachments/${attachment.id}`, { credentials: "same-origin" });
          if (!response.ok) throw new Error(`Could not download attachment: ${attachment.filename}`);
          zip.file(`assets/${attachment.id}`, await response.blob());
          source = source.replaceAll(`/api/v1/attachments/${attachment.id}`, `assets/${attachment.id}`);
        }
        zip.file(`${safeFilename(title || "document", ".md").replace(/\.md$/, "")}.md`, source);
        triggerDownload(await zip.generateAsync({ type: "blob" }), filenameWithExt);
      }
      setExportFormat(null);
      notify(`${exportLabels[format]} exported.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : `Could not export ${exportLabels[format]}.`);
    }
  };

  const openHistory = async () => {
    if (!activeDoc) return;
    try {
      setRevisions(await api<RevisionItem[]>(`/documents/${activeDoc.id}/revisions`));
      setHistoryOpen(true);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not load document history.");
    }
  };

  const restoreRevision = async (revision: RevisionItem) => {
    if (!activeDoc || !window.confirm(`Restore version ${revision.version_number}? The current text will be kept in the history.`)) return;
    try {
      const result = await api<DocumentItem>(`/documents/${activeDoc.id}/revisions/${revision.id}/restore`, { method: "POST", body: "{}" });
      setActiveDoc(result);
      activeDocRef.current = result;
      setContent(result.content);
      setTitle(result.title);
      setHistoryOpen(false);
      notify(`Version ${revision.version_number} restored.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not restore this version.");
    }
  };

  const trashDocument = async (doc: DocumentItem) => {
    if (!window.confirm(`Move “${doc.title}” to Trash?`)) return;
    try {
      if (activeDocRef.current?.id === doc.id) await saveDocument();
      await api(`/documents/${doc.id}`, { method: "DELETE" });
      if (activeDoc?.id === doc.id) {
        setActiveDoc(null);
        activeDocRef.current = null;
      }
      playUiSound("warning");
      await refreshDocuments();
      notify("Document moved to Trash.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not delete document.");
    }
  };

  const restoreDocument = async (doc: DocumentItem) => {
    try {
      await api(`/documents/${doc.id}/restore`, { method: "POST", body: "{}" });
      playUiSound("success");
      await refreshDocuments();
      notify("Document restored.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not restore document.");
    }
  };

  const permanentlyDelete = async (doc: DocumentItem) => {
    if (!window.confirm(`Permanently delete “${doc.title}”? This cannot be undone.`)) return;
    try {
      await api(`/documents/${doc.id}/permanent`, { method: "DELETE" });
      await refreshDocuments();
      notify("Document permanently deleted.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not permanently delete document.");
    }
  };

  const loadAdmin = async () => {
    setAdminLoading(true);
    try {
      const [stats, events] = await Promise.all([
        api<AdminStats>("/admin/stats"),
        api<AuditEvent[]>("/admin/activity"),
      ]);
      setAdminStats(stats);
      setActivity(events);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not load administration data.");
    } finally {
      setAdminLoading(false);
    }
  };

  useEffect(() => {
    if (mode === "admin" && authenticated) void loadAdmin();
  }, [mode, authenticated]);

  const toggleMaintenance = async () => {
    const enabled = settings.maintenance_mode !== "true";
    try {
      await api("/settings", { method: "PUT", body: jsonBody({ maintenance_mode: String(enabled) }) });
      setSettings((current) => ({ ...current, maintenance_mode: String(enabled) }));
      notify(enabled ? "Maintenance mode enabled." : "Maintenance mode disabled.");
      void loadAdmin();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not update maintenance mode.");
    }
  };

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen((current) => !current);
        setCommandQuery("");
      }
      if (event.key === "Escape") {
        setCommandOpen(false);
        setExportFormat(null);
        setHistoryOpen(false);
        setFolderDialog(false);
        setFocusMode(false);
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s" && authenticated) {
        event.preventDefault();
        void saveDocument();
        notify("Saved.");
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [authenticated, notify, saveDocument]);

  const filteredDocuments = useMemo(() => documents, [documents]);
  const outline = useMemo(() => {
    const occurrences = new Map<string, number>();
    return content.split(/\r?\n/)
    .map((line) => {
      const heading = /^(#{1,6})\s+(.+)$/.exec(line.trim());
      if (!heading) return null;
      const base = headingSlug(heading[2]);
      const occurrence = occurrences.get(base) ?? 0;
      occurrences.set(base, occurrence + 1);
      return { level: heading[1].length, text: heading[2].replace(/[*_`]/g, ""), id: occurrence ? `${base}-${occurrence}` : base };
    })
    .filter((item): item is { level: number; text: string; id: string } => item !== null);
  }, [content]);

  if (authenticated === null) return <div className="boot-screen"><div className="brand-gem">S</div><span>Opening your workspace…</span></div>;
  if (!authenticated) {
    return (
      <div className="login-page">
        <div className="login-orbit orbit-one" /><div className="login-orbit orbit-two" />
        <div className="login-card">
          <div className="brand-mark"><Brand /></div>
          <p className="eyebrow">YOUR PRIVATE WORKSPACE</p>
          <h1>Welcome back.</h1>
          <p className="login-copy">A quieter place to think, write, and keep what matters.</p>
          {loginRecovery ? (
            <form onSubmit={recoverAccount}>
              <label htmlFor="recovery-key">Offline recovery key</label>
              <input id="recovery-key" name="recovery-key" type="password" autoComplete="off" required />
              <label htmlFor="new-password">New password</label>
              <input id="new-password" name="new-password" type="password" minLength={12} autoComplete="new-password" required />
              {loginError && <p className="form-error" role="alert">{loginError}</p>}
              <button className="primary-button login-submit" disabled={loginBusy}>{loginBusy ? "Recovering…" : "Reset password"} <ArrowRight size={17} /></button>
              <button className="login-recovery-toggle" type="button" onClick={() => { setLoginRecovery(false); setLoginError(""); }}>Back to sign in</button>
            </form>
          ) : (
            <form onSubmit={login}>
              <input id="username" name="username" type="hidden" value={username} />
              <label htmlFor="password">Access PIN</label>
              <input id="password" name="password" type="password" inputMode="numeric" autoComplete="one-time-code" placeholder="Enter your PIN" required />
              {loginError && <p className="form-error" role="alert">{loginError}</p>}
              <button className="primary-button login-submit" disabled={loginBusy}>{loginBusy ? "Unlocking…" : "Unlock workspace"} <ArrowRight size={17} /></button>
              <button className="login-recovery-toggle" type="button" onClick={() => { setLoginRecovery(true); setLoginError(""); }}>Forgot PIN? Use your recovery key</button>
            </form>
          )}
          <div className="login-lock"><ShieldCheck size={14} /> Private owner access only</div>
        </div>
        <span className="login-version">SYXLOR MD VIEWER <span>·</span> PRIVATE BY DESIGN</span>
      </div>
    );
  }

  const activeListTitle = view === "favorites" ? "Favorites" : view === "recent" ? "Recent" : view === "trash" ? "Trash" : tagFilter ? `# ${tagFilter}` : folderFilter ? folders.find((item) => item.id === folderFilter)?.name ?? "Folder" : "My documents";
  return (
    <div className={`app-shell ${focusMode ? "focus-active" : ""} ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      {!focusMode && (
        <aside className="sidebar">
          <div className="sidebar-brand">
            <Brand />
            <button className="sidebar-collapse" onClick={() => setSidebarCollapsed(true)} title="Collapse sidebar"><PanelLeftClose size={16} /></button>
          </div>
          <button className="new-document-button" onClick={() => void createDocument()}><Plus size={16} /> New document <span>⌘ N</span></button>
          <button className="search-trigger" onClick={() => setCommandOpen(true)}><Search size={16} /><span>Search documents</span><kbd>⌘ K</kbd></button>
          <div className="nav-section-label">WORKSPACE</div>
          <nav className="main-nav" aria-label="Workspace navigation">
            <NavButton active={page === "workspace" && view === "all" && !folderFilter && !tagFilter} icon={<FileText size={16} />} label="All documents" count={documents.length} onClick={() => { navigatePage("workspace"); setView("all"); setFolderFilter(""); setTagFilter(""); }} />
            <NavButton active={page === "workspace" && view === "favorites"} icon={<Heart size={16} />} label="Favorites" onClick={() => { navigatePage("workspace"); setView("favorites"); setFolderFilter(""); setTagFilter(""); }} />
            <NavButton active={page === "workspace" && view === "recent"} icon={<Clock3 size={16} />} label="Recently opened" onClick={() => { navigatePage("workspace"); setView("recent"); setFolderFilter(""); setTagFilter(""); }} />
            <NavButton active={page === "workspace" && view === "trash"} icon={<Trash2 size={16} />} label="Trash" onClick={() => { navigatePage("workspace"); setView("trash"); setFolderFilter(""); setTagFilter(""); }} />
          </nav>
          <div className="nav-section-label sidebar-tools-label">TOOLS &amp; GUIDES</div>
          <nav className="main-nav" aria-label="Tools and guides">
            <NavButton active={page === "guide"} icon={<BookOpen size={16} />} label="Guide" onClick={() => navigatePage("guide")} />
            <NavButton active={page === "converter"} icon={<ArrowRightLeft size={16} />} label="Converter" onClick={() => navigatePage("converter")} />
            <NavButton active={page === "markdown-guide"} icon={<ScrollText size={16} />} label="Markdown guide" onClick={() => navigatePage("markdown-guide")} />
          </nav>
          <div className="folder-heading"><span className="nav-section-label">FOLDERS</span><IconButton label="Create folder" onClick={() => setFolderDialog(true)}><Plus size={15} /></IconButton></div>
          <div className="folder-list">
            {folders.map((item) => (
              <div key={item.id} className="folder-row">
                <button className={`folder-link ${page === "workspace" && folderFilter === item.id ? "selected" : ""}`} onClick={() => { navigatePage("workspace"); setView("all"); setFolderFilter(item.id); setTagFilter(""); }}>
                  <Folder size={15} /><span>{item.name}</span>
                </button>
                <div className="folder-actions">
                  <IconButton label={`Rename ${item.name}`} onClick={() => void renameFolder(item)}><Pencil size={12} /></IconButton>
                  <IconButton label={`Archive ${item.name}`} onClick={() => void deleteFolder(item)}><Trash2 size={12} /></IconButton>
                </div>
              </div>
            ))}
            {!folders.length && <span className="sidebar-hint">Keep projects together with folders.</span>}
          </div>
          <div className="sidebar-bottom">
            <button className="nav-link" onClick={() => { setMode("admin"); setFocusMode(false); }}><LayoutDashboard size={16} /> Owner management</button>
            <button className="nav-link" onClick={() => setCommandOpen(true)}><CircleHelp size={16} /> Shortcuts & help</button>
            <div className="owner-card">
              <div className="owner-avatar">{username.slice(0, 1).toUpperCase()}</div>
              <div className="owner-info"><strong>{username}</strong><span>Owner account</span></div>
              <IconButton label="Sign out" onClick={() => void logout()}><LogOut size={15} /></IconButton>
            </div>
          </div>
        </aside>
      )}

      <section className="main-column">
        <header className="topbar">
          <div className="topbar-left">
            {!focusMode && <IconButton label="Open navigation" className="mobile-nav-trigger" onClick={() => setMobileMenuOpen(true)}><Menu size={17} /></IconButton>}
            {!focusMode && sidebarCollapsed && <IconButton label="Expand sidebar" onClick={() => setSidebarCollapsed(false)}><PanelLeftOpen size={17} /></IconButton>}
            {focusMode && <IconButton label="Exit focus mode" onClick={() => setFocusMode(false)}><ArrowLeft size={17} /></IconButton>}
            {!focusMode && (
              <nav className="breadcrumb" aria-label="Breadcrumb">
                <button type="button" onClick={() => { setMode("workspace"); navigatePage("workspace"); setView("all"); setFolderFilter(""); setTagFilter(""); }}>Workspace</button>
                <ChevronRight size={13} aria-hidden="true" />
                <span aria-current="page">{mode === "admin" ? "Owner management" : page === "workspace" ? activeListTitle : appPageLabels[page]}</span>
              </nav>
            )}
            {focusMode && <span className="focus-label"><BookOpen size={15} /> Reading mode</span>}
          </div>
          <div className="topbar-actions">
            {activeDoc && mode === "workspace" && page === "workspace" && !focusMode && (
              <>
                <SaveIndicator state={saveState} error={saveError} />
                <button className={`topbar-action ${activeDoc.is_favorite ? "active" : ""}`} onClick={() => void changeDocument({ is_favorite: !activeDoc.is_favorite })} title="Toggle favorite"><Heart size={16} fill={activeDoc.is_favorite ? "currentColor" : "none"} /></button>
                <button className={`topbar-action ${activeDoc.is_pinned ? "active" : ""}`} onClick={() => void changeDocument({ is_pinned: !activeDoc.is_pinned })} title="Pin document"><Pin size={16} /></button>
                <button className="topbar-action focus-button" onClick={() => setFocusMode(true)}><BookOpen size={15} /><span>Focus</span></button>
                <div className="export-menu">
                  <button className="primary-button export-main" onClick={(event) => openExport("md", event.shiftKey)}><Download size={15} /> Export <ChevronDown size={14} /></button>
                  <div className="export-popover">
                    {(Object.keys(exportLabels) as ExportFormat[]).map((format) => (
                      <button key={format} onClick={(event) => openExport(format, event.shiftKey)}><span>{exportLabels[format]}</span><kbd>{exportExtensions[format]}</kbd></button>
                    ))}
                  </div>
                </div>
              </>
            )}
            {mode === "admin" && <button className="subtle-button" onClick={() => navigatePage("workspace")}><ArrowLeft size={15} /> Back to workspace</button>}
            <SoundControl enabled={soundEnabled} volume={soundVolume} onToggle={() => setSoundEnabled((value) => !value)} onVolumeChange={(next) => setSoundVolume(next)} />
            <ThemePicker theme={theme} onChange={(next) => void changeTheme(next)} />
            {!focusMode && <IconButton label="Sign out" className="header-logout" onClick={() => void logout()}><LogOut size={16} /></IconButton>}
          </div>
        </header>

        {mode === "admin" ? (
          <AdminPage stats={adminStats} activity={activity} loading={adminLoading} maintenance={settings.maintenance_mode === "true"} onToggleMaintenance={() => void toggleMaintenance()} onRefresh={() => void loadAdmin()} onChangePassword={() => setPasswordDialog(true)} />
        ) : page !== "workspace" ? (
          page === "converter"
            ? <Suspense fallback={<div className="page-loading">Preparing converter…</div>}><ConverterPage onConverted={() => { playUiSound("success"); notify("Converted file downloaded."); }} /></Suspense>
            : <InfoPage page={page} />
        ) : focusMode ? (
          <div className="focus-reader">
            <div className="focus-progress"><span style={{ width: "0%" }} /></div>
            <aside className={`focus-outline ${outlineOpen ? "" : "outline-hidden"}`}>
              <div className="outline-title">ON THIS PAGE <IconButton label="Hide outline" onClick={() => setOutlineOpen(false)}><X size={14} /></IconButton></div>
              {outline.map((item) => <button key={item.id} className={`outline-item level-${item.level}`} onClick={() => document.getElementById(item.id)?.scrollIntoView({ behavior: "smooth" })}>{item.text}</button>)}
              {!outline.length && <p className="muted-copy">Add headings to build an outline.</p>}
            </aside>
            {!outlineOpen && <button className="outline-reopen" onClick={() => setOutlineOpen(true)}><ListTree size={16} /></button>}
            <div className="focus-document" style={{ maxWidth: `${readingWidth}px` }}>
              <div className="focus-document-head"><span>SYXLOR NOTES</span><span>{wordCount} words · {Math.max(1, Math.ceil(wordCount / 220))} min read</span></div>
              <h1 className="focus-title">{title}</h1>
              <Markdown source={content} className="focus-markdown" />
            </div>
            <div className="focus-controls"><button onClick={() => setReadingWidth((width) => Math.max(620, width - 80))}>−</button><span>Reading width</span><button onClick={() => setReadingWidth((width) => Math.min(1080, width + 80))}>+</button></div>
          </div>
        ) : (
          <div className="workspace">
            <div className="document-list-panel">
              <div className="list-heading">
                <div><p className="eyebrow">{view === "trash" ? "RECOVERY" : "YOUR LIBRARY"}</p><h1>{activeListTitle}</h1></div>
                <div className="list-heading-actions">
                  <label className="icon-button list-add import-markdown" title="Import Markdown"><Upload size={15} /><input type="file" accept=".md,.markdown,text/markdown" onChange={(event) => void importMarkdown(event.target.files?.[0])} /></label>
                  <IconButton label="Create document" className="list-add" onClick={() => void createDocument()}><Plus size={17} /></IconButton>
                </div>
              </div>
              <div className="document-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a note..." aria-label="Search documents" /><kbd>⌘ K</kbd></div>
              {tagFilter && <button className="filter-pill" onClick={() => setTagFilter("")}># {tagFilter} <X size={12} /></button>}
              <div className="document-list">
                {listLoading && <div className="list-loading"><div /><div /><div /></div>}
                {!listLoading && !filteredDocuments.length && (
                  <div className="empty-library">
                    <div className="empty-icon"><FileText size={22} /></div>
                    <strong>{view === "trash" ? "Trash is empty" : search ? "No matching documents" : "A fresh page."}</strong>
                    <span>{view === "trash" ? "Deleted documents will wait here until you restore or remove them." : search ? "Try another title or phrase." : "Create your first note and let the ideas find their place."}</span>
                    {view === "all" && !search && <button onClick={() => void createDocument()}><Plus size={15} /> New document</button>}
                  </div>
                )}
                {!listLoading && filteredDocuments.map((doc) => (
                  <DocumentCard
                    key={doc.id}
                    document={doc}
                    active={activeDoc?.id === doc.id}
                    trash={view === "trash"}
                    onSelect={() => view === "trash" ? undefined : void selectDocument(doc.id)}
                    onDelete={() => void trashDocument(doc)}
                    onRestore={() => void restoreDocument(doc)}
                    onPermanentDelete={() => void permanentlyDelete(doc)}
                    onTag={setTagFilter}
                  />
                ))}
              </div>
              <div className="list-footer"><span>{filteredDocuments.length} {filteredDocuments.length === 1 ? "document" : "documents"}</span><span>Saved privately</span></div>
            </div>

            <div className={`editor-workspace ${activeDoc ? mobilePanel : "empty"}`}>
              {activeDoc ? (
                <>
                  <div className="document-toolbar">
                    <div className="document-title-area">
                      <input className="document-title-input" aria-label="Document title" value={title} onChange={(event) => setTitle(event.target.value)} onBlur={() => { if (!title.trim()) setTitle("Untitled document"); }} />
                      <span className="document-meta">{activeDoc.folder_id ? folders.find((item) => item.id === activeDoc.folder_id)?.name ?? "Private notes" : "Private notes"} <span>·</span> Edited {dateLabel(activeDoc.updated_at)}</span>
                    </div>
                    <div className="document-actions">
                        <button className="mobile-library-back" onClick={() => { setActiveDoc(null); void refreshDocuments(); }}><ArrowLeft size={14} /> Library</button>
                      <button className="toolbar-action history-action" onClick={() => void openHistory()}><Clock3 size={15} /><span>History</span></button>
                        <select className="move-folder-select" aria-label="Move to folder" value={activeDoc.folder_id ?? ""} onChange={(event) => void changeDocument({ folder_id: event.target.value || null })}><option value="">Private notes</option>{folders.map((folder) => <option value={folder.id} key={folder.id}>{folder.name}</option>)}</select>
                        <button className="toolbar-action" onClick={() => void duplicateDocument()} title="Duplicate document"><Copy size={15} /></button>
                        <button className="toolbar-action trash-action" onClick={() => void trashDocument(activeDoc)} title="Move to Trash"><Trash2 size={15} /></button>
                      <button className="mobile-preview-toggle" onClick={() => setMobilePanel((current) => current === "editor" ? "preview" : "editor")}>{mobilePanel === "editor" ? "Preview" : "Edit"}</button>
                    </div>
                  </div>
                  <div className="format-toolbar">
                    <button className="format-tool" onClick={() => applyFormatting("## ", "", "Heading")} title="Heading">H</button>
                    <span className="toolbar-divider" />
                    <button className="format-tool" onClick={() => applyFormatting("**", "**")} title="Bold"><strong>B</strong></button>
                    <button className="format-tool" onClick={() => applyFormatting("*", "*")} title="Italic"><em>I</em></button>
                    <button className="format-tool" onClick={() => applyFormatting("~~", "~~")} title="Strikethrough"><s>S</s></button>
                    <span className="toolbar-divider" />
                    <button className="format-tool" onClick={() => applyFormatting("[", "](https://)", "link text")} title="Link">↗</button>
                    <button className="format-tool" onClick={() => applyFormatting("`", "`", "code")} title="Inline code"><Code2 size={15} /></button>
                    <button className="format-tool" onClick={() => applyFormatting("> ", "", "Quote")} title="Quote">❞</button>
                    <button className="format-tool" onClick={() => applyFormatting("- ", "", "List item")} title="List">☷</button>
                    <span className="toolbar-divider" />
                    <label className="format-tool image-tool" title="Insert image"><ImagePlus size={15} /><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => void uploadImage(event.target.files?.[0])} /></label>
                    <button className="format-tool" onClick={() => applyFormatting("\n| Column 1 | Column 2 |\n| --- | --- |\n| Value | Value |\n")} title="Insert table">▦</button>
                    <button className="format-tool" onClick={() => applyFormatting("\n---\n")} title="Divider">―</button>
                    <div className="toolbar-spacer" />
                    <span className="tag-display">{activeDoc.tags.map((tag) => <button key={tag} onClick={() => setTagFilter(tag)}>#{tag}</button>)}</span>
                    <TagEditor value={tagEntry} onChange={setTagEntry} onSave={() => void saveTags()} />
                  </div>
                  <div className="panels">
                    <div className={`editor-panel ${mobilePanel === "preview" ? "mobile-hidden" : ""}`}>
                      <Editor value={content} onChange={onEditorChange} editorRef={editorRef} />
                      <div className="editor-status"><span>{wordCount} words <i>·</i> {content.length} characters <i>·</i> {Math.max(1, Math.ceil(wordCount / 220))} min read</span><span>{cursorPosition}</span></div>
                    </div>
                    <div className="panel-resizer" aria-hidden="true" />
                    <div className={`preview-panel ${mobilePanel === "editor" ? "mobile-hidden" : ""}`}>
                      <div className="preview-heading"><span><Sparkles size={13} /> LIVE PREVIEW</span><span className="preview-dot" /></div>
                      <div className="preview-content"><Markdown source={content || "_Your rendered document will appear here._"} /></div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="workspace-empty">
                  <div className="workspace-empty-art"><div className="art-glow" /><Brand /></div>
                  <p className="eyebrow">A THOUGHTFUL PLACE TO WRITE</p>
                  <h2>Make room for your next idea.</h2>
                  <p>Pick up where you left off, or start with a clean page. Your words are saved to your private workspace.</p>
                  <button className="primary-button" onClick={() => void createDocument()}><FilePlus2 size={16} /> Create a document</button>
                  <span className="shortcut-hint">TIP <kbd>⌘ K</kbd> opens the command palette</span>
                </div>
              )}
            </div>
          </div>
        )}
        <footer className="app-footer">
          <div className="footer-main">
            <div className="footer-about">
              <div className="footer-brand"><img src="/syxlor-mark.png" alt="" /><span>Syxlor Markdown Viewer<small>A private space for writing, organizing, and exporting Markdown.</small></span></div>
              <p>Your notes stay in your workspace. Write at your pace; keep your ideas organized and close at hand.</p>
            </div>
            <nav className="footer-group" aria-label="Product navigation">
              <strong>Explore</strong>
              <button onClick={() => navigatePage("guide")}>Product guide</button>
              <button onClick={() => navigatePage("markdown-guide")}>Markdown reference</button>
              <button onClick={() => navigatePage("converter")}>File converter</button>
            </nav>
            <div className="footer-group footer-company">
              <strong>Made with care</strong>
              <span>Built by Anam</span>
              <span>A Syxlor product <i>·</i> Founded by <a href="https://TasfiqAhmed.com" target="_blank" rel="noopener noreferrer">TasfiqAhmed <ExternalLink size={11} /></a></span>
              <a className="footer-company-link" href="https://syxlor.xyz" target="_blank" rel="noopener noreferrer">syxlor.xyz <ExternalLink size={12} /><small>Parent company</small></a>
            </div>
          </div>
          <div className="footer-bottom">
            <span>© {new Date().getFullYear()} Syxlor Markdown Viewer</span>
            <nav aria-label="Legal information">
              <button onClick={() => navigatePage("privacy")}>Privacy</button>
              <button onClick={() => navigatePage("terms")}>Terms</button>
            </nav>
            <span className="footer-private"><ShieldCheck size={12} /> Private owner workspace</span>
          </div>
        </footer>
      </section>

      {toast && (
        <div className={`toast-message ${toast.kind}`} role="status">
          {toast.kind === "success" && <CheckCircle2 size={16} />}
          {toast.kind === "error" && <AlertTriangle size={16} />}
          {toast.kind === "warning" && <AlertTriangle size={16} />}
          {toast.kind === "info" && <Sparkles size={16} />}
          <span>{toast.message}</span>
        </div>
      )}
      {mobileMenuOpen && <MobileNavigation folders={folders} onClose={() => setMobileMenuOpen(false)} onWorkspace={() => { navigatePage("workspace"); setView("all"); setFolderFilter(""); setTagFilter(""); setActiveDoc(null); }} onView={(nextView) => { navigatePage("workspace"); setView(nextView); setFolderFilter(""); setTagFilter(""); setActiveDoc(null); }} onFolder={(folderId) => { navigatePage("workspace"); setView("all"); setFolderFilter(folderId); setTagFilter(""); setActiveDoc(null); }} onPage={navigatePage} onSearch={() => { setMobileMenuOpen(false); setCommandOpen(true); }} onAdmin={() => { setMode("admin"); setMobileMenuOpen(false); }} onLogout={() => { setMobileMenuOpen(false); void logout(); }} />}
      {exportFormat && <ExportDialog format={exportFormat} filename={filename} setFilename={setFilename} onCancel={() => setExportFormat(null)} onConfirm={() => void performExport(exportFormat, `${filename}${exportExtensions[exportFormat]}`)} />}
      {folderDialog && <Modal title="Create a folder" onClose={() => setFolderDialog(false)}><form className="dialog-form" onSubmit={(event) => void createFolder(event)}><label htmlFor="folder-name">Folder name</label><input id="folder-name" autoFocus maxLength={100} value={folderName} onChange={(event) => setFolderName(event.target.value)} placeholder="e.g. Studio notes" /><div className="dialog-actions"><button type="button" className="subtle-button" onClick={() => setFolderDialog(false)}>Cancel</button><button className="primary-button" disabled={!folderName.trim()}><FolderPlus size={15} /> Create folder</button></div></form></Modal>}
      {passwordDialog && <Modal title="Change owner password" onClose={() => setPasswordDialog(false)}><form className="dialog-form" onSubmit={(event) => void changePassword(event)}><label htmlFor="current-password">Current password</label><input id="current-password" name="current-password" autoComplete="current-password" type="password" required /><label htmlFor="owner-new-password">New password (at least 12 characters)</label><input id="owner-new-password" name="new-password" autoComplete="new-password" type="password" minLength={12} required /><div className="dialog-actions"><button type="button" className="subtle-button" onClick={() => setPasswordDialog(false)}>Cancel</button><button className="primary-button"><ShieldCheck size={15} /> Change password</button></div></form></Modal>}
      {historyOpen && <HistoryDialog revisions={revisions} onClose={() => setHistoryOpen(false)} onRestore={(revision) => void restoreRevision(revision)} />}
      {commandOpen && <CommandDialog query={commandQuery} setQuery={setCommandQuery} documents={documents} onClose={() => setCommandOpen(false)} onCreate={() => { setCommandOpen(false); void createDocument(); }} onSelect={(id) => { setCommandOpen(false); void selectDocument(id); }} onFocus={() => { setCommandOpen(false); setFocusMode(true); }} onAdmin={() => { setCommandOpen(false); setMode("admin"); }} onTheme={() => { setCommandOpen(false); const order: Theme[] = ["syxlor-dark", "normal-dark", "syxlor-light", "normal-light"]; void changeTheme(order[(order.indexOf(theme) + 1) % order.length]); }} />}
    </div>
  );
}

function Brand() {
  return <div className="brand-lockup"><img className="brand-image" src="/syxlor-mark.png" alt="" /><div className="brand-wordmark">SYXLOR<span>MD VIEWER</span></div></div>;
}

function NavButton({ active, icon, label, count, onClick }: { active: boolean; icon: React.ReactNode; label: string; count?: number; onClick: () => void }) {
  return <button className={`nav-link ${active ? "active" : ""}`} onClick={onClick}>{icon}<span>{label}</span>{count !== undefined && <em>{count}</em>}</button>;
}

function DocumentCard({
  document, active, trash, onSelect, onDelete, onRestore, onPermanentDelete, onTag,
}: {
  document: DocumentItem; active: boolean; trash: boolean; onSelect: () => void;
  onDelete: () => void; onRestore: () => void; onPermanentDelete: () => void; onTag: (tag: string) => void;
}) {
  const excerpt = stripMarkdown(document.content).slice(0, 105);
  return (
    <div className={`document-card ${active ? "selected" : ""}`} onClick={onSelect} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") onSelect(); }}>
      <div className="card-title-row"><span className="document-glyph"><FileText size={15} /></span><strong>{document.title || "Untitled document"}</strong>{document.is_pinned && <Pin size={12} className="pin-mark" />}{document.is_favorite && <Heart size={13} className="favorite-mark" fill="currentColor" />}</div>
      <p className="card-excerpt">{excerpt || "An empty page, waiting for an idea."}</p>
      <div className="card-foot"><span>{trash ? `Deleted ${dateLabel(document.deleted_at)}` : dateLabel(document.updated_at)}</span><div>{document.tags.slice(0, 2).map((tag) => <button key={tag} className="card-tag" onClick={(event) => { event.stopPropagation(); onTag(tag); }}>#{tag}</button>)}{trash ? <span className="trash-card-actions"><button onClick={(event) => { event.stopPropagation(); onRestore(); }}>Restore</button><button onClick={(event) => { event.stopPropagation(); onPermanentDelete(); }}>Delete</button></span> : <button className="card-more" title="Delete document" onClick={(event) => { event.stopPropagation(); onDelete(); }}><Trash2 size={15} /></button>}</div></div>
    </div>
  );
}

function SaveIndicator({ state, error }: { state: SaveState; error: string }) {
  const labels: Record<SaveState, string> = { saved: "Saved", saving: "Saving", unsaved: "Unsaved", error: error || "Save failed" };
  return <span className={`save-indicator ${state}`} title={state === "error" ? error : undefined}><i />{labels[state]}</span>;
}

function SoundControl({ enabled, volume, onToggle, onVolumeChange }: { enabled: boolean; volume: number; onToggle: () => void; onVolumeChange: (value: number) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="settings-menu">
      <button
        className="topbar-action theme-trigger"
        type="button"
        onClick={() => setOpen((value) => !value)}
        title="Sound settings"
        aria-label="Sound settings"
        aria-expanded={open}
        aria-controls="sound-settings-panel"
      >
        {enabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
      </button>
      {open && <>
        <button className="click-away" aria-label="Close sound settings" onClick={() => setOpen(false)} />
        <div className="settings-panel" id="sound-settings-panel" aria-label="Sound settings">
          <div className="settings-header">
            <strong>Sound</strong>
            <button className="subtle-button" type="button" onClick={onToggle}>{enabled ? "On" : "Off"}</button>
          </div>
          <label className="range-row">
            <span>Volume</span>
            <input
              aria-label="Sound volume"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={volume}
              style={{ "--range-progress": `${volume * 100}%` } as React.CSSProperties}
              onChange={(event) => onVolumeChange(Number(event.target.value))}
            />
            <output>{Math.round(volume * 100)}%</output>
          </label>
        </div>
      </>}
    </div>
  );
}

function ThemePicker({ theme, onChange }: { theme: Theme; onChange: (theme: Theme) => void }) {
  const [open, setOpen] = useState(false);
  return <div className="theme-picker"><button className="topbar-action theme-trigger" onClick={() => setOpen((value) => !value)} title="Appearance"><Sun size={16} /></button>{open && <><button className="click-away" aria-label="Close themes" onClick={() => setOpen(false)} /><div className="theme-popover"><p>APPEARANCE</p>{(Object.keys(themeLabels) as Theme[]).map((key) => <button key={key} className={theme === key ? "chosen" : ""} onClick={() => { onChange(key); setOpen(false); }}><span className={`theme-swatch ${key}`} />{themeLabels[key]}{theme === key && <Check size={14} />}</button>)}</div></>}</div>;
}

function MobileNavigation({
  folders, onClose, onWorkspace, onView, onFolder, onPage, onSearch, onAdmin, onLogout,
}: {
  folders: FolderItem[]; onClose: () => void; onWorkspace: () => void; onView: (view: View) => void;
  onFolder: (folderId: string) => void; onPage: (page: AppPage) => void; onSearch: () => void;
  onAdmin: () => void; onLogout: () => void;
}) {
  const drawerRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const drawer = drawerRef.current;
    if (!drawer) return;
    const focusable = () => [...drawer.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], input:not(:disabled), [tabindex]:not([tabindex='-1'])")];
    focusable()[0]?.focus();
    const handleKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCloseRef.current();
      } else if (event.key === "Tab") {
        const items = focusable();
        const first = items[0];
        const last = items[items.length - 1];
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handleKeyboard);
    return () => document.removeEventListener("keydown", handleKeyboard);
  }, []);

  return (
    <div className="mobile-drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside ref={drawerRef} className="mobile-drawer" aria-label="Workspace navigation" role="dialog" aria-modal="true" tabIndex={-1}>
        <div className="mobile-drawer-head"><Brand /><IconButton label="Close navigation" onClick={onClose}><X size={17} /></IconButton></div>
        <button className="mobile-nav-search" onClick={onSearch}><Search size={16} /><span>Search documents</span><kbd>⌘ K</kbd></button>
        <div className="mobile-nav-section">
          <span className="nav-section-label">WORKSPACE</span>
          <button className="nav-link" onClick={onWorkspace}><FileText size={16} /> All documents</button>
          <button className="nav-link" onClick={() => onView("favorites")}><Heart size={16} /> Favorites</button>
          <button className="nav-link" onClick={() => onView("recent")}><Clock3 size={16} /> Recently opened</button>
          <button className="nav-link" onClick={() => onView("trash")}><Trash2 size={16} /> Trash</button>
        </div>
        {folders.length > 0 && <div className="mobile-nav-section">
          <span className="nav-section-label">FOLDERS</span>
          {folders.map((folder) => <button className="nav-link" key={folder.id} onClick={() => onFolder(folder.id)}><Folder size={16} /><span>{folder.name}</span></button>)}
        </div>}
        <div className="mobile-nav-section">
          <span className="nav-section-label">TOOLS &amp; GUIDES</span>
          <button className="nav-link" onClick={() => onPage("guide")}><BookOpen size={16} /> Guide</button>
          <button className="nav-link" onClick={() => onPage("converter")}><ArrowRightLeft size={16} /> Converter</button>
          <button className="nav-link" onClick={() => onPage("markdown-guide")}><ScrollText size={16} /> Markdown guide</button>
        </div>
        <div className="mobile-nav-section mobile-nav-account">
          <span className="nav-section-label">ACCOUNT</span>
          <button className="nav-link" onClick={onAdmin}><LayoutDashboard size={16} /> Owner management</button>
          <button className="nav-link" onClick={onLogout}><LogOut size={16} /> Sign out</button>
        </div>
        <div className="mobile-drawer-footer">Private owner workspace</div>
      </aside>
    </div>
  );
}

function TagEditor({ value, onChange, onSave }: { value: string; onChange: (value: string) => void; onSave: () => void }) {
  const [editing, setEditing] = useState(false);
  if (!editing) return <button className="tag-edit-trigger" onClick={() => setEditing(true)} title="Edit tags"><Plus size={13} /></button>;
  return <form className="tag-edit-form" onSubmit={(event) => { event.preventDefault(); onSave(); setEditing(false); }}><input autoFocus value={value} onChange={(event) => onChange(event.target.value)} placeholder="comma-separated tags" onKeyDown={(event) => { if (event.key === "Escape") setEditing(false); }} /><button title="Save tags"><Check size={13} /></button></form>;
}

function Modal({ title, children, onClose, className = "" }: { title: string; children: React.ReactNode; onClose: () => void; className?: string }) {
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className={`modal-card ${className}`} role="dialog" aria-modal="true" aria-label={title}><div className="modal-header"><h2>{title}</h2><IconButton label="Close dialog" onClick={onClose}><X size={17} /></IconButton></div>{children}</section></div>;
}

function ExportDialog({ format, filename, setFilename, onCancel, onConfirm }: { format: ExportFormat; filename: string; setFilename: (name: string) => void; onCancel: () => void; onConfirm: () => void }) {
  const extension = exportExtensions[format];
  const safeName = filename.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/[. ]+$/g, "").slice(0, 120) || "syxlor-document";
  return (
    <Modal title="Export document" onClose={onCancel} className="export-dialog">
      <div className="export-dialog-info"><div className="export-format-icon"><ArrowDownToLine size={19} /></div><div><strong>{exportLabels[format]}</strong><span>Ready to save from your workspace</span></div></div>
      <label className="field-label" htmlFor="export-filename">File name</label>
      <div className="filename-field"><input id="export-filename" autoFocus value={filename} onChange={(event) => setFilename(event.target.value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/[. ]+$/g, "").slice(0, 120))} onKeyDown={(event) => { if (event.key === "Enter") onConfirm(); }} /><span>{extension}</span></div>
      <div className="filename-preview"><span>FILE</span><strong>{safeName}{extension}</strong></div>
      <div className="dialog-actions"><button className="subtle-button" onClick={onCancel}>Cancel</button><button className="primary-button" onClick={onConfirm}><Download size={15} /> Download</button></div>
      <p className="shift-hint"><kbd>SHIFT</kbd> + click Export to download without this dialog</p>
    </Modal>
  );
}

function HistoryDialog({ revisions, onClose, onRestore }: { revisions: RevisionItem[]; onClose: () => void; onRestore: (revision: RevisionItem) => void }) {
  return <Modal title="Version history" onClose={onClose} className="history-dialog"><p className="dialog-description">Meaningful snapshots are kept as you work. Restoring a version creates a new history entry.</p><div className="revision-list">{revisions.map((revision) => <div className="revision-row" key={revision.id}><div className="revision-icon"><Clock3 size={15} /></div><div className="revision-info"><strong>Version {revision.version_number}</strong><span>{new Date(revision.created_at).toLocaleString()} · {formatBytes(revision.content_length)}</span></div><button className="subtle-button" onClick={() => onRestore(revision)}>Restore</button></div>)}{!revisions.length && <p className="muted-copy">No saved versions yet.</p>}</div></Modal>;
}

function CommandDialog({
  query, setQuery, documents, onClose, onCreate, onSelect, onFocus, onAdmin, onTheme,
}: {
  query: string; setQuery: (value: string) => void; documents: DocumentItem[]; onClose: () => void;
  onCreate: () => void; onSelect: (id: string) => void; onFocus: () => void; onAdmin: () => void; onTheme: () => void;
}) {
  const actions = [
    { label: "Create a document", detail: "Start a new note", icon: <Plus size={16} />, action: onCreate },
    { label: "Change appearance", detail: "Cycle through themes", icon: <Sun size={16} />, action: onTheme },
    { label: "Focus mode", detail: "Read without distractions", icon: <BookOpen size={16} />, action: onFocus },
    { label: "Owner management", detail: "Storage, activity and settings", icon: <LayoutDashboard size={16} />, action: onAdmin },
  ];
  const matchingDocs = documents.filter((doc) => doc.title.toLowerCase().includes(query.toLowerCase())).slice(0, 5);
  return <Modal title="Command palette" onClose={onClose} className="command-dialog"><div className="command-search"><Search size={17} /><input autoFocus placeholder="Search documents or actions…" value={query} onChange={(event) => setQuery(event.target.value)} /></div><div className="command-results">{actions.filter((action) => !query || action.label.toLowerCase().includes(query.toLowerCase())).map((action) => <button key={action.label} onClick={action.action}>{action.icon}<span>{action.label}<small>{action.detail}</small></span><ArrowRight size={14} /></button>)}{matchingDocs.map((doc) => <button key={doc.id} onClick={() => onSelect(doc.id)}><FileText size={16} /><span>{doc.title}<small>{stripMarkdown(doc.content).slice(0, 56) || "Empty document"}</small></span><ArrowRight size={14} /></button>)}{!matchingDocs.length && query && <p className="muted-copy">No document titles match “{query}”.</p>}</div><div className="command-footer"><span><kbd>↑</kbd><kbd>↓</kbd> to navigate</span><span><kbd>ESC</kbd> to close</span></div></Modal>;
}

function AdminPage({
  stats, activity, loading, maintenance, onToggleMaintenance, onRefresh, onChangePassword,
}: {
  stats: AdminStats | null; activity: AuditEvent[]; loading: boolean; maintenance: boolean;
  onToggleMaintenance: () => void; onRefresh: () => void; onChangePassword: () => void;
}) {
  return (
    <main className="admin-page">
      <div className="admin-heading"><div><p className="eyebrow">CONTROL ROOM</p><h1>Owner management</h1><p>Keep an eye on your documents, storage, and workspace activity.</p></div><button className="subtle-button" onClick={onRefresh}><Settings2 size={15} /> Refresh</button></div>
      <div className="admin-status"><div className="status-live"><i /> WORKSPACE STATUS</div><strong>Private and protected</strong><span>Local database · owner-only access</span><ShieldCheck size={19} /></div>
      <div className="stats-grid">
        <StatCard label="Active documents" value={stats?.documents ?? "—"} icon={<FileText size={17} />} detail={`${stats?.trashed ?? 0} in trash`} />
        <StatCard label="Folders & tags" value={`${stats?.folders ?? 0} / ${stats?.tags ?? 0}`} icon={<Folder size={17} />} detail="Your organization" />
        <StatCard label="Attachment storage" value={formatBytes(stats?.attachment_bytes ?? 0)} icon={<ImagePlus size={17} />} detail={`${stats?.attachments ?? 0} images`} />
        <StatCard label="Document storage" value={formatBytes(stats?.document_bytes ?? 0)} icon={<Archive size={17} />} detail={`${stats?.quota_gb ?? 10} GB user-data quota`} />
      </div>
      <div className="admin-grid">
        <section className="admin-card activity-card"><div className="admin-card-heading"><div><h2>Recent activity</h2><p>Security and workspace events</p></div><span className="activity-count">{activity.length} events</span></div>{loading && <div className="admin-loading">Refreshing activity…</div>}{activity.length ? <div className="activity-list">{activity.slice(0, 12).map((event, index) => <div className="activity-row" key={`${event.created_at}-${index}`}><span className={`activity-dot ${event.event_type.startsWith("login_failed") ? "warning" : ""}`} /><div><strong>{event.event_type.replaceAll("_", " ")}</strong><span>{event.details || "Workspace event"}</span></div><time>{dateLabel(event.created_at)}</time></div>)}</div> : <div className="admin-empty">Your workspace activity will appear here.</div>}</section>
        <div className="admin-side-stack">
          <section className="admin-card maintenance-card"><div className="admin-card-heading"><div><h2>Maintenance mode</h2><p>Temporarily restrict workspace operations.</p></div><span className={`maintenance-indicator ${maintenance ? "on" : ""}`} /></div><div className="maintenance-status">{maintenance ? "Currently enabled" : "Currently off"}</div><button className={maintenance ? "danger-button" : "subtle-button"} onClick={onToggleMaintenance}>{maintenance ? "Disable maintenance" : "Enable maintenance"}</button><p className="admin-footnote">Administration and sign-out remain available when maintenance is enabled.</p></section>
          <section className="admin-card security-card"><div className="security-lock"><ShieldCheck size={18} /></div><div><h2>Access security</h2><p>HttpOnly session cookies, rate-limited login, and server-side authorization protect private data. Forwarded client IPs are not trusted by the API.</p></div><div className="security-note">Use a trusted HTTPS reverse proxy for production. Network allowlisting is configured at your proxy.</div><button className="subtle-button password-change-button" onClick={onChangePassword}>Change owner password</button></section>
          <section className="admin-card session-card"><div className="session-top"><div><h2>Active sessions</h2><p>{stats?.active_sessions ?? "—"} current owner sessions</p></div><span><ShieldCheck size={17} /></span></div><p>Revoke other sessions if a device is lost or access needs to be rotated.</p><button className="subtle-button" onClick={async () => { if (!window.confirm("Sign out all other active sessions?")) return; try { const csrf = document.cookie.split("; ").find((cookie) => cookie.startsWith("syxlor_csrf="))?.slice("syxlor_csrf=".length); const response = await fetch("/api/v1/admin/sessions", { method: "DELETE", credentials: "same-origin", headers: { "X-CSRF-Token": csrf ? decodeURIComponent(csrf) : "" } }); if (!response.ok) throw new Error("Could not revoke sessions."); onRefresh(); } catch (error) { window.alert(error instanceof Error ? error.message : "Could not revoke sessions."); } }}>Revoke other sessions</button></section>
        </div>
      </div>
      <div className="admin-disclaimer"><ShieldCheck size={15} /><span>Private storage is local to this server. Create encrypted, off-server backups of both the database and storage folder before production use.</span></div>
    </main>
  );
}

function StatCard({ label, value, icon, detail }: { label: string; value: React.ReactNode; icon: React.ReactNode; detail: string }) {
  return <div className="stat-card"><div className="stat-icon">{icon}</div><span className="stat-label">{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}

export default App;
