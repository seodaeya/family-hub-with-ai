export type ListType = 'shopping' | 'supply' | 'todo';

export type EventRow = {
  id: string;
  title: string;
  startsAt: string | null;
  endsAt: string | null;
  allDay: number;
  location: string | null;
  memo: string | null;
  assigneeId: string | null;
  sourceId: string | null;
  updatedAt: number;
  deleted: number;
  rev: number;
};

export type ItemRow = {
  id: string;
  listType: ListType;
  title: string;
  qty: string | null;
  dueAt: string | null;
  assigneeId: string | null;
  done: number;
  sourceId: string | null;
  updatedAt: number;
  deleted: number;
  rev: number;
};

export type SourceRow = {
  id: string;
  kind: string;
  text: string | null;
  photoRef: string | null;
  createdAt: number;
  updatedAt: number;
  deleted: number;
  rev: number;
};

export type Entity = 'events' | 'items' | 'sources';

export type SyncOp = {
  opId: string;
  entity: Entity;
  row: Record<string, unknown>;
};

export type DeviceInfo = {
  id: string;
  name: string;
  platform: string | null;
  role: 'parent' | 'member';
  status: 'pending' | 'approved' | 'revoked';
  createdAt: number;
  approvedAt: number | null;
  lastSeenAt: number | null;
};

export type ExtractItem = {
  listType: ListType;
  title: string;
  qty: string | null;
  dueAt: string | null;
  confidence: number;
};

export type ExtractEvent = {
  title: string;
  startsAt: string | null;
  endsAt: string | null;
  allDay: boolean;
  location: string | null;
  memo: string | null;
  confidence: number;
};

export type ExtractResult = {
  ok: boolean;
  mode: 'image' | 'text';
  events: ExtractEvent[];
  items: ExtractItem[];
  warnings: string[];
  confidence: number;
  ocrText: string;
  photoRef?: string | null;
  meta: { ocrMs?: number; llmMs: number; model: string; totalMs: number };
};

export type PhotoSettings = {
  retention: 'delete' | '7d' | '30d' | 'keep';
  location: 'device' | 'hub';
  mode: 'preset' | 'custom';
  preset: 50 | 75 | 100;
  maxDimension: number;
  jpegQuality: number;
};

export type AiSettings = {
  model: 'fast' | 'accurate';
};
