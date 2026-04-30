import * as XLSX from "xlsx";
import type { DivisionCode } from "@/lib/db/types";

export interface ParsedGame {
  division_code: DivisionCode;
  team_home: string;
  team_away: string;
  field: string;
  starts_at: string; // ISO
  ends_at: string;   // ISO
  is_tournament: boolean;
  source_row: number;
}

export interface ParseResult {
  games: ParsedGame[];
  warnings: string[];
}

/**
 * OMGS schedule layout: weeks stacked vertically. Each week block has
 *   row N:   day-of-week dates (e.g. "2026-04-06" in column 2 = Monday)
 *   row N+1+: 5-col blocks per day → [team1, team2, start, end, field]
 * Sunday occupies column 1 (rarely populated).
 */
const DAY_OFFSETS = [
  { day: "Sun", colStart: 1, colCount: 1 },
  { day: "Mon", colStart: 2, colCount: 5 },
  { day: "Tue", colStart: 7, colCount: 5 },
  { day: "Wed", colStart: 12, colCount: 5 },
  { day: "Thu", colStart: 17, colCount: 5 },
  { day: "Fri", colStart: 22, colCount: 5 },
  { day: "Sat", colStart: 27, colCount: 5 },
];

const TEAM_RE = /^(\d{1,2})\.\d+\s+(.*)$/;

function toDivCode(num: string): DivisionCode | null {
  const code = `${num}U` as DivisionCode;
  if (["8U", "10U", "12U", "14U", "16U", "18U"].includes(code)) return code;
  return null;
}

function combineDateAndTime(date: Date, time: string | Date | number): Date | null {
  if (!date) return null;
  // Date cells from xlsx are midnight UTC of the calendar date
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const d = date.getUTCDate();

  let hh = 0;
  let mm = 0;
  if (time instanceof Date) {
    // Time-only cells are stored as 1899-12-30 + time in *local* tz; getHours()
    // returns the wall-clock hour the user typed.
    hh = time.getHours();
    mm = time.getMinutes();
  } else if (typeof time === "string") {
    const match = time.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!match) return null;
    hh = +match[1];
    mm = +match[2];
  } else if (typeof time === "number") {
    const totalMin = Math.round(time * 24 * 60);
    hh = Math.floor(totalMin / 60);
    mm = totalMin % 60;
  } else {
    return null;
  }

  // Store the wall-clock time as a UTC timestamp (naive local-as-UTC).
  // The UI renders the same numbers — no tz math needed for display.
  return new Date(Date.UTC(y, m, d, hh, mm, 0, 0));
}

function parseTeam(cell: unknown): { div: DivisionCode; label: string } | null {
  if (typeof cell !== "string") return null;
  const m = cell.trim().match(TEAM_RE);
  if (!m) return null;
  const div = toDivCode(m[1]);
  if (!div) return null;
  return { div, label: cell.trim() };
}

export function parseScheduleWorkbook(buffer: ArrayBuffer): ParseResult {
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheet = wb.Sheets["Full Schedule"] ?? wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return { games: [], warnings: ["No sheets found"] };

  // Convert to 2D array (1-indexed by row in our walk, but 0-indexed here)
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    blankrows: true,
  });

  const games: ParsedGame[] = [];
  const warnings: string[] = [];

  // Walk rows looking for "date header" rows: a row where any of the day-block
  // anchor columns contains a Date.
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] || [];
    const dateByDay: Record<string, Date | null> = {};
    let hasDate = false;
    for (const off of DAY_OFFSETS) {
      const cell = row[off.colStart - 1];
      if (cell instanceof Date) {
        dateByDay[off.day] = cell;
        hasDate = true;
      } else {
        dateByDay[off.day] = null;
      }
    }
    if (!hasDate) continue;

    // Walk subsequent rows until we hit a blank row or another date row.
    for (let gr = r + 1; gr < rows.length; gr++) {
      const grow = rows[gr] || [];
      // Stop if this row has any new date cells
      const isNextDateRow = DAY_OFFSETS.some((off) => grow[off.colStart - 1] instanceof Date);
      if (isNextDateRow) break;

      // Skip non-game artifact rows (board duty, BBQ)
      const joined = grow.map((c) => (c == null ? "" : String(c))).join(" ").toLowerCase();
      if (joined.includes("bbq") || joined.includes("board duty") || joined.includes("snack shack")) continue;

      let producedAny = false;
      for (const off of DAY_OFFSETS) {
        if (off.colCount < 5) continue; // Sunday block is 1 col, no game data
        const date = dateByDay[off.day];
        if (!date) continue;

        const t1 = grow[off.colStart - 1];
        const t2 = grow[off.colStart];
        const start = grow[off.colStart + 1];
        const end = grow[off.colStart + 2];
        const field = grow[off.colStart + 3];

        const team1 = parseTeam(t1);
        const team2 = parseTeam(t2);
        if (!team1 || !team2) continue;
        if (team1.div !== team2.div) {
          warnings.push(`Row ${gr + 1} ${off.day}: division mismatch (${team1.div} vs ${team2.div})`);
          continue;
        }

        const startsAt = combineDateAndTime(date, start as Date | string | number);
        const endsAt = combineDateAndTime(date, end as Date | string | number);
        if (!startsAt || !endsAt) {
          warnings.push(`Row ${gr + 1} ${off.day}: bad time (${String(start)}–${String(end)})`);
          continue;
        }

        games.push({
          division_code: team1.div,
          team_home: team1.label,
          team_away: team2.label,
          field: typeof field === "string" ? field.trim() : String(field ?? ""),
          starts_at: startsAt.toISOString(),
          ends_at: endsAt.toISOString(),
          is_tournament: false,
          source_row: gr + 1,
        });
        producedAny = true;
      }
      // continue scanning the same week block — many weeks have multiple game rows
      void producedAny;
    }
  }

  return { games, warnings };
}
