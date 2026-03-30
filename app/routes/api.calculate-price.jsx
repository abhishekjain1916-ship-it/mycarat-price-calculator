import { supabase } from "../supabase.server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Handles OPTIONS preflight request
export const loader = async ({ request }) => {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
};

// Logistics tier lookup — find row where min_value <= subtotal < max_value
function lookupLogistics(subtotal, tiers) {
  const tier = (tiers || []).find(
    (t) =>
      parseFloat(t.min_value) <= subtotal &&
      (t.max_value == null || subtotal < parseFloat(t.max_value))
  );
  return tier ? parseFloat(tier.logistics_charge) : 0;
}

export const action = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const body = await request.json();
  const {
    product_id,
    metal_purity,
    diamond_type,
    diamond_colour_clarity,
    solitaire_type,
    solitaire_colour,
    solitaire_clarity,
    solitaire_cut,
    solitaire_fluorescence,
    solitaire_certification,
    gemstone_type,
    gemstone_quality,
  } = body;

  const metalType = metal_purity
    ? metal_purity.includes("KT") ? "gold" : "silver"
    : null;
  // diamond_rates tables store "Lab Grown" not "Lab"
  const diamondTypeKey = diamond_type === "Lab" ? "Lab Grown" : diamond_type;
  const hasDiamonds = !!(diamond_type && diamond_colour_clarity);
  const hasSolitaires = !!(solitaire_type && solitaire_colour && solitaire_clarity);
  const hasGemstones = !!(gemstone_type && gemstone_quality);

  // ── Fetch everything in one parallel round-trip ────────────────────────────
  const [
    makingRatesResult,
    logisticsTiersResult,
    metalRateResult,
    metalSpecResult,
    diamondSpecsResult,
    solitaireSpecsResult,
    gemstoneSpecsResult,
    diamondRatesRoundResult,
    diamondRatesFancyResult,
    solitaireCoreRatesResult,
    solitaireModifiersResult,
    gemstoneRatesResult,
  ] = await Promise.all([
    supabase.from("making_charge_rates").select("*").eq("id", 1).single(),
    supabase.from("logistics_tiers").select("*").order("min_value", { ascending: true }),
    metalType
      ? supabase.from("metal_rates").select("rate_per_gram").eq("metal", metalType).order("fetched_at", { ascending: false }).limit(1).single()
      : Promise.resolve({ data: null }),
    metal_purity
      ? supabase.from("product_specs_metal").select("weight_grams, purity").eq("product_id", product_id).eq("purity", metal_purity).single()
      : Promise.resolve({ data: null }),
    hasDiamonds
      ? supabase.from("product_specs_diamonds").select("*").eq("product_id", product_id)
      : Promise.resolve({ data: [] }),
    hasSolitaires
      ? supabase.from("product_specs_solitaires").select("*").eq("product_id", product_id)
      : Promise.resolve({ data: [] }),
    hasGemstones
      ? supabase.from("product_specs_gemstones").select("*").eq("product_id", product_id)
      : Promise.resolve({ data: [] }),
    hasDiamonds
      ? supabase.from("diamond_rates_round").select("size_bucket, price_per_carat").eq("diamond_type", diamondTypeKey).eq("colour_clarity", diamond_colour_clarity)
      : Promise.resolve({ data: [] }),
    hasDiamonds
      ? supabase.from("diamond_rates_fancy").select("shape, size_bucket, price_per_carat").eq("diamond_type", diamondTypeKey).eq("colour_clarity", diamond_colour_clarity)
      : Promise.resolve({ data: [] }),
    hasSolitaires
      ? supabase.from("solitaire_rates_core").select("weight_range, price_per_carat").eq("diamond_type", solitaire_type).eq("colour", solitaire_colour).eq("clarity", solitaire_clarity)
      : Promise.resolve({ data: [] }),
    hasSolitaires
      ? supabase.from("solitaire_modifiers").select("modifier_type, modifier_value, modifier_pct")
      : Promise.resolve({ data: [] }),
    hasGemstones
      ? (gemstone_type === "Natural"
          ? supabase.from("gemstone_rates_natural").select("gemstone_name, size_bucket, price_per_carat").eq("quality", gemstone_quality)
          : supabase.from("gemstone_rates_synth_lab").select("gemstone_name, size_bucket, price_per_carat").eq("quality", gemstone_quality))
      : Promise.resolve({ data: [] }),
  ]);

  // ── Build in-memory lookup Maps ────────────────────────────────────────────
  const roundRatesMap = new Map(
    (diamondRatesRoundResult.data || []).map((r) => [r.size_bucket, parseFloat(r.price_per_carat)])
  );
  const fancyRatesMap = new Map(
    (diamondRatesFancyResult.data || []).map((r) => [`${r.shape}|${r.size_bucket}`, parseFloat(r.price_per_carat)])
  );
  const solitaireCoreMap = new Map(
    (solitaireCoreRatesResult.data || []).map((r) => [r.weight_range, parseFloat(r.price_per_carat)])
  );
  const modifiersMap = new Map(
    (solitaireModifiersResult.data || []).map((m) => [`${m.modifier_type}|${m.modifier_value}`, m.modifier_pct / 100])
  );
  const gemstoneRatesMap =
    new Map((gemstoneRatesResult.data || []).map((r) => [`${r.gemstone_name}|${r.size_bucket}`, parseFloat(r.price_per_carat)]));

  const makingRates = makingRatesResult.data || null;
  const logisticsTiers = logisticsTiersResult.data || [];

  const breakdown = { metal: null, diamonds: null, solitaires: null, gemstones: null, making: null };
  let total = 0;
  const errors = [];
  let metalMaterialCost = 0;
  let metalIsGold = false;
  let diamondCtTotal = 0;
  let solitaireCtTotal = 0;
  let gemstoneCtTotal = 0;

  // ── 1. METAL ──────────────────────────────────────────────────────────────
  if (metal_purity) {
    metalIsGold = metalType === "gold";
    const rateRow = metalRateResult.data;
    const metalSpec = metalSpecResult.data;

    if (!rateRow) {
      errors.push("Metal rate not found. Please update metal rates.");
    } else if (!metalSpec) {
      errors.push(`Metal spec not found for purity ${metal_purity}.`);
    } else {
      const purityNumber = parseInt(metal_purity);
      const ppg = metalType === "gold"
        ? parseFloat(rateRow.rate_per_gram) * (purityNumber / 24)
        : parseFloat(rateRow.rate_per_gram) * (purityNumber / 1000);
      const metalPrice = ppg * parseFloat(metalSpec.weight_grams);
      metalMaterialCost = metalPrice;
      breakdown.metal = {
        purity: metal_purity,
        weight_grams: metalSpec.weight_grams,
        ppg: Math.round(ppg * 100) / 100,
        price: Math.round(metalPrice * 100) / 100,
      };
      total += metalPrice;
    }
  }

  // ── 2. DIAMONDS (MELEE) ───────────────────────────────────────────────────
  if (hasDiamonds) {
    const diamondSpecs = diamondSpecsResult.data || [];
    if (diamondSpecs.length > 0) {
      let diamondTotal = 0;
      const diamondGroups = [];

      for (const spec of diamondSpecs) {
        diamondCtTotal += parseFloat(spec.total_weight_ct || 0);

        const isRound = spec.shape === "Round";
        const ppc = isRound
          ? roundRatesMap.get(spec.size_bucket)
          : fancyRatesMap.get(`${spec.shape}|${spec.size_bucket}`);

        if (ppc == null) {
          errors.push(`Diamond rate not found for ${spec.diamond_group_ref} (${spec.shape}, ${spec.size_bucket}, ${diamondTypeKey}, ${diamond_colour_clarity}).`);
          continue;
        }

        const groupPrice = parseFloat(spec.total_weight_ct) * ppc;
        diamondGroups.push({
          ref: spec.diamond_group_ref,
          shape: spec.shape,
          size_bucket: spec.size_bucket,
          count: spec.diamond_count,
          total_weight_ct: spec.total_weight_ct,
          price_per_carat: ppc,
          price: Math.round(groupPrice * 100) / 100,
        });
        diamondTotal += groupPrice;
      }

      breakdown.diamonds = {
        type: diamond_type,
        colour_clarity: diamond_colour_clarity,
        groups: diamondGroups,
        total: Math.round(diamondTotal * 100) / 100,
      };
      total += diamondTotal;
    }
  }

  // ── 3. SOLITAIRES ─────────────────────────────────────────────────────────
  if (hasSolitaires) {
    const solitaireSpecs = solitaireSpecsResult.data || [];
    if (solitaireSpecs.length > 0) {
      let solitaireTotal = 0;
      const solitaireItems = [];

      for (const spec of solitaireSpecs) {
        solitaireCtTotal += parseFloat(spec.actual_weight_ct || 0);

        const corePrice = solitaireCoreMap.get(spec.weight_range);
        if (corePrice == null) {
          errors.push(`Solitaire core rate not found for ${spec.solitaire_ref} (${solitaire_type}, ${solitaire_colour}, ${solitaire_clarity}, ${spec.weight_range}).`);
          continue;
        }

        const shapeModifier       = modifiersMap.get(`shape|${spec.shape}`) || 0;
        const fluorModifier       = solitaire_fluorescence  ? (modifiersMap.get(`fluorescence|${solitaire_fluorescence}`)   || 0) : 0;
        const certModifier        = solitaire_certification ? (modifiersMap.get(`certification|${solitaire_certification}`)  || 0) : 0;
        const cutModifier         = solitaire_cut           ? (modifiersMap.get(`cut_pol_sym|${solitaire_cut}`)              || 0) : 0;

        const adjustedPPC = corePrice
          * (1 + shapeModifier)
          * (1 + fluorModifier)
          * (1 + certModifier)
          * (1 + cutModifier);

        const solitairePrice = parseFloat(spec.actual_weight_ct) * adjustedPPC;

        solitaireItems.push({
          ref: spec.solitaire_ref,
          shape: spec.shape,
          weight_range: spec.weight_range,
          actual_weight_ct: spec.actual_weight_ct,
          core_price_per_carat: corePrice,
          adjusted_price_per_carat: Math.round(adjustedPPC * 100) / 100,
          price: Math.round(solitairePrice * 100) / 100,
        });
        solitaireTotal += solitairePrice;
      }

      breakdown.solitaires = {
        type: solitaire_type,
        colour: solitaire_colour,
        clarity: solitaire_clarity,
        cut: solitaire_cut,
        fluorescence: solitaire_fluorescence,
        certification: solitaire_certification,
        items: solitaireItems,
        total: Math.round(solitaireTotal * 100) / 100,
      };
      total += solitaireTotal;
    }
  }

  // ── 4. GEMSTONES ──────────────────────────────────────────────────────────
  if (hasGemstones) {
    const gemstoneSpecs = gemstoneSpecsResult.data || [];
    if (gemstoneSpecs.length > 0) {
      let gemstoneTotal = 0;
      const gemstoneGroups = [];

      for (const spec of gemstoneSpecs) {
        gemstoneCtTotal += parseFloat(spec.actual_weight_ct || 0);

        const lookupKey = `${spec.gemstone_name}|${spec.size_bucket}`;
        const ppc = gemstoneRatesMap.get(lookupKey);

        if (ppc == null) {
          errors.push(`Gemstone rate not found for ${spec.gemstone_group_ref} (${spec.gemstone_name}, ${gemstone_type}, ${spec.size_bucket}, ${gemstone_quality}).`);
          continue;
        }

        const groupPrice = parseFloat(spec.actual_weight_ct) * ppc;
        gemstoneGroups.push({
          ref: spec.gemstone_group_ref,
          gemstone_name: spec.gemstone_name,
          size_bucket: spec.size_bucket,
          count: spec.gemstone_count,
          actual_weight_ct: spec.actual_weight_ct,
          price_per_carat: ppc,
          price: Math.round(groupPrice * 100) / 100,
        });
        gemstoneTotal += groupPrice;
      }

      breakdown.gemstones = {
        type: gemstone_type,
        quality: gemstone_quality,
        groups: gemstoneGroups,
        total: Math.round(gemstoneTotal * 100) / 100,
      };
      total += gemstoneTotal;
    }
  }

  // ── 5. MAKING CHARGES + GST ───────────────────────────────────────────────
  const materialTotal = total;
  const wastage = parseFloat(makingRates?.wastage) || 0;
  const isLab = (solitaire_type || gemstone_type || diamond_type) === "Lab";

  const metalMakingCharge = metalIsGold ? metalMaterialCost * wastage : 0;

  const certRateDiaSol = isLab
    ? (parseFloat(makingRates?.certification_rate_lab_diamond_solitaire) || 0)
    : (parseFloat(makingRates?.certification_rate_natural_diamond_solitaire) || 0);
  const certRateGem = isLab
    ? (parseFloat(makingRates?.certification_rate_lab_gemstone) || 0)
    : (parseFloat(makingRates?.certification_rate_natural_gemstone) || 0);

  const certification = (diamondCtTotal + solitaireCtTotal) * certRateDiaSol
    + gemstoneCtTotal * certRateGem;

  const nonLogisticsMaking = metalMakingCharge + certification;
  const gstPreLogistics = 0.03 * materialTotal + 0.05 * nonLogisticsMaking;
  const preLogisticsSub = materialTotal + nonLogisticsMaking + gstPreLogistics;

  const logistics = lookupLogistics(preLogisticsSub, logisticsTiers);

  const making = metalMakingCharge + certification + logistics;
  const gstMaterials = 0.03 * materialTotal;
  const gstMaking = 0.05 * making;

  total = materialTotal + making + gstMaterials + gstMaking;

  breakdown.making = {
    metal_making: Math.round(metalMakingCharge * 100) / 100,
    certification: Math.round(certification * 100) / 100,
    logistics: Math.round(logistics * 100) / 100,
    gst_materials: Math.round(gstMaterials * 100) / 100,
    gst_making: Math.round(gstMaking * 100) / 100,
  };

  return new Response(JSON.stringify({
    success: errors.length === 0,
    errors,
    breakdown,
    total: Math.round(total * 100) / 100,
    currency: "INR",
  }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
    },
  });
};
