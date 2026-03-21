/**
 * INF-07 — Daily price cache rebuild
 *
 * Fires once per day at 10:00 AM IST (04:30 UTC) — after IBJA publishes rates.
 * Calls the bulk recalculate endpoint the same way the admin button does.
 * No dependencies — pure Node.js setTimeout.
 * Runs in-process on Fly.io (auto_stop_machines = false keeps the machine alive).
 */

let started = false;

export function startDailyCron() {
  if (started) return;
  started = true;

  const delay = msUntilNext0430UTC();
  const hh = Math.floor(delay / 3_600_000);
  const mm = Math.floor((delay % 3_600_000) / 60_000);
  console.log(`[DailyCron] Scheduled — next rebuild in ${hh}h ${mm}m (10:00 AM IST)`);

  setTimeout(function fire() {
    runBulkRebuild();
    // Schedule next run exactly 24 hours later
    setTimeout(fire, 24 * 60 * 60 * 1000);
  }, delay);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function msUntilNext0430UTC() {
  const now  = new Date();
  const next = new Date();
  next.setUTCHours(4, 30, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next - now;
}

async function runBulkRebuild() {
  console.log("[DailyCron] Starting daily price cache rebuild...");
  try {
    const secret  = process.env.RECALCULATE_SECRET;
    const headers = { "Content-Type": "application/json" };
    if (secret) headers["x-recalc-secret"] = secret;

    const res = await fetch("http://localhost:3000/api/recalculate-cache", {
      method:  "POST",
      headers,
      body:    JSON.stringify({ all: true, trigger: "daily_cron" }),
    });

    if (res.ok) {
      const data = await res.json();
      console.log(
        `[DailyCron] Rebuild complete — ${data.products_processed} products, ${data.total_deltas} deltas`
      );
    } else {
      const text = await res.text();
      console.error("[DailyCron] Rebuild failed:", res.status, text.slice(0, 200));
    }
  } catch (err) {
    console.error("[DailyCron] Rebuild error:", err.message);
  }
}
