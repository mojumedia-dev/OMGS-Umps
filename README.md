# OMGS Umpire Scheduling

Web app for the OMGS softball league: umpires request games, the UIC approves, the league sees who's covering what.

## Stack

- Next.js 16 (App Router) + TypeScript + Tailwind v4
- Clerk for auth (umpire / uic / board / admin roles)
- Supabase Postgres (with RLS) for data
- Twilio for SMS confirmations + reminders
- Vercel for deployment

## MVP scope (Wk1–4)

| Week | Deliverable |
| --- | --- |
| 1 | Foundation: Next.js, Clerk, Supabase schema, Excel importer |
| 2 | UIC dashboard (calendar + game list), umpire "open games", request → approve flow |
| 3 | Twilio SMS, nightly cash payout tracking, CSV pay reports |
| 4 | Calendar polish, swap requests, mobile QA, deploy |

## Local setup

```bash
npm install
cp .env.local.example .env.local   # fill in keys
npm run dev
```

Then open http://localhost:3000.

## Importing the season schedule

```bash
npx tsx scripts/test-import.ts /path/to/SpringMaster.xlsx
```

The parser handles the master schedule format: weeks stacked vertically, day-of-week columns. Verified against `SpringMaster Schedule 2026.xlsx` — parses 258 games across 8U/10U/12U/14U/18U.

## Pay logic

| Division | Slots | Pay/slot |
| --- | --- | --- |
| 8U | 2 | $20 |
| 10U–18U | 1 | $50 |
| Tournament (any) | 2 | division rate |

Stored per-game in the `games` table so any individual game can be overridden without code changes.
