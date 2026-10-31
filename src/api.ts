import { ApiError } from "./types";

const API = "/api/v1";

function readCookie(name: string): string | undefined {
  return document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const method = (init.method ?? "GET").toUpperCase();
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const csrf = readCookie("syxlor_csrf");
    if (csrf) headers.set("X-CSRF-Token", decodeURIComponent(csrf));
  }
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers,
    credentials: "same-origin",
  });
  const payload = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok) throw new ApiError(payload?.error ?? `Request failed (${response.status}).`, response.status);
  return payload as T;
}

export function jsonBody(value: unknown): string {
  return JSON.stringify(value);
}
