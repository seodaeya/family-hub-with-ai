import type { DeviceInfo, ExtractResult } from './types';

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

let baseUrl: string | null = null;
let token: string | null = null;

export function setApiConfig(next: { baseUrl?: string | null; token?: string | null }): void {
  if (next.baseUrl !== undefined) baseUrl = next.baseUrl;
  if (next.token !== undefined) token = next.token;
}

export function normalizeUrl(input: string): string {
  let value = input.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(value)) value = `http://${value}`;
  return value;
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; timeoutMs?: number; auth?: boolean } = {},
): Promise<T> {
  if (!baseUrl) throw new ApiError(0, 'no_server', '서버 주소가 없습니다.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? (options.body ? 'POST' : 'GET'),
      headers: {
        'content-type': 'application/json',
        ...(options.auth !== false && token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
    const text = await res.text();
    const data = text ? safeJson(text) : {};
    if (!res.ok) {
      throw new ApiError(res.status, data?.error ?? 'http_error', data?.message ?? `HTTP ${res.status}`);
    }
    return data as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if ((error as Error).name === 'AbortError') {
      throw new ApiError(0, 'timeout', '서버 응답이 느립니다. 맥이 켜져 있는지 확인해 주세요.');
    }
    throw new ApiError(0, 'network', '서버에 연결할 수 없습니다. 같은 Wi-Fi인지 확인해 주세요.');
  } finally {
    clearTimeout(timer);
  }
}

function safeJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

export type Health = {
  ok: boolean;
  version: string;
  ocr: { ok: boolean; engine: string };
  ollama: { ok: boolean; model: string; altModel?: string; models: string[]; error?: string };
  paired: boolean;
};

export const api = {
  health: () => request<Health>('/v1/health', { auth: false, timeoutMs: 6000 }),  pair: (input: { code: string; name: string; platform: string }) =>
    request<{ token: string; device: DeviceInfo; family: { id: string; name: string } }>('/v1/pair', {
      body: input,
      auth: false,
    }),
  me: () =>
    request<{ device: DeviceInfo; family: { id: string; name: string } | null; serverTime: number }>('/v1/me'),
  devices: () => request<{ devices: DeviceInfo[] }>('/v1/devices'),
  approve: (id: string) => request<{ ok: boolean }>(`/v1/devices/${id}/approve`, { body: {} }),
  revoke: (id: string) => request<{ ok: boolean }>(`/v1/devices/${id}/revoke`, { body: {} }),
  invite: (ttlMinutes = 10) =>
    request<{ code: string; expiresAt: number }>('/v1/invite', { body: { ttlMinutes } }),
  sync: (input: { cursor: number; ops: unknown[] }) =>
    request<{
      cursor: number;
      changes: { events: any[]; items: any[]; sources: any[] };
      applied: string[];
      rejected: Array<{ opId: string; reason: string }>;
      serverTime: number;
    }>('/v1/sync', { body: input, timeoutMs: 20_000 }),
  extract: (input: {
    images?: Array<{ base64: string; mimeType: string }>;
    text?: string;
    url?: string;
    hint?: string;
    model?: string;
    retain?: boolean;
  }) => request<ExtractResult>('/v1/extract', { body: input, timeoutMs: 300_000 }),
};

/** Health check against a URL that is not (yet) the saved server. */
export async function healthAt(input: string): Promise<Health> {
  const base = normalizeUrl(input);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(`${base}/v1/health`, { signal: controller.signal });
    if (!res.ok) throw new ApiError(res.status, 'http_error', `HTTP ${res.status}`);
    return (await res.json()) as Health;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(0, 'network', '서버를 찾지 못했습니다. 주소와 Wi-Fi를 확인해 주세요.');
  } finally {
    clearTimeout(timer);
  }
}
