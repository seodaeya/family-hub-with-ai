import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../config.ts';

export type OcrBlock = { text: string; confidence: number; x: number; y: number; w: number; h: number };
export type OcrResult = {
  text: string;
  blocks: OcrBlock[];
  ms: number;
  engine: string;
  /** Average per-line confidence (0–1). Below ~0.45 the photo was probably unreadable. */
  meanConfidence: number;
  /** True when a detected page was perspective-corrected before reading. */
  deskewed: boolean;
};

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
    const { blocks, meanConfidence, deskewed } = await execOcr(tmpPath);
    return {
      text: blocks.map((block) => block.text).join('\n'),
      blocks,
      ms: Date.now() - started,
      engine: 'apple-vision',
      meanConfidence,
      deskewed,
    };
  } finally {
    await unlink(tmpPath).catch(() => {});
  }
}

type OcrOutput = { blocks?: OcrBlock[]; meanConfidence?: number; deskewed?: boolean };

function execOcr(path: string): Promise<{
  blocks: OcrBlock[];
  meanConfidence: number;
  deskewed: boolean;
}> {
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
        const parsed = JSON.parse(stdout) as OcrOutput;
        const blocks = parsed.blocks ?? [];
        const meanConfidence =
          typeof parsed.meanConfidence === 'number'
            ? parsed.meanConfidence
            : blocks.length
              ? blocks.reduce((sum, block) => sum + block.confidence, 0) / blocks.length
              : 0;
        resolve({ blocks, meanConfidence, deskewed: Boolean(parsed.deskewed) });
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
