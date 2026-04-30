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

/**
 * Normalise a US phone number to E.164 (+15551234567). Accepts free-form
 * input — strips non-digits, trims a leading 1, then prepends +1. Returns
 * null if the result isn't a valid 10-digit US number.
 */
function normalizeUsPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  const ten = digits.startsWith("1") && digits.length === 11 ? digits.slice(1) : digits;
  if (ten.length !== 10) return null;
  return `+1${ten}`;
}

export async function updateContact(formData: FormData): Promise<void> {
  const user = await ensureCurrentUserRow();
  if (!user) throw new Error("Not signed in");

  const phoneRaw = String(formData.get("phone") ?? "").trim();
  const fullName = String(formData.get("full_name") ?? "").trim();

  let phone: string | null = null;
  if (phoneRaw) {
    phone = normalizeUsPhone(phoneRaw);
    if (!phone) throw new Error("Phone must be a 10-digit US number");
  }

  const updates: { full_name?: string; phone?: string | null } = {};
  if (fullName) updates.full_name = fullName;
  updates.phone = phone;

  const sb = supabaseServer();
  const { error } = await sb.from("users").update(updates).eq("id", user.id);
  if (error) throw error;

  revalidatePath("/profile");
}
