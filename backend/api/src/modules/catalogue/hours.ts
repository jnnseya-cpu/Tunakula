/**
 * Opening hours. A weekly schedule keyed by weekday (0=Sunday) maps to a list of [open, close] HH:MM
 * windows in the branch's local time; `special` overrides a specific local date (an empty list closes
 * the day). An empty schedule means always open, so a branch with no hours set behaves as before.
 */
export type HourWindow = [string, string];
export type WeeklyHours = Record<string, HourWindow[]>;
export type SpecialHours = Record<string, HourWindow[]>;

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Validates and normalises a weekly schedule; throws a message on bad input. */
export function parseWeekly(value: unknown): WeeklyHours {
  if (value === null || typeof value !== "object") throw new Error("hours must be an object keyed by weekday 0–6");
  const out: WeeklyHours = {};
  for (const [day, windows] of Object.entries(value as Record<string, unknown>)) {
    if (!/^[0-6]$/.test(day)) throw new Error(`weekday "${day}" must be 0–6 (0=Sunday)`);
    out[day] = parseWindows(windows, `day ${day}`);
  }
  return out;
}

export function parseSpecial(value: unknown): SpecialHours {
  if (value === null || typeof value !== "object") throw new Error("special_hours must be an object keyed by YYYY-MM-DD");
  const out: SpecialHours = {};
  for (const [date, windows] of Object.entries(value as Record<string, unknown>)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`date "${date}" must be YYYY-MM-DD`);
    out[date] = parseWindows(windows, date);
  }
  return out;
}

function parseWindows(windows: unknown, where: string): HourWindow[] {
  if (!Array.isArray(windows)) throw new Error(`${where}: expected a list of [open, close] windows`);
  return windows.map((w) => {
    if (!Array.isArray(w) || w.length !== 2 || !HHMM.test(String(w[0])) || !HHMM.test(String(w[1]))) throw new Error(`${where}: each window is ["HH:MM","HH:MM"]`);
    if (String(w[0]) >= String(w[1])) throw new Error(`${where}: a window opens before it closes`);
    return [String(w[0]), String(w[1])] as HourWindow;
  });
}

/** Local weekday (0=Sunday) and HH:MM and YYYY-MM-DD for an instant in a time zone. */
function localParts(at: Date, timeZone: string): { weekday: number; hhmm: string; date: string } {
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", year: "numeric", month: "2-digit", day: "2-digit", hourCycle: "h23" });
  const parts = Object.fromEntries(fmt.formatToParts(at).map((p) => [p.type, p.value]));
  const days = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as Record<string, number>;
  return { weekday: days[parts.weekday as string] ?? 0, hhmm: `${parts.hour}:${parts.minute}`, date: `${parts.year}-${parts.month}-${parts.day}` };
}

/** Is the branch open at `at` given its schedule? Empty weekly schedule ⇒ always open. */
export function isOpenNow(hours: WeeklyHours, special: SpecialHours, at: Date, timeZone: string): boolean {
  const { weekday, hhmm, date } = localParts(at, timeZone);
  const windows = special[date] ?? hours[String(weekday)];
  if (windows === undefined) return Object.keys(hours).length === 0; // no schedule at all ⇒ always open; a day with no entry ⇒ closed
  return windows.some(([open, close]) => hhmm >= open && hhmm < close);
}
