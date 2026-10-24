import { config } from '../config.ts';

export type OllamaHealth = { ok: boolean; model: string; models: string[]; error?: string };

type GenerateResponse = {
  response?: string;
  thinking?: string;
  error?: string;
  done_reason?: string;
};

export async function ollamaHealth(): Promise<OllamaHealth> {
  try {
    const res = await fetch(`${config.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    const models = (data.models ?? []).map((model) => model.name);
    return { ok: models.includes(config.ollamaModel), model: config.ollamaModel, models };
  } catch (error) {
    return { ok: false, model: config.ollamaModel, models: [], error: (error as Error).message };
  }
}

/**
 * Extract JSON with the local model.
 *
 * `think: false` matters a lot: gemma4 is a reasoning model, and with thinking
 * enabled it spends the whole `num_predict` budget on its scratchpad and
 * returns an empty `response` (which looked like "AI 응답을 해석하지 못했습니다").
 * Disabling it is both faster (~12s vs ~26s) and more accurate.
 */
export async function generateJson(input: {
  prompt: string;
  system: string;
  model?: string;
  timeoutMs?: number;
}): Promise<{ raw: string; model: string; ms: number }> {
  const model = input.model ?? config.ollamaModel;
  const started = Date.now();

  let data: GenerateResponse;
  try {
    data = await call(model, input, false);
  } catch (error) {
    // Older Ollama builds do not know the `think` field at all.
    if (error instanceof Error && /think/i.test(error.message)) {
      data = await call(model, input, undefined);
    } else {
      throw error;
    }
  }

  const raw = (data.response ?? '').trim();
  if (!raw) {
    const hint = data.thinking?.trim()
      ? '모델이 답을 작성하기 전에 출력 한도에 걸렸습니다.'
      : '빈 응답을 받았습니다.';
    throw new Error(`${hint} 잠시 후 다시 시도해 주세요.`);
  }

  return { raw, model, ms: Date.now() - started };
}

async function call(
  model: string,
  input: { prompt: string; system: string; timeoutMs?: number },
  think: boolean | undefined,
): Promise<GenerateResponse> {
  const res = await fetch(`${config.ollamaUrl}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt: input.prompt,
      system: input.system,
      stream: false,
      format: 'json',
      ...(think === undefined ? {} : { think }),
      options: {
        temperature: 0.1,
        top_p: 0.9,
        num_ctx: 8192,
        num_predict: 1500,
      },
      keep_alive: '30m',
    }),
    signal: AbortSignal.timeout(input.timeoutMs ?? 180_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Ollama HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = (await res.json()) as GenerateResponse;
  if (data.error) throw new Error(`Ollama: ${data.error}`);
  return data;
}
