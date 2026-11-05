import test from "node:test";
import assert from "node:assert/strict";
import { buildInvoiceHtml, buildPrescriptionHtml, escapeHtml } from "../lib/print-html.mjs";

const hostileValue = `</title><img src=x onerror=alert(1)>`;

function assertSafePrintHtml(html) {
  assert.ok(html.includes("&lt;/title&gt;&lt;img src=x onerror=alert(1)&gt;"));
  assert.equal(html.includes(hostileValue), false);
  assert.doesNotMatch(html, /<img\b/i);
  assert.doesNotMatch(html, /<script\b/i);
  assert.match(html, /script-src 'none'/);
  assert.match(html, /object-src 'none'/);
}

test("escapes HTML text and attribute-significant characters", () => {
  assert.equal(escapeHtml(`&<>"'`), "&amp;&lt;&gt;&quot;&#39;");
});

test("prescription print output escapes all patient, clinic, exam, and prescription values", () => {
  const html = buildPrescriptionHtml({
    patient: { name: hostileValue },
    clinic: { name: hostileValue, phone: hostileValue },
    exam: {
      date: hostileValue,
      examiner: hostileValue,
      pd: hostileValue,
      vaOD: hostileValue,
      vaOS: hostileValue,
      lens: hostileValue,
      refraction: hostileValue,
      notes: hostileValue,
    },
    rx: {
      distance: {
        OD: { SPH: hostileValue, CYL: hostileValue, AXIS: hostileValue },
        OS: { SPH: hostileValue, CYL: hostileValue, AXIS: hostileValue },
      },
      near: {
        OD: { SPH: hostileValue, CYL: hostileValue, AXIS: hostileValue },
        OS: { SPH: hostileValue, CYL: hostileValue, AXIS: hostileValue },
      },
    },
  });
  assertSafePrintHtml(html);
});

test("invoice print output escapes patient, clinic, invoice, product, and formatted money values", () => {
  const html = buildInvoiceHtml({
    invoice: {
      no: hostileValue,
      date: hostileValue,
      total: 100,
      paid: 25,
      returnedTotal: 0,
      items: [{ name: hostileValue, qty: 1, price: 100 }],
    },
    patientName: hostileValue,
    clinicName: hostileValue,
    formatMoney: () => hostileValue,
  });
  assertSafePrintHtml(html);
});
