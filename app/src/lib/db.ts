import * as SQLite from 'expo-sqlite';
import type { AiSettings, Entity, EventRow, ItemRow, ListType, PhotoSettings, SourceRow } from './types';

const DB_NAME = 'family-hub.db';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) dbPromise = open();
  return dbPromise;
}

async function open(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(DB_NAME);
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      startsAt TEXT,
      endsAt TEXT,
      allDay INTEGER DEFAULT 0,
      location TEXT,
      memo TEXT,
      assigneeId TEXT,
      sourceId TEXT,
      updatedAt INTEGER NOT NULL,
      deleted INTEGER DEFAULT 0,
      rev INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      listType TEXT NOT NULL DEFAULT 'todo',
      title TEXT NOT NULL,
      qty TEXT,
      dueAt TEXT,
      assigneeId TEXT,
      done INTEGER DEFAULT 0,
      sourceId TEXT,
      updatedAt INTEGER NOT NULL,
      deleted INTEGER DEFAULT 0,
      rev INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      text TEXT,
      photoRef TEXT,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      deleted INTEGER DEFAULT 0,
      rev INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS outbox (
      opId TEXT PRIMARY KEY,
      entity TEXT NOT NULL,
      rowId TEXT NOT NULL,
      payload TEXT NOT NULL,
      createdAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_events_start ON events(startsAt);
    CREATE INDEX IF NOT EXISTS idx_items_type ON items(listType);
  `);
  return db;
}

export async function getMeta(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key]);
  return row?.value ?? null;
}

export async function setMeta(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value],
  );
}

// ---------------------------------------------------------------- settings

export const defaultPhotoSettings: PhotoSettings = {
  retention: 'delete',
  location: 'device',
  mode: 'preset',
  preset: 75,
  maxDimension: 2048,
  jpegQuality: 0.8,
};

export const defaultAiSettings: AiSettings = { model: 'fast' };

export async function getPhotoSettings(): Promise<PhotoSettings> {
  const raw = await getMeta('photoSettings');
  if (!raw) return defaultPhotoSettings;
  try {
    return { ...defaultPhotoSettings, ...JSON.parse(raw) };
  } catch {
    return defaultPhotoSettings;
  }
}

export async function savePhotoSettings(value: PhotoSettings): Promise<void> {
  await setMeta('photoSettings', JSON.stringify(value));
}

export async function getAiSettings(): Promise<AiSettings> {
  const raw = await getMeta('aiSettings');
  if (!raw) return defaultAiSettings;
  try {
    return { ...defaultAiSettings, ...JSON.parse(raw) };
  } catch {
    return defaultAiSettings;
  }
}

export async function saveAiSettings(value: AiSettings): Promise<void> {
  await setMeta('aiSettings', JSON.stringify(value));
}

// ------------------------------------------------------------------ outbox

export async function enqueue(entity: Entity, row: Record<string, unknown>): Promise<void> {
  const db = await getDb();
  const opId = `${entity}:${String(row.id)}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  await db.runAsync('INSERT INTO outbox(opId, entity, rowId, payload, createdAt) VALUES(?,?,?,?,?)', [
    opId,
    entity,
    String(row.id),
    JSON.stringify(row),
    Date.now(),
  ]);
}

export async function pendingOps(): Promise<Array<{ opId: string; entity: Entity; row: any }>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ opId: string; entity: Entity; payload: string }>(
    'SELECT opId, entity, payload FROM outbox ORDER BY createdAt LIMIT 2000',
  );
  return rows.map((row) => ({ opId: row.opId, entity: row.entity, row: JSON.parse(row.payload) }));
}

export async function pendingCount(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM outbox');
  return row?.count ?? 0;
}

export async function clearOps(opIds: string[]): Promise<void> {
  if (!opIds.length) return;
  const db = await getDb();
  const placeholders = opIds.map(() => '?').join(',');
  await db.runAsync(`DELETE FROM outbox WHERE opId IN (${placeholders})`, opIds);
}

// ------------------------------------------------------------------ events

export async function saveEvent(input: Partial<EventRow> & { title: string }): Promise<EventRow> {
  const db = await getDb();
  const existing = input.id
    ? await db.getFirstAsync<EventRow>('SELECT * FROM events WHERE id = ?', [input.id])
    : null;
  const row: EventRow = {
    id: input.id ?? newId(),
    title: input.title,
    startsAt: input.startsAt ?? null,
    endsAt: input.endsAt ?? null,
    allDay: input.allDay ?? 0,
    location: input.location ?? null,
    memo: input.memo ?? null,
    assigneeId: input.assigneeId ?? null,
    sourceId: input.sourceId ?? null,
    updatedAt: Date.now(),
    deleted: input.deleted ?? 0,
    rev: existing?.rev ?? 0,
  };
  await db.runAsync(
    `INSERT INTO events(id,title,startsAt,endsAt,allDay,location,memo,assigneeId,sourceId,updatedAt,deleted,rev)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET title=excluded.title, startsAt=excluded.startsAt, endsAt=excluded.endsAt,
       allDay=excluded.allDay, location=excluded.location, memo=excluded.memo, assigneeId=excluded.assigneeId,
       sourceId=excluded.sourceId, updatedAt=excluded.updatedAt, deleted=excluded.deleted`,
    [row.id, row.title, row.startsAt, row.endsAt, row.allDay, row.location, row.memo, row.assigneeId, row.sourceId, row.updatedAt, row.deleted, row.rev],
  );
  await enqueue('events', row);
  return row;
}

export async function deleteEvent(id: string): Promise<void> {
  const db = await getDb();
  const existing = await db.getFirstAsync<EventRow>('SELECT * FROM events WHERE id = ?', [id]);
  if (!existing) return;
  const row = { ...existing, deleted: 1, updatedAt: Date.now() };
  await db.runAsync('UPDATE events SET deleted = 1, updatedAt = ? WHERE id = ?', [row.updatedAt, id]);
  await enqueue('events', row);
}

export async function listEvents(fromISO?: string, toISO?: string): Promise<EventRow[]> {
  const db = await getDb();
  const clauses = ['deleted = 0'];
  const params: (string | number | null)[] = [];
  if (fromISO) {
    clauses.push('startsAt >= ?');
    params.push(fromISO);
  }
  if (toISO) {
    clauses.push('startsAt < ?');
    params.push(toISO);
  }
  return db.getAllAsync<EventRow>(
    `SELECT * FROM events WHERE ${clauses.join(' AND ')} ORDER BY COALESCE(startsAt, '9999') ASC`,
    params,
  );
}

// ------------------------------------------------------------------- items

export async function saveItem(input: Partial<ItemRow> & { title: string; listType: ListType }): Promise<ItemRow> {
  const db = await getDb();
  const existing = input.id ? await db.getFirstAsync<ItemRow>('SELECT * FROM items WHERE id = ?', [input.id]) : null;
  const row: ItemRow = {
    id: input.id ?? newId(),
    listType: input.listType,
    title: input.title,
    qty: input.qty ?? null,
    dueAt: input.dueAt ?? null,
    assigneeId: input.assigneeId ?? null,
    done: input.done ?? 0,
    sourceId: input.sourceId ?? null,
    updatedAt: Date.now(),
    deleted: input.deleted ?? 0,
    rev: existing?.rev ?? 0,
  };
  await db.runAsync(
    `INSERT INTO items(id,listType,title,qty,dueAt,assigneeId,done,sourceId,updatedAt,deleted,rev)
     VALUES(?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET listType=excluded.listType, title=excluded.title, qty=excluded.qty,
       dueAt=excluded.dueAt, assigneeId=excluded.assigneeId, done=excluded.done, sourceId=excluded.sourceId,
       updatedAt=excluded.updatedAt, deleted=excluded.deleted`,
    [row.id, row.listType, row.title, row.qty, row.dueAt, row.assigneeId, row.done, row.sourceId, row.updatedAt, row.deleted, row.rev],
  );
  await enqueue('items', row);
  return row;
}

export async function toggleItem(item: ItemRow): Promise<void> {
  await saveItem({ ...item, done: item.done ? 0 : 1, listType: item.listType });
}

export async function deleteItem(id: string): Promise<void> {
  const db = await getDb();
  const existing = await db.getFirstAsync<ItemRow>('SELECT * FROM items WHERE id = ?', [id]);
  if (!existing) return;
  await db.runAsync('UPDATE items SET deleted = 1, updatedAt = ? WHERE id = ?', [Date.now(), id]);
  await enqueue('items', { ...existing, deleted: 1, updatedAt: Date.now() });
}

export async function listItems(listType?: ListType): Promise<ItemRow[]> {
  const db = await getDb();
  if (listType) {
    return db.getAllAsync<ItemRow>(
      'SELECT * FROM items WHERE deleted = 0 AND listType = ? ORDER BY done ASC, COALESCE(dueAt, "9999") ASC, title ASC',
      [listType],
    );
  }
  return db.getAllAsync<ItemRow>(
    'SELECT * FROM items WHERE deleted = 0 ORDER BY done ASC, listType ASC, COALESCE(dueAt, "9999") ASC',
  );
}

// ----------------------------------------------------------------- sources

export async function saveSource(input: Partial<SourceRow> & { kind: string }): Promise<SourceRow> {
  const db = await getDb();
  const existing = input.id ? await db.getFirstAsync<SourceRow>('SELECT * FROM sources WHERE id = ?', [input.id]) : null;
  const row: SourceRow = {
    id: input.id ?? newId(),
    kind: input.kind,
    text: input.text ?? null,
    photoRef: input.photoRef ?? null,
    createdAt: existing?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
    deleted: 0,
    rev: existing?.rev ?? 0,
  };
  await db.runAsync(
    `INSERT INTO sources(id,kind,text,photoRef,createdAt,updatedAt,deleted,rev) VALUES(?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, text=excluded.text, photoRef=excluded.photoRef, updatedAt=excluded.updatedAt`,
    [row.id, row.kind, row.text, row.photoRef, row.createdAt, row.updatedAt, row.deleted, row.rev],
  );
  await enqueue('sources', row);
  return row;
}

// ------------------------------------------------------------------- sync

export async function applyRemote(changes: { events: any[]; items: any[]; sources: any[] }): Promise<number> {
  const db = await getDb();
  let applied = 0;
  for (const entity of ['events', 'items', 'sources'] as const) {
    for (const remote of changes[entity] ?? []) {
      const existing = await db.getFirstAsync<{ updatedAt: number }>(`SELECT updatedAt FROM ${entity} WHERE id = ?`, [remote.id]);
      if (existing && Number(remote.updatedAt) <= Number(existing.updatedAt)) continue;
      await upsertRemote(entity, remote);
      applied += 1;
    }
  }
  return applied;
}

async function upsertRemote(entity: Entity, remote: any): Promise<void> {
  const db = await getDb();
  if (entity === 'events') {
    await db.runAsync(
      `INSERT INTO events(id,title,startsAt,endsAt,allDay,location,memo,assigneeId,sourceId,updatedAt,deleted,rev)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET title=excluded.title, startsAt=excluded.startsAt, endsAt=excluded.endsAt,
         allDay=excluded.allDay, location=excluded.location, memo=excluded.memo, assigneeId=excluded.assigneeId,
         sourceId=excluded.sourceId, updatedAt=excluded.updatedAt, deleted=excluded.deleted, rev=excluded.rev`,
      [remote.id, remote.title, iso(remote.startsAt), iso(remote.endsAt), remote.allDay, remote.location, remote.memo, remote.assigneeId, remote.sourceId, remote.updatedAt, remote.deleted, remote.rev],
    );
  } else if (entity === 'items') {
    await db.runAsync(
      `INSERT INTO items(id,listType,title,qty,dueAt,assigneeId,done,sourceId,updatedAt,deleted,rev)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET listType=excluded.listType, title=excluded.title, qty=excluded.qty,
         dueAt=excluded.dueAt, assigneeId=excluded.assigneeId, done=excluded.done, sourceId=excluded.sourceId,
         updatedAt=excluded.updatedAt, deleted=excluded.deleted, rev=excluded.rev`,
      [remote.id, remote.listType, remote.title, remote.qty, iso(remote.dueAt), remote.assigneeId, remote.done, remote.sourceId, remote.updatedAt, remote.deleted, remote.rev],
    );
  } else {
    await db.runAsync(
      `INSERT INTO sources(id,kind,text,photoRef,createdAt,updatedAt,deleted,rev) VALUES(?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, text=excluded.text, photoRef=excluded.photoRef,
         createdAt=excluded.createdAt, updatedAt=excluded.updatedAt, deleted=excluded.deleted, rev=excluded.rev`,
      [remote.id, remote.kind, remote.text, remote.photoRef, remote.createdAt, remote.updatedAt, remote.deleted, remote.rev],
    );
  }
}

/** Normalizes any parseable date string to UTC ISO so string comparisons stay correct. */
function iso(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function newId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

export async function wipeLocalData(): Promise<void> {
  const db = await getDb();
  await db.execAsync('DELETE FROM events; DELETE FROM items; DELETE FROM sources; DELETE FROM outbox; DELETE FROM meta;');
}
