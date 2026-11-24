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
  ["customerEmail", parsed.customerEmail === "ti@bkvexpressbh.com.br"],
  ["phone", parsed.whatsappNumber === "553133261400"],
  ["total", parsed.total === 21.63],
  ["currency", parsed.currency === "USD"],
  ["lines", parsed.lines.length === 2],
  ["usage", parsed.lines[0]?.amount === 20.8],
  ["fee", parsed.lines[1]?.amount === 0.83],
];

const CLOSING = `
Invoice number: INV26-237847
Date of issue: 2026-11-01
Date due: 2026-11-04
Bill to Grupo Express ti@bkvexpressbh.com.br
WhatsApp usage costs - 10/2026 for phone number: 553123420610
1.00 202.27 202.27 0.00 USD 202.27 USD
Settled with credit balance
1.00 -202.27 -202.27 0.00 USD -202.27 USD
Transaction Fee
1.00 0.00 0.00 0.00 USD 0.00 USD
Subtotal 0.00 USD
Total 0.00 USD
`;

const closing = parse360DialogInvoiceText(CLOSING);
asserts.push(
  ["closingPhone", closing.whatsappNumber === "553123420610"],
  ["closingTotal", closing.total === 0],
  ["closingUsage", closing.lines[0]?.amount === 202.27],
  ["closingLinePhone", closing.lines[0]?.whatsappNumber === "553123420610"],
);

const CHANNELS = `
Invoice number: INV26-CHANNEL
Date of issue: 2026-11-01
Bill to Grupo Express ti@bkvexpressbh.com.br
Basic WhatsApp Channel | 553133261400
2026-11-01 - 2026-11-30
1.00 15.00 15.00 0.00 USD 15.00 USD
Basic WhatsApp Channel | 553192678466
2026-11-01 - 2026-11-30
1.00 15.00 15.00 0.00 USD 15.00 USD
Basic WhatsApp Channel | 553123420610
2026-11-01 - 2026-11-30
1.00 15.00 15.00 0.00 USD 15.00 USD
Basic WhatsApp Channel | 553125591649
2026-11-01 - 2026-11-30
1.00 15.00 15.00 0.00 USD 15.00 USD
Basic WhatsApp Channel | 553193252484
2026-11-01 - 2026-11-30
1.00 15.00 15.00 0.00 USD 15.00 USD
Transaction Fee
1.00 0.00 0.00 0.00 USD 0.00 USD
Subtotal 75.00 USD
Total 75.00 USD
`;

const channels = parse360DialogInvoiceText(CHANNELS);
const channelPhones = channels.lines
  .map((line) => line.whatsappNumber)
  .filter(Boolean);
asserts.push(
  ["channelHeaderPhone", channels.whatsappNumber === null],
  ["channelTotal", channels.total === 75],
  ["channelLineCount", channels.lines.length === 6],
  ["channelPhoneCount", channelPhones.length === 5],
  ["channelFirstPhone", channelPhones[0] === "553133261400"],
  ["channelAmount", channels.lines[0]?.amount === 15],
);

const WABA = `
Invoice number: INV26-008039
Date of issue: 2026-01-01
Bill to Grupo Multifix ti@multifix.com.br
Basic WABA | 552133118888
2026-01-01 - 2026-01-31
1.00 15.00 15.00 0.00 USD 15.00 USD
Basic WABA | 552136192400
2026-01-01 - 2026-01-31
1.00 15.00 15.00 0.00 USD 15.00 USD
Basic WABA | 558231420832
2026-01-01 - 2026-01-31
1.00 15.00 15.00 0.00 USD 15.00 USD
Transaction Fee
1.00 0.00 0.00 0.00 USD 0.00 USD
Subtotal 45.00 USD
Total 45.00 USD
`;

const waba = parse360DialogInvoiceText(WABA);
const wabaPhones = waba.lines.map((line) => line.whatsappNumber).filter(Boolean);
asserts.push(
  ["wabaHeaderPhone", waba.whatsappNumber === null],
  ["wabaTotal", waba.total === 45],
  ["wabaLineCount", waba.lines.length === 4],
  ["wabaPhoneCount", wabaPhones.length === 3],
  ["wabaFirstPhone", wabaPhones[0] === "552133118888"],
  ["wabaDescription", waba.lines[0]?.description === "Basic WABA | 552133118888"],
);

const failed = asserts.filter(([, ok]) => !ok);
if (failed.length > 0) {
  console.error("Parser falhou:", failed.map(([name]) => name));
  console.error(JSON.stringify({ parsed, closing, channels, waba }, null, 2));
  process.exit(1);
}

console.log(
  "Parser OK:",
  parsed.invoiceNumber,
  parsed.whatsappNumber,
  closing.whatsappNumber,
  `channels=${channelPhones.length}`,
  `waba=${wabaPhones.length}`,
);
