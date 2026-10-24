/**
 * Import the text of a public web page (a Gemini share link, a school notice
 * page, a blog post…) when OCR is not good enough.
 *
 * Two stages:
 *   1. plain fetch + HTML → text (fast, works for server-rendered pages)
 *   2. headless Chrome `--dump-dom` (needed for Google/Gemini share pages,
 *      whose content is rendered by JavaScript)
 *
 * Nothing but the URL leaves the Mac. The page text is processed by the local
 * model exactly like OCR output.
 */
import { spawn } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MAX_HTML_BYTES = 5_000_000;
const MAX_TEXT = 20_000;
const FETCH_TIMEOUT_MS = 12_000;
const CHROME_TIMEOUT_MS = 30_000;
/** If a plain fetch yields less text than this, the page is probably JS-rendered. */
const MIN_USEFUL_TEXT = 240;

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export type UrlImport = {
  url: string;
  title: string;
  text: string;
  via: 'fetch' | 'chrome';
  ms: number;
};

const CHROME_CANDIDATES = [
  process.env.CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
].filter((value): value is string => Boolean(value));

export function normalizeImportUrl(raw: string): URL {
  const trimmed = raw.trim();
  if (!trimmed) throw new UrlImportError('링크를 입력해 주세요.');
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new UrlImportError('링크 형식이 올바르지 않습니다.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UrlImportError('http 또는 https 링크만 가져올 수 있습니다.');
  }
  // The hub is reachable on the LAN; do not let a link probe the home network.
  if (isPrivateHost(url.hostname)) {
    throw new UrlImportError('집 안의 주소(내부 IP)는 가져올 수 없습니다.');
  }
  return url;
}

export class UrlImportError extends Error {}

export async function importUrl(raw: string): Promise<UrlImport> {
  const started = Date.now();
  const url = normalizeImportUrl(raw);

  const direct = await tryFetch(url).catch(() => null);
  if (direct && direct.text.length >= MIN_USEFUL_TEXT) {
    return { url: url.toString(), title: direct.title, text: direct.text, via: 'fetch', ms: Date.now() - started };
  }

  const rendered = await tryChrome(url).catch((error: Error) => {
    // Prefer whatever the plain fetch found over a hard failure.
    if (direct && direct.text.length > 0) return null;
    throw new UrlImportError(
      `링크를 읽지 못했습니다. 공개 링크인지 확인해 주세요. (${error.message})`,
    );
  });

  const best = [rendered, direct]
    .filter((value): value is { title: string; text: string } => Boolean(value))
    .sort((a, b) => b.text.length - a.text.length)[0];

  if (!best || best.text.length === 0) {
    throw new UrlImportError('링크에서 읽을 글자를 찾지 못했습니다. 공개 링크인지 확인해 주세요.');
  }

  return {
    url: url.toString(),
    title: best.title,
    text: best.text,
    via: rendered ? 'chrome' : 'fetch',
    ms: Date.now() - started,
  };
}

async function tryFetch(url: URL): Promise<{ title: string; text: string }> {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: {
      'user-agent': USER_AGENT,
      'accept-language': 'ko-KR,ko;q=0.9,en;q=0.6',
      accept: 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const type = res.headers.get('content-type') ?? '';
  if (!/text\/html|application\/xhtml|text\/plain/i.test(type)) {
    throw new Error(`지원하지 않는 형식: ${type || '알 수 없음'}`);
  }

  const html = (await res.text()).slice(0, MAX_HTML_BYTES);
  return { title: extractTitle(html), text: htmlToText(html) };
}

async function tryChrome(url: URL): Promise<{ title: string; text: string }> {
  const bin = await findChrome();
  if (!bin) throw new Error('Chrome을 찾을 수 없습니다. CHROME_BIN을 지정해 주세요.');

  const profile = await mkdtemp(join(tmpdir(), 'family-hub-chrome-'));
  try {
    const html = await execChrome(bin, url, profile);
    const title = extractTitle(html);
    const text = htmlToText(html);
    if (!text) throw new Error('페이지에 글이 없습니다.');
    return { title, text };
  } finally {
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}

async function findChrome(): Promise<string | null> {
  for (const candidate of CHROME_CANDIDATES) {
    if (!candidate.includes('/')) return candidate; // bare command, let spawn resolve it
    try {
      await access(candidate);
      return candidate;
    } catch {
      // try next
    }
  }
  return null;
}

function execChrome(bin: string, url: URL, profile: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      bin,
      [
        '--headless=new',
        '--disable-gpu',
        '--hide-scrollbars',
        '--mute-audio',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-networking',
        '--disable-extensions',
        '--disable-sync',
        `--user-data-dir=${profile}`,
        '--virtual-time-budget=15000',
        '--dump-dom',
        url.toString(),
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), CHROME_TIMEOUT_MS);

    child.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length < MAX_HTML_BYTES) stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(new Error(error.message));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (!stdout.trim()) {
        reject(new Error(stderr.trim().split('\n')[0] || `Chrome 종료 코드 ${code}`));
        return;
      }
      resolve(stdout);
    });
  });
}

export function htmlToText(html: string): string {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(td|th)>/gi, ' | ')
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|header|footer|table)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');

  const text = decodeEntities(stripped)
    .replace(/[ \t\u00a0]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n');

  return cleanImportedText(text).slice(0, MAX_TEXT);
}

/** Drops the "JPG" chips Gemini puts after every image in a shared chat. */
function cleanImportedText(text: string): string {
  return text
    .replace(/\s*(?:JPG|PNG|JPEG)(?:\s*\+\s*\d+)?\s*(?=\n|$)/g, '')
    .replace(/^\s*\|\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeEntities(match[1]).replace(/\s+/g, ' ').trim().slice(0, 200) : '';
}

function decodeEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local') || host === 'metadata.google.internal') return true;
  if (host === '::1') return true;

  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!v4) return false;
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // Tailscale / CGNAT
  return false;
}
