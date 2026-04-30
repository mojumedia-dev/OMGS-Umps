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
