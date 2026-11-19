import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aucklandClock24,
  buildCsv,
  checkInvoiceFile,
  csvCell,
  currentMonth,
  formatMoney,
  gstCents,
  invoiceExtension,
  invoicePath,
  isInvoicePathFor,
  isMonth,
  monthLabel,
  monthRange,
  newFileId,
  parseMoney,
  purchasesCsv,
  scaledSize,
  toCents,
  validatePurchase,
  type PurchaseInput,
} from "./purchases.ts";

const SITE = "00000000-0000-0000-0000-000000000003";
const FILE_ID = "6f1c2a9e-1b2c-4d3e-8f90-123456789abc";

test("money: parse typed totals into cents", () => {
  assert.equal(parseMoney("115"), 11500);
  assert.equal(parseMoney("$1,234.50"), 123450);
  assert.equal(parseMoney(" 12.5 "), 1250);
  assert.equal(parseMoney("0.01"), 1);
  assert.equal(parseMoney("0"), null);
  assert.equal(parseMoney("-5"), null);
  assert.equal(parseMoney("12.345"), null);
  assert.equal(parseMoney("abc"), null);
  assert.equal(parseMoney(""), null);
});

test("GST is 3/23 of a GST-inclusive total, like the database", () => {
  assert.equal(gstCents(11500, true), 1500); // 115.00 -> 15.00
  assert.equal(gstCents(2300, true), 300);
  assert.equal(gstCents(1000, true), 130); // 1.3043... -> 1.30
  assert.equal(gstCents(10, true), 1); // 0.013 -> 0.01
  assert.equal(gstCents(11500, false), 0);
});

test("money formatting", () => {
  assert.equal(formatMoney(123450), "$1,234.50");
  assert.equal(formatMoney(1500), "$15.00");
  assert.equal(formatMoney(5), "$0.05");
  assert.equal(toCents("115.00"), 11500);
  assert.equal(toCents(0.29), 29);
});

const good: PurchaseInput = {
  supplier: " Pak'nSave ",
  description: "Onions and rice",
  total: "115",
  gst_included: "yes",
  payment_method: "own_money",
  no_receipt_reason: "",
  comments: "",
};

test("a good purchase with an invoice", () => {
  const { values, errors } = validatePurchase(good, true);
  assert.deepEqual(errors, {});
  assert.deepEqual(values, {
    supplier: "Pak'nSave",
    description: "Onions and rice",
    total_incl_gst: "115.00",
    gst_included: true,
    payment_method: "own_money",
    no_receipt_reason: null,
    comments: null,
  });
});

test("no invoice needs a no-receipt reason", () => {
  assert.ok(validatePurchase(good, false).errors.no_receipt_reason);
  assert.ok(validatePurchase({ ...good, no_receipt_reason: "   " }, false).errors.no_receipt_reason);
  const ok = validatePurchase({ ...good, no_receipt_reason: "Market stall" }, false);
  assert.deepEqual(ok.errors, {});
  assert.equal(ok.values?.no_receipt_reason, "Market stall");
  // With an invoice, a stray reason isn't stored.
  assert.equal(validatePurchase({ ...good, no_receipt_reason: "x" }, true).values?.no_receipt_reason, null);
});

test("missing and invalid fields", () => {
  const { values, errors } = validatePurchase(
    { ...good, supplier: "", description: " ", total: "0", gst_included: "", payment_method: "bitcoin" },
    true,
  );
  assert.equal(values, null);
  assert.deepEqual(Object.keys(errors).sort(), ["description", "gst_included", "payment_method", "supplier", "total"]);
  assert.ok(validatePurchase({ ...good, comments: "x".repeat(501) }, true).errors.comments);
  assert.equal(validatePurchase({ ...good, gst_included: "no" }, true).values?.gst_included, false);
});

test("invoice file checks", () => {
  assert.equal(checkInvoiceFile({ type: "image/jpeg", size: 300_000 }), null);
  assert.equal(checkInvoiceFile({ type: "application/pdf", size: 5 * 1024 * 1024 }), null);
  assert.ok(checkInvoiceFile({ type: "application/pdf", size: 5 * 1024 * 1024 + 1 }));
  assert.ok(checkInvoiceFile({ type: "image/heic", size: 1000 }));
  assert.ok(checkInvoiceFile({ type: "text/plain", size: 1000 }));
  assert.ok(checkInvoiceFile({ type: "image/png", size: 0 }));
  assert.equal(invoiceExtension("image/jpeg"), "jpg");
  assert.equal(invoiceExtension("application/pdf"), "pdf");
  assert.equal(invoiceExtension("image/gif"), null);
});

test("invoice paths use the Auckland month", () => {
  // 31 Oct 2026 at 11:30 UTC is already 1 November in Auckland.
  const path = invoicePath(SITE, new Date("2026-10-31T11:30:00Z"), FILE_ID, "jpg");
  assert.equal(path, `${SITE}/2026/11/${FILE_ID}.jpg`);
  assert.equal(isInvoicePathFor(path, SITE), true);
  assert.equal(isInvoicePathFor(path, "00000000-0000-0000-0000-000000000004"), false);
  assert.equal(isInvoicePathFor(`${SITE}/../x.jpg`, SITE), false);
  assert.equal(isInvoicePathFor(`${SITE}/2026/11/${FILE_ID}.exe`, SITE), false);
});

test("file ids are UUID v4s that fit the invoice path", () => {
  const id = newFileId();
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(newFileId(), id);
  assert.equal(isInvoicePathFor(invoicePath(SITE, new Date(), id, "pdf"), SITE), true);
});

test("photos shrink to 1600 px wide, never grow", () => {
  assert.deepEqual(scaledSize(4032, 3024), { width: 1600, height: 1200 });
  assert.deepEqual(scaledSize(3024, 4032), { width: 1600, height: 2133 });
  assert.deepEqual(scaledSize(800, 600), { width: 800, height: 600 });
});

test("Auckland months as UTC ranges", () => {
  // November is daylight time (UTC+13).
  assert.deepEqual(monthRange("2026-11"), {
    start: "2026-10-31T11:00:00.000Z",
    end: "2026-11-30T11:00:00.000Z",
  });
  // July is standard time (UTC+12); December runs into January.
  assert.equal(monthRange("2026-07").start, "2026-06-30T12:00:00.000Z");
  assert.equal(monthRange("2026-12").end, "2026-12-31T11:00:00.000Z");
  assert.equal(currentMonth(new Date("2026-10-31T11:30:00Z")), "2026-11");
  assert.equal(monthLabel("2026-11"), "November 2026");
  assert.equal(isMonth("2026-11"), true);
  assert.equal(isMonth("2026-13"), false);
  assert.equal(isMonth(undefined), false);
});

test("CSV quoting and formula guard", () => {
  assert.equal(csvCell("plain"), "plain");
  assert.equal(csvCell('Say "hi", ok'), '"Say ""hi"", ok"');
  assert.equal(csvCell("two\nlines"), '"two\nlines"');
  assert.equal(csvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
  assert.equal(csvCell("@sum"), "'@sum");
  assert.equal(csvCell("-1+2"), "'-1+2");
  assert.equal(csvCell(-5), "-5"); // real numbers are left alone
  assert.equal(csvCell(null), "");
  assert.equal(buildCsv(["a", "b"], [["1", 2], [null, "x,y"]]), 'a,b\r\n1,2\r\n,"x,y"\r\n');
});

test("export CSV: Date then Time (24-hour Auckland), one row per purchase", () => {
  const csv = purchasesCsv(
    [
      {
        id: "p1",
        // 01:05 UTC on 20 Nov is 14:05 in Auckland (daylight time, UTC+13).
        purchased_at: "2026-11-20T01:05:00Z",
        supplier: "Pak'nSave",
        description: "Onions, rice",
        total_incl_gst: "115.00",
        gst_amount: "15.00",
        payment_method: "own_money",
        invoice_path: `${SITE}/2026/11/${FILE_ID}.jpg`,
        no_receipt_reason: null,
        site: { name: "Truck - Sandringham" },
        buyer: { name: "Ana" },
      },
      {
        id: "p2",
        // 11:30 UTC on 31 Oct is already 1 Nov, 00:30, in Auckland.
        purchased_at: "2026-10-31T11:30:00Z",
        supplier: "Market",
        description: "Coriander",
        total_incl_gst: 5,
        gst_amount: 0,
        payment_method: "cash",
        invoice_path: null,
        no_receipt_reason: "Stall, no receipts",
        site: null,
        buyer: null,
      },
    ],
    "https://ops.test",
  );
  assert.equal(
    csv,
    "Date,Time,Site,Supplier,Description,Total incl GST,GST,Payment method,Bought by,Invoice link,No receipt reason\r\n" +
      `2026-11-20,14:05,Truck - Sandringham,Pak'nSave,"Onions, rice",115.00,15.00,Own money,Ana,https://ops.test/purchases/invoice/p1,\r\n` +
      '2026-11-01,00:30,,Market,Coriander,5.00,0.00,Till cash,,,"Stall, no receipts"\r\n',
  );
  assert.equal(aucklandClock24("2026-07-01T00:00:00Z"), "12:00"); // winter, UTC+12
});
