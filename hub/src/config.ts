import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const HUB_ROOT = resolve(here, '..');
export const REPO_ROOT = resolve(HUB_ROOT, '..');

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

export function ensureDirs(): void {
  mkdirSync(config.dataDir, { recursive: true });
  mkdirSync(join(config.dataDir, 'photos'), { recursive: true });
  mkdirSync(join(config.dataDir, 'tmp'), { recursive: true });
}

export const dbPath = () => join(config.dataDir, 'hub.db');
