/**
 * MyCarat — Cart Transform Function
 *
 * Reads the "Calculated Price" line item attribute written by the product page:
 *   fmt(n) → '\u20B9' + Math.round(n).toLocaleString('en-IN')
 *   e.g. "₹3,26,238"
 *
 * Overrides the Shopify checkout price so customers are charged the correct
 * material-cost-based price rather than the static variant base price.
 */

export default function run(input) {
  const operations = [];

  for (const line of input.cart.lines) {
    const attrs = line.attributes || [];
    const priceProp = attrs.find(a => a.key === 'Calculated Price');

    if (!priceProp?.value) continue;

    // "₹3,26,238" → strip rupee sign (\u20B9), "Rs.", commas, spaces → "326238"
    const raw = priceProp.value
      .replace(/Rs\.?\s*/gi, '')
      .replace(/[\u20B9,\s]/g, '')
      .trim();

    const rupees = parseFloat(raw);
    if (isNaN(rupees) || rupees <= 0) continue;

    operations.push({
      expand: {
        cartLineId: line.id,
        expandedCartItems: [
          {
            merchandiseId: line.merchandise.id,
            quantity: line.quantity,
            price: {
              adjustment: {
                fixedPricePerUnit: {
                  amount: rupees.toFixed(2),
                },
              },
            },
          },
        ],
      },
    });
  }

  return { operations };
}
