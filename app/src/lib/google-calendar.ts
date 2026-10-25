import * as WebBrowser from 'expo-web-browser';
import { fromLocalInput, toLocalInput } from './format';

export type GoogleTemplateInput = {
  title: string;
  /** YYYY-MM-DD */
  date?: string | null;
  /** HH:mm */
  time?: string | null;
  /** ISO string */
  startsAt?: string | null;
  /** ISO string */
  endsAt?: string | null;
  allDay?: boolean;
  location?: string | null;
  memo?: string | null;
};

function addDaysYmdCompact(ymd: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!match) return ymd.replace(/-/g, '');
  const dt = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return dt.toISOString().slice(0, 10).replace(/-/g, '');
}

function toUtcCompact(iso: string): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export function buildGoogleCalendarTemplateUrl(input: GoogleTemplateInput): string {
  const title = input.title.trim() || '새 일정';
  const allDay = input.allDay ?? !input.time;

  let ymd = (input.date ?? '').trim();
  if (!ymd && input.startsAt) {
    ymd = toLocalInput(input.startsAt).slice(0, 10);
  }
  if (!ymd) {
    ymd = toLocalInput(new Date().toISOString()).slice(0, 10);
  }

  let dates = '';
  if (allDay) {
    const startCompact = addDaysYmdCompact(ymd, 0);
    const endCompact = addDaysYmdCompact(ymd, 1);
    dates = `${startCompact}/${endCompact}`;
  } else {
    const startIso =
      input.startsAt ?? fromLocalInput(`${ymd} ${input.time?.trim() || '09:00'}`) ?? new Date().toISOString();
    const startDate = new Date(startIso);
    const endDate = input.endsAt ? new Date(input.endsAt) : new Date(startDate.getTime() + 3600_000);
    dates = `${toUtcCompact(startDate.toISOString())}/${toUtcCompact(endDate.toISOString())}`;
  }

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates,
    ctz: 'Asia/Seoul',
  });
  if (input.location?.trim()) {
    params.set('location', input.location.trim());
  }
  if (input.memo?.trim()) {
    params.set('details', input.memo.trim());
  }

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export async function openGoogleCalendarTemplate(input: GoogleTemplateInput): Promise<void> {
  const url = buildGoogleCalendarTemplateUrl(input);
  await WebBrowser.openBrowserAsync(url);
}
