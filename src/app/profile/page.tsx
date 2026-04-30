import Link from "next/link";
import { redirect } from "next/navigation";
import { ensureCurrentUserRow } from "@/lib/users";
import { updateEligibility } from "./actions";
import type { DivisionCode } from "@/lib/db/types";

export const dynamic = "force-dynamic";

const ALL_DIVISIONS: DivisionCode[] = ["8U", "10U", "12U", "14U", "16U", "18U"];

export default async function ProfilePage() {
  const user = await ensureCurrentUserRow();
  if (!user) redirect("/sign-in");

  const eligible = new Set(user.eligible_divisions ?? []);

  return (
    <main className="flex-1 px-4 py-8 sm:px-6">
      <div className="mx-auto w-full max-w-xl">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Profile
          </h1>
          <Link
            href="/dashboard"
            className="text-sm font-medium text-zinc-600 hover:text-zinc-900"
          >
            ← Dashboard
          </Link>
        </div>

        <section className="mb-6 rounded-lg border border-zinc-200 bg-white p-5">
          <h2 className="text-base font-bold text-brand-800">Account</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-zinc-500">Name</dt>
              <dd className="font-medium">{user.full_name}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-zinc-500">Email</dt>
              <dd className="font-medium">{user.email ?? "—"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-zinc-500">Phone</dt>
              <dd className="font-medium">{user.phone ?? "—"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-zinc-500">Role</dt>
              <dd className="font-medium uppercase">{user.role}</dd>
            </div>
          </dl>
        </section>

        <form action={updateEligibility} className="rounded-lg border border-zinc-200 bg-white p-5">
          <h2 className="text-base font-bold text-brand-800">
            Eligible divisions
          </h2>
          <p className="mt-1 text-sm text-zinc-600">
            Pick the divisions you can umpire. You won&apos;t be able to request
            games outside your selection.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {ALL_DIVISIONS.map((d) => {
              const checked = eligible.has(d);
              return (
                <label
                  key={d}
                  className={`flex cursor-pointer items-center justify-between rounded-md border px-3 py-2.5 text-sm font-semibold transition-colors ${
                    checked
                      ? "border-brand-600 bg-brand-50 text-brand-800"
                      : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300"
                  }`}
                >
                  <span>{d}</span>
                  <input
                    type="checkbox"
                    name={`div_${d}`}
                    defaultChecked={checked}
                    className="h-4 w-4 accent-brand-600"
                  />
                </label>
              );
            })}
          </div>
          <button
            type="submit"
            className="mt-5 inline-flex h-10 items-center justify-center rounded-md bg-brand-600 px-4 text-sm font-bold text-white transition-colors hover:bg-brand-700"
          >
            Save
          </button>
        </form>
      </div>
    </main>
  );
}
