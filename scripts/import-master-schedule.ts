// One-time import of the OMGS master schedule into Supabase.
// Run: npx tsx scripts/import-master-schedule.ts <path-to-xlsx>
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { parseScheduleWorkbook } from "../src/lib/importer/xlsx";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n").filter(Boolean)) {
  if (line.startsWith("#")) continue;
  const i = line.indexOf("=");
  if (i > 0) process.env[line.slice(0, i).trim()] ??= line.slice(i + 1).trim();
}

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: tsx scripts/import-master-schedule.ts <xlsx>");
    process.exit(1);
  }
  const buf = fs.readFileSync(path);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const { games, warnings } = parseScheduleWorkbook(ab as ArrayBuffer);
  console.log(`Parsed ${games.length} games (${warnings.length} warnings)`);

  // Pull divisions to know default ump_slots and pay_per_slot
  const { data: divisions, error: divErr } = await sb.from("divisions").select("*");
  if (divErr || !divisions) throw divErr ?? new Error("No divisions");
  const divByCode = Object.fromEntries(divisions.map((d) => [d.code, d]));

  // Find UIC for the import_batch.uploaded_by reference
  const { data: uic } = await sb
    .from("users")
    .select("id")
    .eq("role", "uic")
    .limit(1)
    .single();

  // Create import batch
  const { data: batch, error: batchErr } = await sb
    .from("import_batches")
    .insert({
      filename: path.split(/[\\/]/).pop() ?? "schedule.xlsx",
      uploaded_by: uic?.id ?? null,
      games_created: 0,
      notes: warnings.length ? warnings.slice(0, 50).join("\n") : null,
    })
    .select("id")
    .single();
  if (batchErr || !batch) throw batchErr ?? new Error("No batch");

  const rows = games.map((g) => {
    const d = divByCode[g.division_code];
    return {
      division_code: g.division_code,
      team_home: g.team_home,
      team_away: g.team_away,
      field: g.field,
      starts_at: g.starts_at,
      ends_at: g.ends_at,
      ump_slots: g.is_tournament ? d.tournament_ump_slots : d.default_ump_slots,
      pay_per_slot: g.is_tournament ? d.tournament_pay_per_slot : d.default_pay_per_slot,
      is_tournament: g.is_tournament,
      status: "open" as const,
      import_batch_id: batch.id,
    };
  });

  // Insert in chunks of 100
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    const { error } = await sb.from("games").insert(chunk);
    if (error) throw error;
    inserted += chunk.length;
  }

  await sb.from("import_batches").update({ games_created: inserted }).eq("id", batch.id);
  console.log(`Inserted ${inserted} games (batch ${batch.id})`);
}

main().catch((e) => {
  console.error("Import failed:", e);
  process.exit(1);
});
