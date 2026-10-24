import { access } from 'node:fs/promises';
import { config, dbPath } from '../src/config.ts';
import { ollamaHealth } from '../src/ai/ollama.ts';
import { currentRev, listDevices, firstFamily } from '../src/db.ts';

const checks: Array<{ name: string; ok: boolean; detail: string }> = [];

try {
  await access(config.ocrBin);
  checks.push({ name: 'OCR 바이너리', ok: true, detail: config.ocrBin });
} catch {
  checks.push({ name: 'OCR 바이너리', ok: false, detail: `없음 → ocr/build.sh 실행 (${config.ocrBin})` });
}

const ollama = await ollamaHealth();
checks.push({
  name: 'Ollama 모델',
  ok: ollama.ok,
  detail: ollama.ok ? ollama.model : `${ollama.model} 없음 / ${ollama.error ?? ''} → ollama pull ${ollama.model}`,
});

try {
  await access(dbPath());
  checks.push({ name: '데이터베이스', ok: true, detail: dbPath() });
} catch {
  checks.push({ name: '데이터베이스', ok: false, detail: '아직 없음 → npm run init' });
}

const family = firstFamily();
checks.push({ name: '가족', ok: Boolean(family), detail: family ? `${family.name} (${family.id})` : '없음 → npm run init' });

if (family) {
  const devices = listDevices(family.id);
  const approved = devices.filter((device) => device.status === 'approved');
  checks.push({
    name: '기기',
    ok: approved.length > 0,
    detail: `승인 ${approved.length}대 / 전체 ${devices.length}대`,
  });
}

console.log('\nfamily-hub doctor\n');
for (const check of checks) {
  console.log(`${check.ok ? '✓' : '✗'} ${check.name.padEnd(14)} ${check.detail}`);
}
console.log(`\n현재 rev: ${currentRev()}`);
console.log(`서버 주소: http://${config.host}:${config.port}\n`);

if (checks.some((check) => !check.ok)) process.exit(1);
