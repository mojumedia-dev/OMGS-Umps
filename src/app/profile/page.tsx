import Link from "next/link";
import { redirect } from "next/navigation";
import { ensureCurrentUserRow } from "@/lib/users";
import { updateEligibility, updateContact } from "./actions";
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

        <form
          action={updateContact}
          className="mb-6 rounded-lg border border-zinc-200 bg-white p-5"
        >
          <h2 className="text-base font-bold text-brand-800">Contact info</h2>
          <p className="mt-1 text-sm text-zinc-600">
            Phone is required for SMS game confirmations.
          </p>
          <div className="mt-4 space-y-3">
            <label className="block">
              <span className="text-xs font-semibold text-zinc-700">Name</span>
              <input
                type="text"
                name="full_name"
                defaultValue={user.full_name}
                className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-200"
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-zinc-700">
                Phone <span className="text-zinc-400 font-normal">(US)</span>
              </span>
              <input
                type="tel"
                name="phone"
                inputMode="tel"
                autoComplete="tel"
                placeholder="(555) 555-1234"
                defaultValue={user.phone ?? ""}
                className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-200"
              />
            </label>
            <div className="flex items-center justify-between text-xs text-zinc-500">
              <span>Email: {user.email ?? "—"}</span>
              <span className="uppercase">Role: {user.role}</span>
            </div>
          </div>
          <button
            type="submit"
            className="mt-5 inline-flex h-10 items-center justify-center rounded-md bg-brand-600 px-4 text-sm font-bold text-white transition-colors hover:bg-brand-700"
          >
            Save contact
          </button>
        </form>

        {!user.phone && (
          <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            Add your phone number above so the UIC can text you game confirmations.
          </div>
        )}

        <form action={updateEligibility} className="rounded-lg border border-zinc-200 bg-white p-5">
          <h2 className="text-base font-bold text-brand-800">
            Eligible divisions
          </h2>
          <p className="mt-1 text-sm text-zinc-600">
            Tick every division you can umpire. You can only request games in
            divisions you&apos;ve selected here.
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
