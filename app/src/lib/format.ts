export function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

export function formatTime(value: string | null | undefined): string {
  const date = parseDate(value);
  if (!date) return '';
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours < 12 ? '오전' : '오후';
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return minutes ? `${ampm} ${hour12}:${String(minutes).padStart(2, '0')}` : `${ampm} ${hour12}시`;
}

export function formatDate(value: string | null | undefined): string {
  const date = parseDate(value);
  if (!date) return '날짜 없음';
  return `${date.getMonth() + 1}월 ${date.getDate()}일 (${WEEKDAYS[date.getDay()]})`;
}

export function formatDateFull(value: string | null | undefined): string {
  const date = parseDate(value);
  if (!date) return '날짜 없음';
  return `${date.getFullYear()}년 ${formatDate(value)}`;
}

export function dateKey(value: string | null | undefined): string {
  const date = parseDate(value);
  if (!date) return 'none';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function relativeDay(value: string | null | undefined): string {
  const date = parseDate(value);
  if (!date) return '날짜 미정';
  const today = startOfDay(new Date());
  const target = startOfDay(date);
  const days = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  if (days === 0) return '오늘';
  if (days === 1) return '내일';
  if (days === 2) return '모레';
  if (days === -1) return '어제';
  if (days > 2 && days < 7) return `${days}일 뒤`;
  return formatDate(value);
}

export function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function endOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

export function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0KB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function formatRelativeTime(timestamp: number | null): string {
  if (!timestamp) return '아직 없음';
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return '방금 전';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}시간 전`;
  return `${Math.floor(diff / 86_400_000)}일 전`;
}

export function toLocalInput(value: string | null | undefined): string {
  const date = parseDate(value);
  if (!date) return '';
  const pad = (num: number) => String(num).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fromLocalInput(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(' ', 'T');
  const date = new Date(normalized.length === 10 ? `${normalized}T00:00:00` : normalized);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}
