import { chmodSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const HUB_ROOT = resolve(here, '..');
export const REPO_ROOT = resolve(HUB_ROOT, '..');

// Family schedules and OCR text are private. New files (SQLite DB/WAL, photos,
// logs, Chrome profiles) must not be readable by other macOS accounts. The
// default umask is usually 022, which would create world-readable files.
try {
  process.umask(0o077);
} catch {
  // Non-POSIX environments: keep the default.
}

export const config = {
  host: process.env.HUB_HOST ?? '0.0.0.0',
  port: Number(process.env.HUB_PORT ?? 4317),
  dataDir: process.env.HUB_DATA_DIR ?? join(HUB_ROOT, 'data'),
  ocrBin: process.env.OCR_BIN ?? join(REPO_ROOT, 'ocr', 'bin', 'ocr'),
  ollamaUrl: process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434',
  ollamaModel: process.env.OLLAMA_MODEL ?? 'gemma4:e4b',
  altModel: process.env.OLLAMA_ALT_MODEL ?? 'qwen2.5:14b-instruct',
  visionModel: process.env.OLLAMA_VISION_MODEL ?? 'gemma3:12b',
  // Kept intentionally high: photo limits were removed by request.
  bodyLimit: Number(process.env.HUB_BODY_LIMIT ?? 64 * 1024 * 1024),
};

function ensurePrivateDir(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  // mkdir mode only applies when the directory is created. Fix an existing
  // data directory too, because earlier versions created it as 0755.
  try {
    chmodSync(path, 0o700);
  } catch {
    // A non-owner (or a filesystem without POSIX modes) cannot chmod; the
    // process will fail later if it cannot write, which is the safer outcome.
  }
}

export function ensureDirs(): void {
  ensurePrivateDir(config.dataDir);
  ensurePrivateDir(join(config.dataDir, 'photos'));
  ensurePrivateDir(join(config.dataDir, 'tmp'));
}

export const dbPath = () => join(config.dataDir, 'hub.db');
