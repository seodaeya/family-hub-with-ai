// Compares local models on the same notice text: speed + extraction quality.
// usage: node scripts/bench.ts [image-path]
import { readFile } from 'node:fs/promises';
import { runOcr } from '../src/ai/ocr.ts';
import { buildSystemPrompt, buildUserPrompt } from '../src/ai/prompts.ts';
import { config } from '../src/config.ts';

const imagePath = process.argv[2] ?? '/tmp/sample_notice.png';
const image = await readFile(imagePath);
const ocr = await runOcr(image, 'image/png');

const models = process.argv.slice(3).length
  ? process.argv.slice(3)
  : [config.ollamaModel, 'gemma4:e4b'];

console.log(`OCR ${ocr.ms}ms · ${ocr.text.length}자`);
for (const model of models) {
  for (const run of [1, 2]) {
    const started = Date.now();
    const res = await fetch(`${config.ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        system: buildSystemPrompt(),
        prompt: buildUserPrompt(ocr.text),
        stream: false,
        format: 'json',
        options: { temperature: 0.1, num_ctx: 8192, num_predict: 2048 },
        keep_alive: '30m',
      }),
      signal: AbortSignal.timeout(300_000),
    });
    const data = (await res.json()) as any;
    const ms = Date.now() - started;
    let summary = 'parse-fail';
    try {
      const parsed = JSON.parse(data.response);
      summary = `${parsed.events?.length ?? 0} events / ${parsed.items?.length ?? 0} items`;
      if (run === 2) {
        console.log('  events:', parsed.events?.map((event: any) => `${event.title}@${event.startsAt}`).join(' | '));
        console.log('  items :', parsed.items?.map((item: any) => item.title).join(', '));
      }
    } catch {
      summary = String(data.response).slice(0, 80);
    }
    console.log(`${model} run${run}: ${ms}ms · ${summary} · eval ${data.eval_count ?? '?'} tok @ ${data.eval_duration ? Math.round((data.eval_count / (data.eval_duration / 1e9)) * 10) / 10 : '?'} tok/s`);
  }
}
