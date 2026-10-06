export interface BusinessCalendar {
  enabled: boolean;
  timezone: string;
  // index 0 is sunday. minutes from local midnight, null when closed
  week: ([number, number] | null)[];
  holidays: Set<string>; // YYYY-MM-DD, local
}

export const ALWAYS_OPEN: BusinessCalendar = { enabled: false, timezone: "UTC", week: [], holidays: new Set() };

const MINUTE = 60_000;
const MAX_DAYS = 730;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function parseHours(value: string): [number, number] | null {
  const m = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const start = Number(m[1]) * 60 + Number(m[2]);
  const end = Number(m[3]) * 60 + Number(m[4]);
  if (start >= end || end > 1440) return null;
  return [start, end];
}

function safeZone(tz: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

interface LocalDay {
  y: number;
  m: number;
  d: number;
  weekday: number;
}

function localParts(t: number, tz: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
  }).formatToParts(new Date(t));
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return {
    y: Number(p.year),
    m: Number(p.month),
    d: Number(p.day),
    h: Number(p.hour),
    min: Number(p.minute),
    s: Number(p.second),
    weekday: WEEKDAYS.indexOf(p.weekday),
  };
}

function offsetMs(t: number, tz: string): number {
  const p = localParts(t, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - (t - (t % 1000));
}

// utc time of a local wall clock time, twice to get the offset right around clock changes
function zonedTime(day: LocalDay, minuteOfDay: number, tz: string): number {
  const guess = Date.UTC(day.y, day.m - 1, day.d, 0, minuteOfDay);
  const first = guess - offsetMs(guess, tz);
  return guess - offsetMs(first, tz);
}

function dayOf(t: number, tz: string): LocalDay {
  const p = localParts(t, tz);
  return { y: p.y, m: p.m, d: p.d, weekday: p.weekday };
}

function nextDay(day: LocalDay): LocalDay {
  const n = new Date(Date.UTC(day.y, day.m - 1, day.d + 1));
  return { y: n.getUTCFullYear(), m: n.getUTCMonth() + 1, d: n.getUTCDate(), weekday: (day.weekday + 1) % 7 };
}

function key(day: LocalDay): string {
  return `${day.y}-${String(day.m).padStart(2, "0")}-${String(day.d).padStart(2, "0")}`;
}

function windowOf(cal: BusinessCalendar, day: LocalDay, tz: string): [number, number] | null {
  if (cal.holidays.has(key(day))) return null;
  const w = cal.week[day.weekday];
  return w ? [zonedTime(day, w[0], tz), zonedTime(day, w[1], tz)] : null;
}

export function addBusinessMinutes(start: Date, minutes: number, cal: BusinessCalendar): Date {
  if (!cal.enabled) return new Date(start.getTime() + minutes * MINUTE);
  const tz = safeZone(cal.timezone);
  let cursor = start.getTime();
  let left = minutes * MINUTE;
  let day = dayOf(cursor, tz);
  for (let i = 0; i < MAX_DAYS; i++) {
    const win = windowOf(cal, day, tz);
    if (win) {
      const from = Math.max(cursor, win[0]);
      if (from < win[1]) {
        if (from + left <= win[1]) return new Date(from + left);
        left -= win[1] - from;
      }
    }
    day = nextDay(day);
    cursor = zonedTime(day, 0, tz);
  }
  throw new Error("no business hours in the next two years");
}

export function businessMinutesBetween(from: Date, to: Date, cal: BusinessCalendar): number {
  const a = from.getTime();
  const b = to.getTime();
  if (b <= a) return 0;
  if (!cal.enabled) return Math.floor((b - a) / MINUTE);
  const tz = safeZone(cal.timezone);
  let total = 0;
  let day = dayOf(a, tz);
  for (let i = 0; i < MAX_DAYS; i++) {
    if (zonedTime(day, 0, tz) >= b) break;
    const win = windowOf(cal, day, tz);
    if (win) total += Math.max(0, Math.min(b, win[1]) - Math.max(a, win[0]));
    day = nextDay(day);
  }
  return Math.floor(total / MINUTE);
}
