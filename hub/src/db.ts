import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { ensureDirs, dbPath } from './config.ts';

ensureDirs();

export const db = new DatabaseSync(dbPath());

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS families (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  createdAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  familyId TEXT NOT NULL,
  name TEXT NOT NULL,
  platform TEXT,
  role TEXT NOT NULL DEFAULT 'member',
  status TEXT NOT NULL DEFAULT 'pending',
  tokenHash TEXT NOT NULL UNIQUE,
  createdAt INTEGER NOT NULL,
  approvedAt INTEGER,
  lastSeenAt INTEGER
);

CREATE TABLE IF NOT EXISTS pairing_codes (
  code TEXT PRIMARY KEY,
  familyId TEXT NOT NULL,
  kind TEXT NOT NULL,
  createdBy TEXT,
  expiresAt INTEGER NOT NULL,
  usedAt INTEGER,
  usedBy TEXT,
  createdAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  familyId TEXT NOT NULL,
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
  rev INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  familyId TEXT NOT NULL,
  listType TEXT NOT NULL DEFAULT 'todo',
  title TEXT NOT NULL,
  qty TEXT,
  dueAt TEXT,
  assigneeId TEXT,
  done INTEGER DEFAULT 0,
  sourceId TEXT,
  updatedAt INTEGER NOT NULL,
  deleted INTEGER DEFAULT 0,
  rev INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  familyId TEXT NOT NULL,
  kind TEXT NOT NULL,
  text TEXT,
  photoRef TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  deleted INTEGER DEFAULT 0,
  rev INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  familyId TEXT NOT NULL,
  deviceId TEXT,
  action TEXT NOT NULL,
  detail TEXT,
  at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS photo_meta (
  id TEXT PRIMARY KEY,
  familyId TEXT NOT NULL,
  expiresAt INTEGER,
  createdAt INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_rev ON events(familyId, rev);
CREATE INDEX IF NOT EXISTS idx_items_rev ON items(familyId, rev);
CREATE INDEX IF NOT EXISTS idx_sources_rev ON sources(familyId, rev);
`);

export function now(): number {
  return Date.now();
}

export function getMeta(key: string): string | null {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

export function setMeta(key: string, value: string): void {
  db.prepare('INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

export function nextRev(): number {
  const current = Number(getMeta('rev') ?? '0');
  const next = current + 1;
  setMeta('rev', String(next));
  return next;
}

export function currentRev(): number {
  return Number(getMeta('rev') ?? '0');
}

export function tx<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newToken(): string {
  return randomBytes(32).toString('hex');
}

export function newId(): string {
  return randomUUID();
}

export function shortCode(length = 6): string {
  // Avoid ambiguous characters (0/O, 1/I/L).
  const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

export function audit(familyId: string, deviceId: string | null, action: string, detail?: unknown): void {
  db.prepare('INSERT INTO audit_logs(id, familyId, deviceId, action, detail, at) VALUES(?,?,?,?,?,?)').run(
    newId(),
    familyId,
    deviceId,
    action,
    detail === undefined ? null : JSON.stringify(detail),
    now(),
  );
}

// ---------------------------------------------------------------- families

export type Family = { id: string; name: string; createdAt: number };

export function createFamily(name: string): Family {
  const family: Family = { id: newId(), name, createdAt: now() };
  db.prepare('INSERT INTO families(id, name, createdAt) VALUES(?,?,?)').run(family.id, family.name, family.createdAt);
  return family;
}

export function getFamily(id: string): Family | null {
  return (db.prepare('SELECT * FROM families WHERE id = ?').get(id) as Family | undefined) ?? null;
}

export function firstFamily(): Family | null {
  return (db.prepare('SELECT * FROM families ORDER BY createdAt LIMIT 1').get() as Family | undefined) ?? null;
}

// ----------------------------------------------------------------- devices

export type Device = {
  id: string;
  familyId: string;
  name: string;
  platform: string | null;
  role: 'parent' | 'member';
  status: 'pending' | 'approved' | 'revoked';
  createdAt: number;
  approvedAt: number | null;
  lastSeenAt: number | null;
};

export function createDevice(input: {
  familyId: string;
  name: string;
  platform: string;
  role?: 'parent' | 'member';
  status?: 'pending' | 'approved';
}): { device: Device; token: string } {
  const token = newToken();
  const device: Device = {
    id: newId(),
    familyId: input.familyId,
    name: input.name,
    platform: input.platform,
    role: input.role ?? 'member',
    status: input.status ?? 'pending',
    createdAt: now(),
    approvedAt: input.status === 'approved' ? now() : null,
    lastSeenAt: null,
  };
  db.prepare(
    'INSERT INTO devices(id, familyId, name, platform, role, status, tokenHash, createdAt, approvedAt, lastSeenAt) VALUES(?,?,?,?,?,?,?,?,?,?)',
  ).run(
    device.id,
    device.familyId,
    device.name,
    device.platform,
    device.role,
    device.status,
    hashToken(token),
    device.createdAt,
    device.approvedAt,
    null,
  );
  return { device, token };
}

export function getDeviceByToken(token: string): Device | null {
  const row = db.prepare('SELECT * FROM devices WHERE tokenHash = ?').get(hashToken(token)) as Device | undefined;
  if (!row) return null;
  db.prepare('UPDATE devices SET lastSeenAt = ? WHERE id = ?').run(now(), row.id);
  return row;
}

export function getDevice(id: string): Device | null {
  return (db.prepare('SELECT * FROM devices WHERE id = ?').get(id) as Device | undefined) ?? null;
}

export function listDevices(familyId: string): Device[] {
  return db
    .prepare(
      'SELECT id, familyId, name, platform, role, status, createdAt, approvedAt, lastSeenAt FROM devices WHERE familyId = ? ORDER BY createdAt',
    )
    .all(familyId) as Device[];
}

export function setDeviceStatus(id: string, status: Device['status']): void {
  db.prepare('UPDATE devices SET status = ?, approvedAt = COALESCE(approvedAt, ?) WHERE id = ?').run(status, now(), id);
}

// ---------------------------------------------------------------- photos

/** Photo files kept on the hub, with the text that was extracted from them. */
export function listPhotoSources(familyId: string): Array<{ photoRef: string; text: string | null; createdAt: number }> {
  return db
    .prepare(
      'SELECT photoRef, text, createdAt FROM sources WHERE familyId = ? AND deleted = 0 AND photoRef IS NOT NULL ORDER BY createdAt DESC',
    )
    .all(familyId) as Array<{ photoRef: string; text: string | null; createdAt: number }>;
}

export function savePhotoMeta(input: { id: string; familyId: string; expiresAt: number | null }): void {
  db.prepare('INSERT INTO photo_meta(id,familyId,expiresAt,createdAt) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET expiresAt = excluded.expiresAt').run(
    input.id,
    input.familyId,
    input.expiresAt,
    now(),
  );
}

/** Removes expired rows and returns their ids so the caller can unlink files. */
export function purgeExpiredPhotos(familyId: string, nowMs = now()): string[] {
  const rows = db
    .prepare('SELECT id FROM photo_meta WHERE familyId = ? AND expiresAt IS NOT NULL AND expiresAt <= ?')
    .all(familyId, nowMs) as Array<{ id: string }>;
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const placeholders = ids.map(() => '?').join(',');
  db.prepare(`DELETE FROM photo_meta WHERE id IN (${placeholders})`).run(...ids);
  return ids;
}

// ----------------------------------------------------------- pairing codes

export type PairingCode = {
  code: string;
  familyId: string;
  kind: 'bootstrap' | 'invite';
  createdBy: string | null;
  expiresAt: number;
  usedAt: number | null;
  usedBy: string | null;
  createdAt: number;
};

export function createPairingCode(input: {
  familyId: string;
  kind: 'bootstrap' | 'invite';
  createdBy?: string | null;
  ttlMs: number;
}): PairingCode {
  const code = shortCode(input.kind === 'bootstrap' ? 8 : 6);
  const row: PairingCode = {
    code,
    familyId: input.familyId,
    kind: input.kind,
    createdBy: input.createdBy ?? null,
    expiresAt: now() + input.ttlMs,
    usedAt: null,
    usedBy: null,
    createdAt: now(),
  };
  db.prepare(
    'INSERT INTO pairing_codes(code, familyId, kind, createdBy, expiresAt, usedAt, usedBy, createdAt) VALUES(?,?,?,?,?,?,?,?)',
  ).run(row.code, row.familyId, row.kind, row.createdBy, row.expiresAt, null, null, row.createdAt);
  return row;
}

export function getPairingCode(code: string): PairingCode | null {
  return (db.prepare('SELECT * FROM pairing_codes WHERE code = ?').get(code.toUpperCase()) as PairingCode | undefined) ?? null;
}

export function consumePairingCode(code: string, deviceId: string): void {
  db.prepare('UPDATE pairing_codes SET usedAt = ?, usedBy = ? WHERE code = ?').run(now(), deviceId, code.toUpperCase());
}

// --------------------------------------------------------------- sync core

export type Entity = 'events' | 'items' | 'sources';

const FIELDS: Record<Entity, string[]> = {
  events: ['title', 'startsAt', 'endsAt', 'allDay', 'location', 'memo', 'assigneeId', 'sourceId'],
  items: ['listType', 'title', 'qty', 'dueAt', 'assigneeId', 'done', 'sourceId'],
  sources: ['kind', 'text', 'photoRef', 'createdAt'],
};

const NUMERIC = new Set(['allDay', 'done', 'createdAt']);

export type SyncOp = {
  opId: string;
  entity: Entity;
  row: Record<string, unknown> & { id: string; updatedAt: number; deleted?: boolean | number };
};

export function applyOp(familyId: string, op: SyncOp): { applied: boolean; rev: number } {
  const entity = op.entity;
  if (!FIELDS[entity]) throw new Error(`unknown entity: ${entity}`);
  if (!op.row?.id) throw new Error('row.id required');

  const existing = db.prepare(`SELECT * FROM ${entity} WHERE id = ?`).get(op.row.id) as
    | (Record<string, unknown> & { updatedAt: number; rev: number })
    | undefined;

  if (existing) {
    if (Number(op.row.updatedAt) <= Number(existing.updatedAt)) {
      return { applied: false, rev: Number(existing.rev) };
    }
    const rev = nextRev();
    const fields = FIELDS[entity].filter((field) => op.row[field] !== undefined);
    const assignments = [...fields.map((field) => `${field} = ?`), 'updatedAt = ?', 'deleted = ?', 'rev = ?'].join(', ');
    const values = [
      ...fields.map((field) => normalizeValue(field, op.row[field])),
      Number(op.row.updatedAt),
      op.row.deleted ? 1 : 0,
      rev,
    ];
    db.prepare(`UPDATE ${entity} SET ${assignments} WHERE id = ?`).run(...values, op.row.id);
    return { applied: true, rev };
  }

  const rev = nextRev();
  const fields = FIELDS[entity].filter((field) => op.row[field] !== undefined);
  const columns = ['id', 'familyId', ...fields, 'updatedAt', 'deleted', 'rev'];
  const values = [
    op.row.id,
    familyId,
    ...fields.map((field) => normalizeValue(field, op.row[field])),
    Number(op.row.updatedAt),
    op.row.deleted ? 1 : 0,
    rev,
  ];
  db.prepare(`INSERT INTO ${entity} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`).run(...values);
  return { applied: true, rev };
}

function normalizeValue(field: string, value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (NUMERIC.has(field) || typeof value === 'number') {
    if (typeof value === 'boolean') return value ? 1 : 0;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }
  if (typeof value === 'boolean') return value ? 1 : 0;
  return String(value);
}

export type PullChanges = { events: unknown[]; items: unknown[]; sources: unknown[] };

export function pullChanges(familyId: string, cursor: number, limit = 500): { changes: PullChanges; cursor: number } {
  const changes: PullChanges = { events: [], items: [], sources: [] };
  let maxRev = cursor;
  for (const entity of ['events', 'items', 'sources'] as Entity[]) {
    const rows = db
      .prepare(`SELECT * FROM ${entity} WHERE familyId = ? AND rev > ? ORDER BY rev LIMIT ?`)
      .all(familyId, cursor, limit) as Array<{ rev: number }>;
    changes[entity] = rows;
    for (const row of rows) maxRev = Math.max(maxRev, Number(row.rev));
  }
  return { changes, cursor: maxRev };
}
