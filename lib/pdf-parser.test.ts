import { parse360DialogInvoiceText } from "./pdf-parser";

const SAMPLE = `
Invoice
360dialog

Invoice number: INV26-135124
Date of issue: 2026-07-15
Date due: 2026-07-18

360dialog GmbH
Tölzer Straße 1, 82031 Grünwald / Germany

Bill to
Grupo Express
ti@bkvexpressbh.com.br

Description Quantity Unit price (Net) Total net VAT (N/A) Amount (Gross)

Your WhatsApp Business Account, new prepayment for whatsapp usage costs
Phone: 553133261400
1.00 20.80 20.80 0.00 USD 20.80 USD

Transaction Fee
1.00 0.83 0.83 0.00 USD 0.83 USD

Subtotal 21.63 USD
Total VAT - N/A 0.00 USD
Total 21.63 USD
`;

const parsed = parse360DialogInvoiceText(SAMPLE);

const asserts: Array<[string, boolean]> = [
  ["invoiceNumber", parsed.invoiceNumber === "INV26-135124"],
  ["issueDate", parsed.issueDate === "2026-07-15"],
  ["dueDate", parsed.dueDate === "2026-07-18"],
  ["customerName", parsed.customerName === "Grupo Express"],
  ["phone", parsed.whatsappNumber === "553133261400"],
  ["total", parsed.total === 21.63],
  ["currency", parsed.currency === "USD"],
  ["lines", parsed.lines.length === 2],
  ["usage", parsed.lines[0]?.amount === 20.8],
  ["fee", parsed.lines[1]?.amount === 0.83],
];

const failed = asserts.filter(([, ok]) => !ok);
if (failed.length > 0) {
  console.error("Parser falhou:", failed.map(([name]) => name));
  console.error(JSON.stringify(parsed, null, 2));
  process.exit(1);
}

console.log("Parser OK:", parsed.invoiceNumber, parsed.whatsappNumber, parsed.total);
