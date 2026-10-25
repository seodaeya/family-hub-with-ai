import { execFile } from 'node:child_process';
import { createSign } from 'node:crypto';
import { promisify } from 'node:util';
import {
  audit,
  getEventByExternalId,
  getEventById,
  getMeta,
  listEventsForGooglePush,
  now,
  setMeta,
  tx,
  updateEventGoogleMeta,
  upsertEventFromGoogle,
  type HubEventRow,
} from './db.ts';

const execFileAsync = promisify(execFile);

/**
 * Least privilege for the service account.
 *
 * `auth/calendar` would also allow sharing, renaming, and permanently deleting
 * every calendar the account can access. The hub only lists/creates/updates
 * events and reads one calendar's summary, so request just those two scopes.
 * The real boundary is still the calendar ACL: only the dedicated calendar is
 * shared with this service account.
 */
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendars.readonly',
].join(' ');

export const KEYCHAIN_SERVICE = 'family-hub-google';
export const KEYCHAIN_ACCOUNT = 'service-account';

export type GoogleKeychainCredentials = {
  calendarId: string;
  clientEmail: string;
  privateKey: string;
  projectId?: string;
  tokenUri?: string;
};

export type GoogleHealthStatus = {
  configured: boolean;
  ok: boolean;
  calendarSummary?: string;
  calendarIdMasked?: string;
  serviceAccountEmail?: string;
  lastSyncAt?: number | null;
  error?: string;
};

let cachedCreds: GoogleKeychainCredentials | null | undefined;
let cachedToken: { accessToken: string; expiresAt: number } | null = null;

export function clearGoogleCache(): void {
  cachedCreds = undefined;
  cachedToken = null;
}

export async function saveGoogleCredentialsToKeychain(creds: GoogleKeychainCredentials): Promise<void> {
  const encoded = Buffer.from(JSON.stringify(creds), 'utf8').toString('base64');
  await execFileAsync('/usr/bin/security', [
    'add-generic-password',
    '-U',
    '-s',
    KEYCHAIN_SERVICE,
    '-a',
    KEYCHAIN_ACCOUNT,
    '-w',
    encoded,
  ]);
  clearGoogleCache();
}

export async function deleteGoogleCredentialsFromKeychain(): Promise<void> {
  try {
    await execFileAsync('/usr/bin/security', [
      'delete-generic-password',
      '-s',
      KEYCHAIN_SERVICE,
      '-a',
      KEYCHAIN_ACCOUNT,
    ]);
  } catch {
    // Ignore if not found
  }
  clearGoogleCache();
}

export async function loadGoogleCredentialsFromKeychain(): Promise<GoogleKeychainCredentials | null> {
  if (cachedCreds !== undefined) return cachedCreds;
  try {
    const { stdout } = await execFileAsync('/usr/bin/security', [
      'find-generic-password',
      '-s',
      KEYCHAIN_SERVICE,
      '-a',
      KEYCHAIN_ACCOUNT,
      '-w',
    ]);
    const raw = stdout.trim();
    if (!raw) {
      cachedCreds = null;
      return null;
    }
    const decoded = Buffer.from(raw, 'base64').toString('utf8');
    const parsed = JSON.parse(decoded) as GoogleKeychainCredentials;
    if (!parsed.calendarId || !parsed.clientEmail || !parsed.privateKey) {
      cachedCreds = null;
      return null;
    }
    cachedCreds = parsed;
    return parsed;
  } catch {
    cachedCreds = null;
    return null;
  }
}

function maskCalendarId(calendarId: string): string {
  if (calendarId.length <= 12) return calendarId;
  return `${calendarId.slice(0, 6)}…${calendarId.slice(-6)}`;
}

async function getAccessToken(creds: GoogleKeychainCredentials): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.accessToken;
  }
  const tokenUri = creds.tokenUri ?? 'https://oauth2.googleapis.com/token';
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 3600;
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      iss: creds.clientEmail,
      scope: GOOGLE_SCOPES,
      aud: tokenUri,
      iat,
      exp,
    }),
  ).toString('base64url');
  const signingInput = `${header}.${payload}`;
  const signature = createSign('RSA-SHA256')
    .update(signingInput)
    .sign(creds.privateKey, 'base64url');
  const assertion = `${signingInput}.${signature}`;

  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
  });
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error_description?: string;
    error?: string;
  };
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description ?? data.error ?? `구글 토큰 발급 실패 (HTTP ${res.status})`);
  }
  cachedToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  return cachedToken.accessToken;
}

class GoogleApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function googleRequest<T>(
  creds: GoogleKeychainCredentials,
  path: string,
  options: { method?: string; body?: unknown; ifMatch?: string | null } = {},
): Promise<T> {
  const maxRetries = 3;
  let delayMs = 600;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const token = await getAccessToken(creds);
    const headers: Record<string, string> = {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
    };
    if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
    }
    if (options.ifMatch) {
      headers['If-Match'] = options.ifMatch;
    }

    const res = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
      method: options.method ?? (options.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
      await sleep(delayMs);
      delayMs *= 2;
      continue;
    }

    const text = await res.text();
    const json = text ? safeParseJson(text) : {};
    if (!res.ok) {
      const msg = json?.error?.message ?? `Google API HTTP ${res.status}`;
      throw new GoogleApiError(res.status, msg);
    }
    return json as T;
  }

  throw new GoogleApiError(429, 'Google Calendar API 요청 한도를 초과했습니다.');
}

function safeParseJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

export async function googleHealthCheck(familyId?: string): Promise<GoogleHealthStatus> {
  const creds = await loadGoogleCredentialsFromKeychain();
  const lastSyncRaw = familyId ? getMeta(`google.lastSyncAt.${familyId}`) : getMeta('google.lastSyncAt');
  const lastSyncAt = lastSyncRaw ? Number(lastSyncRaw) : null;

  if (!creds) {
    return {
      configured: false,
      ok: false,
      lastSyncAt,
      error: 'macOS 키체인에 구글 서비스 계정이 아직 등록되지 않았습니다.',
    };
  }

  try {
    const cal = await googleRequest<{ id: string; summary?: string }>(
      creds,
      `/calendars/${encodeURIComponent(creds.calendarId)}`,
    );
    return {
      configured: true,
      ok: true,
      calendarSummary: cal.summary ?? '우리집 AI',
      calendarIdMasked: maskCalendarId(creds.calendarId),
      serviceAccountEmail: creds.clientEmail,
      lastSyncAt,
    };
  } catch (error) {
    return {
      configured: true,
      ok: false,
      calendarIdMasked: maskCalendarId(creds.calendarId),
      serviceAccountEmail: creds.clientEmail,
      lastSyncAt,
      error: (error as Error).message,
    };
  }
}

type GoogleEventItem = {
  id: string;
  etag?: string;
  status?: 'confirmed' | 'tentative' | 'cancelled';
  summary?: string;
  description?: string;
  location?: string;
  updated?: string;
  recurringEventId?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
};

type GoogleEventsListResponse = {
  items?: GoogleEventItem[];
  nextPageToken?: string;
  nextSyncToken?: string;
};

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function toKstYmd(isoOrDate: string): string {
  const parsed = new Date(isoOrDate);
  if (Number.isNaN(parsed.getTime())) return isoOrDate.slice(0, 10);
  const kst = new Date(parsed.getTime() + 9 * 3600_000);
  return kst.toISOString().slice(0, 10);
}

function toGoogleEventPayload(row: HubEventRow): Record<string, unknown> {
  const summary = row.title || '일정';
  const base: Record<string, unknown> = {
    summary,
    location: row.location ?? undefined,
    description: row.memo ?? undefined,
  };

  if (row.allDay || !row.startsAt) {
    const startYmd = row.startsAt ? toKstYmd(row.startsAt) : toKstYmd(new Date().toISOString());
    const endYmd = row.endsAt ? toKstYmd(row.endsAt) : addDaysYmd(startYmd, 1);
    return {
      ...base,
      start: { date: startYmd },
      end: { date: endYmd <= startYmd ? addDaysYmd(startYmd, 1) : endYmd },
    };
  }

  const startDate = new Date(row.startsAt);
  const endDate = row.endsAt ? new Date(row.endsAt) : new Date(startDate.getTime() + 3600_000);
  return {
    ...base,
    start: { dateTime: startDate.toISOString(), timeZone: 'Asia/Seoul' },
    end: { dateTime: endDate.toISOString(), timeZone: 'Asia/Seoul' },
  };
}

function parseGoogleEventDates(item: GoogleEventItem): {
  startsAt: string | null;
  endsAt: string | null;
  allDay: number;
} {
  if (item.start?.date) {
    const startsAt = new Date(`${item.start.date}T00:00:00+09:00`).toISOString();
    const endsAt = item.end?.date ? new Date(`${item.end.date}T00:00:00+09:00`).toISOString() : null;
    return { startsAt, endsAt, allDay: 1 };
  }
  if (item.start?.dateTime) {
    const startsAt = new Date(item.start.dateTime).toISOString();
    const endsAt = item.end?.dateTime ? new Date(item.end.dateTime).toISOString() : null;
    return { startsAt, endsAt, allDay: 0 };
  }
  return { startsAt: null, endsAt: null, allDay: 1 };
}

export async function pullFromGoogleCalendar(familyId: string): Promise<{
  ok: boolean;
  pulled: number;
  conflicts: number;
  fullSync: boolean;
  error?: string;
}> {
  const creds = await loadGoogleCredentialsFromKeychain();
  if (!creds) {
    return { ok: false, pulled: 0, conflicts: 0, fullSync: false, error: '구글 자격 증명이 없습니다.' };
  }

  const syncTokenKey = `google.syncToken.${familyId}`;
  let syncToken = getMeta(syncTokenKey);
  let fullSync = !syncToken;

  const fetchAllPages = async (token: string | null): Promise<{ items: GoogleEventItem[]; nextSyncToken?: string }> => {
    const collected: GoogleEventItem[] = [];
    let pageToken: string | undefined;
    let finalSyncToken: string | undefined;

    do {
      const params = new URLSearchParams({
        singleEvents: 'true',
        maxResults: '250',
      });
      if (token) {
        params.set('syncToken', token);
      } else {
        const minDate = new Date(Date.now() - 14 * 86_400_000).toISOString();
        const maxDate = new Date(Date.now() + 180 * 86_400_000).toISOString();
        params.set('timeMin', minDate);
        params.set('timeMax', maxDate);
      }
      if (pageToken) params.set('pageToken', pageToken);

      const res = await googleRequest<GoogleEventsListResponse>(
        creds,
        `/calendars/${encodeURIComponent(creds.calendarId)}/events?${params.toString()}`,
      );
      if (Array.isArray(res.items)) collected.push(...res.items);
      pageToken = res.nextPageToken;
      if (res.nextSyncToken) finalSyncToken = res.nextSyncToken;
    } while (pageToken);

    return { items: collected, nextSyncToken: finalSyncToken };
  };

  let fetched: { items: GoogleEventItem[]; nextSyncToken?: string };
  try {
    fetched = await fetchAllPages(syncToken);
  } catch (error) {
    if (error instanceof GoogleApiError && error.status === 410) {
      // syncToken expired -> fallback to 180-day full sync
      syncToken = null;
      fullSync = true;
      fetched = await fetchAllPages(null);
    } else {
      return { ok: false, pulled: 0, conflicts: 0, fullSync, error: (error as Error).message };
    }
  }

  let pulled = 0;
  let conflicts = 0;
  const syncTimestamp = now();
  const localWinsToPush: string[] = [];

  tx(() => {
    for (const gEvent of fetched.items) {
      if (!gEvent.id) continue;
      const existing = getEventByExternalId(familyId, gEvent.id);

      if (gEvent.status === 'cancelled') {
        if (existing && !existing.deleted) {
          upsertEventFromGoogle(familyId, {
            id: existing.id,
            title: existing.title,
            startsAt: existing.startsAt,
            endsAt: existing.endsAt,
            allDay: existing.allDay,
            location: existing.location,
            memo: existing.memo,
            externalId: gEvent.id,
            externalEtag: gEvent.etag ?? null,
            googleLastSyncedAt: syncTimestamp,
            isRepetition: existing.isRepetition,
            googleWarning: null,
            updatedAt: syncTimestamp,
            deleted: 1,
          });
          pulled += 1;
        }
        continue;
      }

      // If the user explicitly turned off Google sync for this local event, do not overwrite it.
      if (existing && existing.googleSync === 0) {
        continue;
      }

      const { startsAt, endsAt, allDay } = parseGoogleEventDates(gEvent);
      const isRepetition = gEvent.recurringEventId ? 1 : 0;
      const googleUpdatedMs = gEvent.updated ? Date.parse(gEvent.updated) : syncTimestamp;

      // Conflict detection: local row was modified since last Google sync
      if (
        existing &&
        !isRepetition &&
        existing.googleLastSyncedAt &&
        existing.updatedAt > existing.googleLastSyncedAt &&
        existing.externalEtag !== gEvent.etag
      ) {
        conflicts += 1;
        if (existing.updatedAt > googleUpdatedMs) {
          // Local is newer -> keep local data, flag warning, and queue push to Google
          updateEventGoogleMeta(existing.id, {
            externalId: gEvent.id,
            externalEtag: gEvent.etag ?? existing.externalEtag,
            googleLastSyncedAt: existing.googleLastSyncedAt,
            googleWarning: '구글 수정됨(충돌): 앱에서 수정한 내용이 더 최신이어서 앱 내용을 유지했습니다.',
          });
          localWinsToPush.push(existing.id);
          audit(familyId, null, 'google.conflict', {
            eventId: existing.id,
            externalId: gEvent.id,
            winner: 'local',
          });
          continue;
        } else {
          // Google is newer -> Google wins, flag warning
          upsertEventFromGoogle(familyId, {
            id: existing.id,
            title: (gEvent.summary ?? '제목 없음').slice(0, 120),
            startsAt,
            endsAt,
            allDay,
            location: gEvent.location ?? null,
            memo: gEvent.description ?? null,
            externalId: gEvent.id,
            externalEtag: gEvent.etag ?? null,
            googleLastSyncedAt: syncTimestamp,
            isRepetition,
            googleWarning: '구글 수정됨: 구글 캘린더에서 더 최근에 변경된 내용으로 업데이트되었습니다.',
            updatedAt: Math.max(syncTimestamp, googleUpdatedMs),
            deleted: 0,
          });
          audit(familyId, null, 'google.conflict', {
            eventId: existing.id,
            externalId: gEvent.id,
            winner: 'google',
          });
          pulled += 1;
          continue;
        }
      }

      upsertEventFromGoogle(familyId, {
        id: existing?.id,
        title: (gEvent.summary ?? '제목 없음').slice(0, 120),
        startsAt,
        endsAt,
        allDay,
        location: gEvent.location ?? null,
        memo: gEvent.description ?? null,
        externalId: gEvent.id,
        externalEtag: gEvent.etag ?? null,
        googleLastSyncedAt: syncTimestamp,
        isRepetition,
        googleWarning: existing?.googleWarning ?? null,
        updatedAt: Number.isFinite(googleUpdatedMs) ? Math.max(syncTimestamp, googleUpdatedMs) : syncTimestamp,
        deleted: 0,
      });
      pulled += 1;
    }

    if (fetched.nextSyncToken) {
      setMeta(syncTokenKey, fetched.nextSyncToken);
    }
    setMeta(`google.lastSyncAt.${familyId}`, String(syncTimestamp));
    setMeta('google.lastSyncAt', String(syncTimestamp));
  });

  for (const id of localWinsToPush) {
    await pushSingleEventToGoogle(familyId, id, { forceOverwrite: true }).catch(() => {});
  }

  return { ok: true, pulled, conflicts, fullSync };
}

export async function pushSingleEventToGoogle(
  familyId: string,
  eventId: string,
  options: { forceOverwrite?: boolean } = {},
): Promise<{ ok: boolean; conflictWinner?: 'local' | 'google'; error?: string }> {
  const creds = await loadGoogleCredentialsFromKeychain();
  if (!creds) return { ok: false, error: '구글 자격 증명이 없습니다.' };

  const row = getEventById(eventId);
  if (!row || row.familyId !== familyId) return { ok: false, error: '일정을 찾을 수 없습니다.' };
  // Never push read-only recurring instances or events with googleSync turned off.
  // Turning off googleSync intentionally leaves the Google copy intact (safety policy).
  if (row.isRepetition || row.googleSync === 0 || row.deleted) {
    return { ok: true };
  }

  const payload = toGoogleEventPayload(row);
  const calPath = `/calendars/${encodeURIComponent(creds.calendarId)}/events`;

  try {
    if (!row.externalId) {
      const created = await googleRequest<GoogleEventItem>(creds, calPath, {
        method: 'POST',
        body: payload,
      });
      const syncedAt = now();
      updateEventGoogleMeta(row.id, {
        externalId: created.id,
        externalEtag: created.etag ?? null,
        googleLastSyncedAt: syncedAt,
        googleWarning: row.googleWarning,
      });
      setMeta(`google.lastSyncAt.${familyId}`, String(syncedAt));
      setMeta('google.lastSyncAt', String(syncedAt));
      return { ok: true };
    }

    const updated = await googleRequest<GoogleEventItem>(
      creds,
      `${calPath}/${encodeURIComponent(row.externalId)}`,
      {
        method: 'PATCH',
        body: payload,
        ifMatch: options.forceOverwrite ? null : row.externalEtag,
      },
    );
    const syncedAt = now();
    updateEventGoogleMeta(row.id, {
      externalId: updated.id,
      externalEtag: updated.etag ?? null,
      googleLastSyncedAt: syncedAt,
      googleWarning: row.googleWarning,
    });
    setMeta(`google.lastSyncAt.${familyId}`, String(syncedAt));
    setMeta('google.lastSyncAt', String(syncedAt));
    return { ok: true };
  } catch (error) {
    if (error instanceof GoogleApiError && error.status === 412 && row.externalId) {
      // ETag mismatch -> fetch current Google copy and compare timestamps
      const remote = await googleRequest<GoogleEventItem>(
        creds,
        `${calPath}/${encodeURIComponent(row.externalId)}`,
      );
      const remoteUpdatedMs = remote.updated ? Date.parse(remote.updated) : 0;
      const syncedAt = now();

      if (row.updatedAt >= remoteUpdatedMs) {
        // Local is newer -> overwrite Google without If-Match
        const overwritten = await googleRequest<GoogleEventItem>(
          creds,
          `${calPath}/${encodeURIComponent(row.externalId)}`,
          { method: 'PATCH', body: payload },
        );
        updateEventGoogleMeta(row.id, {
          externalId: overwritten.id,
          externalEtag: overwritten.etag ?? null,
          googleLastSyncedAt: syncedAt,
          googleWarning: '구글 수정됨(충돌 해결): 앱 수정 시각이 더 최신이어서 구글 일정을 덮어썼습니다.',
        });
        audit(familyId, null, 'google.conflict', {
          eventId: row.id,
          externalId: row.externalId,
          winner: 'local',
        });
        return { ok: true, conflictWinner: 'local' };
      } else {
        // Google is newer -> update local DB from Google
        const { startsAt, endsAt, allDay } = parseGoogleEventDates(remote);
        upsertEventFromGoogle(familyId, {
          id: row.id,
          title: (remote.summary ?? row.title).slice(0, 120),
          startsAt,
          endsAt,
          allDay,
          location: remote.location ?? null,
          memo: remote.description ?? null,
          externalId: remote.id,
          externalEtag: remote.etag ?? null,
          googleLastSyncedAt: syncedAt,
          isRepetition: remote.recurringEventId ? 1 : 0,
          googleWarning: '구글 수정됨: 구글 캘린더의 최신 수정본이 우선 적용되었습니다.',
          updatedAt: Math.max(syncedAt, remoteUpdatedMs),
          deleted: remote.status === 'cancelled' ? 1 : 0,
        });
        audit(familyId, null, 'google.conflict', {
          eventId: row.id,
          externalId: row.externalId,
          winner: 'google',
        });
        return { ok: true, conflictWinner: 'google' };
      }
    }
    return { ok: false, error: (error as Error).message };
  }
}

export async function syncWithGoogleCalendar(familyId: string): Promise<{
  configured: boolean;
  ok: boolean;
  pushed: number;
  pulled: number;
  conflicts: number;
  error?: string;
}> {
  const creds = await loadGoogleCredentialsFromKeychain();
  if (!creds) {
    return { configured: false, ok: false, pushed: 0, pulled: 0, conflicts: 0 };
  }

  let pushed = 0;
  let conflicts = 0;
  const pending = listEventsForGooglePush(familyId);
  for (const row of pending) {
    const res = await pushSingleEventToGoogle(familyId, row.id);
    if (res.ok) pushed += 1;
    if (res.conflictWinner) conflicts += 1;
  }

  const pullRes = await pullFromGoogleCalendar(familyId);
  conflicts += pullRes.conflicts;

  return {
    configured: true,
    ok: pullRes.ok,
    pushed,
    pulled: pullRes.pulled,
    conflicts,
    error: pullRes.error,
  };
}
