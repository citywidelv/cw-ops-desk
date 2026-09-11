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
// ============================================================

var REC_PROP = 'REC_SHEET_ID';
var REC_TABS = { WIN: 'Winners', NOM: 'Nominations' };
var REC_WIN_HEADERS = ['id', 'type', 'region', 'year', 'month', 'name', 'vendor_id', 'staff_name', 'blurb', 'added', 'added_by', 'hidden'];
var REC_NOM_HEADERS = ['id', 'received', 'type', 'region', 'nominee', 'vendor_id', 'nominator_first', 'nominator_company', 'reason', 'source', 'status', 'reviewed_by', 'reviewed_at'];
var REC_TYPES = ['vendor', 'goat'];
var REC_REGIONS = ['Las Vegas', 'Northern Nevada'];
var REC_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
var REC_NOM_STATUS = ['New', 'Awarded', 'Declined'];

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
  if ((data.passcode || '') !== recPass_()) return recOut_({ ok: false, error: 'Bad passcode' });
  if (kind === 'rec_setup') return recSetup_(data);
  if (kind === 'rec_list') return recList_(data);
  if (kind === 'rec_save') return recSave_(data);
  if (kind === 'rec_remove') return recRemove_(data);
  if (kind === 'rec_nom_status') return recNomStatus_(data);
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
  var noms = recRows_(nom).rows.map(function (r) {
    var o = {}; REC_NOM_HEADERS.forEach(function (h) { o[h] = recStr_(r[h]); }); o.type = recType_(o.type); return o;
  });
  noms.sort(function (a, b) { return a.received < b.received ? 1 : -1; });
  return recOut_({ ok: true, winners: winners, nominations: noms, url: ss.getUrl() });
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
