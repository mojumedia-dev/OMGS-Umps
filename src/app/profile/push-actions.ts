"use server";

import { revalidatePath } from "next/cache";
import { ensureCurrentUserRow } from "@/lib/users";
import { supabaseServer } from "@/lib/supabase/server";

export async function savePushSubscription(input: {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string;
}): Promise<void> {
  const user = await ensureCurrentUserRow();
  if (!user) throw new Error("Not signed in");

  const sb = supabaseServer();
  const { error } = await sb.from("push_subscriptions").upsert(
    {
      user_id: user.id,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      user_agent: input.userAgent ?? null,
      last_used_at: new Date().toISOString(),
    },
    { onConflict: "endpoint" }
  );
  if (error) throw error;

  revalidatePath("/profile");
}

export async function removePushSubscription(endpoint: string): Promise<void> {
  const user = await ensureCurrentUserRow();
  if (!user) throw new Error("Not signed in");

  const sb = supabaseServer();
  await sb
    .from("push_subscriptions")
    .delete()
    .eq("user_id", user.id)
    .eq("endpoint", endpoint);

  revalidatePath("/profile");
}
