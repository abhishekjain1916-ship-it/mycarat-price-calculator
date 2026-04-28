/**
 * WhatsApp scheduler — in-process reminder dispatcher.
 *
 * Runs every 60 s. For each wa_schedules row whose scheduled_at is within
 * the next 15 min and reminder_sent_at IS NULL, sends the schedule_reminder
 * WA template and stamps reminder_sent_at.
 *
 * Started from entry.server.jsx (mirrors startDailyCron pattern).
 * Fly.io keeps the machine alive (auto_stop_machines = false).
 */

import { dispatchDueReminders } from "./wa-scheduler.server";

const TICK_MS = 60_000;

let started = false;

export function startWaReminderCron() {
  if (started) return;
  started = true;

  console.log("[WaReminderCron] started — ticks every 60s");

  setInterval(async () => {
    try {
      const { sent, errors } = await dispatchDueReminders();
      if (sent > 0 || errors > 0) {
        console.log(`[WaReminderCron] sent=${sent} errors=${errors}`);
      }
    } catch (err) {
      console.error("[WaReminderCron] tick failed:", err);
    }
  }, TICK_MS);
}
