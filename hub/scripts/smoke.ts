import { readFile } from 'node:fs/promises';

const base = process.env.HUB_URL ?? 'http://127.0.0.1:4317';
const code = process.argv[2];
const imagePath = process.argv[3] ?? '/tmp/sample_notice.png';

if (!code) {
  console.error('usage: node scripts/smoke.ts <bootstrap-code> [image-path]');
  process.exit(1);
}

async function call(path: string, body?: unknown, token?: string) {
  const res = await fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data } as { status: number; data: any };
}

function step(name: string, detail = '') {
  console.log(`\n=== ${name} ${detail}`);
}

step('health');
const health = await call('/v1/health');
console.log(health.data.ocr, health.data.ollama?.ok);

step('pair (bootstrap)');
const pair = await call('/v1/pair', { code, name: 'Smoke Mac', platform: 'test' });
console.log(pair.status, pair.data.device?.status, pair.data.device?.role);
const token = pair.data.token;
if (!token) process.exit(1);

step('extract (image)');
const image = await readFile(imagePath);
const extracted = await call(
  '/v1/extract',
  { imageBase64: image.toString('base64'), mimeType: 'image/png', hint: '가정통신문' },
  token,
);
console.log('status', extracted.status, 'ok', extracted.data.ok, 'conf', extracted.data.confidence);
console.log('events', JSON.stringify(extracted.data.events, null, 1));
console.log('items', JSON.stringify(extracted.data.items, null, 1));
console.log('warnings', extracted.data.warnings);
console.log('meta', extracted.data.meta);

step('sync push');
const eventRow = {
  id: 'smoke-event-1',
  title: '현장학습',
  startsAt: '2026-10-30T08:40:00+09:00',
  endsAt: null,
  allDay: false,
  location: '국립과천과학관',
  memo: null,
  assigneeId: null,
  sourceId: null,
  updatedAt: Date.now(),
  deleted: false,
};
const pushed = await call(
  '/v1/sync',
  { cursor: 0, ops: [{ opId: 'op-1', entity: 'events', row: eventRow }] },
  token,
);
console.log('status', pushed.status, 'applied', pushed.data.applied, 'rev', pushed.data.cursor, 'serverTime', pushed.data.serverTime);

step('sync pull from cursor 0');
const pulled = await call('/v1/sync', { cursor: 0, ops: [] }, token);
console.log('changes', JSON.stringify(pulled.data.changes.events));

step('invite + second device');
const invite = await call('/v1/invite', { ttlMinutes: 10 }, token);
console.log('invite', invite.status, invite.data.code);
const second = await call('/v1/pair', { code: invite.data.code, name: '아이폰', platform: 'ios' });
console.log('paired', second.status, second.data.device?.status);
const secondToken = second.data.token;

step('pending device blocked');
const blocked = await call('/v1/sync', { cursor: 0, ops: [] }, secondToken);
console.log('sync status (expect 403)', blocked.status, blocked.data.error);

step('parent approves');
const pending = await call('/v1/devices', undefined, token);
const target = pending.data.devices.find((device: any) => device.name === '아이폰');
const approved = await call(`/v1/devices/${target.id}/approve`, {}, token);
console.log('approve', approved.status);

step('second device syncs');
const secondSync = await call('/v1/sync', { cursor: 0, ops: [] }, secondToken);
console.log('changes', secondSync.data.changes.events.length, 'cursor', secondSync.data.cursor);

step('LWW conflict');
const stale = await call(
  '/v1/sync',
  {
    cursor: secondSync.data.cursor,
    ops: [{ opId: 'op-stale', entity: 'events', row: { ...eventRow, title: '덮어쓰기 시도', updatedAt: eventRow.updatedAt - 1000 } }],
  },
  secondToken,
);
console.log('applied (expect [] as LWW)', stale.data.applied);
const after = await call('/v1/sync', { cursor: 0, ops: [] }, secondToken);
console.log('title still', after.data.changes.events[0]?.title);

step('revoke second device');
const revoked = await call(`/v1/devices/${target.id}/revoke`, {}, token);
console.log('revoke', revoked.status);
const afterRevoke = await call('/v1/sync', { cursor: 0, ops: [] }, secondToken);
console.log('second device status (expect 403)', afterRevoke.status, afterRevoke.data.error);
