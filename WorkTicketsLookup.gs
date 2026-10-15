// ============================================================
// Lookup.gs - property picker for the work ticket pages (Oct 15 2026)
// File in the CW Maintenance Work Tickets Apps Script project. doPost routes
// kind 'wo_lookup' here, before the work_order branch.
//
// Source: the customer directory on CW Account FSM Assignments (Account FSM tab),
// kept in sync from the Dynamics "Active Customers" export on the Admin Hub.
// The internal Ops Hub page does NOT use this; it reads alerts_acct_list from the
// main backend with the team passcode. This kind serves the public Vendor Hub copy.
//
// Vendor rule (house rule, do not loosen): a vendor must never be able to pull up
// the client list.
//   group:'kwp'    -> every KWP (7-Eleven) store, one customer's own locations
//   group:'cccnv'  -> every Comprehensive Cancer Centers branch, one customer
//   q:'...'        -> at most 5 accounts, only once the typed text covers most of
//                     the account name (4+ characters and 60% of the letters)
// Nothing here returns FSM names, CRM ids, BC numbers or relationship fields.
// ============================================================
var ACCT_SHEET_ID_DEFAULT = '1KQUwjN6mJzk70d-OeuDguWBHPd2RaqpzusrW25SNz1g'; // CW Account FSM Assignments
var ACCT_TAB = 'Account FSM';

function lkStr_(v) { return (v === null || v === undefined) ? '' : String(v).trim(); }
function lkNorm_(s) { return lkStr_(s).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function lkZip5_(z) { var m = /(\d{5})/.exec(lkStr_(z)); return m ? m[1] : ''; }
function lkCity_(r) { return lkStr_(r.city).toLowerCase().replace(/\b\w/g, function (c) { return c.toUpperCase(); }); }
// Street line only. Some CRM rows carry the whole address in address1 ("7500 N Virginia St, Reno, NV 89506").
function lkStreet_(r) {
  var a1 = lkStr_(r.address1);
  if (a1.indexOf(',') > 0 && lkNorm_(a1).indexOf(lkNorm_(r.city)) > 0) a1 = a1.split(',')[0].trim();
  return [a1, lkStr_(r.address2)].filter(String).join(' ');
}
function lkAddress_(r) {
  var tail = [lkCity_(r), [lkStr_(r.state).toUpperCase(), lkZip5_(r.zip)].filter(String).join(' ')].filter(String).join(', ');
  return [lkStreet_(r), tail].filter(String).join(', ');
}

// Rows from the directory, light objects only.
function lkRows_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('ACCT_SHEET_ID') || ACCT_SHEET_ID_DEFAULT;
  var sh = SpreadsheetApp.openById(id).getSheetByName(ACCT_TAB);
  if (!sh) throw new Error('Directory tab not found');
  var last = sh.getLastRow();
  if (last < 2) return [];
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(lkStr_);
  var want = ['name', 'region', 'address1', 'address2', 'city', 'state', 'zip', 'aliases', 'in_last_import', 'fsm'];
  var col = {};
  want.forEach(function (h) { col[h] = head.indexOf(h); });
  if (col.name < 0) throw new Error('Directory has no name column');
  var vals = sh.getRange(2, 1, last - 1, head.length).getValues();
  var rows = [];
  for (var i = 0; i < vals.length; i++) {
    var r = {};
    want.forEach(function (h) { r[h] = col[h] >= 0 ? vals[i][col[h]] : ''; });
    if (!lkStr_(r.name)) continue;
    if (lkStr_(r.in_last_import).toUpperCase() === 'FALSE') continue; // dropped from the CRM view
    rows.push(r);
  }
  return rows;
}

// KWP (7-Eleven) stores. CRM names look like "KWP - 29384-1100 S Las Vegas BLVD ... Real Estate(v), Ltd."
function lkKwp_(rows) {
  var out = [];
  rows.forEach(function (r) {
    var name = lkStr_(r.name);
    if (!/^\s*KWP\b/i.test(name)) return;
    var m = /KWP\D*(\d{4,6})/i.exec(name);
    var store = m ? m[1] : '';
    var street = lkStreet_(r);
    out.push({
      store: store,
      label: (store ? 'Store ' + store + ' - ' : '') + [street, lkCity_(r)].filter(String).join(', '),
      name: 'KWP' + (store ? ' Store ' + store : '') + ' - ' + street,
      address: lkAddress_(r),
      region: lkStr_(r.region)
    });
  });
  out.sort(function (a, b) { return (a.store || 'zzz') < (b.store || 'zzz') ? -1 : 1; });
  return out;
}

// Comprehensive Cancer Centers branches. Skips the parent (no branch after the dash)
// and the "Special Billing" duplicates, and merges branches that share an address.
function lkCccnv_(rows) {
  var out = [], seen = {};
  rows.forEach(function (r) {
    var name = lkStr_(r.name);
    if (!/comprehensive cancer/i.test(name)) return;
    if (/special billing/i.test(name)) return;
    var m = /comprehensive cancer centers?\s*-\s*(.+)$/i.exec(name);
    if (!m) return; // parent account
    var branch = lkStr_(m[1]);
    var key = lkNorm_(branch);
    if (seen[key]) return;
    seen[key] = 1;
    out.push({ label: branch, name: 'Comprehensive Cancer Centers - ' + branch, address: lkAddress_(r), region: lkStr_(r.region) });
  });
  out.sort(function (a, b) { return a.label.toLowerCase() < b.label.toLowerCase() ? -1 : 1; });
  return out;
}

// Free-text match for the public page. Word-start match, and the typed text has to
// cover at least 60% of the letters in the name (or an alias) before anything comes back.
function lkSearch_(rows, q) {
  var nq = lkNorm_(q);
  if (nq.replace(/\s/g, '').length < 4) return [];
  var out = [];
  rows.forEach(function (r) {
    var names = [lkStr_(r.name)].concat(lkStr_(r.aliases).split('|').map(lkStr_).filter(String));
    var hit = false;
    for (var i = 0; i < names.length && !hit; i++) {
      var n = lkNorm_(names[i]);
      if (!n) continue;
      var starts = n.indexOf(nq) === 0 || n.indexOf(' ' + nq) >= 0;
      if (!starts) continue;
      var need = Math.ceil(n.replace(/\s/g, '').length * 0.6);
      if (nq.replace(/\s/g, '').length >= need) hit = true;
    }
    if (hit) out.push({ label: lkStr_(r.name), name: lkStr_(r.name), address: lkAddress_(r), region: lkStr_(r.region) });
  });
  out.sort(function (a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1; });
  return out.slice(0, 5);
}

function handleLookup(d) {
  var rows = lkRows_();
  var group = lkStr_(d.group).toLowerCase();
  if (group === 'kwp') return { ok: true, group: group, items: lkKwp_(rows) };
  if (group === 'cccnv') return { ok: true, group: group, items: lkCccnv_(rows) };
  return { ok: true, items: lkSearch_(rows, lkStr_(d.q).slice(0, 80)) };
}

// ------------------------------------------------------------ owner stamp -----
// Oct 15 2026: who owns this ticket, for the billing queue (cw-ops-desk/work-tickets.html,
// WorkTicketsHub.gs on the main backend). Exact directory name first, then the KWP store
// number, then the street line. Nothing is written when there is no clean match; the
// main backend tries a fuzzy match later and the page has a Reassign button.
var WT_EXTRA = ['FSM', 'Account', 'Property Group', 'Billed By', 'Billed At', 'Billing Ref', 'Assigned By', 'Assigned At'];
function lkOwner_(property, address) {
  var rows = lkRows_();
  var np = lkNorm_(property);
  if (!np) return null;
  var hit = null;
  rows.forEach(function (r) { if (!hit && lkNorm_(r.name) === np) hit = r; });
  if (!hit) {
    var m = /^kwp\D*(\d{4,6})/i.exec(property);
    if (m) rows.forEach(function (r) { if (!hit && /^\s*KWP\b/i.test(lkStr_(r.name)) && (lkStr_(r.name).indexOf(m[1]) >= 0)) hit = r; });
  }
  if (!hit && address) {
    var street = lkNorm_(String(address).split(',')[0]);
    if (street.length >= 6) rows.forEach(function (r) { if (!hit && lkNorm_(lkStreet_(r)) === street) hit = r; });
  }
  if (!hit || !lkStr_(hit.fsm)) return null;
  return { fsm: lkStr_(hit.fsm).toLowerCase(), name: lkStr_(hit.name) };
}
// Writes owner, account and property group onto the ticket row just inserted at row 2.
// Appends the billing-queue columns to the header the first time.
function wtStamp_(sh, info) {
  var lastC = Math.max(sh.getLastColumn(), 1);
  var head = sh.getRange(1, 1, 1, lastC).getValues()[0].map(lkStr_);
  var missing = WT_EXTRA.filter(function (h) { return head.indexOf(h) < 0; });
  if (missing.length) {
    var need = head.length + missing.length;
    if (sh.getMaxColumns() < need) sh.insertColumnsAfter(sh.getMaxColumns(), need - sh.getMaxColumns());
    sh.getRange(1, head.length + 1, 1, missing.length).setValues([missing])
      .setFontWeight('bold').setFontColor('#FFFFFF').setBackground(RED).setVerticalAlignment('middle').setWrap(false);
    head = head.concat(missing);
  }
  var col = {};
  head.forEach(function (h, i) { if (h && col[h] === undefined) col[h] = i + 1; });
  if (col['Property Group']) sh.getRange(2, col['Property Group']).setValue(lkStr_(info.group));
  var m = lkOwner_(info.property, info.address);
  if (m) {
    sh.getRange(2, col['FSM']).setValue(m.fsm);
    sh.getRange(2, col['Account']).setValue(m.name);
  }
  return m;
}
