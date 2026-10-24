import Fastify from 'fastify';
import cors from '@fastify/cors';
import { createReadStream } from 'node:fs';
import { readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config, ensureDirs } from './config.ts';
import {
  applyOp,
  audit,
  consumePairingCode,
  createDevice,
  createPairingCode,
  currentRev,
  firstFamily,
  getFamily,
  getDeviceByToken,
  getPairingCode,
  listDevices,
  listPhotoSources,
  now,
  purgeExpiredPhotos,
  savePhotoMeta,
  pullChanges,
  setDeviceStatus,
  tx,
  type Device,
  type Entity,
} from './db.ts';
import { extract } from './ai/extract.ts';
import { ollamaHealth } from './ai/ollama.ts';
import { ocrHealthy } from './ai/ocr.ts';
import { importUrl, UrlImportError } from './ai/url.ts';

ensureDirs();

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  bodyLimit: config.bodyLimit,
});

await app.register(cors, { origin: true });

type Authed = { device: Device; token: string };

declare module 'fastify' {
  interface FastifyRequest {
    auth?: Authed;
  }
}

async function authenticate(request: any, reply: any, options: { allowPending?: boolean } = {}) {
  const header = request.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) {
    reply.code(401).send({ error: 'unauthorized', message: '기기 토큰이 필요합니다.' });
    return null;
  }
  const device = getDeviceByToken(token);
  if (!device) {
    reply.code(401).send({ error: 'unauthorized', message: '알 수 없는 기기입니다.' });
    return null;
  }
  if (device.status === 'revoked') {
    reply.code(403).send({ error: 'revoked', message: '이 기기는 허용 목록에서 제거되었습니다.' });
    return null;
  }
  if (device.status === 'pending' && !options.allowPending) {
    reply.code(403).send({ error: 'pending', message: '보호자 승인을 기다리는 중입니다.' });
    return null;
  }
  request.auth = { device, token };
  return device;
}

function requireParent(device: Device, reply: any): boolean {
  if (device.role !== 'parent') {
    reply.code(403).send({ error: 'forbidden', message: '보호자 기기에서만 할 수 있습니다.' });
    return false;
  }
  return true;
}

// ---------------------------------------------------------------- health

app.get('/v1/health', async () => {
  const [ocr, ollama] = await Promise.all([ocrHealthy(), ollamaHealth()]);
  return {
    ok: true,
    version: '0.1.0',
    time: now(),
    ocr: { ok: ocr, engine: 'apple-vision' },
    ollama: { ok: ollama.ok, model: config.ollamaModel, altModel: config.altModel, models: ollama.models, error: ollama.error },
    rev: currentRev(),
    paired: Boolean(firstFamily()),
  };
});

// ---------------------------------------------------------------- pairing

app.post('/v1/pair', async (request, reply) => {
  if (!allowAttempt(request.ip, 10, 60_000)) {
    return reply.code(429).send({ error: 'too_many', message: '시도가 너무 많습니다. 1분 뒤 다시 시도해 주세요.' });
  }
  const body = (request.body ?? {}) as { code?: string; name?: string; platform?: string };
  const code = String(body.code ?? '').trim().toUpperCase();
  if (!code) return reply.code(400).send({ error: 'bad_request', message: '연결 코드를 입력해 주세요.' });

  const row = getPairingCode(code);
  if (!row) return reply.code(404).send({ error: 'not_found', message: '코드를 찾을 수 없습니다.' });
  if (row.usedAt) return reply.code(409).send({ error: 'used', message: '이미 사용된 코드입니다.' });
  if (row.expiresAt < now()) return reply.code(410).send({ error: 'expired', message: '코드가 만료되었습니다. 새로 발급해 주세요.' });

  const family = getFamily(row.familyId);
  if (!family) return reply.code(404).send({ error: 'not_found', message: '가족 정보를 찾을 수 없습니다.' });

  const status = row.kind === 'bootstrap' ? 'approved' : 'pending';
  const role = row.kind === 'bootstrap' ? 'parent' : 'member';
  const { device, token } = createDevice({
    familyId: family.id,
    name: (body.name ?? '새 기기').slice(0, 40),
    platform: (body.platform ?? 'unknown').slice(0, 20),
    role,
    status,
  });
  consumePairingCode(code, device.id);
  audit(family.id, device.id, 'device.pair', { kind: row.kind, platform: device.platform });

  return {
    token,
    device: publicDevice(device),
    family: { id: family.id, name: family.name },
  };
});

app.get('/v1/me', async (request, reply) => {
  const device = await authenticate(request, reply, { allowPending: true });
  if (!device) return;
  const family = getFamily(device.familyId);
  return {
    device: publicDevice(device),
    family: family ? { id: family.id, name: family.name } : null,
    serverTime: now(),
  };
});

// ---------------------------------------------------------------- devices

app.get('/v1/devices', async (request, reply) => {
  const device = await authenticate(request, reply);
  if (!device) return;
  return { devices: listDevices(device.familyId).map(publicDevice) };
});

app.post('/v1/devices/:id/approve', async (request, reply) => {
  const device = await authenticate(request, reply);
  if (!device) return;
  if (!requireParent(device, reply)) return;

  const { id } = request.params as { id: string };
  const target = listDevices(device.familyId).find((row) => row.id === id);
  if (!target) return reply.code(404).send({ error: 'not_found', message: '기기를 찾을 수 없습니다.' });
  if (target.status === 'revoked') {
    return reply.code(409).send({ error: 'revoked', message: '해제된 기기는 다시 승인할 수 없습니다. 새로 연결해 주세요.' });
  }
  setDeviceStatus(id, 'approved');
  audit(device.familyId, device.id, 'device.approve', { target: id });
  return { ok: true, device: publicDevice({ ...target, status: 'approved', approvedAt: now() }) };
});

app.post('/v1/devices/:id/revoke', async (request, reply) => {
  const device = await authenticate(request, reply);
  if (!device) return;
  if (!requireParent(device, reply)) return;

  const { id } = request.params as { id: string };
  const target = listDevices(device.familyId).find((row) => row.id === id);
  if (!target) return reply.code(404).send({ error: 'not_found', message: '기기를 찾을 수 없습니다.' });
  setDeviceStatus(id, 'revoked');
  audit(device.familyId, device.id, 'device.revoke', { target: id });
  return { ok: true };
});

app.post('/v1/invite', async (request, reply) => {
  const device = await authenticate(request, reply);
  if (!device) return;
  if (!requireParent(device, reply)) return;

  const body = (request.body ?? {}) as { ttlMinutes?: number };
  const ttlMs = Math.min(60, Math.max(1, Number(body.ttlMinutes ?? 10))) * 60_000;
  const code = createPairingCode({ familyId: device.familyId, kind: 'invite', createdBy: device.id, ttlMs });
  audit(device.familyId, device.id, 'invite.create', { code: code.code });
  return { code: code.code, expiresAt: code.expiresAt };
});

// ------------------------------------------------------------------ sync

app.post('/v1/sync', async (request, reply) => {
  const device = await authenticate(request, reply);
  if (!device) return;

  const body = (request.body ?? {}) as {
    cursor?: number;
    ops?: Array<{ opId: string; entity: Entity; row: any }>;
  };
  const cursor = Number(body.cursor ?? 0);
  const ops = Array.isArray(body.ops) ? body.ops.slice(0, 5000) : [];

  const applied: string[] = [];
  const rejected: Array<{ opId: string; reason: string }> = [];

  tx(() => {
    for (const op of ops) {
      try {
        if (!op?.opId || !op?.entity || !op?.row) {
          rejected.push({ opId: String(op?.opId ?? ''), reason: 'invalid' });
          continue;
        }
        const result = applyOp(device.familyId, op);
        if (result.applied) applied.push(op.opId);
        else rejected.push({ opId: op.opId, reason: 'stale' });
      } catch (error) {
        rejected.push({ opId: String(op?.opId ?? ''), reason: (error as Error).message });
      }
    }
  });

  if (rejected.length) {
    // The app clears rejected ops, so without this line a silently dropped edit
    // leaves no trace on the hub.
    request.log.warn(
      { deviceId: device.id, device: device.name, rejected },
      'sync ops rejected',
    );
  }

  const pulled = pullChanges(device.familyId, cursor);
  return {
    cursor: pulled.cursor,
    changes: pulled.changes,
    applied,
    rejected,
    serverTime: now(),
  };
});

// --------------------------------------------------------------- extract

app.post('/v1/extract', async (request, reply) => {
  const device = await authenticate(request, reply);
  if (!device) return;

  const body = (request.body ?? {}) as {
    imageBase64?: string;
    images?: Array<{ base64: string; mimeType?: string }>;
    mimeType?: string;
    text?: string;
    url?: string;
    hint?: string;
    retain?: boolean;
    /** 0 or missing = keep forever, otherwise days until the hub deletes it. */
    retainDays?: number;
    model?: string;
  };

  const images = Array.isArray(body.images) && body.images.length
    ? body.images.map((image) => ({
        buffer: Buffer.from(image.base64, 'base64'),
        mimeType: image.mimeType ?? 'image/jpeg',
      }))
    : body.imageBase64
      ? [{ buffer: Buffer.from(body.imageBase64, 'base64'), mimeType: body.mimeType ?? 'image/jpeg' }]
      : [];

  // Import a public link (Gemini share, school notice page, …) instead of a photo.
  let urlText: string | undefined;
  let source: { url: string; title: string; via: string } | undefined;
  if (!images.length && !body.text?.trim() && body.url?.trim()) {
    try {
      const imported = await importUrl(body.url);
      urlText = imported.text;
      source = { url: imported.url, title: imported.title, via: imported.via };
    } catch (error) {
      if (error instanceof UrlImportError) {
        return reply.code(400).send({ error: 'url_failed', message: error.message });
      }
      throw error;
    }
  }

  if (!images.length && !body.text?.trim() && !urlText) {
    return reply.code(400).send({ error: 'bad_request', message: '사진, 텍스트, 링크 중 하나가 필요합니다.' });
  }

  const photoRefs: string[] = [];
  if (body.retain && images.length) {
    const days = typeof body.retainDays === 'number' && body.retainDays > 0 ? Math.min(body.retainDays, 3650) : 0;
    const expiresAt = days > 0 ? now() + days * 86_400_000 : null;
    for (const image of images) {
      const ref = `${randomUUID()}.${mimeToExt(image.mimeType)}`;
      await writeFile(join(config.dataDir, 'photos', ref), image.buffer);
      savePhotoMeta({ id: ref, familyId: device.familyId, expiresAt });
      photoRefs.push(ref);
    }
  }
  const photoRef = photoRefs[0] ?? null;

  const model = typeof body.model === 'string' && /^[a-zA-Z0-9._:\/-]{1,80}$/.test(body.model) ? body.model : undefined;

  try {
    const results = [];
    for (const image of images) {
      results.push(await extract({ image: image.buffer, mimeType: image.mimeType, hint: body.hint, model }));
    }
    if (!images.length) results.push(await extract({ text: body.text ?? urlText, hint: body.hint, model }));

    const merged = mergeResults(results);
    audit(device.familyId, device.id, 'extract', {
      mode: source ? 'url' : merged.mode,
      images: images.length,
      events: merged.events.length,
      items: merged.items.length,
      ms: merged.meta.totalMs,
      url: source?.url,
    });
    return { ...merged, photoRef, photoRefs, source };
  } catch (error) {
    request.log.error(error);
    return reply.code(502).send({
      error: 'ai_failed',
      message: '로컬 AI 처리에 실패했습니다. 사진을 다시 찍거나 직접 입력해 주세요.',
      detail: (error as Error).message,
    });
  }
});

// ---------------------------------------------------------------- photos

app.get('/v1/photos', async (request, reply) => {
  const device = await authenticate(request, reply);
  if (!device) return;

  const dir = join(config.dataDir, 'photos');
  // The hub deletes photos whose retention window has passed.
  for (const id of purgeExpiredPhotos(device.familyId)) {
    await unlink(join(dir, id)).catch(() => {});
  }

  const previews = new Map(
    listPhotoSources(device.familyId).map((row) => [row.photoRef, row.text] as const),
  );
  const names = await readdir(dir).catch(() => [] as string[]);
  const photos = [];
  for (const id of names) {
    if (!/^[a-f0-9-]+\.(jpg|jpeg|png|webp|heic)$/i.test(id)) continue;
    const info = await stat(join(dir, id)).catch(() => null);
    if (!info?.isFile()) continue;
    photos.push({
      id,
      bytes: info.size,
      createdAt: Math.round(info.mtimeMs),
      preview: previews.get(id)?.replace(/\s+/g, ' ').slice(0, 140) ?? null,
    });
  }
  photos.sort((a, b) => b.createdAt - a.createdAt);
  return { photos };
});

app.get('/v1/photos/:id', async (request, reply) => {
  const device = await authenticate(request, reply);
  if (!device) return;
  const { id } = request.params as { id: string };
  if (!/^[a-f0-9-]+\.(jpg|jpeg|png|webp|heic)$/i.test(id)) {
    return reply.code(400).send({ error: 'bad_request', message: '잘못된 사진 경로입니다.' });
  }
  const path = join(config.dataDir, 'photos', id);
  return reply
    .header('cache-control', 'private, max-age=3600')
    .type(mimeFromExt(id))
    .send(createReadStream(path).on('error', () => reply.code(404).send({ error: 'not_found' })));
});

// ----------------------------------------------------------------- utils

const attemptBuckets = new Map<string, { count: number; resetAt: number }>();

/** Small in-memory limiter so pairing codes cannot be brute-forced. */
function allowAttempt(key: string, limit: number, windowMs: number): boolean {
  const nowMs = Date.now();
  const bucket = attemptBuckets.get(key);
  if (!bucket || bucket.resetAt < nowMs) {
    attemptBuckets.set(key, { count: 1, resetAt: nowMs + windowMs });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= limit;
}

function publicDevice(device: Device) {
  return {
    id: device.id,
    name: device.name,
    platform: device.platform,
    role: device.role,
    status: device.status,
    createdAt: device.createdAt,
    approvedAt: device.approvedAt,
    lastSeenAt: device.lastSeenAt,
  };
}

function mimeToExt(mime: string): string {
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('heic')) return 'heic';
  return 'jpg';
}

function mimeFromExt(name: string): string {
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.webp')) return 'image/webp';
  if (name.endsWith('.heic')) return 'image/heic';
  return 'image/jpeg';
}

function mergeResults(results: Awaited<ReturnType<typeof extract>>[]) {
  const base = results[0];
  const events = dedupeEvents(results.flatMap((result) => result.events));
  const items = dedupeItems(results.flatMap((result) => result.items));
  const warnings = [...new Set(results.flatMap((result) => result.warnings))].slice(0, 5);
  const confidences = [...events.map((event) => event.confidence), ...items.map((item) => item.confidence)];
  return {
    ok: events.length + items.length > 0,
    mode: base.mode,
    events,
    items,
    warnings,
    confidence: confidences.length
      ? Math.round((confidences.reduce((sum, value) => sum + value, 0) / confidences.length) * 100) / 100
      : 0,
    ocrText: results.map((result) => result.ocrText).filter(Boolean).join('\n---\n'),
    meta: {
      ocrMs: results.reduce((sum, result) => sum + (result.meta.ocrMs ?? 0), 0),
      ocrConfidence: worstOcrConfidence(results),
      llmMs: results.reduce((sum, result) => sum + result.meta.llmMs, 0),
      model: base.meta.model,
      totalMs: results.reduce((sum, result) => sum + result.meta.totalMs, 0),
    },
  };
}

function worstOcrConfidence(results: Awaited<ReturnType<typeof extract>>[]): number | undefined {
  const values = results
    .map((result) => result.meta.ocrConfidence)
    .filter((value): value is number => typeof value === 'number');
  return values.length ? Math.min(...values) : undefined;
}

function dedupeItems(items: Array<{ title: string }>) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.title}`.replace(/\s+/g, '').toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeEvents<T extends { title: string; startsAt: string | null }>(events: T[]): T[] {
  const seen = new Set<string>();
  return events.filter((event) => {
    const key = `${event.title}`.replace(/\s+/g, '').toLowerCase() + '|' + (event.startsAt ?? '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

app.setErrorHandler((error, request, reply) => {
  request.log.error(error);
  const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
  reply.code(status).send({ error: 'server_error', message: error.message });
});

const close = async () => {
  await app.close();
  process.exit(0);
};
process.on('SIGINT', close);
process.on('SIGTERM', close);

await app.listen({ host: config.host, port: config.port });
app.log.info(`family-hub hub listening on http://${config.host}:${config.port}`);
