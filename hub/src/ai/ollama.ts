import { config } from '../config.ts';

export type OllamaHealth = { ok: boolean; model: string; models: string[]; error?: string };

export async function ollamaHealth(): Promise<OllamaHealth> {
  try {
    const res = await fetch(`${config.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return { ok: false, model: config.ollamaModel, models: [], error: `HTTP ${res.status}` };
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    const models = (data.models ?? []).map((model) => model.name);
    return { ok: models.includes(config.ollamaModel), model: config.ollamaModel, models };
  } catch (error) {
    return { ok: false, model: config.ollamaModel, models: [], error: (error as Error).message };
  }
}

export async function generateJson(input: {
  prompt: string;
  system: string;
  model?: string;
  timeoutMs?: number;
}): Promise<{ raw: string; model: string; ms: number }> {
  const model = input.model ?? config.ollamaModel;
  const started = Date.now();
  const res = await fetch(`${config.ollamaUrl}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt: input.prompt,
      system: input.system,
      stream: false,
      format: 'json',
      options: {
        temperature: 0.1,
        top_p: 0.9,
        num_ctx: 8192,
        num_predict: 900,
      },
      keep_alive: '30m',
    }),
    signal: AbortSignal.timeout(input.timeoutMs ?? 180_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Ollama HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = (await res.json()) as { response?: string };
  return { raw: data.response ?? '', model, ms: Date.now() - started };
}
