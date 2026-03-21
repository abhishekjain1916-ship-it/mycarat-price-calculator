import { data as json } from "react-router";
import { supabase } from "../supabase.server";
import { invalidateCache } from "../utils/price-cache.server";

// Default configurations
const LAB_DEFAULTS = {
  metal_purity: "18KT",
  diamond_colour_clarity: "EF VVS",
  solitaire_colour: "E",
  solitaire_clarity: "VVS2",
  solitaire_cut: "3EX",
  solitaire_fluorescence: "None",
  solitaire_certification: "IGI",
  gemstone_quality: "Premium",
};

const NATURAL_DEFAULTS = {
  metal_purity: "18KT",
  diamond_colour_clarity: "FG VS",
  solitaire_colour: "H",
  solitaire_clarity: "VS2",
  solitaire_cut: "3VG+",
  solitaire_fluorescence: "Faint",
  solitaire_certification: "IGI",
  gemstone_quality: "Premium",
};

// All options per component
const OPTIONS = {
  diamond_lab: ["EF VVS", "EF VS", "FG VS"],
  diamond_natural: ["EF VVS", "EF VS", "FG VVS", "FG VS", "GH VS", "GH SI"],
  solitaire_colour_lab: ["D", "E", "F"],
  solitaire_colour_natural: ["E", "F", "G", "H", "I", "J"],
  solitaire_clarity_lab: ["FL", "IF", "VVS1", "VVS2", "VS1", "VS2"],
  solitaire_clarity_natural: ["VVS1", "VVS2", "VS1", "VS2", "SI1", "SI2"],
  solitaire_cut_natural: ["3EX", "3VG+", "Others"],
  solitaire_fluorescence_natural: ["None", "Faint", "Others"],
  solitaire_certification_natural: ["IGI", "GIA", "Others"],
  gemstone_lab: ["Classic", "Premium", "Synthetic"],
  gemstone_natural: ["Classic", "Premium", "World Class", "Heirloom", "Royalty"],
};
const PURITY_ORDER = ["9KT", "14KT", "18KT"];

function lookupLogistics(subtotal, tiers) {
  const tier = (tiers || []).find(
    (t) =>
      parseFloat(t.min_value) <= subtotal &&
      (t.max_value == null || subtotal < parseFloat(t.max_value))
  );
  return tier ? parseFloat(tier.logistics_charge) : 0;
}

// ─── Batch-fetch all rates + specs for given product IDs ───────────────────────
// One call to fetchPreloaded replaces ~500-1000 individual DB queries per product.
async function fetchPreloaded(productIds) {
  // null means "fetch all products" (bulk mode — avoids oversized URL in .in() filter)
  const ids = productIds === null ? null : (Array.isArray(productIds) ? productIds : [productIds]);

  // Build spec queries — filter by product_id in single-product mode, fetch all in bulk mode
  const specQuery = (table, columns) => {
    const q = supabase.from(table).select(columns).limit(10000);
    return ids !== null ? q.in("product_id", ids) : q;
  };

  const [
    metalRatesRes,
    metalSpecsRes,
    diamondSpecsRes,
    solitaireSpecsRes,
    gemstoneSpecsRes,
    diamondRatesRoundRes,
    diamondRatesFancyRes,
    solitaireRatesRes,
    solitaireModsRes,
    gemstoneNaturalRatesRes,
    gemstoneSynthRatesRes,
    makingRatesRes,
    logisticsTiersRes,
  ] = await Promise.all([
    supabase.from("metal_rates").select("metal, rate_per_gram").order("fetched_at", { ascending: false }).limit(100),
    specQuery("product_specs_metal", "product_id, purity, weight_grams"),
    specQuery("product_specs_diamonds", "product_id, shape, size_bucket, total_weight_ct"),
    specQuery("product_specs_solitaires", "product_id, weight_range, shape, actual_weight_ct"),
    specQuery("product_specs_gemstones", "product_id, gemstone_name, size_bucket, actual_weight_ct"),
    supabase.from("diamond_rates_round").select("diamond_type, colour_clarity, size_bucket, price_per_carat").limit(10000),
    supabase.from("diamond_rates_fancy").select("diamond_type, colour_clarity, size_bucket, shape, price_per_carat").limit(10000),
    supabase.from("solitaire_rates_core").select("diamond_type, colour, clarity, weight_range, price_per_carat").limit(10000),
    supabase.from("solitaire_modifiers").select("modifier_type, modifier_value, modifier_pct").limit(1000),
    supabase.from("gemstone_rates_natural").select("gemstone_name, size_bucket, quality, price_per_carat").limit(10000),
    supabase.from("gemstone_rates_synth_lab").select("gemstone_name, size_bucket, quality, price_per_carat").limit(10000),
    supabase.from("making_charge_rates").select("*").eq("id", 1).single(),
    supabase.from("logistics_tiers").select("*").order("min_value", { ascending: true }).limit(100),
  ]);

  // Latest metal rate per type (rates are ordered newest-first, take first seen)
  const metalRatesMap = {};
  for (const row of (metalRatesRes.data || [])) {
    if (!(row.metal in metalRatesMap)) metalRatesMap[row.metal] = parseFloat(row.rate_per_gram);
  }

  // Specs grouped by product_id
  const metalSpecsByProduct = {};
  for (const row of (metalSpecsRes.data || [])) {
    if (!metalSpecsByProduct[row.product_id]) metalSpecsByProduct[row.product_id] = [];
    metalSpecsByProduct[row.product_id].push(row);
  }
  const diamondSpecsByProduct = {};
  for (const row of (diamondSpecsRes.data || [])) {
    if (!diamondSpecsByProduct[row.product_id]) diamondSpecsByProduct[row.product_id] = [];
    diamondSpecsByProduct[row.product_id].push(row);
  }
  const solitaireSpecsByProduct = {};
  for (const row of (solitaireSpecsRes.data || [])) {
    if (!solitaireSpecsByProduct[row.product_id]) solitaireSpecsByProduct[row.product_id] = [];
    solitaireSpecsByProduct[row.product_id].push(row);
  }
  const gemstoneSpecsByProduct = {};
  for (const row of (gemstoneSpecsRes.data || [])) {
    if (!gemstoneSpecsByProduct[row.product_id]) gemstoneSpecsByProduct[row.product_id] = [];
    gemstoneSpecsByProduct[row.product_id].push(row);
  }

  // Rate lookup maps (keyed for O(1) access)
  const diamondRatesRoundMap = {};
  for (const r of (diamondRatesRoundRes.data || [])) {
    diamondRatesRoundMap[`${r.diamond_type}|${r.colour_clarity}|${r.size_bucket}`] = parseFloat(r.price_per_carat);
  }
  const diamondRatesFancyMap = {};
  for (const r of (diamondRatesFancyRes.data || [])) {
    diamondRatesFancyMap[`${r.diamond_type}|${r.colour_clarity}|${r.size_bucket}|${r.shape}`] = parseFloat(r.price_per_carat);
  }
  const solitaireRatesMap = {};
  for (const r of (solitaireRatesRes.data || [])) {
    solitaireRatesMap[`${r.diamond_type}|${r.colour}|${r.clarity}|${r.weight_range}`] = parseFloat(r.price_per_carat);
  }
  const solitaireModsMap = {};
  for (const m of (solitaireModsRes.data || [])) {
    solitaireModsMap[`${m.modifier_type}|${m.modifier_value}`] = m.modifier_pct / 100;
  }
  const gemstoneNaturalRatesMap = {};
  for (const r of (gemstoneNaturalRatesRes.data || [])) {
    gemstoneNaturalRatesMap[`${r.gemstone_name}|${r.size_bucket}|${r.quality}`] = parseFloat(r.price_per_carat);
  }
  const gemstoneSynthRatesMap = {};
  for (const r of (gemstoneSynthRatesRes.data || [])) {
    gemstoneSynthRatesMap[`${r.gemstone_name}|${r.size_bucket}|${r.quality}`] = parseFloat(r.price_per_carat);
  }

  // Pre-compute carat totals per product (used in making charge calculation)
  const totalDiamondCtByProduct = {};
  for (const [pid, specs] of Object.entries(diamondSpecsByProduct)) {
    totalDiamondCtByProduct[pid] = specs.reduce((s, r) => s + parseFloat(r.total_weight_ct || 0), 0);
  }
  const totalSolitaireCtByProduct = {};
  for (const [pid, specs] of Object.entries(solitaireSpecsByProduct)) {
    totalSolitaireCtByProduct[pid] = specs.reduce((s, r) => s + parseFloat(r.actual_weight_ct || 0), 0);
  }
  const totalGemstoneCtByProduct = {};
  for (const [pid, specs] of Object.entries(gemstoneSpecsByProduct)) {
    totalGemstoneCtByProduct[pid] = specs.reduce((s, r) => s + parseFloat(r.actual_weight_ct || 0), 0);
  }

  return {
    metalRatesMap,
    metalSpecsByProduct,
    diamondSpecsByProduct,
    solitaireSpecsByProduct,
    gemstoneSpecsByProduct,
    diamondRatesRoundMap,
    diamondRatesFancyMap,
    solitaireRatesMap,
    solitaireModsMap,
    gemstoneNaturalRatesMap,
    gemstoneSynthRatesMap,
    makingRates: makingRatesRes.data || null,
    logisticsTiers: logisticsTiersRes.data || [],
    totalDiamondCtByProduct,
    totalSolitaireCtByProduct,
    totalGemstoneCtByProduct,
  };
}

// ─── Core calculation — now SYNCHRONOUS, zero DB calls ───────────────────────
// All data is pre-fetched by fetchPreloaded() and passed in via `preloaded`.
function calculatePrice(product_id, params, preloaded) {
  const {
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
  } = params;

  const {
    metalRatesMap,
    metalSpecsByProduct,
    diamondSpecsByProduct,
    solitaireSpecsByProduct,
    gemstoneSpecsByProduct,
    diamondRatesRoundMap,
    diamondRatesFancyMap,
    solitaireRatesMap,
    solitaireModsMap,
    gemstoneNaturalRatesMap,
    gemstoneSynthRatesMap,
    makingRates,
    logisticsTiers: tiers,
    totalDiamondCtByProduct,
    totalSolitaireCtByProduct,
    totalGemstoneCtByProduct,
  } = preloaded;

  let total = 0;
  let metalMaterialCost = 0;
  let metalIsGold = false;
  const misses = [];

  // 1. METAL
  if (metal_purity) {
    const metalType = metal_purity.includes("KT") ? "gold" : "silver";
    metalIsGold = metalType === "gold";
    const ratePerGram = metalRatesMap[metalType];

    if (ratePerGram != null) {
      const metalSpec = (metalSpecsByProduct[product_id] || []).find(s => s.purity === metal_purity);
      if (metalSpec) {
        const purityNumber = parseInt(metal_purity);
        const divisor = metalType === "gold" ? 24 : 1000;
        const ppg = ratePerGram * (purityNumber / divisor);
        metalMaterialCost = ppg * parseFloat(metalSpec.weight_grams);
        total += metalMaterialCost;
      } else {
        misses.push(`metal spec missing: purity=${metal_purity}`);
      }
    } else {
      misses.push(`metal rate missing: type=${metalType}`);
    }
  }

  // 2. DIAMONDS
  if (diamond_type && diamond_colour_clarity) {
    const diamondSpecs = diamondSpecsByProduct[product_id] || [];
    for (const spec of diamondSpecs) {
      const isRound = spec.shape === "Round";
      const dtKey = diamond_type === "Lab" ? "Lab Grown" : "Natural";
      const ppc = isRound
        ? diamondRatesRoundMap[`${dtKey}|${diamond_colour_clarity}|${spec.size_bucket}`]
        : diamondRatesFancyMap[`${dtKey}|${diamond_colour_clarity}|${spec.size_bucket}|${spec.shape}`];

      if (ppc != null) {
        total += parseFloat(spec.total_weight_ct) * ppc;
      } else {
        misses.push(`diamond rate missing: ${diamond_type} ${diamond_colour_clarity} ${spec.size_bucket} shape=${spec.shape}`);
      }
    }
  }

  // 3. SOLITAIRES
  if (solitaire_type && solitaire_colour && solitaire_clarity) {
    const solitaireSpecs = solitaireSpecsByProduct[product_id] || [];
    for (const spec of solitaireSpecs) {
      const ppc = solitaireRatesMap[`${solitaire_type}|${solitaire_colour}|${solitaire_clarity}|${spec.weight_range}`];
      if (ppc == null) {
        misses.push(`solitaire rate missing: ${solitaire_type} ${solitaire_colour} ${solitaire_clarity} ${spec.weight_range}`);
        continue;
      }
      const shapeMod  = solitaireModsMap[`shape|${spec.shape}`] || 0;
      const fluorMod  = solitaire_fluorescence ? (solitaireModsMap[`fluorescence|${solitaire_fluorescence}`] || 0) : 0;
      const certMod   = solitaire_certification ? (solitaireModsMap[`certification|${solitaire_certification}`] || 0) : 0;
      const cutMod    = solitaire_cut ? (solitaireModsMap[`cut_pol_sym|${solitaire_cut}`] || 0) : 0;
      total += parseFloat(spec.actual_weight_ct) * ppc * (1 + shapeMod) * (1 + fluorMod) * (1 + certMod) * (1 + cutMod);
    }
  }

  // 4. GEMSTONES
  if (gemstone_type && gemstone_quality) {
    const gemstoneSpecs = gemstoneSpecsByProduct[product_id] || [];
    for (const spec of gemstoneSpecs) {
      const ppc = gemstone_type === "Natural"
        ? gemstoneNaturalRatesMap[`${spec.gemstone_name}|${spec.size_bucket}|${gemstone_quality}`]
        : gemstoneSynthRatesMap[`${spec.gemstone_name}|${spec.size_bucket}|${gemstone_quality}`];

      if (ppc != null) {
        total += parseFloat(spec.actual_weight_ct) * ppc;
      } else {
        misses.push(`gemstone rate missing: ${gemstone_type} ${spec.gemstone_name} ${spec.size_bucket} quality=${gemstone_quality}`);
      }
    }
  }

  // 5. MAKING CHARGES + GST
  const materialTotal = total;
  const wastage = parseFloat(makingRates?.wastage) || 0;
  const isLab = (params.solitaire_type || params.gemstone_type || params.diamond_type) === "Lab";

  const metalMaking = metalIsGold ? metalMaterialCost * wastage : 0;

  const certRateDiaSol = isLab
    ? (parseFloat(makingRates?.certification_rate_lab_diamond_solitaire) || 0)
    : (parseFloat(makingRates?.certification_rate_natural_diamond_solitaire) || 0);
  const certRateGem = isLab
    ? (parseFloat(makingRates?.certification_rate_lab_gemstone) || 0)
    : (parseFloat(makingRates?.certification_rate_natural_gemstone) || 0);

  const totalDiamondCt   = totalDiamondCtByProduct[product_id]   || 0;
  const totalSolitaireCt = totalSolitaireCtByProduct[product_id] || 0;
  const totalGemstoneCt  = totalGemstoneCtByProduct[product_id]  || 0;

  const certification = (totalDiamondCt + totalSolitaireCt) * certRateDiaSol
    + totalGemstoneCt * certRateGem;

  const nonLogisticsMaking = metalMaking + certification;
  const gstPreLogistics = 0.03 * materialTotal + 0.05 * nonLogisticsMaking;
  const preLogisticsSub = materialTotal + nonLogisticsMaking + gstPreLogistics;

  const logistics = lookupLogistics(preLogisticsSub, tiers);

  const making = metalMaking + certification + logistics;
  const gstMaterials = 0.03 * materialTotal;
  const gstMaking    = 0.05 * making;

  const price = Math.round(materialTotal + making + gstMaterials + gstMaking);
  return { price, misses, preLogisticsSub };
}

// ─── Process a single product using pre-fetched data ─────────────────────────
function processProduct(product_id, preloaded) {
  const metalSpecs      = preloaded.metalSpecsByProduct[product_id]      || [];
  const diamondSpecs    = preloaded.diamondSpecsByProduct[product_id]    || [];
  const solitaireSpecs  = preloaded.solitaireSpecsByProduct[product_id]  || [];
  const gemstoneSpecs   = preloaded.gemstoneSpecsByProduct[product_id]   || [];

  const productHasDiamonds   = diamondSpecs.length > 0;
  const productHasSolitaires = solitaireSpecs.length > 0;
  const productHasGemstones  = gemstoneSpecs.length > 0;

  const availablePurities = metalSpecs.map(s => s.purity);
  const cheapestPurity = PURITY_ORDER.find(p => availablePurities.includes(p)) || availablePurities[0] || "18KT";

  // Build params for Lab and Natural defaults
  const labParams = {
    metal_purity: LAB_DEFAULTS.metal_purity,
    diamond_type: productHasDiamonds ? "Lab" : null,
    diamond_colour_clarity: productHasDiamonds ? LAB_DEFAULTS.diamond_colour_clarity : null,
    solitaire_type: productHasSolitaires ? "Lab" : null,
    solitaire_colour: productHasSolitaires ? LAB_DEFAULTS.solitaire_colour : null,
    solitaire_clarity: productHasSolitaires ? LAB_DEFAULTS.solitaire_clarity : null,
    solitaire_cut: productHasSolitaires ? LAB_DEFAULTS.solitaire_cut : null,
    solitaire_fluorescence: productHasSolitaires ? LAB_DEFAULTS.solitaire_fluorescence : null,
    solitaire_certification: productHasSolitaires ? LAB_DEFAULTS.solitaire_certification : null,
    gemstone_type: productHasGemstones ? "Lab" : null,
    gemstone_quality: productHasGemstones ? LAB_DEFAULTS.gemstone_quality : null,
  };

  const naturalParams = {
    metal_purity: NATURAL_DEFAULTS.metal_purity,
    diamond_type: productHasDiamonds ? "Natural" : null,
    diamond_colour_clarity: productHasDiamonds ? NATURAL_DEFAULTS.diamond_colour_clarity : null,
    solitaire_type: productHasSolitaires ? "Natural" : null,
    solitaire_colour: productHasSolitaires ? NATURAL_DEFAULTS.solitaire_colour : null,
    solitaire_clarity: productHasSolitaires ? NATURAL_DEFAULTS.solitaire_clarity : null,
    solitaire_cut: productHasSolitaires ? NATURAL_DEFAULTS.solitaire_cut : null,
    solitaire_fluorescence: productHasSolitaires ? NATURAL_DEFAULTS.solitaire_fluorescence : null,
    solitaire_certification: productHasSolitaires ? NATURAL_DEFAULTS.solitaire_certification : null,
    gemstone_type: productHasGemstones ? "Natural" : null,
    gemstone_quality: productHasGemstones ? NATURAL_DEFAULTS.gemstone_quality : null,
  };

  // Default prices
  const { price: labDefault,     misses: m1, preLogisticsSub: labPreLogSub } = calculatePrice(product_id, labParams,     preloaded);
  const { price: naturalDefault, misses: m2, preLogisticsSub: natPreLogSub } = calculatePrice(product_id, naturalParams, preloaded);

  // Find cheapest/priciest solitaire combination (in-memory, zero DB queries)
  let cheapestLabSolCombo    = null;
  let priesiestLabSolCombo   = null;
  let cheapestNatSolCombo    = null;
  let priesiestNatSolCombo   = null;

  if (productHasSolitaires) {
    const { solitaireRatesMap, solitaireModsMap } = preloaded;
    const tiers = preloaded.logisticsTiers;

    const computeSolMaterial = (type, colour, clarity, cut, fluor, cert) => {
      let t = 0;
      for (const spec of solitaireSpecs) {
        const ppc = solitaireRatesMap[`${type}|${colour}|${clarity}|${spec.weight_range}`];
        if (ppc == null) continue;
        const shapeMod = solitaireModsMap[`shape|${spec.shape}`] || 0;
        const fluorMod = fluor != null ? (solitaireModsMap[`fluorescence|${fluor}`] || 0) : 0;
        const certMod  = cert  != null ? (solitaireModsMap[`certification|${cert}`] || 0) : 0;
        const cutMod   = cut   != null ? (solitaireModsMap[`cut_pol_sym|${cut}`]   || 0) : 0;
        t += parseFloat(spec.actual_weight_ct) * ppc * (1 + shapeMod) * (1 + fluorMod) * (1 + certMod) * (1 + cutMod);
      }
      return t;
    };

    // Lab: colour × clarity
    let minLab = Infinity, maxLab = -Infinity;
    for (const colour of OPTIONS.solitaire_colour_lab) {
      for (const clarity of OPTIONS.solitaire_clarity_lab) {
        const cost = computeSolMaterial("Lab", colour, clarity, LAB_DEFAULTS.solitaire_cut, LAB_DEFAULTS.solitaire_fluorescence, LAB_DEFAULTS.solitaire_certification);
        if (cost < minLab) { minLab = cost; cheapestLabSolCombo  = { solitaire_colour: colour, solitaire_clarity: clarity }; }
        if (cost > maxLab) { maxLab = cost; priesiestLabSolCombo = { solitaire_colour: colour, solitaire_clarity: clarity }; }
      }
    }

    // Natural: all 972 combinations
    let minNat = Infinity, maxNat = -Infinity;
    for (const colour of OPTIONS.solitaire_colour_natural) {
      for (const clarity of OPTIONS.solitaire_clarity_natural) {
        for (const cut of OPTIONS.solitaire_cut_natural) {
          for (const fluor of OPTIONS.solitaire_fluorescence_natural) {
            for (const cert of OPTIONS.solitaire_certification_natural) {
              const cost = computeSolMaterial("Natural", colour, clarity, cut, fluor, cert);
              if (cost < minNat) { minNat = cost; cheapestNatSolCombo  = { solitaire_colour: colour, solitaire_clarity: clarity, solitaire_cut: cut, solitaire_fluorescence: fluor, solitaire_certification: cert }; }
              if (cost > maxNat) { maxNat = cost; priesiestNatSolCombo = { solitaire_colour: colour, solitaire_clarity: clarity, solitaire_cut: cut, solitaire_fluorescence: fluor, solitaire_certification: cert }; }
            }
          }
        }
      }
    }
  }

  // Min prices
  const { price: labMin,     misses: m3 } = calculatePrice(product_id, { ...labParams,     metal_purity: cheapestPurity, diamond_colour_clarity: productHasDiamonds ? "FG VS" : null,  ...(productHasSolitaires && cheapestLabSolCombo   ? cheapestLabSolCombo   : {}), gemstone_quality: productHasGemstones ? "Classic" : null }, preloaded);
  const { price: naturalMin, misses: m4 } = calculatePrice(product_id, { ...naturalParams, metal_purity: cheapestPurity, diamond_colour_clarity: productHasDiamonds ? "GH SI" : null,  ...(productHasSolitaires && cheapestNatSolCombo   ? cheapestNatSolCombo   : {}), gemstone_quality: productHasGemstones ? "Classic" : null }, preloaded);

  // Max prices
  const { price: labMax,     misses: m5 } = calculatePrice(product_id, { ...labParams,     metal_purity: "18KT", diamond_colour_clarity: productHasDiamonds ? "EF VVS" : null, ...(productHasSolitaires && priesiestLabSolCombo ? priesiestLabSolCombo : {}), gemstone_quality: productHasGemstones ? "Premium" : null }, preloaded);
  const { price: naturalMax, misses: m6 } = calculatePrice(product_id, { ...naturalParams, metal_purity: "18KT", diamond_colour_clarity: productHasDiamonds ? "EF VVS" : null, ...(productHasSolitaires && priesiestNatSolCombo ? priesiestNatSolCombo : {}), gemstone_quality: productHasGemstones ? "Royalty"  : null }, preloaded);

  const cacheWarnings = [...new Set([...m1, ...m2, ...m3, ...m4, ...m5, ...m6])];

  // ── Deltas ──────────────────────────────────────────────────────────────────
  const deltas = [];

  const calcDelta = (type, component, optionValue, overrideParams) => {
    const baseParams  = type === "Lab" ? { ...labParams } : { ...naturalParams };
    const { price: newPrice } = calculatePrice(product_id, { ...baseParams, ...overrideParams }, preloaded);
    const basePrice = type === "Lab" ? labDefault : naturalDefault;
    return { product_id, diamond_type: type, component, option_value: optionValue, delta_amount: newPrice - basePrice, last_calculated_at: new Date().toISOString() };
  };

  // Metal deltas
  for (const type of ["Lab", "Natural"]) {
    for (const purity of availablePurities.filter(p => PURITY_ORDER.includes(p))) {
      deltas.push(calcDelta(type, "metal", purity, { metal_purity: purity }));
    }
  }

  // Diamond deltas
  if (productHasDiamonds) {
    for (const option of OPTIONS.diamond_lab)     deltas.push(calcDelta("Lab",     "diamond", option, { diamond_colour_clarity: option }));
    for (const option of OPTIONS.diamond_natural)  deltas.push(calcDelta("Natural", "diamond", option, { diamond_colour_clarity: option }));
  }

  // Solitaire individual deltas
  if (productHasSolitaires) {
    for (const option of OPTIONS.solitaire_colour_lab)           deltas.push(calcDelta("Lab",     "solitaire_colour",        option, { solitaire_colour:        option }));
    for (const option of OPTIONS.solitaire_colour_natural)       deltas.push(calcDelta("Natural", "solitaire_colour",        option, { solitaire_colour:        option }));
    for (const option of OPTIONS.solitaire_clarity_lab)          deltas.push(calcDelta("Lab",     "solitaire_clarity",       option, { solitaire_clarity:       option }));
    for (const option of OPTIONS.solitaire_clarity_natural)      deltas.push(calcDelta("Natural", "solitaire_clarity",       option, { solitaire_clarity:       option }));
    for (const option of OPTIONS.solitaire_cut_natural)          deltas.push(calcDelta("Natural", "solitaire_cut",           option, { solitaire_cut:           option }));
    for (const option of OPTIONS.solitaire_fluorescence_natural) deltas.push(calcDelta("Natural", "solitaire_fluorescence",  option, { solitaire_fluorescence:  option }));
    for (const option of OPTIONS.solitaire_certification_natural)deltas.push(calcDelta("Natural", "solitaire_certification", option, { solitaire_certification: option }));
  }

  // Gemstone deltas
  if (productHasGemstones) {
    for (const option of OPTIONS.gemstone_lab)     deltas.push(calcDelta("Lab",     "gemstone", option, { gemstone_quality: option }));
    for (const option of OPTIONS.gemstone_natural)  deltas.push(calcDelta("Natural", "gemstone", option, { gemstone_quality: option }));
  }

  // Solitaire combined deltas (exact pricing via in-memory computation)
  if (productHasSolitaires) {
    const { solitaireRatesMap, solitaireModsMap, logisticsTiers: tiers } = preloaded;

    const computeSolMat = (type, colour, clarity, cut, fluor, cert) => {
      let t = 0;
      for (const spec of solitaireSpecs) {
        const ppc = solitaireRatesMap[`${type}|${colour}|${clarity}|${spec.weight_range}`];
        if (ppc == null) continue;
        const shapeMod = solitaireModsMap[`shape|${spec.shape}`] || 0;
        const fluorMod = fluor != null ? (solitaireModsMap[`fluorescence|${fluor}`] || 0) : 0;
        const certMod  = cert  != null ? (solitaireModsMap[`certification|${cert}`] || 0) : 0;
        const cutMod   = cut   != null ? (solitaireModsMap[`cut_pol_sym|${cut}`]   || 0) : 0;
        t += parseFloat(spec.actual_weight_ct) * ppc * (1 + shapeMod) * (1 + fluorMod) * (1 + certMod) * (1 + cutMod);
      }
      return t;
    };

    // Lab: 18 combinations
    const labSolDefault = computeSolMat("Lab", LAB_DEFAULTS.solitaire_colour, LAB_DEFAULTS.solitaire_clarity, LAB_DEFAULTS.solitaire_cut, LAB_DEFAULTS.solitaire_fluorescence, LAB_DEFAULTS.solitaire_certification);
    for (const colour of OPTIONS.solitaire_colour_lab) {
      for (const clarity of OPTIONS.solitaire_clarity_lab) {
        const solNew = computeSolMat("Lab", colour, clarity, LAB_DEFAULTS.solitaire_cut, LAB_DEFAULTS.solitaire_fluorescence, LAB_DEFAULTS.solitaire_certification);
        const deltaS = solNew - labSolDefault;
        const newPreLog = labPreLogSub + 1.03 * deltaS;
        const deltaLogistics = lookupLogistics(newPreLog, tiers) - lookupLogistics(labPreLogSub, tiers);
        deltas.push({ product_id, diamond_type: "Lab", component: "solitaire_combined", option_value: `${colour}_${clarity}`, delta_amount: Math.round(1.03 * deltaS + 1.05 * deltaLogistics), last_calculated_at: new Date().toISOString() });
      }
    }

    // Natural: 972 combinations
    const natSolDefault = computeSolMat("Natural", NATURAL_DEFAULTS.solitaire_colour, NATURAL_DEFAULTS.solitaire_clarity, NATURAL_DEFAULTS.solitaire_cut, NATURAL_DEFAULTS.solitaire_fluorescence, NATURAL_DEFAULTS.solitaire_certification);
    for (const colour of OPTIONS.solitaire_colour_natural) {
      for (const clarity of OPTIONS.solitaire_clarity_natural) {
        for (const cut of OPTIONS.solitaire_cut_natural) {
          for (const fluor of OPTIONS.solitaire_fluorescence_natural) {
            for (const cert of OPTIONS.solitaire_certification_natural) {
              const solNew = computeSolMat("Natural", colour, clarity, cut, fluor, cert);
              const deltaS = solNew - natSolDefault;
              const newPreLog = natPreLogSub + 1.03 * deltaS;
              const deltaLogistics = lookupLogistics(newPreLog, tiers) - lookupLogistics(natPreLogSub, tiers);
              deltas.push({ product_id, diamond_type: "Natural", component: "solitaire_combined", option_value: `${colour}_${clarity}_${cut}_${fluor}_${cert}`, delta_amount: Math.round(1.03 * deltaS + 1.05 * deltaLogistics), last_calculated_at: new Date().toISOString() });
            }
          }
        }
      }
    }
  }

  return {
    priceCache: {
      product_id,
      lab_default_price: labDefault,
      lab_min_price: labMin,
      lab_max_price: labMax,
      natural_default_price: naturalDefault,
      natural_min_price: naturalMin,
      natural_max_price: naturalMax,
      last_calculated_at: new Date().toISOString(),
    },
    deltas,
    cacheWarnings,
  };
}

// ─── Write results for one product to DB ─────────────────────────────────────
async function writeProductResults(product_id, priceCache, deltas) {
  await supabase.from("product_price_cache").upsert(priceCache, { onConflict: "product_id" });

  const individualDeltas = deltas.filter(d => d.component !== "solitaire_combined");
  const combinedDeltas   = deltas.filter(d => d.component === "solitaire_combined");

  await supabase.from("product_delta_cache").delete().eq("product_id", product_id);

  const { error: indivErr } = await supabase.from("product_delta_cache").insert(individualDeltas);
  if (indivErr) console.error("[RecalcCache] Individual delta insert error:", indivErr);

  const BATCH_SIZE = 500;
  let combinedInsertOk = true;
  for (let i = 0; i < combinedDeltas.length; i += BATCH_SIZE) {
    const { error: combErr } = await supabase.from("product_delta_cache").insert(combinedDeltas.slice(i, i + BATCH_SIZE));
    if (combErr) {
      console.error(`[RecalcCache] Combined delta insert error (batch ${Math.floor(i / BATCH_SIZE) + 1}):`, combErr);
      combinedInsertOk = false;
      break;
    }
  }

  invalidateCache(product_id);
  return combinedInsertOk;
}

// ─── Route handler ────────────────────────────────────────────────────────────
export const action = async ({ request }) => {
  const secret = process.env.RECALCULATE_SECRET;
  if (secret) {
    const provided = request.headers.get("x-recalc-secret");
    if (provided !== secret) return json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { product_id, trigger } = body;

  // ── Bulk mode: recalculate ALL products in one pass ──────────────────────
  if (body.all) {
    try {
      const { data: metalSpecs, error: specErr } = await supabase
        .from("product_specs_metal")
        .select("product_id")
        .limit(10000);

      if (specErr) return json({ success: false, error: specErr.message });

      const allIds = [...new Set((metalSpecs || []).map(r => r.product_id))];
      if (allIds.length === 0) return json({ success: false, error: "No products found in product_specs_metal" });

      const preloaded = await fetchPreloaded(null); // null = fetch all specs without filter

      let totalDeltas = 0;
      const results = [];
      const warnings = [];

      for (const pid of allIds) {
        const { priceCache, deltas, cacheWarnings } = processProduct(pid, preloaded);
        if (cacheWarnings.length > 0) warnings.push({ product_id: pid, warnings: cacheWarnings });
        await writeProductResults(pid, priceCache, deltas);
        results.push({ product_id: pid, deltas: deltas.length });
        totalDeltas += deltas.length;
      }

      return json({
        success: true,
        products_processed: allIds.length,
        total_deltas: totalDeltas,
        ...(warnings.length > 0 ? { warnings } : {}),
      });
    } catch (error) {
      return json({ success: false, error: error.message });
    }
  }

  try {
    if (!product_id) return json({ success: false, error: "product_id is required" });

    const preloaded = await fetchPreloaded(product_id);
    const { priceCache, deltas, cacheWarnings } = processProduct(product_id, preloaded);

    if (cacheWarnings.length > 0) console.warn(`[RecalcCache] Missing rates for ${product_id}:`, cacheWarnings);

    const combinedInsertOk = await writeProductResults(product_id, priceCache, deltas);

    const individualDeltas = deltas.filter(d => d.component !== "solitaire_combined");
    const combinedDeltas   = deltas.filter(d => d.component === "solitaire_combined");

    return json({
      success: true,
      trigger,
      product_id,
      prices: {
        lab:     { default: priceCache.lab_default_price,     min: priceCache.lab_min_price,     max: priceCache.lab_max_price },
        natural: { default: priceCache.natural_default_price, min: priceCache.natural_min_price, max: priceCache.natural_max_price },
      },
      deltas_calculated: deltas.length,
      deltas_individual: individualDeltas.length,
      deltas_combined:   combinedDeltas.length,
      combined_insert_ok: combinedInsertOk,
      ...(cacheWarnings.length > 0 ? { warnings: cacheWarnings } : {}),
    });

  } catch (error) {
    return json({ success: false, error: error.message });
  }
};
