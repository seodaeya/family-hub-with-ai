import { generateJson } from './ollama.ts';
import { runOcr } from './ocr.ts';
import { buildSystemPrompt, buildUserPrompt, kstNow } from './prompts.ts';

export type ExtractedEvent = {
  title: string;
  startsAt: string | null;
  endsAt: string | null;
  allDay: boolean;
  location: string | null;
  memo: string | null;
  confidence: number;
};

export type ExtractedItem = {
  listType: 'shopping' | 'supply' | 'todo';
  title: string;
  qty: string | null;
  dueAt: string | null;
  confidence: number;
};

export type ExtractResult = {
  ok: boolean;
  mode: 'image' | 'text';
  events: ExtractedEvent[];
  items: ExtractedItem[];
  warnings: string[];
  confidence: number;
  ocrText: string;
  meta: {
    ocrMs?: number;
    ocrConfidence?: number;
    deskewed?: boolean;
    llmMs: number;
    model: string;
    totalMs: number;
  };
};

const LIST_TYPES = new Set(['shopping', 'supply', 'todo']);
/** Below this the photo was usually too small, blurry or tilted to read reliably. */
const LOW_OCR_CONFIDENCE = 0.6;

export async function extract(input: {
  image?: Buffer;
  mimeType?: string;
  text?: string;
  hint?: string;
  model?: string;
}): Promise<ExtractResult> {
  const started = Date.now();
  let ocrText = (input.text ?? '').trim();
  let ocrMs: number | undefined;
  let ocrConfidence: number | undefined;
  let deskewed: boolean | undefined;
  const mode: 'image' | 'text' = input.image ? 'image' : 'text';

  if (input.image) {
    const ocr = await runOcr(input.image, input.mimeType);
    ocrMs = ocr.ms;
    ocrConfidence = ocr.meanConfidence;
    deskewed = ocr.deskewed;
    if (ocr.text.trim().length > ocrText.length) ocrText = ocr.text.trim();
  }

  const qualityWarnings: string[] = [];
  if (ocrConfidence !== undefined && ocrConfidence < LOW_OCR_CONFIDENCE) {
    qualityWarnings.push(
      '사진 글자가 흐려서 인식이 어렵습니다. 밝은 곳에서 다시 찍거나, 제미나이 공유 링크를 붙여넣어 주세요.',
    );
  }

  if (!ocrText) {
    return {
      ok: false,
      mode,
      events: [],
      items: [],
      warnings: [...qualityWarnings, '글자를 찾지 못했습니다. 사진을 다시 찍거나 직접 입력해 주세요.'],
      confidence: 0,
      ocrText: '',
      meta: { ocrMs, ocrConfidence, deskewed, llmMs: 0, model: '', totalMs: Date.now() - started },
    };
  }

  const llm = await generateJson({
    system: buildSystemPrompt(),
    prompt: buildUserPrompt(ocrText, input.hint),
    model: input.model,
  });

  const parsed = safeParse(llm.raw);
  if (!parsed) {
    return {
      ok: false,
      mode,
      events: [],
      items: [],
      warnings: [...qualityWarnings, 'AI 응답을 해석하지 못했습니다. 직접 확인해 주세요.'],
      confidence: 0,
      ocrText,
      meta: { ocrMs, ocrConfidence, deskewed, llmMs: llm.ms, model: llm.model, totalMs: Date.now() - started },
    };
  }

  const events = normalizeEvents(parsed.events);
  const items = normalizeItems(parsed.items);
  const warnings = [
    ...qualityWarnings,
    ...normalizeWarnings(parsed.warnings),
    ...dateWarnings(events, items),
  ];
  const confidence = averageConfidence(events, items);

  return {
    ok: events.length + items.length > 0,
    mode,
    events,
    items,
    warnings,
    confidence,
    ocrText,
    meta: { ocrMs, ocrConfidence, deskewed, llmMs: llm.ms, model: llm.model, totalMs: Date.now() - started },
  };
}

function safeParse(raw: string): { events?: unknown; items?: unknown; warnings?: unknown } | null {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();
  const candidates = [cleaned];
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(cleaned.slice(first, last + 1));

  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate);
      if (value && typeof value === 'object') return value;
    } catch {
      // try next
    }
  }
  return null;
}

function normalizeEvents(input: unknown): ExtractedEvent[] {
  if (!Array.isArray(input)) return [];
  const out: ExtractedEvent[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const title = String(row.title ?? '').trim();
    if (!title) continue;
    const allDay = Boolean(row.allDay) || !row.startsAt;
    out.push({
      title: title.slice(0, 60),
      startsAt: normalizeDate(row.startsAt),
      endsAt: normalizeDate(row.endsAt),
      allDay,
      location: row.location ? String(row.location).slice(0, 80) : null,
      memo: row.memo ? String(row.memo).slice(0, 200) : null,
      confidence: clamp(row.confidence, allDay ? 0.6 : 0.85),
    });
  }
  return out;
}

function normalizeItems(input: unknown): ExtractedItem[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: ExtractedItem[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const title = String(row.title ?? '').trim();
    if (!title) continue;
    const key = title.replace(/\s+/g, '').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const listType = String(row.listType ?? 'todo');
    out.push({
      listType: (LIST_TYPES.has(listType) ? listType : 'todo') as ExtractedItem['listType'],
      title: title.slice(0, 60),
      qty: row.qty ? String(row.qty).slice(0, 20) : null,
      dueAt: normalizeDate(row.dueAt),
      confidence: clamp(row.confidence, 0.8),
    });
  }
  return out;
}

function normalizeWarnings(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input.map((value) => String(value).slice(0, 120)).filter(Boolean).slice(0, 5);
}

function normalizeDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const text = value.trim();
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  // Return a stable ISO string in KST.
  return new Date(parsed.getTime() + 9 * 60 * 60 * 1000).toISOString().replace('Z', '+09:00');
}

function dateWarnings(events: ExtractedEvent[], items: ExtractedItem[]): string[] {
  const warnings: string[] = [];
  if (events.some((event) => !event.startsAt)) {
    warnings.push('날짜를 확정하지 못한 일정이 있습니다. 날짜를 직접 확인해 주세요.');
  }
  const today = kstNow().date;
  if (events.some((event) => event.startsAt && event.startsAt.slice(0, 10) < today)) {
    warnings.push('지난 날짜로 해석된 일정이 있습니다.');
  }
  if (items.some((item) => item.dueAt && item.dueAt.slice(0, 10) < today)) {
    warnings.push('지난 날짜로 해석된 마감이 있습니다.');
  }
  return warnings;
}

function averageConfidence(events: ExtractedEvent[], items: ExtractedItem[]): number {
  const values = [...events.map((event) => event.confidence), ...items.map((item) => item.confidence)];
  if (!values.length) return 0;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
}

function clamp(value: unknown, fallback: number): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(1, Math.max(0, Math.round(num * 100) / 100));
}
