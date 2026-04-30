"use server";

import { revalidatePath } from "next/cache";
import { ensureCurrentUserRow } from "@/lib/users";
import { supabaseServer } from "@/lib/supabase/server";
import type { DivisionCode } from "@/lib/db/types";

const ALL_DIVISIONS: DivisionCode[] = ["8U", "10U", "12U", "14U", "16U", "18U"];

export async function updateEligibility(formData: FormData): Promise<void> {
  const user = await ensureCurrentUserRow();
  if (!user) throw new Error("Not signed in");

  const selected = ALL_DIVISIONS.filter((d) => formData.get(`div_${d}`) === "on");

  const sb = supabaseServer();
  const { error } = await sb
    .from("users")
    .update({ eligible_divisions: selected })
    .eq("id", user.id);
  if (error) throw error;

  revalidatePath("/profile");
  revalidatePath("/games");
}
