// My Carat — Surat Gold 24K & Silver Rate Bot
// Source: BankBazaar.com (city-specific Surat rates)
// Target: Supabase table → metal_rates
// Schedule: Daily 2:00 PM IST (08:30 UTC) via GitHub Actions

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-IN,en;q=0.9',
}

async function fetchRate(url, parseHtml) {
  const res = await fetch(url, { headers: HEADERS })
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`)
  const html = await res.text()
  console.log(`[RateBot] HTML sample from ${url}:`, html.slice(0, 600).replace(/\s+/g, ' '))
  return parseHtml(html)
}

function parseGold(html) {
  // BankBazaar embeds cityPrices JSON — cityId 2 = Surat. Field order changed 2026-05 (cityId before date).
  const match = html.match(/"2":\[{"cityId":2,"date":"(\d{4}-\d{2}-\d{2})","prices":\{"22K_1G":\d+,"24K_1G":(\d+)\}}/)
  if (!match) throw new Error('Gold rate not found in BankBazaar HTML')
  return { date: match[1], gold24k: parseFloat(match[2]) }
}

function parseSilver(html) {
  // Silver page — cityId 2 = Surat, field "1G" = per gram. Field order changed 2026-05 (cityId before date).
  const match = html.match(/"2":\[{"cityId":2,"date":"(\d{4}-\d{2}-\d{2})","prices":\{"1G":(\d+)\}}/)
  if (!match) throw new Error('Silver rate not found in BankBazaar HTML')
  return { date: match[1], silver: parseFloat(match[2]) }
}

async function main() {
  console.log('[RateBot] Starting — Surat Gold 24K & Silver fetch...')
  const now = new Date().toISOString()

  // 1. Fetch rates
  const { date: goldDate, gold24k } = await fetchRate(
    'https://www.bankbazaar.com/gold-rate-surat.html',
    parseGold
  )
  const { date: silverDate, silver } = await fetchRate(
    'https://www.bankbazaar.com/silver-rate-surat.html',
    parseSilver
  )

  console.log(`[RateBot] Fetched — Gold 24K: ₹${gold24k}/g (${goldDate}) | Silver: ₹${silver}/g (${silverDate})`)

  // 2. Sanity checks
  if (gold24k < 7000 || gold24k > 25000)
    throw new Error(`Gold rate out of range: ₹${gold24k}/g`)
  if (silver < 50 || silver > 500)
    throw new Error(`Silver rate out of range: ₹${silver}/g`)

  // 3. Insert into existing metal_rates table
  const { error } = await supabase.from('metal_rates').insert([
    { metal: 'gold',   rate_per_gram: gold24k, fetched_at: now, source: 'BankBazaar Surat' },
    { metal: 'silver', rate_per_gram: silver,  fetched_at: now, source: 'BankBazaar Surat' },
  ])
  if (error) throw new Error(`Supabase insert failed: ${error.message}`)

  console.log(`[RateBot] ✅ Saved to metal_rates — Gold 24K: ₹${gold24k}/g | Silver: ₹${silver}/g`)

  // 4. Trigger price recalculation (non-fatal if fails)
  try {
    const secret = process.env.RECALCULATE_SECRET
    const recalcRes = await fetch('https://mycarat-price-calc.fly.dev/api/recalculate-cache', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(secret ? { 'x-recalc-secret': secret } : {}),
      },
      body: JSON.stringify({ all: true, trigger: 'rate_bot' }),
    })
    if (recalcRes.ok) {
      const d = await recalcRes.json()
      console.log(`[RateBot] Recalc queued for ${d.products_processed ?? '?'} products`)
    } else {
      console.warn('[RateBot] Recalc endpoint returned:', recalcRes.status)
    }
  } catch (e) {
    console.warn('[RateBot] Recalc trigger failed (non-fatal):', e.message)
  }
}

main().catch(err => {
  console.error('[RateBot] ❌ Failed:', err.message)
  process.exit(1)
})
