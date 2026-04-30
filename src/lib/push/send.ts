import "server-only";
import webpush from "web-push";
import { supabaseServer } from "@/lib/supabase/server";

let configured = false;
function configure() {
  if (configured) return;
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@example.com";
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) {
    console.warn("VAPID keys missing — push notifications disabled");
    return;
  }
  webpush.setVapidDetails(subject, pub, priv);
  configured = true;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

/**
 * Send a push notification to every device a user has subscribed.
 * Removes subscriptions that 404/410 (browser unsubscribed).
 * Never throws — failures are logged so the caller's primary action keeps going.
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload
): Promise<void> {
  configure();
  if (!process.env.VAPID_PRIVATE_KEY) return;

  const sb = supabaseServer();
  const { data: subs } = await sb
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId);
  if (!subs?.length) return;

  const json = JSON.stringify(payload);

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          json,
          { TTL: 60 * 60 * 24 }
        );
        await sb
          .from("push_subscriptions")
          .update({ last_used_at: new Date().toISOString() })
          .eq("id", s.id);
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await sb.from("push_subscriptions").delete().eq("id", s.id);
        } else {
          console.error("Push failed", { userId, status, err: (e as Error).message });
        }
      }
    })
  );
}
