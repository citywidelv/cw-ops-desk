// ============================================================
// ShopOrders.gs  (CW Team Portal Backend)  Build 2026-10-02
// Vendor shop orders (cw-vendor-hub/shop). One door for the whole order:
//   POST /exec {kind:'shop_order', ...}  -> row on the Orders tab of the
//   CW Vendor Shop Catalog book (AL_SHOP_ID, the tab Alerts.gs, UniformOrders.gs
//   and the Admin Desk already read), then the internal email and the vendor
//   confirmation. Returns {ok:true, id} only after the row has landed.
//
// Why this exists (Oct 2 2026): the shop used to post to Formspree first and fire
// the sheet webhook (a separate old Apps Script) afterward with no-cors, so a
// dropped webhook write was invisible. An order reached Formspree, never reached
// the sheet, and never showed on the Ops Hub Alerts card. Now the sheet write is
// the order. If it fails the vendor is told and gets the email fallback.
//
// Router line needed in doPost, before doPostBase:
//   if (d && String(d.kind||'').indexOf('shop_') === 0) return shopDispatch(d);
//
// Orders tab headers (unchanged, positional on the live tab):
//   Order Placed | Picked Up | Date | Vendor Name | Company | Email |
//   Primary Account | Notes | Items | Total
// Extra columns are added by header name if missing: Region, Payment, Order ID.
// Alerts.gs keys a shop item on Date + Email, so Date must be a real Date.
// No passcode: this is a public vendor-facing page. Vendors never see each other;
// nothing here reads any other vendor's row.
// ============================================================
var SHOP_TAB = 'Orders';
var SHOP_HEAD = ['Order Placed', 'Picked Up', 'Date', 'Vendor Name', 'Company', 'Email', 'Primary Account', 'Notes', 'Items', 'Total'];
var SHOP_EXTRA = ['Region', 'Payment', 'Order ID'];
var SHOP_REGIONS = { 'Las Vegas': 1, 'Northern Nevada': 1 };
var SHOP_URL = 'https://citywidelv.github.io/cw-vendor-hub/shop/';

function shopDispatch(d) {
  var kind = String(d.kind || '');
  try {
    if (kind === 'shop_order') return _json(shopOrder_(d));
    return _json({ ok: false, error: 'Unknown shop kind: ' + kind });
  } catch (e) {
    return _json({ ok: false, error: 'Shop error: ' + (e && e.message ? e.message : e) });
  }
}

function shopStr_(v) { return (v === null || v === undefined) ? '' : String(v).trim(); }
function shopMoney_(n) { n = Number(n) || 0; return '$' + n.toFixed(2); }

function shopSheet_() {
  var ss = SpreadsheetApp.openById(AL_SHOP_ID);
  var sh = ss.getSheetByName(SHOP_TAB);
  if (!sh) {
    sh = ss.insertSheet(SHOP_TAB);
    sh.getRange(1, 1, 1, SHOP_HEAD.length).setValues([SHOP_HEAD]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  var lastCol = Math.max(sh.getLastColumn(), SHOP_HEAD.length);
  var head = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(shopStr_);
  // Add the extra columns by name so older rows and other readers are untouched.
  SHOP_EXTRA.forEach(function (h) {
    if (head.indexOf(h) < 0) { sh.getRange(1, head.length + 1).setValue(h).setFontWeight('bold'); head.push(h); }
  });
  return { ss: ss, sh: sh, head: head };
}

function shopOrder_(d) {
  var v = d.vendor || {};
  var name = shopStr_(v.name), company = shopStr_(v.company), email = shopStr_(v.email).toLowerCase();
  var account = shopStr_(v.account), notes = shopStr_(v.notes), pay = shopStr_(v.pay) === 'card' ? 'Credit card' : 'Pay deduction';
  var region = shopStr_(v.region || d.region);
  if (!SHOP_REGIONS[region]) region = '';
  if (!name || !company || !email) return { ok: false, error: 'Name, company and email are required.' };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: 'That email address does not look right.' };

  var items = Array.isArray(d.items) ? d.items : [];
  var lines = [];
  var sub = 0;
  items.forEach(function (it) {
    if (!it) return;
    var qty = Math.max(1, Math.min(999, Math.round(Number(it.qty) || 1)));
    var unit = Math.max(0, Number(it.unit) || 0);
    var nm = shopStr_(it.name);
    if (!nm) return;
    var spec = shopStr_(it.spec || it.size);
    var sku = shopStr_(it.sku) + (shopStr_(it.supplier_sku) ? ' / Bennett ' + shopStr_(it.supplier_sku) : '');
    lines.push({ qty: qty, name: nm, spec: spec, sku: sku, unit: unit, line: +(qty * unit).toFixed(2), fulfillment: shopStr_(it.fulfillment) });
    sub += qty * unit;
  });
  if (!lines.length) return { ok: false, error: 'The cart is empty.' };

  var discount = Math.max(0, Number(d.discount) || 0);
  var coupon = shopStr_(d.coupon), couponLabel = shopStr_(d.coupon_label);
  var total = +Math.max(0, sub - discount).toFixed(2);
  var now = new Date();
  var id = 'SHOP-' + Utilities.formatDate(now, AL_TZ, 'yyMMddHHmm') + '-' + Math.random().toString(36).slice(2, 5).toUpperCase();

  // Same text shape the Orders tab has always held, so the Alerts card and the
  // Admin Desk keep reading it the same way.
  var itemsText = lines.map(function (l) {
    return l.qty + ' x ' + l.name + (l.spec ? ' [' + l.spec + ']' : '') + ' (' + l.sku + ') @ $' + l.unit;
  }).join('\n');
  var noteOut = notes;
  if (coupon) noteOut = (noteOut ? noteOut + ' | ' : '') + 'Vendor of the Month award ' + coupon + ' applied: -' + shopMoney_(discount);

  var t = shopSheet_();
  var byName = {
    'Order Placed': false, 'Picked Up': false, 'Date': now, 'Vendor Name': name, 'Company': company,
    'Email': email, 'Primary Account': account, 'Notes': noteOut, 'Items': itemsText, 'Total': total,
    'Region': region, 'Payment': pay, 'Order ID': id
  };
  var row = t.head.map(function (h) { return byName.hasOwnProperty(h) ? byName[h] : ''; });
  var r = t.sh.getLastRow() + 1;
  t.sh.getRange(r, 1, 1, row.length).setValues([row]);
  try {
    var rule = SpreadsheetApp.newDataValidation().requireCheckbox().build();
    var cP = t.head.indexOf('Order Placed') + 1, cK = t.head.indexOf('Picked Up') + 1;
    if (cP) t.sh.getRange(r, cP).setDataValidation(rule);
    if (cK) t.sh.getRange(r, cK).setDataValidation(rule);
    var cD = t.head.indexOf('Date') + 1;
    if (cD) t.sh.getRange(r, cD).setNumberFormat('M/d/yyyy H:mm:ss');
  } catch (fe) { /* formatting never fails an order */ }
  // Prove the row is there before anything else happens.
  var back = t.sh.getRange(r, t.head.indexOf('Order ID') + 1).getValue();
  if (shopStr_(back) !== id) return { ok: false, error: 'The order did not save. Nothing was submitted. Please try again.' };

  var order = { id: id, when: now, name: name, company: company, email: email, account: account, notes: notes, pay: pay, region: region,
    lines: lines, sub: sub, discount: discount, coupon: coupon, couponLabel: couponLabel, total: total };

  var to = REGION_EMAIL[region] || REGION_EMAIL['Las Vegas'];
  if (d._nomail) return { ok: true, id: id, total: total, nomail: true };   // editor self test only
  try {
    cwMail_('shop_int', {
      to: to,
      replyTo: email,
      subject: 'Vendor shop order: ' + company + ' (' + shopMoney_(total) + ') [' + id + ']',
      htmlBody: shopEmail_(order, false),
      body: shopText_(order),
      digest: { title: 'Vendor shop order ' + id, region: region, id: id,
        fields: [['Vendor', name + ' (' + company + ')'], ['Email', email], ['Account', account || 'not given'], ['Total', shopMoney_(total)], ['Payment', pay]],
        links: [['Open the Orders tab', t.ss.getUrl()]] }
    });
  } catch (m1) {}
  try {
    cwMail_('shop_conf', {
      to: email,
      replyTo: to,
      subject: 'Order received: City Wide Vendor Shop [' + id + ']',
      htmlBody: shopEmail_(order, true),
      body: 'City Wide received your vendor shop order ' + id + '.\n\n' + shopText_(order)
    });
  } catch (m2) {}

  return { ok: true, id: id, total: total };
}

function shopText_(o) {
  var out = [
    'VENDOR ORDER ' + o.id + ' - ' + Utilities.formatDate(o.when, AL_TZ, 'EEEE, MMMM d, yyyy h:mm a'),
    'Name: ' + o.name, 'Company: ' + o.company, 'Email: ' + o.email,
    'Primary Account: ' + (o.account || 'not given'),
    'Region: ' + (o.region || 'not given'),
    o.notes ? 'Notes: ' + o.notes : null,
    '', 'ITEMS:'
  ];
  o.lines.forEach(function (l) {
    out.push(l.qty + ' x ' + l.name + (l.spec ? ' [' + l.spec + ']' : '') + ' (' + l.sku + ') @ ' + shopMoney_(l.unit) + ' = ' + shopMoney_(l.line) + (l.fulfillment ? ' [' + l.fulfillment + ']' : ''));
  });
  out.push('');
  if (o.coupon) { out.push('Subtotal: ' + shopMoney_(o.sub)); out.push('Vendor of the Month award (' + o.coupon + (o.couponLabel ? ', ' + o.couponLabel : '') + '): -' + shopMoney_(o.discount)); }
  out.push('Estimated total' + (o.coupon ? ' after award' : '') + ': ' + shopMoney_(o.total));
  out.push('Payment: ' + (o.pay === 'Credit card' ? 'Credit card on file (vendor approves the total before we charge)' : 'Pay deduction (authorized at checkout)'));
  return out.filter(function (x) { return x !== null; }).join('\n');
}

function shopEmail_(o, forVendor) {
  var F = 'font-family:Verdana,Arial,sans-serif;';
  var rows = '';
  o.lines.forEach(function (l) {
    rows += '<tr>' +
      '<td style="' + F + 'font-size:13px;color:#2d2a26;padding:9px 8px;border-bottom:1px solid #eeeeee;">' + _esc(l.name) + (l.spec ? ' <span style="color:#636466">[' + _esc(l.spec) + ']</span>' : '') + '<br><span style="font-size:11px;color:#636466;">' + _esc(l.sku) + (l.fulfillment ? ' &middot; ' + _esc(l.fulfillment) : '') + '</span></td>' +
      '<td align="center" style="' + F + 'font-size:13px;font-weight:bold;color:#2d2a26;padding:9px 8px;border-bottom:1px solid #eeeeee;">' + l.qty + '</td>' +
      '<td align="right" style="' + F + 'font-size:13px;color:#2d2a26;padding:9px 8px;border-bottom:1px solid #eeeeee;white-space:nowrap;">' + shopMoney_(l.line) + '</td></tr>';
  });
  var when = Utilities.formatDate(o.when, AL_TZ, 'EEEE, MMMM d, yyyy h:mm a');
  var intro = forVendor
    ? '<h1 style="margin:0 0 4px;' + F + 'font-size:19px;font-weight:bold;color:#D22730;">Order Received</h1>' +
      '<p style="margin:0 0 18px;' + F + 'font-size:13px;line-height:1.55;color:#636466;">Thanks, ' + _esc(o.name) + '. City Wide received your order <b>' + _esc(o.id) + '</b>. ' +
      'Prices are estimates. You will be contacted if anything needs clarification. Reply to this email with questions.</p>'
    : '<h1 style="margin:0 0 4px;' + F + 'font-size:19px;font-weight:bold;color:#D22730;">Vendor Shop Order</h1>' +
      '<p style="margin:0 0 14px;' + F + 'font-size:13px;color:#636466;">' + _esc(o.id) + ' &middot; ' + when + '</p>' +
      '<table border="0" cellpadding="0" cellspacing="0" style="margin:0 0 16px;">' +
      _kvRow('Vendor', o.name + ' (' + o.company + ')') + _kvRow('Email', o.email) +
      _kvRow('Primary account', o.account || 'not given') + _kvRow('Region', o.region || 'not given') + _kvRow('Payment', o.pay) +
      '</table>';
  var note = o.notes
    ? '<p style="margin:16px 0 0;' + F + 'font-size:13px;line-height:1.55;color:#2d2a26;border-left:4px solid #D22730;background-color:#f5f5f5;padding:10px 12px;"><b>Notes:</b> ' + _esc(o.notes) + '</p>'
    : '';
  var totals = '';
  if (o.coupon) {
    totals += '<tr><td colspan="2" align="right" style="' + F + 'font-size:12px;color:#636466;padding:8px 8px 2px;">Subtotal</td><td align="right" style="' + F + 'font-size:12px;color:#636466;padding:8px 8px 2px;">' + shopMoney_(o.sub) + '</td></tr>' +
      '<tr><td colspan="2" align="right" style="' + F + 'font-size:12px;color:#067679;padding:2px 8px;">Vendor of the Month award (' + _esc(o.coupon) + ')</td><td align="right" style="' + F + 'font-size:12px;color:#067679;padding:2px 8px;">-' + shopMoney_(o.discount) + '</td></tr>';
  }
  totals += '<tr><td colspan="2" align="right" style="' + F + 'font-size:14px;font-weight:bold;color:#2d2a26;padding:10px 8px;">Estimated total</td><td align="right" style="' + F + 'font-size:14px;font-weight:bold;color:#2d2a26;padding:10px 8px;">' + shopMoney_(o.total) + '</td></tr>';
  return '' +
    '<table bgcolor="#f4f4f4" border="0" cellpadding="0" cellspacing="0" width="100%"><tr><td align="center" style="padding:20px 0;">' +
    '<table bgcolor="#ffffff" border="0" cellpadding="0" cellspacing="0" width="620">' +
    '<tr><td style="padding:22px 30px 0;"><img src="' + LOGO + '" width="200" alt="City Wide Facility Solutions" style="display:block;border:0;"></td></tr>' +
    '<tr><td style="padding:18px 30px 30px;">' + intro +
    '<table border="0" cellpadding="0" cellspacing="0" width="100%">' +
    '<tr><th align="left" style="' + F + 'font-size:11px;color:#636466;text-transform:uppercase;letter-spacing:.04em;padding:6px 8px;border-bottom:2px solid #D22730;">Item</th>' +
    '<th align="center" style="' + F + 'font-size:11px;color:#636466;text-transform:uppercase;letter-spacing:.04em;padding:6px 8px;border-bottom:2px solid #D22730;">Qty</th>' +
    '<th align="right" style="' + F + 'font-size:11px;color:#636466;text-transform:uppercase;letter-spacing:.04em;padding:6px 8px;border-bottom:2px solid #D22730;">Line</th></tr>' +
    rows + totals + '</table>' + note +
    (forVendor ? '' : '<p style="margin:18px 0 0;' + F + 'font-size:12px;color:#636466;">This order is on the Ops Hub Alerts card. Mark it Processed there when it goes to the supplier and Picked up when the vendor collects it.</p>') +
    '</td></tr>' +
    '<tr><td style="padding:14px 30px;border-top:1px solid #eeeeee;' + F + 'font-size:11px;color:#636466;">City Wide Facility Solutions &middot; <a href="' + SHOP_URL + '" style="color:#D22730;">Vendor Shop</a> &middot; GoCityWide</td></tr>' +
    '</table></td></tr></table>';
}

// Editor helper: proves the write path without sending mail. Run once, then
// clear the test row's contents on the Orders tab (never delete rows).
function shopSelfTestRun() {
  var r = shopOrder_({ vendor: { name: 'TEST - shop_order', company: 'TEST ORDER - safe to clear', email: CW_TEST_TO, account: 'Test Property', notes: 'shopSelfTestRun', pay: 'deduct', region: 'Las Vegas' }, _nomail: true,
    items: [{ sku: '122-06Q', name: 'OxiGenesis Disinfectant RTU 32oz', qty: 1, unit: 12 }] });
  Logger.log(JSON.stringify(r));
}
