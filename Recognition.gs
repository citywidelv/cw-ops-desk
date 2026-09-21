// ============================================================
// Recognition.gs - Vendor of the Month and G.O.A.T. of the Month (Sep 11 2026)
// File in the CW Solicitations Apps Script project.
// Routing: doPost in Code.gs routes any kind starting 'rec_' to recDispatch(data).
//          doGet in Code.gs returns recWall_() when e.parameter.recognition is set.
//
// Own spreadsheet ("CW Recognition"), created by rec_setup and remembered in the
// REC_SHEET_ID script property (one sheet per purpose). Two tabs:
//   Winners      one row per engraved plate. type vendor|goat, region, year, month,
//                name, vendor_id (join to the CW Vendor Directory when known),
//                staff_name, blurb, added, added_by, hidden
//   Nominations  one row per nomination. Nobody is emailed (TJ's call, Sep 11 2026);
//                the queue is read on the Admin Hub recognition page.
//
// Kinds
//   public, no passcode:
//     rec_nominate   from the Vendor Hub and the Ops Hub. Honeypot field 'website'.
//     rec_staff      names and titles only, for the public G.O.A.T. picker. No phones,
//                    no emails, ever.
//     rec_vendor_hint  autocomplete for the public nominate page. Returns at most 3
//                    vendor names, and only when the typed text already covers 60% of a
//                    name from its start, so a vendor can finish a name they know but
//                    can never browse the directory (TJ's rule, Sep 11 2026).
//     GET ?recognition=1   the wall: every visible winner, grouped by region and year.
//   team passcode required (checked here on the server, like vd_*):
//     rec_setup, rec_list, rec_save, rec_remove, rec_nom_status
//
// Winner names on the public wall are the plate text only. vendor_id never leaves
// the server on the public feed.
//
// Sep 21 2026: Vendor of the Month coupons and certificates. Two more tabs on the same book:
//   Coupons      one row per code. VOTM-MMYY-XXXXX, $150 off one Vendor Shop order, one time,
//                whole code on one transaction (the unused part is forfeited). Issued from the
//                Admin Hub (rec_coupon_issue) and redeemed by the shop checkout (public kinds
//                rec_coupon_check / rec_coupon_redeem / rec_coupon_release, all server-side,
//                so no code ever sits in page source).
//   Sends        one row per certificate email (rec_cert_send). The PDF is drawn in the browser
//                (cw-admin-hub/cert.js), posted here as base64, mailed from the company Google
//                account with the vendor in To and the staff lists in CC as the admin left them,
//                and filed in the Drive folder "CW Recognition Certificates".
// ============================================================

var REC_PROP = 'REC_SHEET_ID';
var REC_TABS = { WIN: 'Winners', NOM: 'Nominations' };
var REC_WIN_HEADERS = ['id', 'type', 'region', 'year', 'month', 'name', 'vendor_id', 'staff_name', 'blurb', 'added', 'added_by', 'hidden'];
var REC_NOM_HEADERS = ['id', 'received', 'type', 'region', 'nominee', 'vendor_id', 'nominator_first', 'nominator_company', 'reason', 'source', 'status', 'reviewed_by', 'reviewed_at'];
var REC_TYPES = ['vendor', 'goat'];
var REC_REGIONS = ['Las Vegas', 'Northern Nevada'];
var REC_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
var REC_NOM_STATUS = ['New', 'Awarded', 'Declined'];
var REC_TABS_X = { CPN: 'Coupons', SND: 'Sends' };
var REC_CPN_HEADERS = ['code', 'winner_id', 'type', 'region', 'year', 'month', 'name', 'vendor_id', 'amount', 'status', 'issued', 'issued_by',
  'redeemed_at', 'redeemed_name', 'redeemed_company', 'redeemed_email', 'redeemed_account', 'order_subtotal', 'discount', 'release_token',
  'voided_at', 'voided_by', 'notes'];
var REC_SND_HEADERS = ['sent', 'winner_id', 'name', 'year', 'month', 'region', 'to', 'cc', 'subject', 'coupon_code', 'has_pdf', 'test', 'sent_by', 'status', 'error', 'cert_url'];
var REC_CPN_STATUS = ['Issued', 'Redeemed', 'Void'];
var REC_COUPON_AMOUNT = 150;
var REC_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no 0/O or 1/I, so a typed code is never ambiguous
var REC_SHOP_URL = 'https://citywidelv.github.io/cw-vendor-hub/shop/';
var REC_CERT_FOLDER = 'CW Recognition Certificates';
var REC_LOGO = 'https://emfluence-media.s3.amazonaws.com/2023/07/City-Wide-Logo-Horizontal-1.png';
var REC_SENDERS = {
  'Las Vegas':       { name: 'City Wide of Las Vegas',       reply: 'lvservicecall@gocitywide.com', office: 'Las Vegas' },
  'Northern Nevada': { name: 'City Wide of Northern Nevada', reply: 'rnservicecall@gocitywide.com', office: 'Reno' }
};

// The two Las Vegas plaques photographed Sep 11 2026. Seeded once by rec_setup.
var REC_SEED = [
  [2025, 1, 'JGS Janitorial LLC'], [2025, 2, 'JGS Janitorial LLC'], [2025, 3, 'UCS USA, LLC'],
  [2025, 4, 'Janitorial Specialists Inc.'], [2025, 5, "Martha's Coverall LLC"], [2025, 6, "Granda's Cleaning, LLC"],
  [2025, 7, 'Venturaevans Cleaning'], [2025, 8, 'Go-Bright Cleaning Solutions LLC'], [2025, 9, 'White Glove Cleaning Services LLC'],
  [2025, 10, 'Top Tier Services LLC'], [2025, 11, 'TRP Landscaping and Lawn Care LLC'], [2025, 12, 'L and T Janitorial Services LLC'],
  [2026, 1, 'Sanitation Engineer'], [2026, 2, 'TRP Landscaping LLC'], [2026, 3, 'Sparkling Cleaning Solutions'],
  [2026, 4, 'Glass Cactus Cleaning'], [2026, 5, 'Lobo Cleaning LV'], [2026, 6, 'Sparkling Cleaning Solutions'],
  [2026, 7, 'Virignack Facility Solutions']
];

function recPass_() {
  try { if (typeof PASSCODE !== 'undefined') return PASSCODE; } catch (e) {}
  return PropertiesService.getScriptProperties().getProperty('PASSCODE') || '';
}
function recOut_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
function recStr_(v) { return v == null ? '' : String(v).trim(); }
function recTrue_(v) { return recStr_(v).toUpperCase() === 'TRUE'; }
function recNow_() { return Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyyy-MM-dd HH:mm'); }
function recRegion_(v) {
  var s = recStr_(v).toLowerCase();
  if (/north|reno|nnv/.test(s)) return 'Northern Nevada';
  return 'Las Vegas';
}
function recType_(v) { return recStr_(v).toLowerCase() === 'goat' ? 'goat' : 'vendor'; }

function recDispatch(data) {
  var kind = String(data.kind || '');
  if (kind === 'rec_nominate') return recNominate_(data);
  if (kind === 'rec_staff') return recStaffPublic_();
  if (kind === 'rec_wall') return recOut_(recWall_());
  if (kind === 'rec_vendor_hint') return recVendorHint_(data);
  if (kind === 'rec_coupon_check') return recCouponCheck_(data);
  if (kind === 'rec_coupon_redeem') return recCouponRedeem_(data);
  if (kind === 'rec_coupon_release') return recCouponRelease_(data);
  if ((data.passcode || '') !== recPass_()) return recOut_({ ok: false, error: 'Bad passcode' });
  if (kind === 'rec_setup') return recSetup_(data);
  if (kind === 'rec_list') return recList_(data);
  if (kind === 'rec_save') return recSave_(data);
  if (kind === 'rec_remove') return recRemove_(data);
  if (kind === 'rec_nom_status') return recNomStatus_(data);
  if (kind === 'rec_coupon_issue') return recCouponIssue_(data);
  if (kind === 'rec_coupon_void') return recCouponVoid_(data);
  if (kind === 'rec_cert_send') return recCertSend_(data);
  return recOut_({ ok: false, error: 'Unknown kind ' + kind });
}

// ------------------------------------------------------------ sheet ----------
function recSS_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(REC_PROP);
  if (id) { try { return SpreadsheetApp.openById(id); } catch (e) {} }
  var ss = SpreadsheetApp.create('CW Recognition');
  props.setProperty(REC_PROP, ss.getId());
  return ss;
}
function recTab_(ss, name, headers, color) {
  var sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); }
  var have = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0] : [];
  if (String(have[0] || '') !== headers[0]) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
    if (color) sh.setTabColor(color);
  }
  return sh;
}
function recRows_(sh) {
  var v = sh.getDataRange().getValues();
  if (v.length < 2) return { head: v[0] || [], rows: [] };
  var head = v[0].map(function (h) { return String(h); });
  var rows = [];
  for (var i = 1; i < v.length; i++) {
    if (!recStr_(v[i][0])) continue;
    var o = { _row: i + 1 };
    head.forEach(function (h, c) {
      var cell = v[i][c];
      if (cell instanceof Date) cell = Utilities.formatDate(cell, 'America/Los_Angeles', 'yyyy-MM-dd HH:mm');
      o[h] = cell;
    });
    rows.push(o);
  }
  return { head: head, rows: rows };
}
function recNextRow_(sh) {
  var col = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1) + 1, 1).getValues();
  for (var i = 1; i < col.length; i++) { if (!recStr_(col[i][0])) return i + 1; }
  return col.length + 1;
}
function recId_(prefix) {
  return prefix + '-' + Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyMMdd') + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
}

function recSetup_(data) {
  var ss = recSS_();
  var win = recTab_(ss, REC_TABS.WIN, REC_WIN_HEADERS, '#D22730');
  var nom = recTab_(ss, REC_TABS.NOM, REC_NOM_HEADERS, '#636466');
  var first = ss.getSheets()[0];
  if (first.getName() === 'Sheet1' && ss.getSheets().length > 1) ss.deleteSheet(first);
  // dropdowns so hand edits stay clean
  var rule = function (list) { return SpreadsheetApp.newDataValidation().requireValueInList(list, true).setAllowInvalid(false).build(); };
  win.getRange(2, 2, 999, 1).setDataValidation(rule(REC_TYPES));
  win.getRange(2, 3, 999, 1).setDataValidation(rule(REC_REGIONS));
  win.getRange(2, 12, 999, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
  nom.getRange(2, 3, 999, 1).setDataValidation(rule(REC_TYPES));
  nom.getRange(2, 4, 999, 1).setDataValidation(rule(REC_REGIONS));
  nom.getRange(2, 11, 999, 1).setDataValidation(rule(REC_NOM_STATUS));
  win.setColumnWidth(6, 260); win.setColumnWidth(9, 320);
  nom.setColumnWidth(5, 220); nom.setColumnWidth(9, 380);

  var seeded = 0;
  if (!recRows_(win).rows.length) {
    var dir = recDirectoryIndex_();
    var out = REC_SEED.map(function (s) {
      return [recId_('VM'), 'vendor', 'Las Vegas', s[0], s[1], s[2], dir[s[2].toLowerCase()] || '', '', '', recNow_(), 'plaque seed', false];
    });
    win.getRange(2, 1, out.length, REC_WIN_HEADERS.length).setValues(out);
    seeded = out.length;
  }
  return recOut_({ ok: true, url: ss.getUrl(), seeded: seeded });
}

// Map of lowercased dba_name / legal_name -> vendor_id from the CW Vendor Directory,
// used to link a plate to the directory automatically when the names match.
function recDirectoryIndex_() {
  var idx = {};
  try {
    if (typeof vdSS_ !== 'function' || typeof vdAllRows_ !== 'function') return idx;
    vdAllRows_(vdSS_()).forEach(function (r) {
      if (!r.vendor_id) return;
      if (r.dba_name) idx[String(r.dba_name).toLowerCase().trim()] = r.vendor_id;
      if (r.legal_name) idx[String(r.legal_name).toLowerCase().trim()] = r.vendor_id;
    });
  } catch (e) {}
  return idx;
}

// ------------------------------------------------------------ public ---------
// The wall. Also embedded (as a fallback copy) in the Vendor Hub index.html.
function recWall_() {
  var ss = recSS_();
  var win = ss.getSheetByName(REC_TABS.WIN);
  if (!win) return { ok: false, error: 'Run rec_setup first.' };
  var items = recRows_(win).rows.filter(function (r) { return !recTrue_(r.hidden) && recStr_(r.name); })
    .map(function (r) {
      return { type: recType_(r.type), region: recRegion_(r.region), year: Number(r.year) || 0,
               month: Number(r.month) || 0, name: recStr_(r.name), blurb: recStr_(r.blurb) };
    });
  items.sort(function (a, b) { return (b.year - a.year) || (b.month - a.month); });
  return { ok: true, count: items.length, items: items, generated: recNow_() };
}

function recStaffPublic_() {
  var out = [];
  try {
    if (typeof staffSS_ === 'function') {
      var sh = staffSS_().getSheetByName('Staff');
      var v = sh ? sh.getDataRange().getValues() : [];
      for (var i = 1; i < v.length; i++) {
        if (!recStr_(v[i][0])) continue;
        if (String(v[i][5]).toUpperCase() === 'FALSE') continue;
        out.push({ name: recStr_(v[i][0]), role: recStr_(v[i][1]), market: recStr_(v[i][2]) });
      }
    }
  } catch (e) {}
  if (!out.length && typeof FSM_ROSTER !== 'undefined') {
    Object.keys(FSM_ROSTER).forEach(function (k) { out.push({ name: FSM_ROSTER[k].name, role: FSM_ROSTER[k].title, market: FSM_ROSTER[k].region }); });
  }
  out.sort(function (a, b) { return a.name < b.name ? -1 : 1; });
  return recOut_({ ok: true, staff: out });
}

function recVendorHint_(data) {
  var q = recStr_(data.q).toLowerCase().replace(/\s+/g, ' ');
  if (q.length < 4) return recOut_({ ok: true, names: [] });
  var seen = {}, names = [];
  try {
    vdAllRows_(vdSS_()).forEach(function (r) {
      if (recTrue_(r.hide)) return;
      [r.dba_name, r.legal_name].forEach(function (n) {
        n = recStr_(n); if (!n) return;
        var k = n.toLowerCase().replace(/\s+/g, ' ');
        if (k.indexOf(q) !== 0) return;
        if (q.length < Math.ceil(k.length * 0.6)) return;
        if (!seen[k]) { seen[k] = 1; names.push(n); }
      });
    });
  } catch (e) {}
  return recOut_({ ok: true, names: names.slice(0, 3) });
}

function recNominate_(data) {
  if (recStr_(data.website)) return recOut_({ ok: true, id: 'ok' });   // honeypot
  var type = recType_(data.type);
  var nominee = recStr_(data.nominee).slice(0, 120);
  var first = recStr_(data.nominator_first).slice(0, 60);
  var reason = recStr_(data.reason).slice(0, 1500);
  if (!nominee) return recOut_({ ok: false, error: 'Who are you nominating?' });
  if (!first) return recOut_({ ok: false, error: 'Add your first name. Nominations are not anonymous.' });
  if (!reason) return recOut_({ ok: false, error: 'Tell us why in a sentence or two.' });
  var ss = recSS_();
  var nom = recTab_(ss, REC_TABS.NOM, REC_NOM_HEADERS, '#636466');
  var id = recId_(type === 'goat' ? 'GN' : 'VN');
  var row = [id, recNow_(), type, recRegion_(data.region), nominee, recStr_(data.vendor_id).slice(0, 20), first,
             recStr_(data.nominator_company).slice(0, 120), reason, recStr_(data.source || 'vendor-hub').slice(0, 30), 'New', '', ''];
  nom.getRange(recNextRow_(nom), 1, 1, REC_NOM_HEADERS.length).setValues([row]);
  return recOut_({ ok: true, id: id });
}

// ------------------------------------------------------------ admin ----------
function recList_(data) {
  var ss = recSS_();
  var win = ss.getSheetByName(REC_TABS.WIN), nom = ss.getSheetByName(REC_TABS.NOM);
  if (!win || !nom) return recOut_({ ok: false, error: 'Run rec_setup first.' });
  var winners = recRows_(win).rows.map(function (r) {
    return { id: recStr_(r.id), type: recType_(r.type), region: recRegion_(r.region), year: Number(r.year) || 0, month: Number(r.month) || 0,
             name: recStr_(r.name), vendor_id: recStr_(r.vendor_id), staff_name: recStr_(r.staff_name), blurb: recStr_(r.blurb),
             added: recStr_(r.added), added_by: recStr_(r.added_by), hidden: recTrue_(r.hidden) };
  });
  winners.sort(function (a, b) { return (b.year - a.year) || (b.month - a.month); });
  // Sep 21 2026: contact email from the directory, the live coupon and the last certificate send
  var contacts = recDirectoryContacts_();
  var coupons = recCoupons_(ss), sends = recSends_(ss);
  var lastSend = {}; sends.forEach(function (x) { if (!x.test && (!lastSend[x.winner_id] || x.sent > lastSend[x.winner_id].sent)) lastSend[x.winner_id] = x; });
  var liveCoupon = {}; coupons.forEach(function (c) { if (c.status !== 'Void') liveCoupon[c.winner_id] = c; });
  winners.forEach(function (w) {
    var ct = contacts[w.vendor_id] || {};
    w.email = ct.email || ''; w.contact = ct.contact || '';
    w.coupon = liveCoupon[w.id] || null;
    w.last_sent = lastSend[w.id] ? { sent: lastSend[w.id].sent, to: lastSend[w.id].to, cc: lastSend[w.id].cc, by: lastSend[w.id].sent_by, cert_url: lastSend[w.id].cert_url } : null;
  });
  var noms = recRows_(nom).rows.map(function (r) {
    var o = {}; REC_NOM_HEADERS.forEach(function (h) { o[h] = recStr_(r[h]); }); o.type = recType_(o.type); return o;
  });
  noms.sort(function (a, b) { return a.received < b.received ? 1 : -1; });
  return recOut_({ ok: true, winners: winners, nominations: noms, coupons: coupons, sends: sends, url: ss.getUrl(),
                   coupon_amount: REC_COUPON_AMOUNT, shop_url: REC_SHOP_URL });
}

// Add or update one plate. Same type+region+year+month replaces the existing row,
// so re-saving a month is an edit, not a duplicate.
function recSave_(data) {
  var w = data.winner || {};
  var type = recType_(w.type), region = recRegion_(w.region);
  var year = Number(w.year) || 0, month = Number(w.month) || 0;
  var name = recStr_(w.name).slice(0, 120);
  if (!name) return recOut_({ ok: false, error: 'Name is required.' });
  if (year < 2015 || year > 2100 || month < 1 || month > 12) return recOut_({ ok: false, error: 'Pick a month and a year.' });
  var ss = recSS_();
  var win = recTab_(ss, REC_TABS.WIN, REC_WIN_HEADERS, '#D22730');
  var rows = recRows_(win).rows;
  var hit = rows.filter(function (r) {
    return recType_(r.type) === type && recRegion_(r.region) === region && Number(r.year) === year && Number(r.month) === month;
  })[0];
  if (!hit && recStr_(w.id)) hit = rows.filter(function (r) { return recStr_(r.id) === recStr_(w.id); })[0];
  var vendorId = recStr_(w.vendor_id);
  if (!vendorId && type === 'vendor') vendorId = recDirectoryIndex_()[name.toLowerCase()] || '';
  var id = hit ? recStr_(hit.id) : recId_(type === 'goat' ? 'GM' : 'VM');
  var row = [id, type, region, year, month, name, vendorId, type === 'goat' ? name : '', recStr_(w.blurb).slice(0, 600),
             hit ? recStr_(hit.added) || recNow_() : recNow_(), recStr_(data.who || w.added_by || 'Admin Hub').slice(0, 60), false];
  var at = hit ? hit._row : recNextRow_(win);
  win.getRange(at, 1, 1, REC_WIN_HEADERS.length).setValues([row]);
  // if this came from a nomination, mark it awarded
  if (recStr_(w.nomination_id)) recSetNomStatus_(ss, recStr_(w.nomination_id), 'Awarded', recStr_(data.who));
  return recOut_({ ok: true, id: id, replaced: !!hit, vendor_id: vendorId });
}

function recRemove_(data) {
  var id = recStr_(data.id);
  if (!id) return recOut_({ ok: false, error: 'No id' });
  var ss = recSS_();
  var win = ss.getSheetByName(REC_TABS.WIN);
  var hit = recRows_(win).rows.filter(function (r) { return recStr_(r.id) === id; })[0];
  if (!hit) return recOut_({ ok: false, error: 'No plate with that id' });
  win.getRange(hit._row, 1, 1, REC_WIN_HEADERS.length).clearContent();
  return recOut_({ ok: true });
}

function recNomStatus_(data) {
  var status = recStr_(data.status);
  if (REC_NOM_STATUS.indexOf(status) < 0) return recOut_({ ok: false, error: 'Status must be New, Awarded or Declined' });
  var ok = recSetNomStatus_(recSS_(), recStr_(data.id), status, recStr_(data.who));
  return recOut_(ok ? { ok: true } : { ok: false, error: 'No nomination with that id' });
}
function recSetNomStatus_(ss, id, status, who) {
  var nom = ss.getSheetByName(REC_TABS.NOM);
  if (!nom || !id) return false;
  var hit = recRows_(nom).rows.filter(function (r) { return recStr_(r.id) === id; })[0];
  if (!hit) return false;
  nom.getRange(hit._row, 11, 1, 3).setValues([[status, who || '', recNow_()]]);
  return true;
}

// Editor > Run once after the first deployment. Creates the book and seeds the plaques.
function recSetupRun() { Logger.log(recSetup_({}).getContent()); }
function recUrlRun() { Logger.log(recSS_().getUrl()); }


// ============================================================ coupons ========
// Sep 21 2026. One code per Vendor of the Month plate, $150 off one Vendor Shop order.
// The whole code is spent on one transaction: a $50 order with a $150 code is free and
// the other $100 is gone (TJ's rule). Validation and redemption are server-side only.

function recCpnTab_(ss) { return recTab_(ss, REC_TABS_X.CPN, REC_CPN_HEADERS, '#0AA6A9'); }
function recSndTab_(ss) { return recTab_(ss, REC_TABS_X.SND, REC_SND_HEADERS, '#636466'); }
function recNormCode_(v) { return recStr_(v).toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function recMonthName_(m) { return REC_MONTHS[(Number(m) || 1) - 1] || ''; }
function recCouponLabel_(c) { return 'Vendor of the Month, ' + recMonthName_(c.month) + ' ' + c.year; }
function recNewCode_(year, month, taken) {
  var mm = (Number(month) < 10 ? '0' : '') + Number(month), yy = String(year).slice(-2);
  for (var tries = 0; tries < 50; tries++) {
    var tail = '';
    for (var i = 0; i < 5; i++) tail += REC_CODE_ALPHABET.charAt(Math.floor(Math.random() * REC_CODE_ALPHABET.length));
    var code = 'VOTM-' + mm + yy + '-' + tail;
    if (!taken[recNormCode_(code)]) return code;
  }
  throw new Error('Could not make a unique code');
}
function recCoupons_(ss) {
  var sh = ss.getSheetByName(REC_TABS_X.CPN);
  if (!sh) return [];
  return recRows_(sh).rows.map(function (r) {
    var o = { _row: r._row };
    REC_CPN_HEADERS.forEach(function (h) { o[h] = recStr_(r[h]); });
    o.year = Number(o.year) || 0; o.month = Number(o.month) || 0;
    o.amount = Number(o.amount) || REC_COUPON_AMOUNT;
    o.order_subtotal = o.order_subtotal === '' ? '' : Number(o.order_subtotal) || 0;
    o.discount = o.discount === '' ? '' : Number(o.discount) || 0;
    if (REC_CPN_STATUS.indexOf(o.status) < 0) o.status = 'Issued';
    delete o.release_token;
    return o;
  }).sort(function (a, b) { return (b.year - a.year) || (b.month - a.month) || (a.issued < b.issued ? 1 : -1); });
}
function recSends_(ss) {
  var sh = ss.getSheetByName(REC_TABS_X.SND);
  if (!sh) return [];
  return recRows_(sh).rows.map(function (r) {
    var o = {}; REC_SND_HEADERS.forEach(function (h) { o[h] = recStr_(r[h]); });
    o.test = recTrue_(o.test); o.has_pdf = recTrue_(o.has_pdf); return o;
  }).sort(function (a, b) { return a.sent < b.sent ? 1 : -1; });
}
function recCouponFind_(sh, code) {
  var want = recNormCode_(code);
  if (!want) return null;
  var v = sh.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) if (recNormCode_(v[i][0]) === want) {
    var o = { _row: i + 1 }; REC_CPN_HEADERS.forEach(function (h, c) { o[h] = v[i][c]; }); return o;
  }
  return null;
}
function recDirectoryContacts_() {
  var idx = {};
  try {
    if (typeof vdSS_ !== 'function' || typeof vdAllRows_ !== 'function') return idx;
    vdAllRows_(vdSS_()).forEach(function (r) {
      if (!r.vendor_id) return;
      idx[String(r.vendor_id)] = { email: recStr_(r.email), contact: recStr_(r.contact_name), region: recStr_(r.region) };
    });
  } catch (e) {}
  return idx;
}
function recEmailOk_(s) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recStr_(s)); }
// Accepts "a@b.com, Name <c@d.com>; e@f.com" and returns the bare addresses, deduped.
function recEmailList_(v) {
  var seen = {}, out = [];
  (String(v || '').match(/[^\s<>,;"']+@[^\s<>,;"']+\.[^\s<>,;"']+/g) || []).forEach(function (e) {
    e = recStr_(e).toLowerCase();
    if (!e || !recEmailOk_(e) || seen[e]) return;
    seen[e] = 1; out.push(e);
  });
  return out;
}

// ---- public: the shop checkout -------------------------------------------
// Rough brute-force brake. Codes have 28 million possible tails per month and the script
// answers about one call a second, so this is belt and braces, not the lock.
function recCheckBrake_() {
  try {
    var cache = CacheService.getScriptCache(), k = 'rec_cpn_miss';
    var n = Number(cache.get(k) || 0) + 1;
    cache.put(k, String(n), 3600);
    return n > 300;
  } catch (e) { return false; }
}
function recCouponCheck_(data) {
  var code = recNormCode_(data.code);
  if (code.length < 8) return recOut_({ ok: true, valid: false, reason: 'That does not look like a full code.' });
  var c = recCouponFind_(recCpnTab_(recSS_()), code);
  if (!c) {
    if (recCheckBrake_()) return recOut_({ ok: true, valid: false, reason: 'Too many tries right now. Please try again in an hour.' });
    return recOut_({ ok: true, valid: false, reason: 'That code is not valid. Check it against your Vendor of the Month email.' });
  }
  var status = recStr_(c.status) || 'Issued';
  if (status === 'Redeemed') return recOut_({ ok: true, valid: false, reason: 'That code was already used on ' + recStr_(c.redeemed_at).slice(0, 10) + '. Each code works one time.' });
  if (status === 'Void') return recOut_({ ok: true, valid: false, reason: 'That code is no longer active. Contact your City Wide representative.' });
  return recOut_({ ok: true, valid: true, code: recStr_(c.code), amount: Number(c.amount) || REC_COUPON_AMOUNT, name: recStr_(c.name),
                   month: Number(c.month), year: Number(c.year), label: recCouponLabel_(c) });
}
function recCouponRedeem_(data) {
  var code = recNormCode_(data.code);
  var subtotal = Math.max(0, Number(data.subtotal) || 0);
  var lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) { return recOut_({ ok: false, error: 'The shop is busy. Try again in a moment.' }); }
  try {
    var sh = recCpnTab_(recSS_());
    var c = recCouponFind_(sh, code);
    if (!c) return recOut_({ ok: false, error: 'That code is not valid.' });
    if ((recStr_(c.status) || 'Issued') !== 'Issued') return recOut_({ ok: false, error: 'That code was already used. Each code works one time.' });
    var amount = Number(c.amount) || REC_COUPON_AMOUNT;
    var discount = Math.min(amount, subtotal);
    var token = Math.random().toString(36).slice(2, 10).toUpperCase();
    var col = function (h) { return REC_CPN_HEADERS.indexOf(h) + 1; };
    sh.getRange(c._row, col('status')).setValue('Redeemed');
    sh.getRange(c._row, col('redeemed_at'), 1, 7).setValues([[ recNow_(), recStr_(data.name).slice(0, 80), recStr_(data.company).slice(0, 120),
      recStr_(data.email).slice(0, 120), recStr_(data.account).slice(0, 120), subtotal, discount ]]);
    sh.getRange(c._row, col('release_token')).setValue(token);
    if (recStr_(data.items)) sh.getRange(c._row, col('notes')).setValue(recStr_(data.items).slice(0, 500));
    return recOut_({ ok: true, code: recStr_(c.code), amount: amount, discount: discount, forfeited: Math.max(0, amount - discount), token: token, label: recCouponLabel_(c) });
  } finally { lock.releaseLock(); }
}
// The checkout redeems first, then submits the order. If the order service fails it hands the
// code back within 15 minutes, so the vendor is not left with a spent code and no order.
function recCouponRelease_(data) {
  var code = recNormCode_(data.code), token = recStr_(data.token);
  if (!code || !token) return recOut_({ ok: false, error: 'Nothing to release.' });
  var lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) { return recOut_({ ok: false, error: 'Busy.' }); }
  try {
    var sh = recCpnTab_(recSS_());
    var c = recCouponFind_(sh, code);
    if (!c || recStr_(c.status) !== 'Redeemed' || recStr_(c.release_token) !== token) return recOut_({ ok: false, error: 'No match.' });
    var when = new Date(String(c.redeemed_at).replace(' ', 'T') + ':00');
    if (isNaN(when.getTime()) || (Date.now() - when.getTime()) > 15 * 60 * 1000) return recOut_({ ok: false, error: 'Too late to release. Contact City Wide.' });
    var col = function (h) { return REC_CPN_HEADERS.indexOf(h) + 1; };
    sh.getRange(c._row, col('status')).setValue('Issued');
    sh.getRange(c._row, col('redeemed_at'), 1, 7).setValues([[ '', '', '', '', '', '', '' ]]);
    sh.getRange(c._row, col('release_token')).setValue('');
    sh.getRange(c._row, col('notes')).setValue('Released ' + recNow_() + ' (order did not go through)');
    return recOut_({ ok: true });
  } finally { lock.releaseLock(); }
}

// ---- team: issue, void ----------------------------------------------------
function recWinnerById_(ss, id) {
  var win = ss.getSheetByName(REC_TABS.WIN);
  return win ? recRows_(win).rows.filter(function (r) { return recStr_(r.id) === recStr_(id); })[0] : null;
}
function recCouponIssue_(data) {
  var ss = recSS_();
  var w = recWinnerById_(ss, data.winner_id);
  if (!w) return recOut_({ ok: false, error: 'No plate with that id.' });
  if (recType_(w.type) !== 'vendor') return recOut_({ ok: false, error: 'Only Vendor of the Month plates get a shop code.' });
  var sh = recCpnTab_(ss);
  var all = recCoupons_(ss), taken = {};
  all.forEach(function (c) { taken[recNormCode_(c.code)] = 1; });
  var live = all.filter(function (c) { return c.winner_id === recStr_(w.id) && c.status !== 'Void'; })[0];
  if (live && !data.reissue) return recOut_({ ok: true, coupon: live, existing: true });
  if (live && live.status === 'Redeemed') return recOut_({ ok: false, error: 'That code was already redeemed, so it cannot be reissued.' });
  var col = function (h) { return REC_CPN_HEADERS.indexOf(h) + 1; };
  if (live) {
    sh.getRange(live._row, col('status')).setValue('Void');
    sh.getRange(live._row, col('voided_at'), 1, 2).setValues([[recNow_(), recStr_(data.who).slice(0, 60) || 'Admin Hub']]);
  }
  var code = recNewCode_(w.year, w.month, taken);
  var amount = Number(data.amount) > 0 ? Number(data.amount) : REC_COUPON_AMOUNT;
  var row = [code, recStr_(w.id), 'vendor', recRegion_(w.region), Number(w.year), Number(w.month), recStr_(w.name), recStr_(w.vendor_id), amount, 'Issued',
             recNow_(), recStr_(data.who).slice(0, 60) || 'Admin Hub', '', '', '', '', '', '', '', '', '', '', ''];
  sh.getRange(recNextRow_(sh), 1, 1, REC_CPN_HEADERS.length).setValues([row]);
  var out = {}; REC_CPN_HEADERS.forEach(function (h, i) { out[h] = row[i]; }); delete out.release_token;
  return recOut_({ ok: true, coupon: out, existing: false });
}
function recCouponVoid_(data) {
  var sh = recCpnTab_(recSS_());
  var c = recCouponFind_(sh, data.code);
  if (!c) return recOut_({ ok: false, error: 'No such code.' });
  if (recStr_(c.status) === 'Redeemed') return recOut_({ ok: false, error: 'That code was already redeemed. It stays on the record.' });
  var col = function (h) { return REC_CPN_HEADERS.indexOf(h) + 1; };
  sh.getRange(c._row, col('status')).setValue('Void');
  sh.getRange(c._row, col('voided_at'), 1, 2).setValues([[recNow_(), recStr_(data.who).slice(0, 60) || 'Admin Hub']]);
  return recOut_({ ok: true });
}

// ============================================================ certificate email
// The admin page draws the PDF, shows it, and posts it here with the To / CC exactly as the
// admin left them on screen. Nothing is hardcoded on this side: the defaults live on the page.
function recCertFolder_() {
  var it = DriveApp.getFoldersByName(REC_CERT_FOLDER);
  if (it.hasNext()) return it.next();
  var f = DriveApp.createFolder(REC_CERT_FOLDER);
  try { f.addEditor('tjroberts@gocitywide.com'); } catch (e) {}
  return f;
}
function recCertHtml_(o) {
  var esc = function (s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
  var paras = String(o.body || '').replace(/\r/g, '').split(/\n{2,}/).map(function (p) {
    return '<p style="margin:0 0 14px;font:15px/1.6 Verdana,Geneva,sans-serif;color:#2D2A26">' + esc(p).replace(/\n/g, '<br>') + '</p>';
  }).join('');
  var coupon = '';
  if (o.coupon && o.coupon.code) {
    coupon = '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:6px 0 18px;border:2px solid #0AA6A9;border-radius:10px;background:#F2FBFB"><tr><td style="padding:18px 20px;text-align:center">' +
      '<div style="font:700 11px/1.4 Verdana,Geneva,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#067679">Your Vendor of the Month award</div>' +
      '<div style="font:700 30px/1.2 Verdana,Geneva,sans-serif;color:#2D2A26;margin:8px 0 4px">$' + Number(o.coupon.amount || REC_COUPON_AMOUNT) + ' off</div>' +
      '<div style="font:13px/1.5 Verdana,Geneva,sans-serif;color:#636466">one order in the Vendor Shop, supplies or uniforms</div>' +
      '<div style="margin:14px auto 6px;display:inline-block;font:700 22px/1.2 Verdana,Geneva,sans-serif;letter-spacing:.08em;color:#D22730;background:#fff;border:1.5px dashed #D22730;border-radius:8px;padding:10px 18px">' + esc(o.coupon.code) + '</div>' +
      '<div style="font:12px/1.5 Verdana,Geneva,sans-serif;color:#636466;margin-top:8px">Enter the code at checkout. It works one time, on one order, for up to $' + Number(o.coupon.amount || REC_COUPON_AMOUNT) + '. Whatever part of the $' + Number(o.coupon.amount || REC_COUPON_AMOUNT) + ' is not used on that order is not carried over.</div>' +
      '<div style="margin-top:14px"><a href="' + REC_SHOP_URL + '" style="display:inline-block;background:#D22730;color:#fff;text-decoration:none;font:700 14px Verdana,Geneva,sans-serif;padding:12px 22px;border-radius:7px">Open the Vendor Shop</a></div>' +
      '</td></tr></table>';
  }
  return '<!DOCTYPE html><html><body style="margin:0;background:#F5F5F5;padding:24px 12px">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #E5E5E5">' +
    '<tr><td style="padding:22px 28px 10px;border-top:6px solid #D22730"><img src="' + REC_LOGO + '" alt="City Wide Facility Solutions" width="180" style="display:block;width:180px;height:auto"></td></tr>' +
    '<tr><td style="padding:10px 28px 0"><div style="font:700 11px/1.4 Verdana,Geneva,sans-serif;letter-spacing:.16em;text-transform:uppercase;color:#D22730">Vendor of the Month</div>' +
    '<div style="font:700 22px/1.3 Verdana,Geneva,sans-serif;color:#2D2A26;margin:6px 0 16px">' + esc(o.heading || '') + '</div></td></tr>' +
    '<tr><td style="padding:0 28px">' + paras + coupon + '</td></tr>' +
    '<tr><td style="padding:14px 28px 24px;border-top:1px solid #E5E5E5;font:12px/1.6 Verdana,Geneva,sans-serif;color:#636466">' + esc(o.sender_name || 'City Wide Facility Solutions') + '<br>' +
    (o.has_pdf ? 'Your certificate is attached as a PDF.<br>' : '') + 'GoCityWide.com</td></tr></table></body></html>';
}
function recCertSend_(data) {
  var ss = recSS_();
  var w = recWinnerById_(ss, data.winner_id);
  if (!w) return recOut_({ ok: false, error: 'No plate with that id.' });
  var test = String(data.test || '') === 'true' || data.test === true;
  var to = recEmailList_(data.to), cc = recEmailList_(data.cc);
  if (!to.length) return recOut_({ ok: false, error: test ? 'Type the address the test should go to.' : 'Add the vendor email in To.' });
  var subject = recStr_(data.subject).slice(0, 200);
  var body = String(data.body || '').replace(/\r/g, '').trim();
  if (!subject) return recOut_({ ok: false, error: 'The subject is empty.' });
  if (!body) return recOut_({ ok: false, error: 'The message is empty.' });
  var region = recRegion_(w.region);
  var sender = REC_SENDERS[region] || REC_SENDERS['Las Vegas'];
  var coupon = null;
  if (recStr_(data.coupon_code)) {
    var live = recCoupons_(ss).filter(function (c) { return recNormCode_(c.code) === recNormCode_(data.coupon_code) && c.status !== 'Void'; })[0];
    if (live) coupon = { code: live.code, amount: live.amount };
  }
  var pdf = null, certUrl = '';
  if (recStr_(data.pdf_b64)) {
    try {
      var fname = recStr_(data.filename) || (recMonthName_(w.month) + ' ' + w.year + ' VOTM - ' + recStr_(w.name) + '.pdf');
      pdf = Utilities.newBlob(Utilities.base64Decode(String(data.pdf_b64)), 'application/pdf', fname);
      if (!test) {
        try {
          var folder = recCertFolder_();
          var old = folder.getFilesByName(fname);
          while (old.hasNext()) old.next().setTrashed(true);
          certUrl = folder.createFile(pdf.copyBlob()).getUrl();
        } catch (e) { certUrl = ''; }
      }
    } catch (e) { return recOut_({ ok: false, error: 'The certificate PDF did not come through: ' + String(e && e.message || e) }); }
  }
  var html = recCertHtml_({ heading: recStr_(data.heading) || subject, body: body, coupon: coupon, sender_name: sender.name, has_pdf: !!pdf });
  var plain = body + (coupon ? '\n\nYour Vendor of the Month award: $' + coupon.amount + ' off one order in the Vendor Shop. Code: ' + coupon.code + '\n' + REC_SHOP_URL : '') + '\n\n' + sender.name + '\nGoCityWide.com';
  var opts = { to: to.join(','), replyTo: sender.reply, name: sender.name, subject: (test ? '[TEST] ' : '') + subject, htmlBody: html, body: plain };
  if (cc.length && !test) opts.cc = cc.join(',');
  if (pdf) opts.attachments = [pdf];
  var status = 'sent', err = '';
  try { MailApp.sendEmail(opts); } catch (e) { status = 'failed'; err = String(e && e.message || e); }
  try {
    recSndTab_(ss).appendRow([recNow_(), recStr_(w.id), recStr_(w.name), Number(w.year), Number(w.month), region, to.join(', '), test ? '' : cc.join(', '),
      subject, coupon ? coupon.code : '', !!pdf, test, recStr_(data.who).slice(0, 60) || 'Admin Hub', status, err, certUrl]);
  } catch (e) {}
  if (status !== 'sent') return recOut_({ ok: false, error: 'Gmail refused the send: ' + err });
  return recOut_({ ok: true, test: test, to: to, cc: test ? [] : cc, cert_url: certUrl, quota_left: (function () { try { return MailApp.getRemainingDailyQuota(); } catch (e) { return -1; } })() });
}
