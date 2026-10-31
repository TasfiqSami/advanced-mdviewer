export type Theme = "syxlor-dark" | "normal-dark" | "syxlor-light" | "normal-light";
export type View = "all" | "favorites" | "recent" | "trash";

export interface DocumentItem {
  id: string;
  title: string;
  content: string;
  folder_id: string | null;
  is_favorite: boolean;
  is_pinned: boolean;
  revision_number: number;
  created_at: string;
  updated_at: string;
  last_opened_at: string | null;
  deleted_at: string | null;
  tags: string[];
}

export interface FolderItem {
  id: string;
  name: string;
  parent_id: string | null;
}

export interface RevisionItem {
  id: string;
  version_number: number;
  created_at: string;
  content_length: number;
}

export interface AdminStats {
  documents: number;
  trashed: number;
  folders: number;
  tags: number;
  attachments: number;
  attachment_bytes: number;
  document_bytes: number;
  active_sessions: number;
  quota_bytes: number;
  quota_gb: number;
}

export interface AuditEvent {
  event_type: string;
  details: string;
  created_at: string;
}

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}
