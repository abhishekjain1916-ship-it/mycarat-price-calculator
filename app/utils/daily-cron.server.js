/**
 * INF-07 — Daily price cache rebuild
 *
 * Two triggers per day:
 *   • 10:00 AM IST (04:30 UTC) — after IBJA publishes morning gold rates
 *   • 2:05  PM IST (08:35 UTC) — after admin updates gold rates in the afternoon
 *
 * Each trigger runs: bulk rebuild → self-healing pass (fixes 0-delta products).
 * No dependencies — pure Node.js setTimeout.
 * Runs in-process on Fly.io (auto_stop_machines = false keeps the machine alive).
 */

import { supabase } from "../supabase.server";

let started = false;

export function startDailyCron() {
  if (started) return;
  started = true;

  scheduleTrigger("10:00 AM IST", msUntilNextUTC(4, 30));
  scheduleTrigger("2:05 PM IST",  msUntilNextUTC(8, 35));
}

function scheduleTrigger(label, delay) {
  const hh = Math.floor(delay / 3_600_000);
  const mm = Math.floor((delay % 3_600_000) / 60_000);
  console.log(`[DailyCron] ${label} trigger scheduled — fires in ${hh}h ${mm}m`);

  setTimeout(async function fire() {
    console.log(`[DailyCron] ${label} trigger firing...`);
    await runBulkRebuild(label);
    await healZeroDeltas();
    // Reschedule exactly 24 h later
    setTimeout(fire, 24 * 60 * 60 * 1000);
  }, delay);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function msUntilNextUTC(hour, minute) {
  const now  = new Date();
  const next = new Date();
  next.setUTCHours(hour, minute, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next - now;
}

async function runBulkRebuild(label) {
  console.log(`[DailyCron] Starting bulk rebuild (${label})...`);
  try {
    const secret  = process.env.RECALCULATE_SECRET;
    const headers = { "Content-Type": "application/json" };
    if (secret) headers["x-recalc-secret"] = secret;

    const res = await fetch("http://localhost:3000/api/recalculate-cache", {
      method:  "POST",
      headers,
      body:    JSON.stringify({ all: true, trigger: `cron_${label}` }),
    });

    if (res.ok) {
      const data = await res.json();
      console.log(`[DailyCron] Rebuild complete — ${data.products_processed} products, ${data.total_deltas} deltas`);
    } else {
      const text = await res.text();
      console.error("[DailyCron] Rebuild failed:", res.status, text.slice(0, 200));
    }
  } catch (err) {
    console.error("[DailyCron] Rebuild error:", err.message);
  }
}

// ── Self-healing: re-run recalc for any product with 0 cached deltas ─────────
// Catches products missed by the bulk pass and any whose cache was
// preserved-but-empty by the zero-delta guard.
async function healZeroDeltas() {
  try {
    const specTables = ["product_specs_metal", "product_specs_solitaires", "product_specs_diamonds", "product_specs_gemstones"];
    const allIdsSet = new Set();
    for (const table of specTables) {
      const { data } = await supabase.from(table).select("product_id").limit(10000);
      (data || []).forEach(r => allIdsSet.add(r.product_id));
    }

    const { data: cachedRows } = await supabase
      .from("product_delta_cache")
      .select("product_id")
      .limit(50000);
    const cachedIds = new Set((cachedRows || []).map(r => r.product_id));

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
          else console.warn(`[DailyCron] Self-heal: still 0 deltas for ${pid} (check admin data)`);
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
