import { auth, currentUser } from "@clerk/nextjs/server";
import { supabaseServer } from "@/lib/supabase/server";
import type { User } from "@/lib/db/types";

/**
 * On first sign-in we materialise a row in the `users` table so we have
 * a stable internal id to reference from `assignments`. Role defaults to
 * 'umpire'; admins promote to 'uic' / 'board' manually.
 */
export async function ensureCurrentUserRow(): Promise<User | null> {
  const { userId } = await auth();
  if (!userId) return null;

  const sb = supabaseServer();

  const existing = await sb
    .from("users")
    .select("*")
    .eq("clerk_user_id", userId)
    .maybeSingle();
  if (existing.data) return existing.data as User;

  const u = await currentUser();
  const email = u?.primaryEmailAddress?.emailAddress ?? null;
  const fullName =
    [u?.firstName, u?.lastName].filter(Boolean).join(" ") ||
    u?.username ||
    email ||
    "Umpire";

  // If a row already exists for this email (pre-seeded UIC, etc.), link to it
  // so we keep the role and any prior data. Compare case-insensitively.
  if (email) {
    const byEmail = await sb
      .from("users")
      .select("*")
      .ilike("email", email)
      .maybeSingle();
    if (byEmail.data) {
      const { data: linked, error: linkErr } = await sb
        .from("users")
        .update({
          clerk_user_id: userId,
          full_name: fullName,
          phone: u?.primaryPhoneNumber?.phoneNumber ?? byEmail.data.phone,
        })
        .eq("id", byEmail.data.id)
        .select("*")
        .single();
      if (linkErr) throw linkErr;
      return linked as User;
    }
  }

  const { data, error } = await sb
    .from("users")
    .insert({
      clerk_user_id: userId,
      full_name: fullName,
      email,
      phone: u?.primaryPhoneNumber?.phoneNumber ?? null,
      role: "umpire",
    })
    .select("*")
    .single();

  if (error) throw error;
  return data as User;
}
