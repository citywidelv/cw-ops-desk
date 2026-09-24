// ============================================================
// UniformOrders.gs  (CW Solicitations project)  Build 2026-09-24b (need_by always yyyy-MM-dd)
// ------------------------------------------------------------
// One list of every uniform that still has to be ordered, for the Admin Hub
// page cw-admin-hub/uniform-orders.html. Two sources, read live on every call:
//
//   Vendor shop   Orders tab of the CW Vendor Shop Catalog book (UO_SHOP_ID).
//                 Only the uniform lines of each order are returned (SKU in the
//                 shop catalog's Uniforms category, or a UNI- SKU); chemicals and
//                 supplies on the same order are counted but not shown.
//                 "Ordered" = the Order Placed checkbox that the Ops Admin Desk
//                 and the Ops Hub alerts card already read. "Picked up" = Picked Up.
//
//   Employees     Requests tab of the CW Uniform Requests book (UO_EMP_ID), written
//                 by the employee storefront (cw-ops-desk/uniforms.html, its own
//                 satellite script). Every request is a Bennett uniform.
//                 "Ordered" = status column set to Ordered (New when unchecked).
//
// Kinds (prefix uo_, team passcode, routed from doPost before doPostBase):
//   uo_list                     -> { ok, shop:[...], emp:[...], catalog:{sku:{...}}, at }
//   uo_set  {source, row, key, field:'ordered'|'picked', value:true|false, who}
//                               -> { ok, row, key, ordered, picked, status }
// Every change is written to the Site Admin Log (saLog_) under surface uo:shop or
// uo:emp with the old and new value, so the Change Log tab shows who ticked what.
// ============================================================

var UO_SHOP_ID = '1p0CJVr6UJnYTBvAF3-VPBA_6uBHG9BLlByryXLwlOTw';   // CW Vendor Shop Catalog (same book Alerts.gs reads)
var UO_EMP_ID = '1ppNU5OCSclRyA1N98hCDiirk0PktUVlihoezeS8Se3o';    // CW Uniform Requests (employee storefront)
var UO_TZ = 'America/Los_Angeles';
var UO_DONE_DAYS = 120;   // ordered items older than this drop off the page; unordered items never do
var UO_EMP_DONE = ['ordered', 'received', 'done', 'complete', 'completed', 'picked up', 'delivered'];

function uoDispatch(d) {
  var kind = String(d.kind || '');
  if ((d.passcode || '') !== uoPass_()) return uoOut_({ ok: false, error: 'Wrong passcode.' });
  try {
    if (kind === 'uo_list') return uoOut_(uoList_(d));
    if (kind === 'uo_set') return uoOut_(uoSet_(d));
    return uoOut_({ ok: false, error: 'Unknown uo kind: ' + kind });
  } catch (err) {
    return uoOut_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

// ---------------------------------------------------------------- list ----
function uoList_(d) {
  var out = { ok: true, at: new Date().toISOString(), shop: [], emp: [], catalog: {}, errors: [] };
  var cat = {};
  try { cat = uoCatalog_(); } catch (e) { out.errors.push('catalog: ' + e); }
  out.catalog = cat;
  try { out.shop = uoShopRows_(cat); } catch (e) { out.errors.push('shop: ' + e); }
  try { out.emp = uoEmpRows_(); } catch (e) { out.errors.push('employees: ' + e); }
  return out;
}

// Uniform SKUs from the shop catalog tab (the first tab carrying a `sku` header).
// Returns { SKU: { name, bennett, logo, category } }. UNI- SKUs are always uniforms.
function uoCatalog_() {
  var ss = SpreadsheetApp.openById(UO_SHOP_ID);
  var sheets = ss.getSheets(), sh = null;
  for (var i = 0; i < sheets.length; i++) {
    var h = sheets[i].getRange(1, 1, 1, Math.max(1, sheets[i].getLastColumn())).getValues()[0].map(uoStr_).map(function (x) { return x.toLowerCase(); });
    if (h.indexOf('sku') >= 0 && h.indexOf('categories') >= 0) { sh = sheets[i]; break; }
  }
  var out = {};
  if (!sh) return out;
  var rows = uoRows_(sh);
  rows.forEach(function (r) {
    var sku = uoStr_(r['sku'] !== undefined ? r['sku'] : r['SKU']).toUpperCase();
    if (!sku) return;
    var cats = uoStr_(r['categories'] || r['Categories']);
    var isUni = /(^|;|,)\s*uniforms?\s*(;|,|$)/i.test(cats) || /^UNI-/.test(sku);
    if (!isUni) return;
    out[sku] = {
      name: uoStr_(r['name'] || r['Name']),
      bennett: uoStr_(r['supplier_sku'] || r['Supplier SKU']),
      logo: uoStr_(r['logo'] || r['Logo']),
      active: uoTruthy_(r['active'] !== undefined ? r['active'] : 1),
      stock: /vest|apron/i.test(uoStr_(r['name'] || r['Name']))
    };
  });
  return out;
}

// Vendor shop orders that carry at least one uniform line.
function uoShopRows_(cat) {
  var ss = SpreadsheetApp.openById(UO_SHOP_ID);
  var sh = ss.getSheetByName('Orders');
  if (!sh) throw new Error('Orders tab not found on the shop book');
  var cutoff = Date.now() - UO_DONE_DAYS * 86400000;
  var out = [];
  uoRows_(sh).forEach(function (r) {
    var items = uoStr_(r['Items']);
    if (!items) return;
    var parsed = uoParseShopItems_(items, cat);
    if (!parsed.uniform.length) return;
    var when = uoDate_(r['Date']);
    var ordered = uoTruthy_(r['Order Placed']), picked = uoTruthy_(r['Picked Up']);
    if (ordered && when && when.getTime() < cutoff) return;   // old and done: off the page
    var email = uoStr_(r['Email']).toLowerCase();
    out.push({
      source: 'shop',
      key: uoShopKey_(when, email),
      row: r._row,
      when: uoIso_(when), when_nice: uoNice_(when),
      name: uoStr_(r['Vendor Name']), company: uoStr_(r['Company']), email: email,
      account: uoStr_(r['Primary Account']), notes: uoStr_(r['Notes']),
      lines: parsed.uniform, other: parsed.other.length,
      uniform_total: parsed.total,
      total: uoNum_(r['Total']),
      ordered: ordered, picked: picked,
      test: /^(test|zz)\b/i.test(uoStr_(r['Vendor Name'])) || /test order/i.test(uoStr_(r['Company']))
    });
  });
  out.sort(function (a, b) { return (b.when || '').localeCompare(a.when || ''); });
  return out;
}

// "2 x Unisex Dri-Fit T-Shirt [S / Red / Independent Contractor] (UNI-DRIFIT-T / Bennett CWPC380) @ $10.75"
// one per line. Older orders have no Bennett part and no colour.
function uoParseShopItems_(text, cat) {
  var uniform = [], other = [], total = 0;
  String(text).split(/\r?\n/).forEach(function (line) {
    line = line.trim();
    if (!line) return;
    var m = /^(\d+)\s*x\s+(.*?)(?:\s*\[([^\]]*)\])?\s*\(([^()]*)\)\s*(?:@\s*\$?\s*([\d.,]+))?\s*$/.exec(line);
    if (!m) { other.push({ raw: line }); return; }
    var qty = Number(m[1]) || 1, name = m[2].trim(), spec = (m[3] || '').trim(), skuPart = m[4].trim();
    var unit = m[5] ? Number(String(m[5]).replace(/,/g, '')) : 0;
    var sku = skuPart.split('/')[0].trim().toUpperCase();
    var bennett = (/Bennett\s+([A-Za-z0-9-]+)/i.exec(skuPart) || [])[1] || '';
    var c = cat[sku];
    var isUni = !!c || /^UNI-/.test(sku);
    var o = { qty: qty, name: name, spec: spec, sku: sku, bennett: bennett || (c ? c.bennett : ''), unit: unit, logo: c ? c.logo : '', stock: c ? !!c.stock : /vest|apron/i.test(name) };
    if (isUni) { uniform.push(o); total += qty * unit; } else other.push(o);
  });
  return { uniform: uniform, other: other, total: Math.round(total * 100) / 100 };
}

// Employee requests from the storefront.
function uoEmpRows_() {
  var ss = SpreadsheetApp.openById(UO_EMP_ID);
  var sh = ss.getSheetByName('Requests');
  if (!sh) throw new Error('Requests tab not found on the CW Uniform Requests book');
  var cutoff = Date.now() - UO_DONE_DAYS * 86400000;
  var out = [];
  uoRows_(sh).forEach(function (r) {
    var id = uoStr_(r['request_id']);
    if (!id) return;
    var status = uoStr_(r['status']);
    var ordered = UO_EMP_DONE.indexOf(status.toLowerCase()) >= 0;
    var when = uoDate_(r['received']);
    if (ordered && when && when.getTime() < cutoff) return;
    var lines = uoParseEmpItems_(uoStr_(r['items']));
    out.push({
      source: 'emp',
      key: id, row: r._row,
      when: uoIso_(when), when_nice: uoNice_(when),
      name: uoStr_(r['requester']), email: uoStr_(r['email']).toLowerCase(),
      need_by: uoDay_(r['need_by']), reason: uoStr_(r['reason']), notes: uoStr_(r['notes']),
      lines: lines, other: 0,
      uniform_total: uoNum_(r['est_total']), total: uoNum_(r['est_total']),
      ordered: ordered, picked: false, status: status || 'New',
      test: /^(test|zz)\b/i.test(uoStr_(r['requester']))
    });
  });
  out.sort(function (a, b) { return (b.when || '').localeCompare(a.when || ''); });
  return out;
}

// "1 x Mercer+Mettle Polo (SKU CWMM1020) [Logo: FACILITY SOLUTIONS, Color: Anchor Grey, Size: 2XL + $2.00] @ $25.00 = $25.00"
function uoParseEmpItems_(text) {
  var out = [];
  String(text).split(/\r?\n/).forEach(function (line) {
    line = line.trim();
    if (!line) return;
    var m = /^(\d+)\s*x\s+(.*?)\s*\(SKU\s+([^)]+)\)\s*(?:\[([^\]]*)\])?\s*(?:@\s*\$?([\d.,]+))?(?:\s*=\s*\$?([\d.,]+))?\s*$/.exec(line);
    if (!m) { out.push({ qty: 1, name: line, sku: '', spec: '', unit: 0, bennett: '' }); return; }
    var opts = (m[4] || '').split(/,\s*(?=[A-Za-z ]+:)/).map(function (s) { return s.trim(); }).filter(String);
    var spec = opts.map(function (s) { return s.replace(/^[^:]+:\s*/, ''); }).join(' / ');
    out.push({ qty: Number(m[1]) || 1, name: m[2].trim(), sku: m[3].trim(), bennett: m[3].trim(), spec: spec, opts: opts, unit: m[5] ? Number(m[5].replace(/,/g, '')) : 0 });
  });
  return out;
}

// ----------------------------------------------------------------- set ----
function uoSet_(d) {
  var source = String(d.source || ''), row = Number(d.row) || 0, key = uoStr_(d.key), field = String(d.field || 'ordered');
  var value = d.value === true || String(d.value).toUpperCase() === 'TRUE';
  var who = uoStr_(d.who) || 'Admin Hub';
  if (!row || !key) throw new Error('Missing row or key');
  if (field !== 'ordered' && field !== 'picked') throw new Error('Unknown field: ' + field);
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (source === 'shop') return uoSetShop_(row, key, field, value, who);
    if (source === 'emp') return uoSetEmp_(row, key, field, value, who);
    throw new Error('Unknown source: ' + source);
  } finally { lock.releaseLock(); }
}

function uoSetShop_(row, key, field, value, who) {
  var ss = SpreadsheetApp.openById(UO_SHOP_ID);
  var sh = ss.getSheetByName('Orders');
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(uoStr_);
  var cPlaced = head.indexOf('Order Placed') + 1, cPicked = head.indexOf('Picked Up') + 1, cDate = head.indexOf('Date') + 1, cEmail = head.indexOf('Email') + 1;
  if (!cPlaced || !cPicked) throw new Error('Order Placed / Picked Up columns not found');
  var vals = sh.getRange(row, 1, 1, sh.getLastColumn()).getValues()[0];
  var k = uoShopKey_(uoDate_(vals[cDate - 1]), uoStr_(vals[cEmail - 1]).toLowerCase());
  if (k !== key) {
    // the sheet moved under us (a row was sorted or removed); find the order by key instead
    var found = 0, rows = uoRows_(sh);
    for (var i = 0; i < rows.length; i++) {
      if (uoShopKey_(uoDate_(rows[i]['Date']), uoStr_(rows[i]['Email']).toLowerCase()) === key) { found = rows[i]._row; break; }
    }
    if (!found) throw new Error('That order is no longer on the sheet. Refresh the page.');
    row = found; vals = sh.getRange(row, 1, 1, sh.getLastColumn()).getValues()[0];
  }
  var col = field === 'ordered' ? cPlaced : cPicked;
  var oldv = uoTruthy_(vals[col - 1]);
  sh.getRange(row, col).setValue(value);
  if (field === 'picked' && value && !uoTruthy_(vals[cPlaced - 1])) sh.getRange(row, cPlaced).setValue(true);   // picked up means it was ordered
  if (field === 'ordered' && !value && uoTruthy_(vals[cPicked - 1])) sh.getRange(row, cPicked).setValue(false);   // un-ordering also clears picked up
  uoLog_(who, field + (value ? ':on' : ':off'), 'uo:shop', 'Orders', row, head[col - 1], oldv ? 'TRUE' : 'FALSE', value ? 'TRUE' : 'FALSE');
  var after = sh.getRange(row, 1, 1, sh.getLastColumn()).getValues()[0];
  return { ok: true, source: 'shop', row: row, key: key, ordered: uoTruthy_(after[cPlaced - 1]), picked: uoTruthy_(after[cPicked - 1]) };
}

function uoSetEmp_(row, key, field, value, who) {
  if (field !== 'ordered') throw new Error('Employee requests only track Ordered');
  var ss = SpreadsheetApp.openById(UO_EMP_ID);
  var sh = ss.getSheetByName('Requests');
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(uoStr_);
  var cId = head.indexOf('request_id') + 1, cStatus = head.indexOf('status') + 1, cNotes = head.indexOf('notes') + 1;
  if (!cId || !cStatus) throw new Error('request_id / status columns not found');
  var id = uoStr_(sh.getRange(row, cId).getValue());
  if (id !== key) {
    var found = 0, last = sh.getLastRow();
    if (last > 1) {
      var ids = sh.getRange(2, cId, last - 1, 1).getValues();
      for (var i = 0; i < ids.length; i++) if (uoStr_(ids[i][0]) === key) { found = i + 2; break; }
    }
    if (!found) throw new Error('That request is no longer on the sheet. Refresh the page.');
    row = found;
  }
  var oldv = uoStr_(sh.getRange(row, cStatus).getValue());
  var newv = value ? 'Ordered' : 'New';
  sh.getRange(row, cStatus).setValue(newv);
  if (cNotes) {
    var stamp = (value ? 'Ordered ' : 'Un-ordered ') + Utilities.formatDate(new Date(), UO_TZ, 'MMM d, yyyy h:mm a') + ' by ' + who;
    var n = uoStr_(sh.getRange(row, cNotes).getValue());
    sh.getRange(row, cNotes).setValue(n ? n + ' | ' + stamp : stamp);
  }
  uoLog_(who, 'ordered' + (value ? ':on' : ':off'), 'uo:emp', 'Requests', row, 'status', oldv, newv);
  return { ok: true, source: 'emp', row: row, key: key, ordered: value, picked: false, status: newv };
}

// ------------------------------------------------------------- helpers ----
function uoOut_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function uoPass_() {
  try { if (typeof PASSCODE !== 'undefined') return PASSCODE; } catch (e) {}
  return PropertiesService.getScriptProperties().getProperty('PASSCODE') || '';
}
function uoLog_(who, action, surface, tab, row, field, oldv, newv) {
  try { if (typeof saLog_ === 'function') saLog_(who, action, surface, tab, row, field, oldv, newv); } catch (e) {}
}
function uoStr_(v) { return (v === null || v === undefined) ? '' : String(v).trim(); }
function uoNum_(v) { if (typeof v === 'number') return v; var n = Number(String(v || '').replace(/[$,]/g, '')); return isNaN(n) ? 0 : n; }
function uoTruthy_(v) { if (v === true) return true; var s = uoStr_(v).toUpperCase(); return s === 'TRUE' || s === '1' || s === 'YES' || s === 'Y'; }
function uoDate_(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  var s = uoStr_(v); if (!s) return null;
  var d = new Date(s); return isNaN(d.getTime()) ? null : d;
}
// A need-by cell may hold a Date (Sheets converted it) or the text the page sent ("2026-09-18").
function uoDay_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return Utilities.formatDate(v, UO_TZ, 'yyyy-MM-dd');
  var s = uoStr_(v);
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return m[0];
  var d = new Date(s);
  return isNaN(d.getTime()) ? s : Utilities.formatDate(d, UO_TZ, 'yyyy-MM-dd');
}
function uoIso_(d) { return d ? Utilities.formatDate(d, UO_TZ, "yyyy-MM-dd'T'HH:mm:ss") : ''; }
function uoNice_(d) { return d ? Utilities.formatDate(d, UO_TZ, 'MMM d, yyyy h:mm a') : ''; }
function uoShopKey_(when, email) { return 'shop:' + (when ? Utilities.formatDate(when, UO_TZ, 'yyyyMMddHHmmss') : 'nodate') + '|' + (email || ''); }
// Rows as objects keyed by header, with _row = sheet row number. Skips rows with nothing in them.
function uoRows_(sh) {
  var last = sh.getLastRow(), lastC = sh.getLastColumn();
  if (last < 2 || lastC < 1) return [];
  var vals = sh.getRange(1, 1, last, lastC).getValues();
  var head = vals[0].map(uoStr_);
  var out = [];
  for (var i = 1; i < vals.length; i++) {
    var o = { _row: i + 1 }, any = false;
    for (var c = 0; c < head.length; c++) {
      if (!head[c]) continue;
      var v = vals[i][c];
      o[head[c]] = v;
      if (v !== '' && v !== null && v !== undefined && v !== false) any = true;
    }
    if (any) out.push(o);
  }
  return out;
}

// Editor helper: summarizes what the page would receive. Safe to run any time.
function uoSelfTest() {
  var r = uoList_({});
  Logger.log('shop orders with uniforms: ' + r.shop.length + ' (unordered ' + r.shop.filter(function (x) { return !x.ordered; }).length + ')');
  Logger.log('employee requests: ' + r.emp.length + ' (unordered ' + r.emp.filter(function (x) { return !x.ordered; }).length + ')');
  Logger.log('uniform SKUs in catalog: ' + Object.keys(r.catalog).length);
  Logger.log('errors: ' + JSON.stringify(r.errors));
  Logger.log(JSON.stringify(r.shop.slice(0, 2)).slice(0, 1500));
  Logger.log(JSON.stringify(r.emp.slice(0, 2)).slice(0, 1500));
  return r;
}
