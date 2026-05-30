// My Carat — Surat Gold 24K & Silver Rate Bot
// Source: BankBazaar.com (city-specific Surat rates)
// Target: Supabase table → metal_rates
// Schedule: Daily 2:00 PM IST (08:30 UTC) via GitHub Actions

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function getHtml(filePath, url) {
  // If a pre-fetched file is provided (from curl step in CI), read it
  if (filePath) {
    console.log(`[RateBot] Reading HTML from file: ${filePath}`)
    return readFileSync(filePath, 'utf8')
  }
  // Fallback: fetch directly (for local runs)
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-IN,en;q=0.9',
      'Referer': 'https://www.google.com/',
    },
  })
  const html = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`)
  return html
}

function parseGold(html) {
  const match = html.match(/"2":\[{"cityId":2,"date":"(\d{4}-\d{2}-\d{2})","prices":\{"22K_1G":\d+,"24K_1G":(\d+)\}}/)
  if (!match) throw new Error(`Gold rate not found — HTML snippet: ${html.slice(0, 400).replace(/\s+/g, ' ')}`)
  return { date: match[1], gold24k: parseFloat(match[2]) }
}

function parseSilver(html) {
  const match = html.match(/"2":\[{"cityId":2,"date":"(\d{4}-\d{2}-\d{2})","prices":\{"1G":(\d+)\}}/)
  if (!match) throw new Error(`Silver rate not found — HTML snippet: ${html.slice(0, 400).replace(/\s+/g, ' ')}`)
  return { date: match[1], silver: parseFloat(match[2]) }
}

async function main() {
  console.log('[RateBot] Starting — Surat Gold 24K & Silver fetch...')
  const now = new Date().toISOString()

  const goldHtml   = await getHtml(process.env.GOLD_HTML_FILE,   'https://www.bankbazaar.com/gold-rate-surat.html')
  const silverHtml = await getHtml(process.env.SILVER_HTML_FILE, 'https://www.bankbazaar.com/silver-rate-surat.html')

  const { date: goldDate,   gold24k } = parseGold(goldHtml)
  const { date: silverDate, silver  } = parseSilver(silverHtml)

  console.log(`[RateBot] Fetched — Gold 24K: ₹${gold24k}/g (${goldDate}) | Silver: ₹${silver}/g (${silverDate})`)

  if (gold24k < 7000 || gold24k > 25000)
    throw new Error(`Gold rate out of range: ₹${gold24k}/g`)
  if (silver < 50 || silver > 500)
    throw new Error(`Silver rate out of range: ₹${silver}/g`)

  const { error } = await supabase.from('metal_rates').insert([
    { metal: 'gold',   rate_per_gram: gold24k, fetched_at: now, source: 'BankBazaar Surat' },
    { metal: 'silver', rate_per_gram: silver,  fetched_at: now, source: 'BankBazaar Surat' },
  ])
  if (error) throw new Error(`Supabase insert failed: ${error.message}`)

  console.log(`[RateBot] ✅ Saved to metal_rates — Gold 24K: ₹${gold24k}/g | Silver: ₹${silver}/g`)

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
