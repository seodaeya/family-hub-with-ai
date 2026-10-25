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
import { lookup } from 'node:dns/promises';
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

  // Reject other schemes explicitly: prefixing "ftp://…" with https: would
  // otherwise turn it into a nonsense host and a confusing fetch error.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) {
    throw new UrlImportError('http 또는 https 링크만 가져올 수 있습니다.');
  }

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

  let direct: { title: string; text: string; finalUrl: string } | null = null;
  try {
    direct = await tryFetch(url);
  } catch (error) {
    // A blocked internal address must not silently fall through to Chrome,
    // which would follow the same redirect.
    if (error instanceof UrlImportError) throw error;
    // Network/HTTP/content-type failures may still work in the JS renderer.
  }
  if (direct && direct.text.length >= MIN_USEFUL_TEXT) {
    return { url: url.toString(), title: direct.title, text: direct.text, via: 'fetch', ms: Date.now() - started };
  }

  // Start Chrome at the final, already-validated URL when the redirect chain
  // is known. This keeps a public URL from bouncing the browser into the LAN.
  const chromeTarget = direct?.finalUrl ? new URL(direct.finalUrl) : url;
  await assertPublicHost(chromeTarget);

  const rendered = await tryChrome(chromeTarget).catch((error: Error) => {
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

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;

/**
 * Fetch with manual redirects so every hop is re-checked against the private
 * host rules. `redirect: 'follow'` would let a public URL bounce straight to
 * 127.0.0.1 / 192.168.x.x after the initial validation.
 */
async function tryFetch(url: URL): Promise<{ title: string; text: string; finalUrl: string }> {
  let current = url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertPublicHost(current);

    const res = await fetch(current, {
      redirect: 'manual',
      headers: {
        'user-agent': USER_AGENT,
        'accept-language': 'ko-KR,ko;q=0.9,en;q=0.6',
        accept: 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (REDIRECT_STATUS.has(res.status)) {
      const location = res.headers.get('location');
      await res.body?.cancel().catch(() => {});
      if (!location) throw new UrlImportError('링크가 잘못된 주소로 이동합니다.');
      current = normalizeImportUrl(new URL(location, current).toString());
      continue;
    }

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const type = res.headers.get('content-type') ?? '';
    if (!/text\/html|application\/xhtml|text\/plain/i.test(type)) {
      throw new Error(`지원하지 않는 형식: ${type || '알 수 없음'}`);
    }

    const html = (await res.text()).slice(0, MAX_HTML_BYTES);
    return { title: extractTitle(html), text: htmlToText(html), finalUrl: current.toString() };
  }

  throw new UrlImportError('링크 이동이 너무 많습니다.');
}

/**
 * Resolves a hostname and rejects it when any address points into the LAN.
 * The literal check in normalizeImportUrl is not enough: a public-looking
 * domain can resolve to 127.0.0.1 (DNS rebinding is still a residual risk
 * between this lookup and the actual request).
 */
async function assertPublicHost(url: URL): Promise<void> {
  if (isPrivateHost(url.hostname)) {
    throw new UrlImportError('집 안의 주소(내부 IP)는 가져올 수 없습니다.');
  }
  if (isIpLiteral(url.hostname)) return;

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(url.hostname, { all: true, verbatim: true });
  } catch {
    throw new UrlImportError('링크의 주소를 확인하지 못했습니다. 공개 링크인지 확인해 주세요.');
  }
  if (!addresses.length) {
    throw new UrlImportError('링크의 주소를 확인하지 못했습니다. 공개 링크인지 확인해 주세요.');
  }
  for (const { address } of addresses) {
    if (isPrivateHost(address)) {
      throw new UrlImportError('집 안의 주소(내부 IP)는 가져올 수 없습니다.');
    }
  }
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

export function isPrivateHost(hostname: string): boolean {
  // URL keeps IPv6 brackets and may leave a trailing dot on a hostname.
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');

  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.home.arpa') ||
    host === 'metadata.google.internal'
  ) {
    return true;
  }

  if (host.includes(':')) {
    if (host === '::1' || host === '::') return true;
    if (/^f[cd][0-9a-f]{2}:/.test(host)) return true; // fc00::/7 unique local
    if (/^fe[89ab][0-9a-f]:/.test(host)) return true; // fe80::/10 link local
    if (/^fe[c-f][0-9a-f]:/.test(host)) return true; // fec0::/10 site local (deprecated)
    // IPv4-mapped IPv6 appears as ::ffff:7f00:1 in WHATWG URLs.
    const mapped = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
    if (mapped) {
      const hi = parseInt(mapped[1], 16);
      const lo = parseInt(mapped[2], 16);
      return isPrivateHost(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    return false;
  }

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

function isIpLiteral(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '');
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
}
