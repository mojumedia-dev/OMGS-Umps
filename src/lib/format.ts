// Display helpers for game timestamps. Schedule times are stored as naive
// local-time-as-UTC (see importer/xlsx.ts), so we render the UTC components
// directly — no tz conversion.

export function formatGameDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function formatGameTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "UTC",
  });
}

export function formatGameDateKey(iso: string): string {
  // YYYY-MM-DD in UTC, used for grouping
  return iso.slice(0, 10);
}

export function formatMoney(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

/**
 * Game times are stored as Mountain wall-clock encoded into a UTC ISO
 * (see lib/importer/xlsx.ts). To compare "now" against a game start, we
 * need the same encoding for the present moment — current Mountain wall
 * clock formatted as if it were UTC.
 */
export function nowAsLeagueIso(): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Denver",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  const hour = map.hour === "24" ? "00" : map.hour;
  return `${map.year}-${map.month}-${map.day}T${hour}:${map.minute}:${map.second}.000Z`;
}
