'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');

var invoice = require('../lib/invoice');
var pricing = require('../lib/pricing');
var reports = require('../lib/reports');

function billedOrder(items, coupon) {
  var totals = pricing.computeTotals(items, coupon || '');
  return {
    id: 101,
    date: '2026-11-21',
    customer: 'Characterization Customer',
    paymentMode: 'cash',
    status: 'completed',
    items: items,
    coupon: coupon || '',
    subtotal: totals.subtotal,
    discount: totals.discount,
    tax: totals.tax,
    total: totals.total
  };
}

test('invoice total and GST breakdown match the figures used to bill the customer', function () {
  var order = billedOrder([
    { id: 1, name: 'Rice', hsn: '1006', price: 640, qty: 1 },
    { id: 2, name: 'Packaged Tea', hsn: '0902', price: 140, qty: 1 }
  ], 'WELCOME');

  var figures = invoice.computeInvoiceFigures(order);

  assert.deepEqual(
    {
      subtotal: figures.subtotal,
      discount: figures.discount,
      tax: figures.tax,
      cgst: figures.cgst,
      sgst: figures.sgst,
      total: figures.total,
      gstPercentByLine: figures.rows.map(function (row) {
        return row.gstPercent;
      })
    },
    {
      subtotal: order.subtotal,
      discount: order.discount,
      tax: order.tax,
      cgst: 27.17,
      sgst: 27.17,
      total: order.total,
      gstPercentByLine: [5, 18]
    }
  );
});

test('invoice agrees with the billed figures for an undiscounted item at the default GST rate', function () {
  var order = billedOrder([
    { id: 1, name: 'Packaged Tea', hsn: '0902', price: 100, qty: 2 }
  ]);

  var figures = invoice.computeInvoiceFigures(order);

  assert.deepEqual(
    {
      subtotal: figures.subtotal,
      discount: figures.discount,
      tax: figures.tax,
      total: figures.total
    },
    {
      subtotal: order.subtotal,
      discount: order.discount,
      tax: order.tax,
      total: order.total
    }
  );
  assert.equal(figures.rows[0].gstPercent, 18);
});

test('invoice uses the HSN GST slab when the stored line has no gstRate', function () {
  var order = billedOrder([
    { id: 2, name: 'Rice', hsn: '1006', price: 100, qty: 2 }
  ]);

  assert.deepEqual(
    {
      tax: order.tax,
      total: order.total
    },
    {
      tax: 10,
      total: 210
    }
  );

  var figures = invoice.computeInvoiceFigures(order);

  assert.deepEqual(
    {
      tax: figures.tax,
      cgst: figures.cgst,
      sgst: figures.sgst,
      total: figures.total,
      displayedGstPercent: figures.rows[0].gstPercent
    },
    {
      tax: 10,
      cgst: 5,
      sgst: 5,
      total: 210,
      displayedGstPercent: 5
    }
  );
});

test('invoice uses the billed discount and GST breakdown for a percentage coupon', function () {
  var order = billedOrder([
    { id: 3, name: 'Packaged Tea', hsn: '0902', price: 1000, qty: 1 }
  ], 'WELCOME');

  assert.deepEqual(
    {
      discount: order.discount,
      tax: order.tax,
      total: order.total
    },
    {
      discount: 50,
      tax: 171,
      total: 1121
    }
  );

  var figures = invoice.computeInvoiceFigures(order);

  assert.deepEqual(
    {
      discount: figures.discount,
      tax: figures.tax,
      cgst: figures.cgst,
      sgst: figures.sgst,
      total: figures.total
    },
    {
      discount: 50,
      tax: 171,
      cgst: 85.5,
      sgst: 85.5,
      total: 1121
    }
  );
});

test('invoice applies the configured maximum percentage discount', function () {
  var order = billedOrder([
    { id: 4, name: 'Packaged Tea', hsn: '0902', price: 2000, qty: 1 }
  ], 'SAVE10');

  assert.deepEqual(
    {
      discount: order.discount,
      tax: order.tax,
      total: order.total
    },
    {
      discount: 150,
      tax: 333,
      total: 2183
    }
  );

  var figures = invoice.computeInvoiceFigures(order);

  assert.deepEqual(
    {
      discount: figures.discount,
      tax: figures.tax,
      total: figures.total
    },
    {
      discount: 150,
      tax: 333,
      total: 2183
    }
  );
});

test('invoice subtracts a flat coupon before calculating GST', function () {
  var order = billedOrder([
    { id: 5, name: 'Packaged Tea', hsn: '0902', price: 500, qty: 1 }
  ], 'FLAT50');

  assert.deepEqual(
    {
      discount: order.discount,
      tax: order.tax,
      total: order.total
    },
    {
      discount: 50,
      tax: 81,
      total: 531
    }
  );

  var figures = invoice.computeInvoiceFigures(order);

  assert.deepEqual(
    {
      discount: figures.discount,
      tax: figures.tax,
      total: figures.total
    },
    {
      discount: 50,
      tax: 81,
      total: 531
    }
  );
});

test('invoice GST total uses the same per-line rounding as billing', function () {
  var order = billedOrder([
    { id: 6, name: 'Item A', hsn: '0902', price: 0.03, qty: 1 },
    { id: 7, name: 'Item B', hsn: '0902', price: 0.03, qty: 1 },
    { id: 8, name: 'Item C', hsn: '0902', price: 0.03, qty: 1 }
  ]);

  var figures = invoice.computeInvoiceFigures(order);
  var displayedLineTaxTotal = figures.rows.reduce(function (sum, row) {
    return sum + row.lineTax;
  }, 0);

  assert.equal(order.tax, 0.03);
  assert.equal(figures.tax, 0.03);
  assert.equal(displayedLineTaxTotal, 0.03);
  assert.equal(figures.total, 0.12);
  assert.equal(order.total, 0.12);
});

test('rendered invoice does not warn when HSN GST figures match the billed order', function () {
  var order = billedOrder([
    { id: 9, name: 'Rice', hsn: '1006', price: 100, qty: 2 }
  ]);

  var html = invoice.render(order);

  assert.doesNotMatch(html, /Accountant Reconciliation Notice/);
  assert.match(html, /CGST \+ SGST \(Total GST\)<\/td><td class="r">.*10\.00/);
  assert.match(html, /Invoice Total<\/td><td class="r">.*210\.00/);
});

test('rendered invoice gives no warning when GST and discount match the billed order', function () {
  var order = billedOrder([
    { id: 10, name: 'Packaged Tea', hsn: '0902', price: 1000, qty: 1 }
  ], 'WELCOME');

  var html = invoice.render(order);

  assert.doesNotMatch(html, /Accountant Reconciliation Notice/);
  assert.equal(invoice.computeInvoiceFigures(order).tax, 171);
  assert.equal(order.tax, 171);
});

test('reconciliation reports a matched invoice when GST and total agree with billing', function () {
  var order = billedOrder([
    { id: 11, name: 'Packaged Tea', hsn: '0902', price: 1000, qty: 1 }
  ], 'WELCOME');

  var result = reports.getGstReconciliation({ orders: [order] });

  assert.equal(result.totalChecked, 1);
  assert.equal(result.mismatchCount, 0);
  assert.equal(result.totalDelta, 0);
  assert.equal(result.rows[0].matched, true);
  assert.equal(result.rows[0].delta, 0);
  assert.equal(result.rows[0].ledgerTax, 171);
  assert.equal(result.rows[0].invoiceTax, 171);
});
