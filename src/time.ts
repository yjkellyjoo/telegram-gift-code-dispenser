const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/;

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  zone: string;
}

function wallClock(at: number, tz: string): WallClock {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  }).formatToParts(new Date(at));
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? '';
  return {
    year: Number(part('year')),
    month: Number(part('month')),
    day: Number(part('day')),
    hour: Number(part('hour')),
    minute: Number(part('minute')),
    second: Number(part('second')),
    zone: part('timeZoneName'),
  };
}

export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Parses "YYYY-MM-DD HH:mm" as wall-clock time in `tz`. Returns UTC milliseconds, or null if malformed. */
export function parseLocalDateTime(text: string, tz: string): number | null {
  const match = LOCAL_DATE_TIME.exec(text);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [number, number, number, number, number];
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const check = new Date(wall);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    check.getUTCHours() !== hour ||
    check.getUTCMinutes() !== minute
  ) {
    return null;
  }
  const offset = (at: number): number => {
    const w = wallClock(at, tz);
    return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - Math.floor(at / 1000) * 1000;
  };
  return wall - offset(wall - offset(wall));
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** "2026-11-14 18:00 CET" */
export function formatDateTime(at: number, tz: string): string {
  const w = wallClock(at, tz);
  return `${w.year}-${pad(w.month)}-${pad(w.day)} ${pad(w.hour)}:${pad(w.minute)} ${w.zone}`;
}

/** "14:31:05" */
export function formatTime(at: number, tz: string): string {
  const w = wallClock(at, tz);
  return `${pad(w.hour)}:${pad(w.minute)}:${pad(w.second)}`;
}

/** "2026-12-14" */
export function formatDate(at: number, tz: string): string {
  const w = wallClock(at, tz);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}`;
}
