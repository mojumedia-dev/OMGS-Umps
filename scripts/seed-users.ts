// Seed 10 placeholder umpires + 1 UIC.
// Real Clerk users link by replacing the clerk_user_id later.
// Run: npx tsx scripts/seed-users.ts
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

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

const seeds = [
  { clerk_user_id: "placeholder_uic_1", role: "uic" as const, full_name: "UIC Placeholder", email: "uic@example.com", phone: "+15555550100" },
  { clerk_user_id: "placeholder_ump_1", role: "umpire" as const, full_name: "Umpire One", email: "ump1@example.com", phone: "+15555550101" },
  { clerk_user_id: "placeholder_ump_2", role: "umpire" as const, full_name: "Umpire Two", email: "ump2@example.com", phone: "+15555550102" },
  { clerk_user_id: "placeholder_ump_3", role: "umpire" as const, full_name: "Umpire Three", email: "ump3@example.com", phone: "+15555550103" },
  { clerk_user_id: "placeholder_ump_4", role: "umpire" as const, full_name: "Umpire Four", email: "ump4@example.com", phone: "+15555550104" },
  { clerk_user_id: "placeholder_ump_5", role: "umpire" as const, full_name: "Umpire Five", email: "ump5@example.com", phone: "+15555550105" },
  { clerk_user_id: "placeholder_ump_6", role: "umpire" as const, full_name: "Umpire Six", email: "ump6@example.com", phone: "+15555550106" },
  { clerk_user_id: "placeholder_ump_7", role: "umpire" as const, full_name: "Umpire Seven", email: "ump7@example.com", phone: "+15555550107" },
  { clerk_user_id: "placeholder_ump_8", role: "umpire" as const, full_name: "Umpire Eight", email: "ump8@example.com", phone: "+15555550108" },
  { clerk_user_id: "placeholder_ump_9", role: "umpire" as const, full_name: "Umpire Nine", email: "ump9@example.com", phone: "+15555550109" },
  { clerk_user_id: "placeholder_ump_10", role: "umpire" as const, full_name: "Umpire Ten", email: "ump10@example.com", phone: "+15555550110" },
];

async function main() {
  const { data, error } = await sb
    .from("users")
    .upsert(seeds, { onConflict: "clerk_user_id" })
    .select("id, clerk_user_id, role, full_name");

  if (error) {
    console.error("Seed failed:", error);
    process.exit(1);
  }

  console.log(`Seeded ${data?.length} users:`);
  for (const u of data ?? []) console.log(" ", u.role.padEnd(7), u.full_name);
}

main();
