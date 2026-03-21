import { supabase } from "../supabase.server";

let started = false;
let processedCount = 0;
let lastJobAt = null;

export function startRecalcWorker() {
  if (started) return;
  started = true;
  console.log("[RecalcWorker] Started — polling every 1s");
  setInterval(processNextJob, 1000);
  setInterval(heartbeat, 60000);
}

async function heartbeat() {
  const { count } = await supabase
    .from("recalc_queue")
    .select("*", { count: "exact", head: true })
    .eq("status", "pending");
  const idleSince = lastJobAt
    ? `last job ${Math.round((Date.now() - lastJobAt) / 1000)}s ago`
    : "no jobs processed this session";
  console.log(
    `[RecalcWorker] Heartbeat — pending: ${count ?? "?"}, processed this session: ${processedCount}, ${idleSince}`
  );
}

async function processNextJob() {
  try {
    // Pick the highest-priority pending job, then oldest first
    // Falls back to FIFO if priority column doesn't exist yet
    let { data: jobs, error: jobsError } = await supabase
      .from("recalc_queue")
      .select("id, product_id")
      .eq("status", "pending")
      .order("priority", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(1);
    if (jobsError) {
      // priority column not yet added — fall back to FIFO
      ({ data: jobs } = await supabase
        .from("recalc_queue")
        .select("id, product_id")
        .eq("status", "pending")
        .order("created_at", { ascending: true })
        .limit(1));
    }

    const job = jobs?.[0];
    if (!job) return;

    // Mark as processing (optimistic lock — only update if still pending)
    const { count } = await supabase
      .from("recalc_queue")
      .update({ status: "processing", attempted_at: new Date().toISOString() })
      .eq("id", job.id)
      .eq("status", "pending");

    if (count === 0) return; // Another worker claimed it (future-proofing)

    console.log(`[RecalcWorker] Processing: ${job.product_id}`);

    const headers = { "Content-Type": "application/json" };
    if (process.env.RECALCULATE_SECRET) {
      headers["x-recalc-secret"] = process.env.RECALCULATE_SECRET;
    }
    const res = await fetch("http://localhost:3000/api/recalculate-cache", {
      method: "POST",
      headers,
      body: JSON.stringify({ product_id: job.product_id, trigger: "queue" }),
    });

    if (res.ok) {
      await supabase
        .from("recalc_queue")
        .update({ status: "done", completed_at: new Date().toISOString() })
        .eq("id", job.id);
      processedCount++;
      lastJobAt = Date.now();
      console.log(`[RecalcWorker] Done: ${job.product_id}`);
    } else {
      const errText = await res.text();
      await supabase
        .from("recalc_queue")
        .update({ status: "failed", error: errText.slice(0, 500) })
        .eq("id", job.id);
      console.error(`[RecalcWorker] Failed: ${job.product_id}`, errText);
    }
  } catch (e) {
    console.error("[RecalcWorker] Error:", e.message);
  }
}
