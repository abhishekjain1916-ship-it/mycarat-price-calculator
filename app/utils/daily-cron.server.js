/**
 * INF-07 — Daily price cache rebuild
 *
 * Three triggers per day:
 *   • 10:00 AM IST (04:30 UTC) — after IBJA publishes morning gold rates
 *   • 2:00  PM IST (08:30 UTC) — fetch fresh Surat gold/silver rate (metal-rate-bot),
 *                                 then rebuild the price cache against it
 *
 * Each trigger runs: [rate fetch, 2 PM only] → bulk rebuild → self-healing pass
 * (fixes same-price products). No dependencies — pure Node.js setTimeout.
 * Runs in-process on Fly.io (auto_stop_machines = false keeps the machine alive),
 * which is why the rate fetch moved here from GitHub Actions — GH's free-tier
 * scheduled workflows can lag by hours, this fires at the exact minute.
 */

import { supabase } from "../supabase.server";
import { fetchAndSaveMetalRates } from "./metal-rate-bot.server";

let started = false;

export function startDailyCron() {
  if (started) return;
  started = true;

  scheduleTrigger("10:00 AM IST", msUntilNextUTC(4, 30), false);
  scheduleTrigger("2:00 PM IST",  msUntilNextUTC(8, 30), true);
}

function scheduleTrigger(label, delay, fetchRateFirst) {
  const hh = Math.floor(delay / 3_600_000);
  const mm = Math.floor((delay % 3_600_000) / 60_000);
  console.log(`[DailyCron] ${label} trigger scheduled — fires in ${hh}h ${mm}m`);

  setTimeout(async function fire() {
    console.log(`[DailyCron] ${label} trigger firing...`);
    if (fetchRateFirst) {
      try {
        await fetchAndSaveMetalRates();
      } catch (err) {
        console.error("[DailyCron] Metal rate fetch failed — rebuilding with last known rate:", err.message);
      }
    }
    await runBulkRebuild(label);
    await healSamePriceProducts();
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

// ── Self-healing: fix any product whose cached deltas would cause same tier prices ──
//
// "Same price" happens when a product has solitaire OR diamond specs in DB but
// its delta cache has NO non-zero solitaire_combined or diamond deltas.
// This catches products the bulk pass processed incorrectly (bulk preload race)
// as well as products with 0 total deltas.
async function healSamePriceProducts() {
  try {
    // Products that have solitaire or diamond specs (these MUST have non-zero upgrade deltas)
    const upgradableIds = new Set();
    for (const table of ["product_specs_solitaires", "product_specs_diamonds"]) {
      const { data } = await supabase.from(table).select("product_id").limit(10000);
      (data || []).forEach(r => upgradableIds.add(r.product_id));
    }

    if (upgradableIds.size === 0) {
      console.log("[DailyCron] Self-heal: no solitaire/diamond products found");
      return;
    }

    // Fetch all upgrade-relevant cached deltas (solitaire_combined + diamond, non-zero)
    const { data: upgDeltas } = await supabase
      .from("product_delta_cache")
      .select("product_id, component, delta_amount")
      .in("component", ["solitaire_combined", "diamond"])
      .neq("delta_amount", 0)
      .limit(100000);

    const hasUpgradeDelta = new Set((upgDeltas || []).map(r => r.product_id));

    // Products with specs but no valid upgrade delta in cache → same-price bug
    const broken = [...upgradableIds].filter(id => !hasUpgradeDelta.has(id));

    if (broken.length === 0) {
      console.log(`[DailyCron] Self-heal: all ${upgradableIds.size} solitaire/diamond products have correct tier prices ✓`);
      return;
    }

    console.log(`[DailyCron] Self-heal: ${broken.length} products with same-price issue — re-running individual recalc`);
    const secret  = process.env.RECALCULATE_SECRET;
    const headers = { "Content-Type": "application/json" };
    if (secret) headers["x-recalc-secret"] = secret;

    let fixed = 0;
    for (const pid of broken) {
      try {
        const res = await fetch("http://localhost:3000/api/recalculate-cache", {
          method: "POST",
          headers,
          body: JSON.stringify({ product_id: pid, trigger: "heal" }),
        });
        if (res.ok) {
          const d = await res.json();
          const hasUpgrade = (d.deltas || [])
            ? d.deltas_calculated > 0 && (d.deltas_combined > 0 || d.deltas_individual > 0)
            : false;
          if (d.deltas_calculated > 0) fixed++;
          else console.warn(`[DailyCron] Self-heal: still 0 deltas for ${pid} — check admin data`);
        }
      } catch (e) {
        console.error(`[DailyCron] Self-heal error for ${pid}:`, e.message);
      }
    }
    console.log(`[DailyCron] Self-heal complete — ${fixed}/${broken.length} products fixed`);
  } catch (err) {
    console.error("[DailyCron] Self-heal error:", err.message);
  }
}
