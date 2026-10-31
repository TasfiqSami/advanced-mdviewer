import "dotenv/config";

import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import bcrypt from "bcryptjs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { z } from "zod";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync, unlinkSync } from "node:fs";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dataPath = resolve(process.env.DATABASE_PATH ?? join(root, "data", "syxlor.db"));
const storagePath = resolve(process.env.STORAGE_PATH ?? join(root, "storage"));
const attachmentPath = join(storagePath, "attachments");
const isProduction = process.env.NODE_ENV === "production";
if (process.env.DATABASE_URL?.trim()) {
  throw new Error("DATABASE_URL was provided, but this build uses SQLite. Neon/PostgreSQL is not integrated; refusing to ignore the configured database.");
}
const parseIntegerSetting = (name: string, value: string | undefined, fallback: number, min: number, max: number) => {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be a whole number between ${min} and ${max}.`);
  }
  return parsed;
};
const port = parseIntegerSetting("PORT", process.env.PORT, 4174, 1, 65535);
const ownerName = process.env.OWNER_USERNAME?.trim() || "syxlor";
const ownerPassword = process.env.OWNER_PASSWORD ?? "";
const accessPin = (process.env.APP_PIN ?? (isProduction ? "" : process.env.ACCESS_PIN))?.trim() ?? "";
const ownerRecoveryKey = process.env.OWNER_RECOVERY_KEY ?? "";
const sessionSecret = process.env.SESSION_SECRET ?? "";
const appUrl = process.env.APP_URL?.trim() ?? "";
const cookieSecure = isProduction;
const sessionCookieName = isProduction ? "__Host-syxlor_session" : "syxlor_session";
const sessionDays = 7;
const maxUploadMb = parseIntegerSetting("MAX_UPLOAD_MB", process.env.MAX_UPLOAD_MB, 20, 1, 1024);
const uploadLimit = maxUploadMb * 1024 * 1024;
const storageQuotaBytes = parseIntegerSetting("STORAGE_QUOTA_GB", process.env.STORAGE_QUOTA_GB, 10, 1, 1024) * 1024 ** 3;
let appOrigin = "";
if (appUrl) {
  try {
    const parsedUrl = new URL(appUrl);
    if (parsedUrl.protocol !== "https:" && (isProduction || parsedUrl.protocol !== "http:")) {
      throw new Error("APP_URL must use HTTPS in production.");
    }
    appOrigin = parsedUrl.origin;
  } catch (error) {
    if (error instanceof Error && error.message === "APP_URL must use HTTPS in production.") throw error;
    throw new Error("APP_URL must be a valid absolute URL.");
  }
}
const trustedOrigins = new Set([
  ...(process.env.TRUSTED_ORIGINS ?? (isProduction ? "" : "http://127.0.0.1:5173,http://localhost:5173"))
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  ...(appOrigin ? [appOrigin] : []),
]);
const trustedProxyIps = (process.env.TRUSTED_PROXY_IPS ?? "")
  .split(",")
  .map((ip) => ip.trim())
  .filter(Boolean);

if (ownerPassword.length < 12) {
  throw new Error("OWNER_PASSWORD must be set to at least 12 characters.");
}
if (isProduction && !process.env.APP_PIN?.trim()) {
  throw new Error("APP_PIN must be explicitly configured in production; the unsafe default PIN has been removed.");
}
if (accessPin && (!/^\d{6,12}$/.test(accessPin) || (isProduction && accessPin === "6969420"))) {
  throw new Error("APP_PIN must be a non-default PIN containing 6 to 12 digits.");
}
if (isProduction && !appOrigin) {
  throw new Error("APP_URL must be set to the public HTTPS application URL in production.");
}
if (isProduction && sessionSecret.length < 32) {
  throw new Error("SESSION_SECRET must contain at least 32 characters in production.");
}
if (isProduction && ownerRecoveryKey.length < 32) {
  throw new Error("OWNER_RECOVERY_KEY must contain at least 32 characters in production.");
}

mkdirSync(join(dataPath, ".."), { recursive: true });
mkdirSync(attachmentPath, { recursive: true });

const db = new DatabaseSync(dataPath);
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
function runTransaction(work: () => void) {
  db.exec("BEGIN");
  try {
    work();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
db.exec(`
  CREATE TABLE IF NOT EXISTS owner (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS folders (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    parent_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );
  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
    is_favorite INTEGER NOT NULL DEFAULT 0,
    is_pinned INTEGER NOT NULL DEFAULT 0,
    revision_number INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_opened_at TEXT,
    deleted_at TEXT
  );
  CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    color TEXT NOT NULL DEFAULT '#5ee4ff',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS document_tags (
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (document_id, tag_id)
  );
  CREATE TABLE IF NOT EXISTS revisions (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(document_id, version_number)
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    csrf_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    last_active_at TEXT NOT NULL,
    revoked_at TEXT
  );
  CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    details TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS app_settings (
    name TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS documents_updated_idx ON documents(updated_at DESC);
  CREATE INDEX IF NOT EXISTS documents_folder_idx ON documents(folder_id);
  CREATE INDEX IF NOT EXISTS documents_deleted_idx ON documents(deleted_at);
  CREATE INDEX IF NOT EXISTS revisions_document_idx ON revisions(document_id, version_number DESC);
`);

const now = () => new Date().toISOString();
const hash = (value: string) => createHmac("sha256", sessionSecret || "syxlor-local-development-key").update(value).digest("hex");
const newId = () => randomBytes(16).toString("hex");
const storageUsageBytes = () => {
  const usage = db.prepare(`
    SELECT
      (SELECT COALESCE(SUM(file_size), 0) FROM attachments) +
      (SELECT COALESCE(SUM(length(CAST(content AS BLOB))), 0) FROM documents) +
      (SELECT COALESCE(SUM(length(CAST(content AS BLOB))), 0) FROM revisions) AS used
  `).get() as { used: number };
  return usage.used;
};

const owner = db.prepare("SELECT id FROM owner WHERE id = 1").get();
if (!owner) {
  const passwordHash = bcrypt.hashSync(ownerPassword, 12);
  db.prepare("INSERT INTO owner (id, username, password_hash, created_at) VALUES (1, ?, ?, ?)")
    .run(ownerName, passwordHash, now());
  const welcomeId = newId();
  const welcomeContent = `# Welcome to Syxlor MD Viewer\n\nYour private Markdown workspace is ready. This document autosaves as you write.\n\n## A few things to try\n\n- Create folders and organize your documents from the sidebar.\n- Use **Ctrl + K** to search and navigate quickly.\n- Switch between editor and preview on smaller screens.\n- Choose **Focus mode** for a calmer reading experience.\n- Export a document with a click, or hold **Shift** to download immediately.\n\n> [!TIP]\n> Your documents are stored on this server. Set up off-server backups before using this as your only copy.\n\n\`\`\`markdown\n## Your next note\n\nWrite something worth keeping.\n\`\`\`\n`;
  db.prepare(`
    INSERT INTO documents (id, title, content, created_at, updated_at, last_opened_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(welcomeId, "Welcome to Syxlor", welcomeContent, now(), now(), now());
  db.prepare("INSERT INTO revisions (id, document_id, version_number, content, created_at) VALUES (?, ?, 1, ?, ?)")
    .run(newId(), welcomeId, welcomeContent, now());
}

const app = Fastify({
  logger: { level: isProduction ? "info" : "warn" },
  bodyLimit: 2 * 1024 * 1024,
  trustProxy: trustedProxyIps.length ? trustedProxyIps : false,
});

await app.register(cookie);
await app.register(helmet, {
  contentSecurityPolicy: isProduction
    ? {
        directives: {
          defaultSrc: ["'self'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
          fontSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      }
    : false,
});
await app.register(rateLimit, { max: 180, timeWindow: "1 minute" });
await app.register(multipart, { limits: { fileSize: uploadLimit, files: 1 } });

app.addHook("onRequest", async (request, reply) => {
  const origin = request.headers.origin;
  if (origin && !trustedOrigins.has(origin)) {
    return reply.code(403).send({ error: "Origin is not allowed." });
  }
});

function setSessionCookies(reply: FastifyReply, token: string, csrfToken: string) {
  const cookieOptions = {
    path: "/",
    sameSite: "strict" as const,
    secure: cookieSecure,
    maxAge: sessionDays * 24 * 60 * 60,
  };
  reply.setCookie(sessionCookieName, token, { ...cookieOptions, httpOnly: true });
  reply.setCookie("syxlor_csrf", csrfToken, { ...cookieOptions, httpOnly: false });
}

function clearSessionCookies(reply: FastifyReply) {
  reply.clearCookie(sessionCookieName, { path: "/", sameSite: "strict", secure: cookieSecure });
  reply.clearCookie("syxlor_csrf", { path: "/", sameSite: "strict", secure: cookieSecure });
}

function recordAudit(eventType: string, details = "") {
  db.prepare("INSERT INTO audit_events (id, event_type, details, created_at) VALUES (?, ?, ?, ?)")
    .run(newId(), eventType, details.slice(0, 500), now());
}

async function requireOwner(request: FastifyRequest, reply: FastifyReply) {
  const token = request.cookies[sessionCookieName];
  if (!token) return reply.code(401).send({ error: "Authentication required." });
  const session = db.prepare(`
    SELECT token_hash, csrf_hash, expires_at, revoked_at
    FROM sessions WHERE token_hash = ?
  `).get(hash(token)) as { token_hash: string; csrf_hash: string; expires_at: string; revoked_at: string | null } | undefined;
  if (!session || session.revoked_at || session.expires_at <= now()) {
    clearSessionCookies(reply);
    return reply.code(401).send({ error: "Your session has expired. Please sign in again." });
  }

  if (request.method !== "GET" && request.method !== "HEAD" && request.method !== "OPTIONS") {
    const cookieToken = request.cookies.syxlor_csrf;
    const headerToken = request.headers["x-csrf-token"];
    if (!cookieToken || typeof headerToken !== "string" || cookieToken !== headerToken || hash(cookieToken) !== session.csrf_hash) {
      return reply.code(403).send({ error: "Request verification failed. Refresh and try again." });
    }
  }

  const maintenanceMode = db.prepare("SELECT value FROM app_settings WHERE name = 'maintenance_mode'").get() as { value: string } | undefined;
  const pathname = request.url.split("?")[0];
  if (maintenanceMode?.value === "true"
    && !pathname.startsWith("/api/v1/admin/")
    && pathname !== "/api/v1/settings"
    && pathname !== "/api/v1/auth/logout") {
    return reply.code(503).send({ error: "The workspace is in maintenance mode. Owner administration remains available." });
  }

  db.prepare("UPDATE sessions SET last_active_at = ? WHERE token_hash = ?").run(now(), session.token_hash);
}

const loginSchema = z.object({
  username: z.string().trim().max(100).default(ownerName),
  password: z.string().min(1).max(200),
});
const documentSchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().max(2_000_000),
  folderId: z.string().nullable().optional(),
  isFavorite: z.boolean().optional(),
  isPinned: z.boolean().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  expectedRevision: z.number().int().positive().optional(),
});

function getTags(documentId: string): string[] {
  return (db.prepare(`
    SELECT tags.name FROM tags
    JOIN document_tags ON document_tags.tag_id = tags.id
    WHERE document_tags.document_id = ? ORDER BY tags.name COLLATE NOCASE
  `).all(documentId) as { name: string }[]).map((tag) => tag.name);
}

function documentResponse(row: Record<string, unknown>) {
  return {
    ...row,
    is_favorite: Boolean(row.is_favorite),
    is_pinned: Boolean(row.is_pinned),
    tags: getTags(String(row.id)),
  };
}

app.get("/api/v1/health", async () => ({ status: "ok" }));
app.get("/api/v1/config", async () => ({ maxUploadMb }));

app.post("/api/v1/auth/login", {
  config: { rateLimit: { max: 8, timeWindow: "15 minutes" } },
}, async (request, reply) => {
  const parsed = loginSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "Enter your access PIN or owner credentials." });

  const account = db.prepare("SELECT username, password_hash FROM owner WHERE id = 1")
    .get() as { username: string; password_hash: string } | undefined;

  const username = parsed.data.username || ownerName;
  const password = parsed.data.password;
  const submittedPin = Buffer.from(password);
  const configuredPin = Buffer.from(accessPin);
  const usingPin = configuredPin.length > 0
    && submittedPin.length === configuredPin.length
    && timingSafeEqual(submittedPin, configuredPin)
    && username.trim().length > 0;
  const validPassword = account && account.username === username && await bcrypt.compare(password, account.password_hash);
  const valid = Boolean(account && (validPassword || usingPin));

  if (!valid || !account) {
    recordAudit("login_failed", `IP: ${request.ip}`);
    return reply.code(401).send({ error: "The access PIN or credentials are incorrect." });
  }

  const token = randomBytes(32).toString("base64url");
  const csrfToken = randomBytes(32).toString("base64url");
  const createdAt = now();
  const expiresAt = new Date(Date.now() + sessionDays * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(`
    INSERT INTO sessions (token_hash, csrf_hash, created_at, expires_at, last_active_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(hash(token), hash(csrfToken), createdAt, expiresAt, createdAt);
  setSessionCookies(reply, token, csrfToken);
  recordAudit("login_succeeded");
  return { authenticated: true, username: account.username, csrfToken };
});

app.post("/api/v1/auth/recover", {
  config: { rateLimit: { max: 3, timeWindow: "15 minutes" } },
}, async (request, reply) => {
  if (!ownerRecoveryKey) return reply.code(503).send({ error: "Account recovery is not configured on this server." });
  const parsed = z.object({
    recoveryKey: z.string().min(1).max(200),
    newPassword: z.string().min(12).max(200),
  }).safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "Enter the recovery key and a new password of at least 12 characters." });
  const supplied = Buffer.from(hash(parsed.data.recoveryKey), "hex");
  const configured = Buffer.from(hash(ownerRecoveryKey), "hex");
  if (!timingSafeEqual(supplied, configured)) {
    recordAudit("account_recovery_failed", `IP: ${request.ip}`);
    return reply.code(401).send({ error: "The recovery key is incorrect." });
  }
  db.prepare("UPDATE owner SET password_hash = ? WHERE id = 1").run(await bcrypt.hash(parsed.data.newPassword, 12));
  db.prepare("UPDATE sessions SET revoked_at = ? WHERE revoked_at IS NULL").run(now());
  clearSessionCookies(reply);
  recordAudit("account_recovered", `IP: ${request.ip}`);
  return { success: true };
});

app.get("/api/v1/auth/session", async (request) => {
  const token = request.cookies[sessionCookieName];
  if (!token) return { authenticated: false };
  const session = db.prepare(`
    SELECT csrf_hash, expires_at, revoked_at FROM sessions WHERE token_hash = ?
  `).get(hash(token)) as { csrf_hash: string; expires_at: string; revoked_at: string | null } | undefined;
  if (!session || session.revoked_at || session.expires_at <= now()) return { authenticated: false };
  const csrfToken = request.cookies.syxlor_csrf ?? "";
  if (!csrfToken || hash(csrfToken) !== session.csrf_hash) return { authenticated: false };
  const account = db.prepare("SELECT username FROM owner WHERE id = 1").get() as { username: string };
  return { authenticated: true, username: account.username, csrfToken };
});

app.post("/api/v1/auth/logout", { preHandler: requireOwner }, async (request, reply) => {
  const token = request.cookies[sessionCookieName];
  if (token) db.prepare("UPDATE sessions SET revoked_at = ? WHERE token_hash = ?").run(now(), hash(token));
  clearSessionCookies(reply);
  recordAudit("logout");
  return { success: true };
});

await app.register(async (api) => {
  api.addHook("preHandler", requireOwner);

  api.get("/documents", async (request) => {
    const query = request.query as { search?: string; folder?: string; view?: string; tag?: string };
    const terms: string[] = [];
    const params: SQLInputValue[] = [];
    if (query.view === "trash") terms.push("documents.deleted_at IS NOT NULL");
    else terms.push("documents.deleted_at IS NULL");
    if (query.search?.trim()) {
      terms.push("(documents.title LIKE ? ESCAPE '\\' OR documents.content LIKE ? ESCAPE '\\')");
      const needle = `%${query.search.trim().replace(/[\\%_]/g, "\\$&")}%`;
      params.push(needle, needle);
    }
    if (query.folder) {
      terms.push("documents.folder_id = ?");
      params.push(query.folder);
    }
    if (query.view === "favorites") terms.push("documents.is_favorite = 1");
    if (query.view === "recent") terms.push("documents.last_opened_at IS NOT NULL");
    if (query.tag) {
      terms.push("EXISTS (SELECT 1 FROM document_tags dt JOIN tags t ON t.id = dt.tag_id WHERE dt.document_id = documents.id AND t.name = ?)");
      params.push(query.tag);
    }
    const orderBy = query.view === "recent"
      ? "documents.last_opened_at DESC"
      : "documents.is_pinned DESC, documents.updated_at DESC";
    const rows = db.prepare(`
      SELECT documents.* FROM documents
      WHERE ${terms.join(" AND ")}
      ORDER BY ${orderBy} LIMIT 500
    `).all(...params) as Record<string, unknown>[];
    return rows.map(documentResponse);
  });

  api.post("/documents", async (request, reply) => {
    const parsed = documentSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Document details are invalid." });
    const data = parsed.data;
    const newContentBytes = Buffer.byteLength(data.content, "utf8");
    if (storageUsageBytes() + newContentBytes * 2 > storageQuotaBytes) {
      return reply.code(413).send({ error: "The document would exceed the available storage quota." });
    }
    const id = newId();
    const timestamp = now();
    runTransaction(() => {
      db.prepare(`
        INSERT INTO documents (id, title, content, folder_id, is_favorite, is_pinned, created_at, updated_at, last_opened_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, data.title, data.content, data.folderId ?? null, Number(data.isFavorite ?? false), Number(data.isPinned ?? false), timestamp, timestamp, timestamp);
      db.prepare("INSERT INTO revisions (id, document_id, version_number, content, created_at) VALUES (?, ?, 1, ?, ?)")
        .run(newId(), id, data.content, timestamp);
      updateDocumentTags(id, data.tags ?? []);
    });
    recordAudit("document_created", id);
    const row = db.prepare("SELECT * FROM documents WHERE id = ?").get(id) as Record<string, unknown>;
    return reply.code(201).send(documentResponse(row));
  });

  api.put("/auth/password", async (request, reply) => {
    const parsed = z.object({
      currentPassword: z.string().min(1).max(200),
      newPassword: z.string().min(12).max(200),
    }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "A new password must be at least 12 characters." });
    const account = db.prepare("SELECT password_hash FROM owner WHERE id = 1").get() as { password_hash: string };
    if (!await bcrypt.compare(parsed.data.currentPassword, account.password_hash)) {
      recordAudit("password_change_failed");
      return reply.code(401).send({ error: "The current password is incorrect." });
    }
    db.prepare("UPDATE owner SET password_hash = ? WHERE id = 1").run(await bcrypt.hash(parsed.data.newPassword, 12));
    const token = request.cookies[sessionCookieName];
    db.prepare("UPDATE sessions SET revoked_at = ? WHERE revoked_at IS NULL AND token_hash != ?")
      .run(now(), token ? hash(token) : "");
    recordAudit("password_changed");
    return { success: true };
  });

  api.get("/documents/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = db.prepare("SELECT * FROM documents WHERE id = ? AND deleted_at IS NULL").get(id) as Record<string, unknown> | undefined;
    if (!row) return reply.code(404).send({ error: "Document not found." });
    db.prepare("UPDATE documents SET last_opened_at = ? WHERE id = ?").run(now(), id);
    return documentResponse({ ...row, last_opened_at: now() });
  });

  api.put("/documents/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = documentSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Document details are invalid." });
    const existing = db.prepare("SELECT * FROM documents WHERE id = ? AND deleted_at IS NULL")
      .get(id) as { content: string; revision_number: number } | undefined;
    if (!existing) return reply.code(404).send({ error: "Document not found." });
    if (parsed.data.expectedRevision !== undefined && parsed.data.expectedRevision !== existing.revision_number) {
      return reply.code(409).send({ error: "This document changed in another tab. Reload the latest version before saving.", currentRevision: existing.revision_number });
    }
    const timestamp = now();
    const newRevision = existing.revision_number + 1;
    const lastRevision = db.prepare("SELECT created_at, content FROM revisions WHERE document_id = ? ORDER BY version_number DESC LIMIT 1")
      .get(id) as { created_at: string; content: string } | undefined;
    const snapshotNeeded = (!lastRevision || timestamp > new Date(new Date(lastRevision.created_at).getTime() + 5 * 60_000).toISOString())
      && lastRevision?.content !== parsed.data.content;
    const storageDelta = Buffer.byteLength(parsed.data.content, "utf8") - Buffer.byteLength(existing.content, "utf8")
      + (snapshotNeeded ? Buffer.byteLength(parsed.data.content, "utf8") : 0);
    if (storageUsageBytes() + storageDelta > storageQuotaBytes) {
      return reply.code(413).send({ error: "The document update would exceed the available storage quota." });
    }
    runTransaction(() => {
      db.prepare(`
        UPDATE documents
        SET title = ?, content = ?, folder_id = ?, is_favorite = ?, is_pinned = ?,
            revision_number = ?, updated_at = ?
        WHERE id = ?
      `).run(
        parsed.data.title,
        parsed.data.content,
        parsed.data.folderId ?? null,
        Number(parsed.data.isFavorite ?? false),
        Number(parsed.data.isPinned ?? false),
        newRevision,
        timestamp,
        id,
      );
      if (snapshotNeeded) {
        db.prepare("INSERT INTO revisions (id, document_id, version_number, content, created_at) VALUES (?, ?, ?, ?, ?)")
          .run(newId(), id, newRevision, parsed.data.content, timestamp);
      }
      updateDocumentTags(id, parsed.data.tags ?? []);
    });
    const row = db.prepare("SELECT * FROM documents WHERE id = ?").get(id) as Record<string, unknown>;
    return documentResponse(row);
  });

  api.post("/documents/:id/duplicate", async (request, reply) => {
    const { id } = request.params as { id: string };
    const source = db.prepare("SELECT * FROM documents WHERE id = ? AND deleted_at IS NULL").get(id) as Record<string, unknown> | undefined;
    if (!source) return reply.code(404).send({ error: "Document not found." });
    const copiedBytes = Buffer.byteLength(String(source.content), "utf8") * 2;
    if (storageUsageBytes() + copiedBytes > storageQuotaBytes) {
      return reply.code(413).send({ error: "Duplicating this document would exceed the available storage quota." });
    }
    const copyId = newId();
    const timestamp = now();
    runTransaction(() => {
      db.prepare(`
        INSERT INTO documents (id, title, content, folder_id, created_at, updated_at, last_opened_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(copyId, `${String(source.title)} copy`, String(source.content), typeof source.folder_id === "string" ? source.folder_id : null, timestamp, timestamp, timestamp);
      db.prepare("INSERT INTO revisions (id, document_id, version_number, content, created_at) VALUES (?, ?, 1, ?, ?)")
        .run(newId(), copyId, String(source.content), timestamp);
      for (const tag of getTags(id)) updateDocumentTags(copyId, [...getTags(copyId), tag]);
    });
    return reply.code(201).send(documentResponse(db.prepare("SELECT * FROM documents WHERE id = ?").get(copyId) as Record<string, unknown>));
  });

  api.delete("/documents/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = db.prepare("UPDATE documents SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL")
      .run(now(), now(), id);
    if (!result.changes) return reply.code(404).send({ error: "Document not found." });
    recordAudit("document_trashed", id);
    return { success: true };
  });

  api.post("/documents/:id/restore", async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = db.prepare("UPDATE documents SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL")
      .run(now(), id);
    if (!result.changes) return reply.code(404).send({ error: "Deleted document not found." });
    recordAudit("document_restored", id);
    return { success: true };
  });

  api.delete("/documents/:id/permanent", async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = db.prepare("DELETE FROM documents WHERE id = ? AND deleted_at IS NOT NULL").run(id);
    if (!result.changes) return reply.code(404).send({ error: "Trashed document not found." });
    recordAudit("document_permanently_deleted", id);
    return { success: true };
  });

  api.get("/documents/:id/revisions", async (request, reply) => {
    const { id } = request.params as { id: string };
    const exists = db.prepare("SELECT 1 FROM documents WHERE id = ?").get(id);
    if (!exists) return reply.code(404).send({ error: "Document not found." });
    return db.prepare(`
      SELECT id, version_number, created_at, length(content) AS content_length
      FROM revisions WHERE document_id = ? ORDER BY version_number DESC LIMIT 100
    `).all(id);
  });

  api.post("/documents/:id/revisions/:revisionId/restore", async (request, reply) => {
    const { id, revisionId } = request.params as { id: string; revisionId: string };
    const revision = db.prepare("SELECT content FROM revisions WHERE id = ? AND document_id = ?").get(revisionId, id) as { content: string } | undefined;
    const document = db.prepare("SELECT revision_number FROM documents WHERE id = ? AND deleted_at IS NULL")
      .get(id) as { revision_number: number } | undefined;
    if (!revision || !document) return reply.code(404).send({ error: "Revision or document not found." });
    const timestamp = now();
    const versionNumber = document.revision_number + 1;
    const restoredBytes = Buffer.byteLength(revision.content, "utf8");
    const currentContent = db.prepare("SELECT content FROM documents WHERE id = ?").get(id) as { content: string };
    const storageDelta = restoredBytes - Buffer.byteLength(currentContent.content, "utf8") + restoredBytes;
    if (storageUsageBytes() + storageDelta > storageQuotaBytes) {
      return reply.code(413).send({ error: "Restoring this version would exceed the available storage quota." });
    }
    runTransaction(() => {
      db.prepare("UPDATE documents SET content = ?, revision_number = ?, updated_at = ? WHERE id = ?")
        .run(revision.content, versionNumber, timestamp, id);
      db.prepare("INSERT INTO revisions (id, document_id, version_number, content, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(newId(), id, versionNumber, revision.content, timestamp);
    });
    recordAudit("revision_restored", id);
    return documentResponse(db.prepare("SELECT * FROM documents WHERE id = ?").get(id) as Record<string, unknown>);
  });

  api.get("/folders", async () => db.prepare("SELECT * FROM folders WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE").all());

  api.post("/folders", async (request, reply) => {
    const parsed = z.object({ name: z.string().trim().min(1).max(100), parentId: z.string().nullable().optional() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Folder name is required." });
    const id = newId();
    const timestamp = now();
    db.prepare("INSERT INTO folders (id, name, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run(id, parsed.data.name, parsed.data.parentId ?? null, timestamp, timestamp);
    return reply.code(201).send(db.prepare("SELECT * FROM folders WHERE id = ?").get(id));
  });

  api.put("/folders/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = z.object({ name: z.string().trim().min(1).max(100) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Folder name is required." });
    const result = db.prepare("UPDATE folders SET name = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL")
      .run(parsed.data.name, now(), id);
    if (!result.changes) return reply.code(404).send({ error: "Folder not found." });
    return db.prepare("SELECT * FROM folders WHERE id = ?").get(id);
  });

  api.delete("/folders/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = db.prepare("UPDATE folders SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL")
      .run(now(), now(), id);
    if (!result.changes) return reply.code(404).send({ error: "Folder not found." });
    return { success: true };
  });

  api.get("/tags", async () => db.prepare("SELECT id, name, color FROM tags ORDER BY name COLLATE NOCASE").all());

  api.get("/settings", async () => {
    const rows = db.prepare("SELECT name, value FROM app_settings").all() as { name: string; value: string }[];
    return Object.fromEntries(rows.map((row) => [row.name, row.value]));
  });

  api.put("/settings", async (request, reply) => {
    const parsed = z.record(z.string().max(100), z.string().max(1000)).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Settings are invalid." });
    const allowed = new Set(["maintenance_mode", "theme", "editor_font_size", "reading_width", "sound_enabled", "sound_volume"]);
    runTransaction(() => {
      for (const [name, value] of Object.entries(parsed.data)) {
        if (allowed.has(name)) {
          db.prepare("INSERT INTO app_settings (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value")
            .run(name, value);
        }
      }
    });
    if (Object.hasOwn(parsed.data, "maintenance_mode")) recordAudit("maintenance_mode_changed", parsed.data.maintenance_mode);
    return { success: true };
  });

  api.get("/admin/stats", async () => {
    const stats = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM documents WHERE deleted_at IS NULL) AS documents,
        (SELECT COUNT(*) FROM documents WHERE deleted_at IS NOT NULL) AS trashed,
        (SELECT COUNT(*) FROM folders WHERE deleted_at IS NULL) AS folders,
        (SELECT COUNT(*) FROM tags) AS tags,
        (SELECT COUNT(*) FROM attachments) AS attachments,
        (SELECT COALESCE(SUM(file_size), 0) FROM attachments) AS attachment_bytes,
        (SELECT COALESCE(SUM(length(content)), 0) FROM documents) AS document_bytes,
        (SELECT COUNT(*) FROM sessions WHERE revoked_at IS NULL AND expires_at > ?) AS active_sessions
    `).get(now()) as Record<string, number>;
    return { ...stats, quota_bytes: storageQuotaBytes, quota_gb: storageQuotaBytes / 1024 ** 3 };
  });

  api.get("/admin/activity", async () => db.prepare(`
    SELECT event_type, details, created_at FROM audit_events ORDER BY created_at DESC LIMIT 100
  `).all());

  api.get("/admin/sessions", async () => db.prepare(`
    SELECT created_at, last_active_at, expires_at FROM sessions
    WHERE revoked_at IS NULL AND expires_at > ? ORDER BY last_active_at DESC
  `).all(now()));

  api.delete("/admin/sessions", async (request) => {
    const currentToken = request.cookies[sessionCookieName];
    db.prepare("UPDATE sessions SET revoked_at = ? WHERE revoked_at IS NULL AND token_hash != ?")
      .run(now(), currentToken ? hash(currentToken) : "");
    recordAudit("sessions_revoked");
    return { success: true };
  });

  api.post("/attachments", async (request, reply) => {
    const documentId = String((request.query as { documentId?: string }).documentId ?? "");
    const exists = db.prepare("SELECT 1 FROM documents WHERE id = ? AND deleted_at IS NULL").get(documentId);
    if (!exists) return reply.code(404).send({ error: "Document not found." });
    const part = await request.file();
    if (!part) return reply.code(400).send({ error: "Choose an image to upload." });
    const extension = extname(part.filename).toLowerCase();
    const allowed = new Map([
      [".png", "image/png"],
      [".jpg", "image/jpeg"],
      [".jpeg", "image/jpeg"],
      [".webp", "image/webp"],
      [".gif", "image/gif"],
    ]);
    const mimeType = allowed.get(extension);
    if (!mimeType || part.mimetype !== mimeType) return reply.code(415).send({ error: "Only PNG, JPEG, WebP, and GIF images are supported." });
    const id = newId();
    const diskPath = join(attachmentPath, id);
    const buffer = await part.toBuffer();
    if (!isSafeImage(buffer, mimeType)) return reply.code(415).send({ error: "The selected file does not match its image type." });
    if (storageUsageBytes() + buffer.byteLength > storageQuotaBytes) return reply.code(413).send({ error: "The storage quota has been reached." });
    writeFileSync(diskPath, buffer, { flag: "wx" });
    try {
      db.prepare(`
        INSERT INTO attachments (id, document_id, filename, mime_type, file_size, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, documentId, part.filename.replace(/[\\/]/g, "_").slice(0, 200), mimeType, buffer.byteLength, now());
    } catch (error) {
      unlinkSync(diskPath);
      throw error;
    }
    recordAudit("attachment_uploaded", id);
    return reply.code(201).send({ id, filename: part.filename, mimeType, fileSize: buffer.byteLength, url: `/api/v1/attachments/${id}` });
  });

  api.get("/attachments", async (request) => {
    const documentId = String((request.query as { documentId?: string }).documentId ?? "");
    return db.prepare(`
      SELECT id, document_id, filename, mime_type, file_size, created_at
      FROM attachments WHERE document_id = ? ORDER BY created_at DESC
    `).all(documentId);
  });

  api.get("/attachments/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const attachment = db.prepare("SELECT * FROM attachments WHERE id = ?").get(id) as {
      id: string; filename: string; mime_type: string; file_size: number;
    } | undefined;
    if (!attachment) return reply.code(404).send({ error: "Attachment not found." });
    reply.header("Content-Type", attachment.mime_type);
    reply.header("Content-Length", attachment.file_size);
    reply.header("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`);
    reply.header("Cache-Control", "private, max-age=3600");
    return reply.send(createReadStream(join(attachmentPath, id)));
  });

  api.delete("/attachments/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const exists = db.prepare("SELECT 1 FROM attachments WHERE id = ?").get(id);
    if (!exists) return reply.code(404).send({ error: "Attachment not found." });
    const path = join(attachmentPath, id);
    try {
      unlinkSync(path);
    } catch (error) {
      app.log.error({ err: error, attachmentId: id }, "Could not remove attachment file");
      return reply.code(500).send({ error: "Attachment metadata was removed, but its file could not be deleted." });
    }
    db.prepare("DELETE FROM attachments WHERE id = ?").run(id);
    recordAudit("attachment_deleted", id);
    return { success: true };
  });
}, { prefix: "/api/v1" });

function updateDocumentTags(documentId: string, names: string[]) {
  const uniqueNames = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
  db.prepare("DELETE FROM document_tags WHERE document_id = ?").run(documentId);
  for (const name of uniqueNames) {
    let tag = db.prepare("SELECT id FROM tags WHERE name = ? COLLATE NOCASE").get(name) as { id: string } | undefined;
    if (!tag) {
      const id = newId();
      db.prepare("INSERT INTO tags (id, name, created_at) VALUES (?, ?, ?)").run(id, name, now());
      tag = { id };
    }
    db.prepare("INSERT OR IGNORE INTO document_tags (document_id, tag_id) VALUES (?, ?)").run(documentId, tag.id);
  }
}

function isSafeImage(buffer: Buffer, mimeType: string): boolean {
  if (mimeType === "image/png") return buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mimeType === "image/jpeg") return buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mimeType === "image/gif") return buffer.subarray(0, 6).toString("ascii").match(/^GIF8[79]a$/) !== null;
  if (mimeType === "image/webp") return buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
  return false;
}

const staticDir = join(root, "dist");
if (isProduction) {
  const mimeTypes: Record<string, string> = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".ico": "image/x-icon",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".gif": "image/gif",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".webp": "image/webp",
  };
  app.get("/", async (_request, reply) => reply.type("text/html; charset=utf-8").send(createReadStream(join(staticDir, "index.html"))));
  app.get("/*", async (request, reply) => {
    if (request.url.startsWith("/api/")) return reply.code(404).send({ error: "Not found." });
    let requestedPath: string;
    try {
      requestedPath = decodeURIComponent(request.url.split("?")[0]);
    } catch {
      return reply.code(400).send({ error: "Invalid asset path." });
    }
    const path = resolve(staticDir, `.${requestedPath}`);
    const relativePath = relative(staticDir, path);
    if (!relativePath || relativePath.startsWith(`..${sep}`) || relativePath === ".." || isAbsolute(relativePath) || !existsSync(path) || !statSync(path).isFile()) {
      return reply.code(404).send({ error: "Not found." });
    }
    return reply.type(mimeTypes[extname(path).toLowerCase()] ?? "application/octet-stream").send(createReadStream(path));
  });
}

app.setErrorHandler((error, request, reply) => {
  request.log.error({ err: error }, "Request failed");
  if (error instanceof Error && "statusCode" in error && error.statusCode === 413) {
    return reply.code(413).send({ error: `The upload exceeds this server's ${maxUploadMb} MB file-size limit.` });
  }
  if (error instanceof Error && "statusCode" in error && typeof error.statusCode === "number" && error.statusCode < 500) {
    return reply.code(error.statusCode).send({ error: error.message });
  }
  return reply.code(500).send({ error: "Something went wrong. Please try again." });
});

app.addHook("onClose", () => {
  db.close();
});
const shutdown = async () => {
  await app.close();
};
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

try {
  await app.listen({ port, host: "0.0.0.0" });
  app.log.info(`Syxlor MD Viewer listening on port ${port}`);
} catch (error) {
  app.log.error(error);
  db.close();
  process.exitCode = 1;
}
