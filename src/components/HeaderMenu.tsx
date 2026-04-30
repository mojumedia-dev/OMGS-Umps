"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

export default function HeaderMenu({
  signedIn,
  showApprovals,
  showPayouts,
  showAudit,
  userButton,
}: {
  signedIn: boolean;
  showApprovals: boolean;
  showPayouts: boolean;
  showAudit: boolean;
  userButton: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  // Close on resize > sm
  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth >= 640) setOpen(false);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const linkCls = "block py-2 text-sm font-medium text-white/85 hover:text-white";
  const desktopLink =
    "hidden sm:inline font-medium text-white/85 hover:text-white";

  return (
    <>
      {/* Desktop nav */}
      <nav className="hidden items-center gap-4 text-sm sm:flex">
        <Link href="/games" className={desktopLink}>
          Schedule
        </Link>
        {signedIn && (
          <>
            <Link href="/dashboard" className={desktopLink}>
              My games
            </Link>
            {showApprovals && (
              <Link href="/uic" className={desktopLink}>
                Approvals
              </Link>
            )}
            {showPayouts && (
              <Link href="/uic/payouts" className={desktopLink}>
                Payouts
              </Link>
            )}
            {showAudit && (
              <Link href="/audit" className={desktopLink}>
                Audit
              </Link>
            )}
            <Link href="/profile" className={desktopLink}>
              Profile
            </Link>
            {userButton}
          </>
        )}
        {!signedIn && (
          <Link
            href="/sign-in"
            className="inline-flex h-8 items-center justify-center rounded-md bg-lime-400 px-3 text-xs font-bold text-brand-900 hover:bg-lime-500"
          >
            Sign in
          </Link>
        )}
      </nav>

      {/* Mobile: avatar + hamburger */}
      <div className="flex items-center gap-2 sm:hidden">
        {signedIn && userButton}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label="Menu"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-white/10 text-white hover:bg-white/20"
        >
          <span className="block h-0.5 w-4 bg-white before:absolute before:-mt-1.5 before:block before:h-0.5 before:w-4 before:bg-white after:absolute after:mt-1.5 after:block after:h-0.5 after:w-4 after:bg-white" />
        </button>
      </div>

      {open && (
        <div className="absolute inset-x-0 top-14 z-20 border-t border-brand-800 bg-brand-700 px-4 py-2 shadow-lg sm:hidden">
          <Link href="/games" className={linkCls} onClick={() => setOpen(false)}>
            Schedule
          </Link>
          {signedIn && (
            <>
              <Link href="/dashboard" className={linkCls} onClick={() => setOpen(false)}>
                My games
              </Link>
              {showApprovals && (
                <Link href="/uic" className={linkCls} onClick={() => setOpen(false)}>
                  Approvals
                </Link>
              )}
              {showPayouts && (
                <Link href="/uic/payouts" className={linkCls} onClick={() => setOpen(false)}>
                  Payouts
                </Link>
              )}
              {showAudit && (
                <Link href="/audit" className={linkCls} onClick={() => setOpen(false)}>
                  Audit
                </Link>
              )}
              <Link href="/profile" className={linkCls} onClick={() => setOpen(false)}>
                Profile
              </Link>
            </>
          )}
          {!signedIn && (
            <Link
              href="/sign-in"
              className={linkCls}
              onClick={() => setOpen(false)}
            >
              Sign in
            </Link>
          )}
        </div>
      )}
    </>
  );
}
