/**
 * Venmo deeplink helper. We use the universal venmo.com URL — on iOS/Android
 * with the app installed it opens the app prefilled; on desktop it opens the
 * web flow. Either way the recipient/amount/note are captured before the user
 * confirms send inside Venmo, so we never touch their credentials.
 */

export function normalizeVenmoHandle(raw: string): string | null {
  const trimmed = raw.trim().replace(/^@+/, "");
  if (!trimmed) return null;
  if (!/^[A-Za-z0-9_.-]{4,30}$/.test(trimmed)) return null;
  return trimmed;
}

export function buildVenmoPayUrl(opts: {
  handle: string;
  amount: number;
  note: string;
}): string {
  const params = new URLSearchParams({
    txn: "pay",
    audience: "private",
    recipients: opts.handle,
    amount: opts.amount.toFixed(2),
    note: opts.note,
  });
  return `https://venmo.com/?${params.toString()}`;
}
