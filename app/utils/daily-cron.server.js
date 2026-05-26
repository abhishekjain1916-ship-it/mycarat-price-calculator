/**
 * INF-07 — Daily price cache rebuild
 *
 * Fires once per day at 10:00 AM IST (04:30 UTC) — after IBJA publishes rates.
 * Calls the bulk recalculate endpoint the same way the admin button does.
 * No dependencies — pure Node.js setTimeout.
 * Runs in-process on Fly.io (auto_stop_machines = false keeps the machine alive).
 */

import { supabase } from "../supabase.server";

let started = false;

export function startDailyCron() {
  if (started) return;
  started = true;

  const delay = msUntilNext0430UTC();
  const hh = Math.floor(delay / 3_600_000);
  const mm = Math.floor((delay % 3_600_000) / 60_000);
  console.log(`[DailyCron] Scheduled — next rebuild in ${hh}h ${mm}m (10:00 AM IST)`);

  setTimeout(async function fire() {
    await runBulkRebuild();
    // Self-healing pass: find and fix any products that still have 0 deltas after bulk rebuild
    await healZeroDeltas();
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

// ── Self-healing: re-run recalc for any product with 0 cached deltas ─────────
// Catches products missed by the bulk pass (not in product_specs_metal) and any
// whose cache was preserved-but-empty by the zero-delta guard.
async function healZeroDeltas() {
  try {
    // Collect all product IDs from every spec table
    const specTables = ["product_specs_metal", "product_specs_solitaires", "product_specs_diamonds", "product_specs_gemstones"];
    const allIdsSet = new Set();
    for (const table of specTables) {
      const { data } = await supabase.from(table).select("product_id").limit(10000);
      (data || []).forEach(r => allIdsSet.add(r.product_id));
    }

    // Find which products have at least one delta row
    const { data: cachedRows } = await supabase
      .from("product_delta_cache")
      .select("product_id")
      .limit(50000);
    const cachedIds = new Set((cachedRows || []).map(r => r.product_id));

    // Products with no cached deltas at all
    const missing = [...allIdsSet].filter(id => !cachedIds.has(id));
    if (missing.length === 0) {
      console.log("[DailyCron] Self-heal: all products have cached deltas ✓");
      return;
    }

    console.log(`[DailyCron] Self-heal: ${missing.length} products with 0 deltas — re-running recalc`);
    const secret  = process.env.RECALCULATE_SECRET;
    const headers = { "Content-Type": "application/json" };
    if (secret) headers["x-recalc-secret"] = secret;

    let fixed = 0;
    for (const pid of missing) {
      try {
        const res = await fetch("http://localhost:3000/api/recalculate-cache", {
          method: "POST",
          headers,
          body: JSON.stringify({ product_id: pid, trigger: "heal" }),
        });
        if (res.ok) {
          const d = await res.json();
          if (d.deltas_calculated > 0) fixed++;
          else console.warn(`[DailyCron] Self-heal: still 0 deltas for ${pid}`);
        }
      } catch (e) {
        console.error(`[DailyCron] Self-heal error for ${pid}:`, e.message);
      }
    }
    console.log(`[DailyCron] Self-heal complete — ${fixed}/${missing.length} products fixed`);
  } catch (err) {
    console.error("[DailyCron] Self-heal error:", err.message);
  }
}
