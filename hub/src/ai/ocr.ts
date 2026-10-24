import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../config.ts';

export type OcrBlock = { text: string; confidence: number; x: number; y: number; w: number; h: number };
export type OcrResult = { text: string; blocks: OcrBlock[]; ms: number; engine: string };

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'image/webp': 'webp',
};

export async function runOcr(image: Buffer, mimeType = 'image/jpeg'): Promise<OcrResult> {
  const started = Date.now();
  const ext = EXT_BY_MIME[mimeType] ?? 'jpg';
  const tmpPath = join(config.dataDir, 'tmp', `${randomUUID()}.${ext}`);

  await writeFile(tmpPath, image);
  try {
    const blocks = await execOcr(tmpPath);
    return {
      text: blocks.map((block) => block.text).join('\n'),
      blocks,
      ms: Date.now() - started,
      engine: 'apple-vision',
    };
  } finally {
    await unlink(tmpPath).catch(() => {});
  }
}

function execOcr(path: string): Promise<OcrBlock[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(config.ocrBin, [path, 'ko-KR,en-US'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 30_000);

    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(new Error(`OCR 실행 실패 (${config.ocrBin}): ${error.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`OCR 종료 코드 ${code}: ${stderr.trim()}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as { blocks: OcrBlock[] };
        resolve(parsed.blocks ?? []);
      } catch {
        reject(new Error('OCR 결과를 해석할 수 없습니다.'));
      }
    });
  });
}

export async function ocrHealthy(): Promise<boolean> {
  try {
    const { access } = await import('node:fs/promises');
    await access(config.ocrBin);
    return true;
  } catch {
    return false;
  }
}
