/**
 * Document numbering — keep prefixes consistent across admin + storefront.
 *
 * - **THOR-…** — order reference (storefront checkout, offline POS, B2B wholesale order)
 * - **INV-…** — admin B2B GST tax invoice only (`SalesInvoice`, not order PDFs)
 */

export const ORDER_REF_PREFIX = "THOR";

export const B2B_TAX_INVOICE_PREFIX = "INV";

/** Order receipt / order PDF invoice uses the same number as the order (THOR-…). */
export function orderInvoiceNumber(orderNumber: string): string {
  return orderNumber.trim();
}

/** Suggest next B2B GST tax invoice number — admin can overwrite. */
export function suggestB2bTaxInvoiceNumber(now: Date = new Date()): string {
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const seq = Math.floor(Math.random() * 900 + 100);
  return `${B2B_TAX_INVOICE_PREFIX}-${yy}${mm}${dd}-${seq}`;
}
