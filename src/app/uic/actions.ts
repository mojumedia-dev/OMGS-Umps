"use server";

import { revalidatePath } from "next/cache";
import { ensureCurrentUserRow } from "@/lib/users";
import { supabaseServer } from "@/lib/supabase/server";
import { refreshGameStatus } from "@/lib/db/game-status";
import { sendPushToUser } from "@/lib/push/send";

function formatGameSummary(g: {
  division_code: string;
  team_home: string;
  starts_at: string;
  field: string;
}): string {
  const d = new Date(g.starts_at);
  const day = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "UTC" });
  return `${g.division_code} · ${day} ${time} · ${g.field}`;
}

async function requireUic() {
  const user = await ensureCurrentUserRow();
  if (!user) throw new Error("Not signed in");
  if (user.role !== "uic" && user.role !== "admin")
    throw new Error("UIC access required");
  return user;
}

export async function approveRequest(formData: FormData): Promise<void> {
  const assignmentId = String(formData.get("assignmentId") ?? "");
  if (!assignmentId) throw new Error("Missing assignmentId");
  const uic = await requireUic();

  const sb = supabaseServer();
  const { data: a, error } = await sb
    .from("assignments")
    .update({
      status: "approved",
      approved_at: new Date().toISOString(),
      approved_by: uic.id,
    })
    .eq("id", assignmentId)
    .eq("status", "requested")
    .select(
      "game_id, umpire_id, game:games(division_code, team_home, team_away, field, starts_at)"
    )
    .single();
  if (error) throw error;
  if (a?.game_id) await refreshGameStatus(a.game_id);

  if (a?.umpire_id && a.game) {
    const g = a.game as unknown as {
      division_code: string;
      team_home: string;
      team_away: string;
      field: string;
      starts_at: string;
    };
    await sendPushToUser(a.umpire_id, {
      title: "Game approved ✅",
      body: formatGameSummary(g),
      url: "/dashboard",
      tag: `approved-${a.game_id}`,
    });
  }

  revalidatePath("/uic");
  revalidatePath("/games");
  revalidatePath("/dashboard");
}

export async function declineRequest(formData: FormData): Promise<void> {
  const assignmentId = String(formData.get("assignmentId") ?? "");
  if (!assignmentId) throw new Error("Missing assignmentId");
  await requireUic();

  const sb = supabaseServer();
  const { data: a, error } = await sb
    .from("assignments")
    .update({ status: "declined" })
    .eq("id", assignmentId)
    .eq("status", "requested")
    .select(
      "game_id, umpire_id, game:games(division_code, team_home, team_away, field, starts_at)"
    )
    .single();
  if (error) throw error;
  if (a?.game_id) await refreshGameStatus(a.game_id);

  if (a?.umpire_id && a.game) {
    const g = a.game as unknown as {
      division_code: string;
      team_home: string;
      team_away: string;
      field: string;
      starts_at: string;
    };
    await sendPushToUser(a.umpire_id, {
      title: "Request declined",
      body: formatGameSummary(g),
      url: "/games",
      tag: `declined-${a.game_id}`,
    });
  }

  revalidatePath("/uic");
  revalidatePath("/games");
}

export async function markPaid(formData: FormData): Promise<void> {
  const assignmentId = String(formData.get("assignmentId") ?? "");
  const amountRaw = String(formData.get("amount") ?? "");
  if (!assignmentId) throw new Error("Missing assignmentId");
  const amount = Number(amountRaw);
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Invalid amount");

  const uic = await requireUic();
  const sb = supabaseServer();
  const { data: a, error } = await sb
    .from("assignments")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
      paid_amount: amount,
      paid_by: uic.id,
    })
    .eq("id", assignmentId)
    .in("status", ["approved", "confirmed", "completed"])
    .select(
      "umpire_id, game_id, game:games(division_code, team_home, team_away, field, starts_at)"
    )
    .maybeSingle();
  if (error) throw error;

  if (a?.umpire_id && a.game) {
    const g = a.game as unknown as {
      division_code: string;
      team_home: string;
      team_away: string;
      field: string;
      starts_at: string;
    };
    await sendPushToUser(a.umpire_id, {
      title: `Paid $${amount} 💵`,
      body: formatGameSummary(g),
      url: "/dashboard",
      tag: `paid-${a.game_id}`,
    });
  }

  revalidatePath("/uic");
  revalidatePath("/uic/payouts");
  revalidatePath("/dashboard");
}

export async function undoPaid(formData: FormData): Promise<void> {
  const assignmentId = String(formData.get("assignmentId") ?? "");
  if (!assignmentId) throw new Error("Missing assignmentId");
  await requireUic();

  const sb = supabaseServer();
  const { error } = await sb
    .from("assignments")
    .update({
      status: "approved",
      paid_at: null,
      paid_amount: null,
      paid_by: null,
    })
    .eq("id", assignmentId)
    .eq("status", "paid");
  if (error) throw error;

  revalidatePath("/uic");
  revalidatePath("/uic/payouts");
  revalidatePath("/dashboard");
}
