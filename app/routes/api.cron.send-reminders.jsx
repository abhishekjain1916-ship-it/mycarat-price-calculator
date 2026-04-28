/**
 * POST /api/cron/send-reminders
 *
 * External fallback for the in-process WA reminder cron. Hit this endpoint
 * every minute from any external scheduler (pg_cron, cron-job.org, GitHub
 * Actions, etc.) — secured via X-Cron-Secret header.
 *
 * The in-process cron in entry.server.jsx already handles this on the live
 * Fly machine; this route exists as a redundancy and for testing.
 */

import { dispatchDueReminders } from "../utils/wa-scheduler.server";

const CRON_SECRET = process.env.CRON_SECRET;

export const action = async ({ request }) => {
  if (!CRON_SECRET || request.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const result = await dispatchDueReminders();
  return new Response(JSON.stringify({ ok: true, ...result }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
