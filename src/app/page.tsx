import Link from "next/link";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full bg-brand-100 px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-brand-700">
          <span className="inline-block h-2 w-2 rounded-full bg-lime-400" />
          Play Like A Girl
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight text-brand-800 sm:text-4xl">
          OMGS Umpire Scheduling
        </h1>
        <p className="mt-3 text-base text-zinc-600">
          Request games, see your schedule, get paid.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/sign-in"
            className="inline-flex h-11 items-center justify-center rounded-md bg-brand-600 px-6 text-sm font-bold text-white transition-colors hover:bg-brand-700"
          >
            Sign in
          </Link>
          <Link
            href="/games"
            className="inline-flex h-11 items-center justify-center rounded-md border-2 border-brand-200 bg-white px-6 text-sm font-bold text-brand-700 transition-colors hover:bg-brand-50"
          >
            View schedule
          </Link>
        </div>
      </div>
    </main>
  );
}
