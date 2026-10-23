// ============================================================
// NightInspection.gs - Night Manager inspection recaps (Sep 15 2026, Phase 1)
// New FILE in the CW Solicitations Apps Script project. Kind prefix: ni_
//
// Wire-up in doPost, after the staff_ line and BEFORE return doPostBase(e):
//   if (d && String(d.kind||'').indexOf('ni_') === 0) return niDispatch(d);
//
// Replaces the Night Manager Inspection Jotform (233486327771060) for the
// night managers. One row per recap on its own spreadsheet (script property
// NI_SHEET_ID, created by ni_setup), one PDF per recap in the City Wide
// Drive with the photos embedded, loose photo copies filed beside it so
// date, account, night manager and vendor are all searchable from the name.
// No email per submission. The 7am roll-up (Phase 3) reads the `flags`
// column, so keep niFlags_ honest.
//
// Kinds (team passcode on every one):
//   ni_setup    idempotent; creates the sheet, the Inspections tab, the Drive root
//   ni_context  accounts + vendors + night managers + FSMs + last vendor per account
//   ni_photo    one resized photo, filed to _Incoming now so a dead tab never loses it
//   ni_submit   moves the photos, builds the PDF, writes the row. Duplicate draft_id
//               returns the first row instead of writing a second.
//   ni_request  a building or cleaning company that is not in the directory
//   ni_list     recent rows for night-inspections.html - newest first
//   ni_get      one recap + picker lists, for night-inspection-edit.html (Oct 21 2026)
//   ni_edit     save changes to a recap (Oct 21 2026)
//   ni_reattach file photos a recap's draft left behind in _Incoming (Oct 21 2026).
//               Until this date ni_submit kept only the first 16 photos, in the
//               order they were added. General condition is the first button on
//               the page, so the janitor closet, complaint and standard photos
//               were the ones that fell off. Nothing was deleted; the extras sat
//               in _Incoming. This kind moves them in and rebuilds the PDF.
//
// Maintenance: niSweepIncoming() trashes _Incoming photos older than 3 days
// (drafts nobody sent). Give it a daily time trigger after launch.
//
// Reads the Account Directory (ActLedger.gs), the Vendor Directory
// (VendorDirectory.gs) and the Staff tab (Staff.gs). WRITES to the Account
// Cleaner Tracker Events tab (acAppend_ in Code.gs) when a night manager
// records a crew name that is not on that vendor's roster yet, source
// 'night-inspection', status 'Needs Review'. Crew names are also checked
// against the background checks on file (vdCleared_) and any name not found
// lands in crew_unverified and the crew_unverified flag.
// Alerts.gs reads this sheet (alNight_) so an FSM escalation shows on the Ops
// Hub alerts card the next morning.
// ============================================================

var NI_PROP = 'NI_SHEET_ID';
var NI_FOLDER_PROP = 'NI_FOLDER_ID';
var NI_FOLDER_PATH = ['Team Portal', 'Ops Hub', 'Night Inspections'];
var NI_TAB = 'Inspections';
var NI_REQ_TAB = 'Requests';
var NI_TZ = 'America/Los_Angeles';
var NI_LOW_SCORE = 8;   // under this = low_score flag
var NI_PHOTO_MAX = 60;  // photos filed per recap. Every one is kept in Drive and linked on the row.
var NI_PDF_MAX = 30;    // photos embedded in the PDF. Category photos first, then General condition.
                        // Past this the PDF says how many more are in the photo folder.
var NI_EDITOR = 'tjroberts@gocitywide.com';

// Sheet contract. Append at the END only; never insert a column mid-list.
var NI_HEADERS = [
  'inspection_id', 'submitted_at', 'market', 'report_date',
  'nm_name', 'nm_email',
  'account_id', 'account_name', 'account_matched',
  'vendor_id', 'vendor_name', 'vendor_owner', 'vendor_matched',
  'fsm', 'reason', 'timing', 'arrival', 'departure',
  'score', 'score_note',
  'complaint_flag', 'complaint_what', 'complaint_areas', 'complaint_channel', 'complaint_verified',
  'complaint_root_cause', 'complaint_agreed_fix', 'complaint_resolved', 'complaint_blocker', 'crm_closed',
  'hotspots_shown', 'hotspots_checked', 'dispensers_ok', 'trash_ok', 'restrooms_ok',
  'closet_checked', 'closet_organized', 'sds_present', 'chemicals_labelled', 'chemicals_on_hand',
  'equipment_ok', 'envirox_low', 'closet_notes',
  'newstart_night', 'initial_clean_paid', 'checklist_items',
  'issues_found', 'issues_resolved', 'issue_resolution', 'issue_remaining', 'issue_owner', 'issue_due',
  'fsm_action_needed', 'fsm_action_note',
  'supplies_needed', 'supplies_note', 'uniforms_needed',
  'summary', 'photo_count', 'pdf_url', 'pdf_name', 'photo_folder_url',
  'flags', 'source', 'device',
  // appended Sep 15 2026
  'why_early', 'wo_what', 'wo_done', 'call_who', 'call_about', 'call_next', 'draft_id',
  'crew_seen', 'crew_uniform', 'crew_uniform_note', 'photo_links',
  // appended Sep 15 2026 (crew roster + structured supplies)
  'crew_names', 'crew_unverified', 'building_supplies', 'vendor_supplies',
  // appended Sep 15 2026 (standards checklist)
  'standards', 'standards_failed', 'standards_met', 'prior_complaints',
  // appended Sep 15 2026 (route out)
  'route_stop_id', 'route_answers',
  // appended Oct 21 2026 (recap edits, ni_edit)
  'edited_at', 'edited_by'
];
var NI_REQ_HEADERS = ['when', 'market', 'type', 'name', 'owner', 'label', 'nm_name', 'sent_to', 'status'];

var NI_REASONS = ['Regular check', 'New building', 'Client complained', 'Work order', 'Phone only', 'Photos from crew'];
var NI_MARKETS = { lv: 'Las Vegas', nnv: 'Northern Nevada' };
var NI_SERVICE = { lv: 'lvservicecall@gocitywide.com', nnv: 'rnservicecall@gocitywide.com' };

// ------------------------------------------------------------ plumbing ----

function niPass_() {
  try { if (typeof PASSCODE !== 'undefined') return PASSCODE; } catch (e) {}
  return PropertiesService.getScriptProperties().getProperty('PASSCODE') || '';
}
function niOut_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
function niStr_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, NI_TZ, 'yyyy-MM-dd HH:mm');
  return String(v == null ? '' : v).replace(/[​-‍﻿]/g, '').trim();
}
function niMarket_(raw) {
  var s = niStr_(raw).toLowerCase();
  return (s === 'nnv' || s.indexOf('northern') === 0 || s === 'reno') ? 'nnv' : 'lv';
}
function niSS_() {
  // Router over the night ops family (Books.gs): CW Night Inspections, with
  // Routes, AccountChecks and RouteConfig answered by CW Night Route Out.
  return cwRouter_('ni');
}
function niTab_(ss, name, headers) {
  name = name || NI_TAB; headers = headers || NI_HEADERS;
  var sh = ss.getSheetByName(name);
  if (!sh) {
    var first = ss.getSheets()[0];
    if (name === NI_TAB && first.getLastRow() === 0 && ss.getSheets().length === 1) { sh = first; sh.setName(name); }
    else sh = ss.insertSheet(name);
  }
  var head = sh.getLastRow() ? sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(niStr_) : [];
  if (!head[0]) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#D22730').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  } else {
    // Append any header this build knows that the tab does not carry yet. Never reorder.
    var have = head.filter(String);
    var missing = headers.filter(function (h) { return have.indexOf(h) < 0; });
    if (missing.length) sh.getRange(1, have.length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold').setBackground('#D22730').setFontColor('#ffffff');
  }
  return sh;
}
function niHead_(sh) {
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(niStr_);
}
function niFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(NI_FOLDER_PROP);
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var parent = DriveApp.getRootFolder();
  NI_FOLDER_PATH.forEach(function (name) {
    var it = parent.getFoldersByName(name);
    parent = it.hasNext() ? it.next() : parent.createFolder(name);
  });
  props.setProperty(NI_FOLDER_PROP, parent.getId());
  return parent;
}
function niSub_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}
// Night Inspections / <Market> / <YYYY-MM> / Reports | Photos
function niMonthFolder_(mkt, reportDate, kind) {
  var m = niSub_(niFolder_(), NI_MARKETS[mkt]);
  var ym = niSub_(m, String(reportDate || '').slice(0, 7) || Utilities.formatDate(new Date(), NI_TZ, 'yyyy-MM'));
  return niSub_(ym, kind);
}
function niIncoming_() { return niSub_(niFolder_(), '_Incoming'); }
function niSafe_(s) {
  return niStr_(s).replace(/[\\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
}
function niLastName_(s) {
  var p = niStr_(s).split(/\s+/);
  return p.length ? p[p.length - 1] : '';
}
function niEsc_(s) {
  return niStr_(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function niShare_(f) { try { f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {} }

// ------------------------------------------------------------ dispatch ----

function niDispatch(data) {
  var kind = String(data.kind || '');
  if ((data.passcode || '') === '' || (data.passcode || '') !== niPass_()) return niOut_({ ok: false, error: 'Bad passcode' });
  try {
    if (kind.indexOf('ni_route_') === 0) return nrDispatch_(data);
    if (kind === 'ni_setup') return niSetup_(data);
    if (kind === 'ni_context') return niContext_(data);
    if (kind === 'ni_photo') return niPhoto_(data);
    if (kind === 'ni_submit') return niSubmit_(data);
    if (kind === 'ni_request') return niRequest_(data);
    if (kind === 'ni_list') return niList_(data);
    if (kind === 'ni_get') return niGet_(data);
    if (kind === 'ni_edit') return niEdit_(data);
    if (kind === 'ni_reattach') return niReattach_(data);
    return niOut_({ ok: false, error: 'Unknown kind ' + kind });
  } catch (e) {
    return niOut_({ ok: false, error: String(e && e.message || e) });
  }
}

// ------------------------------------------------------------ setup -------

function niSetup_(data) {
  var ss = niSS_();
  try { ss.addEditor(NI_EDITOR); } catch (e) {}
  var sh = niTab_(ss);
  niTab_(ss, NI_REQ_TAB, NI_REQ_HEADERS);
  var f = niFolder_();
  ['lv', 'nnv'].forEach(function (k) { niSub_(f, NI_MARKETS[k]); });
  niIncoming_();
  return niOut_({ ok: true, sheet_url: ss.getUrl(), sheet_id: ss.getId(), folder_url: f.getUrl(), folder_id: f.getId(), columns: niHead_(sh).length });
}

// ------------------------------------------------------------ context -----

// Everything the page needs for one market in one call. Accounts: Active (or
// blank status), not hidden. Vendors: live janitorial vendors in the market,
// labelled "DBA - Owner". People: Staff tab rows by role. last_vendor maps
// account_id -> the vendor used on that account's most recent recap, which is
// how the page prefills the cleaning company. Internal page; a full picker is
// correct here.
function niContext_(data) {
  var mkt = niMarket_(data.market);
  var region = NI_MARKETS[mkt];
  var out = { ok: true, market: mkt, region: region, today: Utilities.formatDate(new Date(), NI_TZ, 'yyyy-MM-dd'),
    accounts: [], vendors: [], night_managers: [], fsms: [], last_vendor: {}, prior_complaints: {}, roster: {}, vendor_roster: {}, warnings: [] };

  try {
    actAccountRows_(actSS_()).forEach(function (r) {
      if (actRegion_(r.region) !== region) return;
      if (actStr_(r.hide).toUpperCase() === 'TRUE') return;
      var st = actStr_(r.status);
      if (st && st !== 'Active') return;
      out.accounts.push({ id: actStr_(r.account_id), name: actStr_(r.name), fsm: actStr_(r.fsm), night_manager: actStr_(r.night_manager),
        industry: actStr_(r.industry), address: [actStr_(r.address1), actStr_(r.city)].filter(String).join(', ') });
    });
    out.accounts.sort(function (a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1; });
  } catch (e) { out.warnings.push('accounts: ' + e.message); }

  try {
    vdAllRows_(vdSS_()).forEach(function (r) {
      if (!vdStr_(r.dba_name) || vdTrue_(r.hide)) return;
      if (VD_LIVE_STATUS.indexOf(vdStr_(r.status)) < 0) return;
      if (!vdInRegion_(vdRegion_(r.region), mkt)) return;
      var slugs = vdSlugs_(r.service_types);
      if (slugs.length && slugs.indexOf(VD_JANITORIAL) < 0) return;
      var owner = vdStr_(r.contact_name);
      out.vendors.push({ id: vdStr_(r.vendor_id), dba: vdStr_(r.dba_name), owner: owner, label: vdStr_(r.dba_name) + (owner ? ' - ' + owner : '') });
    });
    out.vendors.sort(function (a, b) { return a.label.toLowerCase() < b.label.toLowerCase() ? -1 : 1; });
  } catch (e) { out.warnings.push('vendors: ' + e.message); }

  try {
    var sh = staffSS_().getSheetByName('Staff');
    var v = sh ? sh.getDataRange().getValues() : [];
    for (var i = 1; i < v.length; i++) {
      if (!v[i][0] || String(v[i][5]).toUpperCase() === 'FALSE') continue;
      var p = { name: String(v[i][0]).replace(/\s+/g, ' ').trim(), email: String(v[i][4] || '').trim(), market: String(v[i][2] || '').trim(), role: String(v[i][1] || '').trim() };
      var inMkt = p.market === 'Both' || p.market === region;
      if (p.role === 'Night Manager') out.night_managers.push(p);
      else if (/Facility Solutions Manager|Director of Operations|General Manager/.test(p.role)) { p.in_market = inMkt; out.fsms.push(p); }
    }
    out.fsms.sort(function (a, b) { if (a.in_market !== b.in_market) return a.in_market ? -1 : 1; return a.name < b.name ? -1 : 1; });
  } catch (e) { out.warnings.push('staff: ' + e.message); }

  // Oct 21 2026: names attached to the cleaning company itself, so the crew step
  // can list who that vendor has turned in to us once the vendor is picked, not
  // only who was seen at this building before. Keyed by vendor_id and by
  // lowercase DBA. Each entry is {n, bc}; bc is 'Cleared', 'Pending' or '' (no
  // background check on file). Sources: the Vendor Directory background check
  // tabs, the Account Cleaner Tracker roster by company, and prior recaps.
  var vrAdd = function (key, name, bc) {
    key = String(key || '').trim(); name = String(name || '').replace(/\s+/g, ' ').trim();
    if (!key || name.length < 2) return;
    var list = out.vendor_roster[key] || (out.vendor_roster[key] = []);
    var low = name.toLowerCase(), hit = null;
    list.some(function (x) { if (x.n.toLowerCase() === low) { hit = x; return true; } return false; });
    if (hit) { if (bc === 'Cleared' || (bc === 'Pending' && !hit.bc)) hit.bc = bc; return; }
    list.push({ n: name, bc: bc || '' });
  };
  var vrBoth = function (id, dba, name, bc) { if (id) vrAdd(id, name, bc); if (dba) vrAdd(String(dba).toLowerCase(), name, bc); };
  var vrIdByName = {}, vrDbaById = {};
  out.vendors.forEach(function (v) { vrIdByName[v.dba.toLowerCase()] = v.id; vrDbaById[v.id] = v.dba; });

  try {
    var isheet = niTab_(niSS_());
    var head = niHead_(isheet);
    var last = isheet.getLastRow();
    if (last > 1) {
      var start = Math.max(2, last - 1500);
      var vals = isheet.getRange(start, 1, last - start + 1, head.length).getValues();
      var cA = head.indexOf('account_id'), cAN = head.indexOf('account_name'), cV = head.indexOf('vendor_name'), cVI = head.indexOf('vendor_id'), cVO = head.indexOf('vendor_owner');
      var cCN = head.indexOf('crew_names');
      var cCF = head.indexOf('complaint_flag'), cCW = head.indexOf('complaint_what'), cCAr = head.indexOf('complaint_areas'), cSub = head.indexOf('submitted_at'), cSF = head.indexOf('standards_failed');
      var cutoff = Date.now() - 90 * 86400000;
      for (var k = vals.length - 1; k >= 0; k--) {
        var key = niStr_(vals[k][cA]) || niStr_(vals[k][cAN]).toLowerCase();
        if (!key) continue;
        if (!out.last_vendor[key] && niStr_(vals[k][cV])) out.last_vendor[key] = { id: niStr_(vals[k][cVI]), dba: niStr_(vals[k][cV]), owner: niStr_(vals[k][cVO]) };
        if (cCN >= 0 && niStr_(vals[k][cCN])) niStr_(vals[k][cCN]).split('\n').forEach(function (n) { niRosterAdd_(out.roster, key, n); if (cAN >= 0) niRosterAdd_(out.roster, niStr_(vals[k][cAN]).toLowerCase(), n); vrBoth(niStr_(vals[k][cVI]), niStr_(vals[k][cV]), n, ''); });
        // Past complaints and failed standards at this building in the last 90 days feed a checklist line.
        var when = vals[k][cSub] instanceof Date ? vals[k][cSub].getTime() : Date.parse(niStr_(vals[k][cSub]).replace(' ', 'T'));
        if (isNaN(when)) when = Date.now();   // unreadable stamp: treat as recent rather than drop it
        if (when && when > cutoff) {
          var bits = [];
          if (niStr_(vals[k][cCF]).toUpperCase() === 'TRUE') bits.push(niStr_(vals[k][cCAr]) || niStr_(vals[k][cCW]).slice(0, 60));
          if (cSF >= 0 && niStr_(vals[k][cSF])) niStr_(vals[k][cSF]).split('\n').forEach(function (l) { var q = l.split('|')[0].trim(); if (q) bits.push(q); });
          bits = bits.filter(String);
          if (bits.length) { var cur = out.prior_complaints[key] || ''; bits.forEach(function (b) { if (cur.indexOf(b) < 0) cur = cur ? cur + '; ' + b : b; }); out.prior_complaints[key] = cur.slice(0, 240); }
        }
      }
    }
  } catch (e) { out.warnings.push('last_vendor: ' + e.message); }

  // Crew names already on the Account Cleaner Tracker roster, keyed by building name.
  // The page shows these first ("the names we have for cleaners at this site") so
  // the night manager ticks who was there and only types a name that is new.
  try {
    if (typeof acRows_ === 'function') {
      var rh = AC_ROS_HEAD, g = function (x, f) { return Array.isArray(x) ? x[rh.indexOf(f)] : x[f]; };
      acRows_(AC_ROS, AC_ROS_HEAD).forEach(function (x) {
        var st = String(g(x, 'status') || '');
        if (/removed/i.test(st)) return;
        var n = (String(g(x, 'cleaner_first') || '') + ' ' + String(g(x, 'cleaner_last') || '')).trim();
        var acct = String(g(x, 'account_matched') || g(x, 'account_raw') || '').toLowerCase().trim();
        if (n && acct) niRosterAdd_(out.roster, acct, n);
      });
    }
  } catch (e) { out.warnings.push('roster: ' + e.message); }

  // Cleaner Tracker roster by company (the names vendors turned in on the roster form).
  try {
    if (typeof acRows_ === 'function') {
      var rh2 = AC_ROS_HEAD, g2 = function (x, f) { return Array.isArray(x) ? x[rh2.indexOf(f)] : x[f]; };
      acRows_(AC_ROS, AC_ROS_HEAD).forEach(function (x) {
        if (/removed/i.test(String(g2(x, 'status') || ''))) return;
        var n = (String(g2(x, 'cleaner_first') || '') + ' ' + String(g2(x, 'cleaner_last') || '')).trim();
        var co = String(g2(x, 'company_matched') || '').trim();
        if (!n || !co) return;
        vrBoth(vrIdByName[co.toLowerCase()] || '', co, n, '');
      });
    }
  } catch (e) { out.warnings.push('vendor_roster_ac: ' + e.message); }

  // Background check tabs: everyone turned in for a check, cleared or pending.
  // Removed people and anyone who did not clear never reach the page.
  try {
    var vss = vdSS_();
    VD_BC_TABS.forEach(function (b) {
      var sh = vss.getSheetByName(b.name);
      if (!sh) return;
      vdRows_(sh).rows.forEach(function (r) {
        var name = [vdStr_(r.first_name), vdStr_(r.last_name)].filter(String).join(' ');
        if (!name) return;
        var st = vdStr_(r.status), res = vdBcRes_(r.result);
        if (st === 'Removed' || res === 'Not clear') return;
        var id = vdStr_(r.vendor_id) || vrIdByName[vdStr_(r.vendor).toLowerCase()] || '';
        var dba = vrDbaById[id] || vdStr_(r.vendor);
        if (!id && !dba) return;
        vrBoth(id, dba, name, (st === 'Pending' || res === 'Pending') ? 'Pending' : 'Cleared');
      });
    });
  } catch (e) { out.warnings.push('vendor_roster_bc: ' + e.message); }

  // Tonight's route from the FSMs, plus every standing per-building checklist.
  // The page filters the stops once the night manager picks their name. A
  // recap filed after midnight still answers the route written the afternoon
  // before, which is what nrNightDate_ handles. sent_only: a route the FSM
  // saved but has not sent is a private draft and stays off this page.
  out.route_date = '';
  out.route = [];
  out.account_checks = {};
  try {
    if (typeof nrNightDate_ === 'function') {
      out.route_date = nrNightDate_();
      var rl = JSON.parse(nrList_({ market: mkt, report_date: out.route_date, sent_only: true }).getContent());
      if (rl && rl.ok) { out.route = rl.stops || []; out.account_checks = rl.checks || {}; }
    }
  } catch (e) { out.warnings.push('route: ' + e.message); }

  return niOut_(out);
}

function niRosterAdd_(map, key, name) {
  key = String(key || '').trim(); name = String(name || '').replace(/\s+/g, ' ').trim();
  if (!key || name.length < 2) return;
  var list = map[key] || (map[key] = []);
  var low = name.toLowerCase();
  if (!list.some(function (x) { return x.toLowerCase() === low; })) list.push(name);
}

// ------------------------------------------------------------ photo -------

// One resized JPEG (data URI, 1600px / 0.75 from the page), filed to _Incoming
// the moment it is taken. ni_submit moves it into the month's Photos folder and
// renames it with the report stem. Returns the Drive id the page holds in its
// draft, so a killed tab keeps its pictures.
function niPhoto_(data) {
  var b64 = String(data.data || '').replace(/^data:[^,]+,/, '');
  if (!b64) return niOut_({ ok: false, error: 'No photo data.' });
  var label = niSafe_(data.label || 'photo') || 'photo';
  var draft = niSafe_(data.draft_id || '') || 'nodraft';
  var blob = Utilities.newBlob(Utilities.base64Decode(b64), 'image/jpeg', draft + ' - ' + label + '.jpg');
  var f = niIncoming_().createFile(blob);
  return niOut_({ ok: true, file_id: f.getId(), bytes: blob.getBytes().length });
}

// Daily trigger target. Photos in _Incoming older than 3 days belong to drafts
// nobody sent. Trash them; Drive keeps the trash 30 days.
function niSweepIncoming() {
  var cut = Date.now() - 3 * 24 * 60 * 60 * 1000;
  var it = niIncoming_().getFiles(), n = 0;
  while (it.hasNext()) { var f = it.next(); if (f.getDateCreated().getTime() < cut) { f.setTrashed(true); n++; } }
  Logger.log('niSweepIncoming trashed ' + n);
  return n;
}

// ------------------------------------------------------------ submit ------

// General condition last, everything else first, order otherwise kept. The
// closet, complaint, hot spot and standard photos are the ones that answer a
// question, so they are never the ones that fall off the end of a PDF.
function niGeneral_(label) { return /^general condition/i.test(niStr_(label)); }
function niPhotoOrder_(list, labelOf) {
  var cat = [], gen = [];
  list.forEach(function (p) { (niGeneral_(labelOf(p)) ? gen : cat).push(p); });
  return cat.concat(gen);
}

function niFlags_(r) {
  var f = [];
  var score = Number(r.score);
  if (r.score !== '' && !isNaN(score) && score < NI_LOW_SCORE) f.push('low_score');
  if (r.complaint_flag === 'TRUE') f.push('complaint');
  if (r.issues_resolved === 'No' || (r.complaint_flag === 'TRUE' && r.complaint_resolved === 'No')) f.push('unresolved');
  if (r.fsm_action_needed === 'Yes') f.push('fsm_action');
  if (r.vendor_matched === 'FALSE' && r.vendor_name) f.push('unmatched_vendor');
  if (r.account_matched === 'FALSE' && r.account_name) f.push('unmatched_account');
  if (r.supplies_needed === 'Yes' || r.uniforms_needed === 'Yes' || r.envirox_low === 'Yes') f.push('supplies');
  if (r.crew_seen === 'Yes' && (r.crew_uniform === 'No' || r.crew_uniform === 'Some of them')) f.push('uniform');
  if (r.crew_unverified) f.push('crew_unverified');
  if (r.standards_failed) f.push('standards_failed');
  if (/\|\s*(No|Couldn't|Couldnt)\s*\|/i.test(String(r.route_answers || ''))) f.push('fsm_ask_missed');
  return f.join(',');
}
function niBool_(v) { return (v === true || String(v).toUpperCase() === 'TRUE' || String(v) === 'Yes') ? 'TRUE' : 'FALSE'; }

function niSubmit_(data) {
  var ss = niSS_();
  var sh = niTab_(ss);
  var head = niHead_(sh);
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var draft = niStr_(data.draft_id);
    if (draft) {
      var dup = niFindDraft_(sh, head, draft);
      if (dup) return niOut_({ ok: true, duplicate: true, inspection_id: dup.inspection_id, pdf_url: dup.pdf_url });
    }

    var mkt = niMarket_(data.market);
    var now = new Date();
    var reportDate = niStr_(data.report_date) || Utilities.formatDate(now, NI_TZ, 'yyyy-MM-dd');
    var id = (mkt === 'nnv' ? 'NNV' : 'LV') + '-NI-' + Utilities.formatDate(now, NI_TZ, 'yyMMdd-HHmmss');

    var r = {};
    NI_HEADERS.forEach(function (h) { var v = data[h]; r[h] = (v === undefined || v === null) ? '' : (Array.isArray(v) ? v.join('\n') : String(v).trim()); });
    r.inspection_id = id;
    r.submitted_at = Utilities.formatDate(now, NI_TZ, 'yyyy-MM-dd HH:mm');
    r.market = NI_MARKETS[mkt];
    r.report_date = reportDate;
    r.account_matched = niBool_(data.account_matched);
    r.vendor_matched = niBool_(data.vendor_matched);
    r.complaint_flag = (r.reason === 'Client complained' || niBool_(data.complaint_flag) === 'TRUE') ? 'TRUE' : 'FALSE';
    r.source = r.source || 'night-inspection.html';
    r.draft_id = draft;
    if (NI_REASONS.indexOf(r.reason) < 0) return niOut_({ ok: false, error: 'Pick a reason for tonight.' });
    if (!r.nm_name) return niOut_({ ok: false, error: 'Night manager name is required.' });
    if (!r.account_name) return niOut_({ ok: false, error: 'Building is required.' });
    if (r.score !== '' && Number(r.score) < NI_LOW_SCORE && !r.score_note) return niOut_({ ok: false, error: 'A score under ' + NI_LOW_SCORE + ' needs a note on what was wrong.' });
    // The uniform gate: never store a uniform answer for a crew nobody saw.
    if (r.crew_seen !== 'Yes') { r.crew_uniform = ''; r.crew_uniform_note = ''; }
    if (r.crew_uniform === 'Yes') r.crew_uniform_note = '';
    if (r.crew_seen !== 'Yes') r.crew_names = '';
    r.crew_unverified = '';
    if (r.crew_names) {
      try { var crew = niCrew_(r); r.crew_unverified = crew.unverified.join('\n'); } catch (ce) { r.crew_unverified = ''; }
    }

    var stem = reportDate + ' - ' + (niSafe_(r.account_name) || 'Building') + ' - ' + (niSafe_(r.vendor_name) || 'No company') + ' - '
      + (niSafe_(niLastName_(r.nm_name)) || 'NM') + ' - ' + r.reason + (r.score !== '' ? ' - ' + r.score : '');

    // Photos: [{file_id, label, small?}] already in _Incoming via ni_photo, or
    // {data, label} inline for a page that could not upload as it went.
    // Category photos (closet, complaint, standards, hot spots) are filed and
    // embedded first; General condition fills in after. Nothing is dropped
    // short of NI_PHOTO_MAX, and the PDF says when it could not hold them all.
    var photos = niPhotoOrder_(Array.isArray(data.photos) ? data.photos : [], function (p) { return p.label; }).slice(0, NI_PHOTO_MAX);
    var links = [], embeds = [], photoFolder = null;
    if (photos.length) {
      photoFolder = niMonthFolder_(mkt, reportDate, 'Photos');
      photos.forEach(function (p) {
        try {
          var label = niSafe_(p.label || '') || 'photo';
          var name = stem + ' - ' + ('0' + (links.length + 1)).slice(-2) + ' ' + label + '.jpg';
          var f = null;
          if (p.file_id) {
            f = DriveApp.getFileById(String(p.file_id));
            f.setName(name);
            f.moveTo(photoFolder);
          } else if (p.data) {
            var b64 = String(p.data).replace(/^data:[^,]+,/, '');
            if (!b64) return;
            f = photoFolder.createFile(Utilities.newBlob(Utilities.base64Decode(b64), 'image/jpeg', name));
          }
          if (!f) return;
          niShare_(f);
          links.push(f.getUrl());
          if (embeds.length < NI_PDF_MAX) {
            var small = String(p.small || '');
            if (!/^data:image/.test(small)) small = niEmbedSrc_(f);
            embeds.push({ src: small, label: label });
          }
        } catch (e) {}
      });
    }
    r.photo_count = String(links.length);
    r.photo_links = links.join('\n');
    r.photo_folder_url = photoFolder ? photoFolder.getUrl() : '';
    r.flags = niFlags_(r);

    var pdf = niPdf_(r, embeds, stem, mkt, reportDate, links.length - embeds.length);
    r.pdf_url = pdf.url; r.pdf_name = pdf.name;

    var row = head.map(function (h) { return r[h] === undefined ? '' : r[h]; });
    sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setValues([row]);

    // Close the loop back to the FSM who assigned this stop.
    var answered = null;
    try { if (typeof nrAnswer_ === 'function') answered = nrAnswer_(r); } catch (re) {}

    return niOut_({ ok: true, inspection_id: id, pdf_url: pdf.url, photo_count: links.length, flags: r.flags, route: answered });
  } finally { lock.releaseLock(); }
}

function niFindDraft_(sh, head, draft) {
  var last = sh.getLastRow();
  if (last < 2) return null;
  var c = head.indexOf('draft_id');
  if (c < 0) return null;
  var start = Math.max(2, last - 400);
  var vals = sh.getRange(start, 1, last - start + 1, head.length).getValues();
  for (var i = vals.length - 1; i >= 0; i--) {
    if (niStr_(vals[i][c]) === draft) return { inspection_id: vals[i][head.indexOf('inspection_id')], pdf_url: vals[i][head.indexOf('pdf_url')] };
  }
  return null;
}

// ------------------------------------------------------------ request -----

// "Can't find it": a cleaning company or building that is not in the directory.
// Emails the market service inbox as "Company Name - Owner Name", logs a row.
// The report itself still submits with the typed name; nothing blocks on this.
function niRequest_(data) {
  var mkt = niMarket_(data.market);
  var type = niStr_(data.type) === 'account' ? 'building' : 'vendor';
  var name = niStr_(data.name);
  if (!name) return niOut_({ ok: false, error: 'Type the name first.' });
  var owner = niStr_(data.owner);
  var label = type === 'vendor' && owner ? name + ' - ' + owner : name;
  var nm = niStr_(data.nm_name);
  var to = NI_SERVICE[mkt];
  var body = (nm || 'A night manager') + ' could not find this ' + (type === 'vendor' ? 'cleaning company' : 'building') + ' on the night inspection page:\n\n'
    + '    ' + label + '\n    ' + NI_MARKETS[mkt] + '\n\n'
    + 'Add it in the Admin Hub ' + (type === 'vendor' ? 'Vendor Directory' : 'Account Directory') + ' so the next recap can pick it from the list.\n'
    + (data.inspection_id ? 'Recap: ' + data.inspection_id + '\n' : '') + '\nCity Wide Night Ops';
  var opts = { to: to, subject: 'Night inspection: add ' + (type === 'vendor' ? 'cleaning company' : 'building') + ' ' + label, body: body,
    name: 'City Wide ' + (mkt === 'nnv' ? 'NNV' : 'LV') + ' Night Ops' };
  var status = 'sent';
  try { if (typeof cwMail_ === 'function') cwMail_('ni_request', opts); else cwSend_(opts); } catch (e) { status = 'mail failed: ' + e.message; }
  try {
    var sh = niTab_(niSS_(), NI_REQ_TAB, NI_REQ_HEADERS);
    sh.getRange(sh.getLastRow() + 1, 1, 1, NI_REQ_HEADERS.length).setValues([[new Date(), NI_MARKETS[mkt], type, name, owner, label, nm, to, status]]);
  } catch (e2) {}
  return niOut_({ ok: true, label: label, sent_to: to, status: status });
}

// ------------------------------------------------------------ crew --------

// Crew names the night manager collected. Two jobs:
//  1. Background checks: compare each name with the cleared list for that
//     vendor (vdCleared_, Vendor Directory BC tabs). Names not found come back
//     as unverified so the morning roll-up can ask the vendor for the check.
//  2. Roster: a name not yet on the Account Cleaner Tracker roster for that
//     vendor is appended to the Events tab as an 'add' with status Needs
//     Review and source night-inspection. The BOM reviews it like any vendor
//     submission. No email is sent from here.
function niCrew_(r) {
  var names = String(r.crew_names || '').split('\n').map(function (n) { return n.replace(/\s+/g, ' ').trim(); }).filter(function (n) { return n.length > 1; });
  var out = { names: names, unverified: [], added: 0 };
  if (!names.length) return out;
  var norm = function (s) { return String(s || '').toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim(); };
  var tokens = function (s) { return norm(s).split(' ').filter(String); };
  var same = function (a, b) {
    var ta = tokens(a), tb = tokens(b);
    if (!ta.length || !tb.length) return false;
    if (ta.join(' ') === tb.join(' ')) return true;
    // first + last both present, in either order, or one name given and it matches first or last
    var hitsA = ta.filter(function (t) { return tb.indexOf(t) >= 0; }).length;
    return hitsA >= Math.min(2, ta.length) && hitsA >= 1;
  };

  // 1. background checks
  var cleared = [];
  try {
    var vss = vdSS_();
    var vendors = vdAllRows_(vss).filter(function (v) { return v.dba_name; });
    var byId = vdCleared_(vss, vendors);
    var vid = r.vendor_id;
    if (!vid && r.vendor_name) { var m = vendors.filter(function (v) { return norm(v.dba_name) === norm(r.vendor_name); })[0]; if (m) vid = m.vendor_id; }
    cleared = (vid && byId[vid]) ? byId[vid].map(function (c) { return c.name; }) : [];
  } catch (e) {}
  names.forEach(function (n) {
    var ok = cleared.some(function (c) { return same(n, c); });
    if (!ok) out.unverified.push(n);
  });

  // 2. roster (Account Cleaner Tracker)
  try {
    if (typeof acRows_ !== 'function' || typeof acAppend_ !== 'function' || typeof acTab_ !== 'function') return out;
    var ros = acRows_(AC_ROS, AC_ROS_HEAD);
    var vkey = norm(r.vendor_name);
    var onRoster = ros.filter(function (x) { return norm(x.company_matched || x.company_raw) === vkey || (x.company_matched && vkey && norm(x.company_matched).indexOf(vkey) >= 0); })
      .map(function (x) { return (String(x.cleaner_first || '') + ' ' + String(x.cleaner_last || '')).trim(); });
    var evSh = null;
    // Keys the way acEvent_ builds them, so acRebuild_ keeps one roster row per person.
    var vendorKey = (r.vendor_matched === 'TRUE' ? '' : 'RAW:') + acKey_(r.vendor_name);
    names.forEach(function (n) {
      if (onRoster.some(function (x) { return same(n, x); })) return;
      var parts = n.split(' ');
      var first = parts.shift(), last = parts.join(' ');
      if (!evSh) evSh = acTab_(AC_EV, AC_EV_HEAD);
      acAppend_(evSh, AC_EV_HEAD, {
        event_id: 'ACE-' + acRand_(6), received: acStamp_(), submission_id: r.inspection_id, action: 'add',
        company_raw: r.vendor_name, company_matched: r.vendor_matched === 'TRUE' ? r.vendor_name : '', vendor_key: vendorKey,
        submitter_name: r.nm_name, submitter_email: r.nm_email, submitter_phone: '',
        cleaner_first: first, cleaner_last: last, cleaner_key: vendorKey + '::' + acKey_(n),
        account_raw: r.account_name, account_matched: r.account_matched === 'TRUE' ? r.account_name : '', match_confidence: r.account_matched === 'TRUE' ? 'high' : 'none',
        background_check: out.unverified.indexOf(n) >= 0 ? 'Not on file' : 'Yes', role: 'Cleaner',
        note_1: 'Met on site by the night manager. Recap ' + r.inspection_id + '.',
        status: 'Needs Review', region: r.market, source: 'night-inspection'
      });
      out.added++;
    });
    if (out.added && typeof acRebuild_ === 'function') { try { acRebuild_(); } catch (rb) {} }
  } catch (e2) {}
  return out;
}

// ------------------------------------------------------------ PDF ---------

function niPdf_(r, embeds, stem, mkt, reportDate, more) {
  var e = niEsc_;
  more = Number(more) || 0;
  function row(label, val) { return val === '' || val == null ? '' : '<tr><th>' + e(label) + '</th><td>' + e(val).replace(/\n/g, '<br>') + '</td></tr>'; }
  function sec(title, rows) { var body = rows.join(''); return body ? '<h2>' + e(title) + '</h2><table>' + body + '</table>' : ''; }
  var flags = r.flags || niFlags_(r);
  var flagNames = { low_score: 'Low score', complaint: 'Complaint', unresolved: 'Unresolved', fsm_action: 'FSM action', unmatched_vendor: 'Company not in directory', unmatched_account: 'Building not in directory', supplies: 'Supplies', uniform: 'Uniform', crew_unverified: 'Crew not background checked', standards_failed: 'Standard not met', fsm_ask_missed: 'FSM ask not met' };
  // Plain red text, not chips: the HTML-to-PDF converter drops inline-block backgrounds.
  var flagHtml = flags ? '<div class="flags">Flags: ' + flags.split(',').map(function (f) { return e(flagNames[f] || f); }).join(' &middot; ') + '</div>' : '';
  var scoreHtml = r.score !== '' ? '<div class="score' + (Number(r.score) < NI_LOW_SCORE ? ' low' : '') + '"><b>' + e(r.score) + '</b><span>/10</span></div>' : '';
  var company = r.vendor_name ? r.vendor_name + (r.vendor_owner ? ' - ' + r.vendor_owner : '') + (r.vendor_matched === 'FALSE' ? ' (typed, not in directory)' : '') : '';

  var html = '<!doctype html><html><head><meta charset="utf-8"><style>'
    + 'body{font-family:Verdana,Geneva,sans-serif;font-size:11px;color:#2D2A26;margin:28px}'
    + 'h1{font-size:18px;margin:0 0 2px;color:#D22730}h2{font-size:12px;margin:16px 0 4px;padding-bottom:3px;border-bottom:2px solid #D22730}'
    + '.sub{color:#636466;font-size:11px;margin-bottom:8px}table{width:100%;border-collapse:collapse}'
    + 'th{text-align:left;vertical-align:top;width:34%;padding:4px 6px;background:#f3f3f3;border-bottom:1px solid #ddd;font-weight:normal;color:#636466}'
    + 'td{padding:4px 6px;border-bottom:1px solid #ddd;vertical-align:top}'
    + '.head{display:table;width:100%}.head>div{display:table-cell;vertical-align:top}'
    + '.score{text-align:right;font-size:11px;color:#636466}.score b{font-size:30px;color:#2D2A26}.score.low b{color:#D22730}'
    + '.flags{color:#D22730;font-weight:bold;font-size:11px;margin:4px 0 6px}'
    + '.sum{white-space:pre-wrap;border:1px solid #ddd;padding:8px;background:#fafafa}'
    + '.ph{margin-top:8px}.ph .cap{font-size:10px;color:#636466;margin-top:6px}.ph img{max-width:100%;max-height:420px;display:block;margin:2px 0 10px;border:1px solid #ddd}'
    + '.foot{margin-top:18px;font-size:9px;color:#636466;text-align:center}'
    + '</style></head><body>'
    + '<div class="head"><div><h1>Night Inspection Recap</h1><div class="sub">' + e(r.account_name) + (r.account_matched === 'FALSE' ? ' (typed, not in directory)' : '') + ' &middot; ' + e(reportDate) + ' &middot; ' + e(r.market) + '</div></div><div>' + scoreHtml + '</div></div>'
    + flagHtml
    + sec('Visit', [row('Night manager', r.nm_name), row('Reason', r.reason), row('When you got there', r.timing), row('Why before the crew', r.why_early),
      row('Arrived', r.arrival), row('Left', r.departure), row('Cleaning company', company), row('FSM', r.fsm)])
    + sec('What you found', [row('Score', r.score !== '' ? r.score + ' / 10' : ''), row('What was wrong', r.score_note),
      row('Hot spots on file', r.hotspots_shown), row('Hot spots checked', r.hotspots_checked),
      row('Soap and paper towels full', r.dispensers_ok), row('Trash all out', r.trash_ok), row('Restrooms done right', r.restrooms_ok),
      row('Saw the crew', r.crew_seen), row('Right uniform', r.crew_uniform), row('What was off', r.crew_uniform_note),
      row('Crew on site', r.crew_names), row('No background check on file', r.crew_unverified)])
    + sec('Standards' + (r.standards_met ? ' (' + r.standards_met + ' met)' : ''), [row('Checked', r.standards), row('Did not meet standard, what was done', r.standards_failed), row('Past complaint areas', r.prior_complaints)])
    + sec('What the FSM asked for', [row('Answers', r.route_answers)])
    + sec('Closet', [row('Closet checked', r.closet_checked), row('Organized', r.closet_organized), row('SDS present', r.sds_present), row('Chemicals labelled', r.chemicals_labelled),
      row('Chemicals on hand', r.chemicals_on_hand), row('Equipment', r.equipment_ok), row('EnvirOx running low', r.envirox_low), row('Closet notes', r.closet_notes)])
    + (r.complaint_flag === 'TRUE' ? sec('Client complaint', [row('What the client said', r.complaint_what), row('Which areas', r.complaint_areas), row('How it reached us', r.complaint_channel),
      row('Checked those areas in person', r.complaint_verified), row('Root cause', r.complaint_root_cause), row('Agreed fix', r.complaint_agreed_fix),
      row('Resolved', r.complaint_resolved), row('What stopped you', r.complaint_blocker), row('Closed in CRM', r.crm_closed)]) : '')
    + (r.reason === 'New building' ? sec('New building', [row('Night', r.newstart_night), row('Client paid for initial clean', r.initial_clean_paid), row('Checklist done', r.checklist_items)]) : '')
    + sec('Work order', [row('What it was', r.wo_what), row('Done', r.wo_done)])
    + sec('Phone call', [row('Who', r.call_who), row('About', r.call_about), row('What happens next', r.call_next)])
    + sec('Before you go', [row('Issues found', r.issues_found), row('Everything fixed', r.issues_resolved), row('How it was fixed', r.issue_resolution),
      row('What is left', r.issue_remaining), row('Who is doing it', r.issue_owner), row('By when', r.issue_due),
      row('FSM needs to act tomorrow', r.fsm_action_needed), row('What the FSM needs to do', r.fsm_action_note),
      row('Building needs', r.building_supplies), row('Crew needs', r.vendor_supplies), row('Supplies note', r.supplies_note)])
    + (r.summary ? '<h2>Summary</h2><div class="sum">' + e(r.summary) + '</div>' : '');

  var total = embeds.length + more;
  var folderLine = (more > 0 && r.photo_folder_url) ? '<div class="cap" style="margin:6px 0 8px;color:#D22730"><b>' + more + ' more photo' + (more === 1 ? '' : 's') + '</b> in the photo folder: ' + e(r.photo_folder_url) + '</div>' : '';
  function body(list) {
    var h = '';
    if (list.length || more) {
      h += '<h2>Photos (' + total + ')</h2><div class="ph">' + folderLine;
      list.forEach(function (p) { if (/^data:image/.test(p.src)) h += '<div class="cap">' + e(p.label) + '</div><img src="' + p.src + '">'; });
      h += '</div>';
    }
    return h;
  }
  var tail = '<div class="foot">City Wide Facility Solutions &middot; ' + e(r.market) + ' &middot; ' + e(r.inspection_id) + ' &middot; Internal record' + (r.edited_at ? ' &middot; Edited ' + e(r.edited_at) + (r.edited_by ? ' by ' + e(r.edited_by) : '') : '') + ' &middot; GoCityWide.com</div></body></html>';

  var name = stem + '.pdf';
  // The HTML to PDF converter has an unpublished size ceiling. If it refuses,
  // embed fewer photos and say so, rather than failing the whole recap.
  var list = embeds.slice(), blob = null, lastErr = null;
  for (var attempt = 0; attempt < 4 && !blob; attempt++) {
    try {
      blob = Utilities.newBlob(html + body(list) + tail, 'text/html', name.replace(/\.pdf$/, '.html')).getAs('application/pdf').setName(name);
    } catch (pe) {
      lastErr = pe;
      if (!list.length) break;
      var keep = Math.floor(list.length / 2);
      more += list.length - keep;
      folderLine = (more > 0 && r.photo_folder_url) ? '<div class="cap" style="margin:6px 0 8px;color:#D22730"><b>' + more + ' more photo' + (more === 1 ? '' : 's') + '</b> in the photo folder: ' + e(r.photo_folder_url) + '</div>' : '';
      list = list.slice(0, keep);
    }
  }
  if (!blob) throw lastErr || new Error('PDF conversion failed');
  var file = niMonthFolder_(mkt, reportDate, 'Reports').createFile(blob);
  niShare_(file);
  return { url: file.getUrl(), id: file.getId(), name: name };
}

// ------------------------------------------------------------ edit --------
// Oct 21 2026. Fix a recap after it was filed: the wrong cleaning company,
// the wrong building, the wrong FSM, a typo. Page: night-inspection-edit.html?id=<inspection_id>,
// opened from the Edit button beside the PDF on night-inspections.html.
//
//   ni_get   team passcode. One recap plus the picker lists for its market.
//   ni_edit  team passcode (Oct 21 2026: TJ dropped the Site Admin passcode
//            requirement; the team is fixing recaps as a matter of course).
//
// ni_edit only writes the columns that actually changed, checks every old
// value against the sheet first (someone else's edit is never overwritten),
// re-runs the same rules as ni_submit (complaint flag, crew gate, crew check,
// flags), renames the photos to the new file name, rebuilds the PDF with the
// photos in it, and moves the old PDF to Reports/_Replaced instead of deleting
// it. Every changed column is logged with its old value on the Recap Edits tab.
var NI_EDIT_TAB = 'Recap Edits';
var NI_EDIT_HEADERS = ['when', 'inspection_id', 'editor', 'field', 'old_value', 'new_value'];
var NI_EDITABLE = [
  'report_date', 'nm_name', 'nm_email',
  'account_id', 'account_name', 'account_matched',
  'vendor_id', 'vendor_name', 'vendor_owner', 'vendor_matched',
  'fsm', 'reason', 'timing', 'why_early', 'arrival', 'departure',
  'score', 'score_note',
  'complaint_flag', 'complaint_what', 'complaint_areas', 'complaint_channel', 'complaint_verified',
  'complaint_root_cause', 'complaint_agreed_fix', 'complaint_resolved', 'complaint_blocker', 'crm_closed',
  'hotspots_checked', 'dispensers_ok', 'trash_ok', 'restrooms_ok',
  'closet_checked', 'closet_organized', 'sds_present', 'chemicals_labelled', 'chemicals_on_hand',
  'equipment_ok', 'envirox_low', 'closet_notes',
  'newstart_night', 'initial_clean_paid', 'checklist_items',
  'issues_found', 'issues_resolved', 'issue_resolution', 'issue_remaining', 'issue_owner', 'issue_due',
  'fsm_action_needed', 'fsm_action_note',
  'supplies_needed', 'supplies_note', 'uniforms_needed', 'building_supplies', 'vendor_supplies',
  'summary', 'wo_what', 'wo_done', 'call_who', 'call_about', 'call_next',
  'crew_seen', 'crew_uniform', 'crew_uniform_note', 'crew_names',
  'standards', 'standards_failed', 'standards_met', 'route_answers'
];

// Sheets turns typed text into cells: "08:10" becomes a time (reads back as
// "1899-12-30 08:10"), "12/14" standards met becomes a date. Put them back the
// way the night manager typed them before they are shown or printed again.
function niTidy_(r) {
  ['arrival', 'departure'].forEach(function (k) { var m = String(r[k] || '').match(/^1899-12-\d{2} (\d{2}:\d{2})$/); if (m) r[k] = m[1]; });
  var d = String(r.report_date || '').match(/^(\d{4}-\d{2}-\d{2}) 00:00$/); if (d) r.report_date = d[1];
  var s = String(r.standards_met || '').match(/^\d{4}-(\d{2})-(\d{2}) 00:00$/); if (s) r.standards_met = String(Number(s[1])) + '/' + String(Number(s[2]));
  return r;
}

function niFindRow_(sh, head, id) {
  var c = head.indexOf('inspection_id');
  var last = sh.getLastRow();
  if (c < 0 || last < 2) return 0;
  var ids = sh.getRange(2, c + 1, last - 1, 1).getValues();
  for (var i = ids.length - 1; i >= 0; i--) if (niStr_(ids[i][0]) === id) return i + 2;
  return 0;
}

// Buildings, cleaning companies, night managers and FSMs for one market.
// Same filters as niContext_, without the 1,500-row history read, so the edit page opens fast.
function niPickers_(mkt) {
  var region = NI_MARKETS[mkt];
  var out = { market: mkt, region: region, accounts: [], vendors: [], night_managers: [], fsms: [], warnings: [] };
  try {
    actAccountRows_(actSS_()).forEach(function (r) {
      if (actRegion_(r.region) !== region) return;
      if (actStr_(r.hide).toUpperCase() === 'TRUE') return;
      var st = actStr_(r.status);
      if (st && st !== 'Active') return;
      out.accounts.push({ id: actStr_(r.account_id), name: actStr_(r.name), fsm: actStr_(r.fsm), address: [actStr_(r.address1), actStr_(r.city)].filter(String).join(', ') });
    });
    out.accounts.sort(function (a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1; });
  } catch (e) { out.warnings.push('accounts: ' + e.message); }
  try {
    vdAllRows_(vdSS_()).forEach(function (r) {
      if (!vdStr_(r.dba_name) || vdTrue_(r.hide)) return;
      if (VD_LIVE_STATUS.indexOf(vdStr_(r.status)) < 0) return;
      if (!vdInRegion_(vdRegion_(r.region), mkt)) return;
      var slugs = vdSlugs_(r.service_types);
      if (slugs.length && slugs.indexOf(VD_JANITORIAL) < 0) return;
      var owner = vdStr_(r.contact_name);
      out.vendors.push({ id: vdStr_(r.vendor_id), dba: vdStr_(r.dba_name), owner: owner, label: vdStr_(r.dba_name) + (owner ? ' - ' + owner : '') });
    });
    out.vendors.sort(function (a, b) { return a.label.toLowerCase() < b.label.toLowerCase() ? -1 : 1; });
  } catch (e) { out.warnings.push('vendors: ' + e.message); }
  try {
    var sh = staffSS_().getSheetByName('Staff');
    var v = sh ? sh.getDataRange().getValues() : [];
    for (var i = 1; i < v.length; i++) {
      if (!v[i][0] || String(v[i][5]).toUpperCase() === 'FALSE') continue;
      var p = { name: String(v[i][0]).replace(/\s+/g, ' ').trim(), email: String(v[i][4] || '').trim(), market: String(v[i][2] || '').trim(), role: String(v[i][1] || '').trim() };
      var inMkt = p.market === 'Both' || p.market === region;
      if (p.role === 'Night Manager') out.night_managers.push(p);
      else if (/Facility Solutions Manager|Director of Operations|General Manager/.test(p.role)) { p.in_market = inMkt; out.fsms.push(p); }
    }
    out.fsms.sort(function (a, b) { if (a.in_market !== b.in_market) return a.in_market ? -1 : 1; return a.name < b.name ? -1 : 1; });
  } catch (e) { out.warnings.push('staff: ' + e.message); }
  return out;
}

function niGet_(data) {
  var id = niStr_(data.id);
  if (!id) return niOut_({ ok: false, error: 'No recap was named in the link.' });
  var sh = niTab_(niSS_());
  var head = niHead_(sh);
  var at = niFindRow_(sh, head, id);
  if (!at) return niOut_({ ok: false, error: 'Recap ' + id + ' was not found. It may have been filed on the old Jotform, which cannot be edited here.' });
  var vals = sh.getRange(at, 1, 1, head.length).getValues()[0];
  var row = {};
  head.forEach(function (h, j) { if (h) row[h] = (h === 'device') ? '' : niStr_(vals[j]); });
  niTidy_(row);
  var out = niPickers_(niMarket_(row.market));
  out.ok = true; out.row = row; out.editable = NI_EDITABLE; out.reasons = NI_REASONS; out.low_score = NI_LOW_SCORE;
  return niOut_(out);
}

// A photo as a ~900px JPEG for the rebuilt PDF. Drive's own thumbnail first,
// the full file if that fails (bigger PDF, same picture).
function niEmbedSrc_(file) {
  try {
    var tok = ScriptApp.getOAuthToken();
    var opt = { headers: { Authorization: 'Bearer ' + tok }, muteHttpExceptions: true };
    var meta = JSON.parse(UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + file.getId() + '?fields=thumbnailLink', opt).getContentText() || '{}');
    if (meta.thumbnailLink) {
      var res = UrlFetchApp.fetch(String(meta.thumbnailLink).replace(/=s\d+$/, '') + '=s900', opt);
      var b = res.getBlob();
      if (res.getResponseCode() === 200 && b.getBytes().length > 3000) return 'data:' + (b.getContentType() || 'image/jpeg') + ';base64,' + Utilities.base64Encode(b.getBytes());
    }
  } catch (e) {}
  return 'data:image/jpeg;base64,' + Utilities.base64Encode(file.getBlob().getBytes());
}

function niStem_(r, reportDate) {
  return reportDate + ' - ' + (niSafe_(r.account_name) || 'Building') + ' - ' + (niSafe_(r.vendor_name) || 'No company') + ' - '
    + (niSafe_(niLastName_(r.nm_name)) || 'NM') + ' - ' + r.reason + (r.score !== '' ? ' - ' + r.score : '');
}

function niEdit_(data) {
  var id = niStr_(data.id), editor = niStr_(data.editor);
  if (!id) return niOut_({ ok: false, error: 'No recap was named.' });
  if (!editor) return niOut_({ ok: false, error: 'Put your name in so the change log shows who made the change.' });
  var changes = (data.changes && typeof data.changes === 'object') ? data.changes : {};
  var keys = Object.keys(changes).filter(function (k) { return NI_EDITABLE.indexOf(k) >= 0 && changes[k] && typeof changes[k] === 'object'; });
  if (!keys.length) return niOut_({ ok: true, changed: 0, note: 'Nothing was changed.' });

  var ss = niSS_();
  var sh = niTab_(ss);            // also appends edited_at / edited_by to the header row the first time
  var head = niHead_(sh);
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var at = niFindRow_(sh, head, id);
    if (!at) return niOut_({ ok: false, error: 'Recap ' + id + ' was not found.' });
    var raw = sh.getRange(at, 1, 1, head.length).getValues()[0];
    var cur = {};
    head.forEach(function (h, j) { if (h) cur[h] = niStr_(raw[j]); });
    niTidy_(cur);

    var stale = keys.filter(function (k) { return niStr_(changes[k].old) !== (cur[k] || ''); });
    if (stale.length) return niOut_({ ok: false, conflict: true, error: 'This recap changed after you opened it (' + stale.join(', ') + '). Reload the page and make your change again.' });

    var r = {};
    Object.keys(cur).forEach(function (k) { r[k] = cur[k]; });
    keys.forEach(function (k) { var v = changes[k].new; r[k] = Array.isArray(v) ? v.join('\n') : String(v == null ? '' : v).replace(/[​-‍﻿]/g, '').trim(); });

    // The same rules ni_submit applies.
    if (NI_REASONS.indexOf(r.reason) < 0) return niOut_({ ok: false, error: 'Pick a reason.' });
    if (!r.nm_name) return niOut_({ ok: false, error: 'Night manager name is required.' });
    if (!r.account_name) return niOut_({ ok: false, error: 'Building is required.' });
    if (r.score !== '' && (isNaN(Number(r.score)) || Number(r.score) < 1 || Number(r.score) > 10)) return niOut_({ ok: false, error: 'The score is a number from 1 to 10.' });
    if (r.score !== '' && Number(r.score) < NI_LOW_SCORE && !r.score_note) return niOut_({ ok: false, error: 'A score under ' + NI_LOW_SCORE + ' needs a note on what was wrong.' });
    // TRUE/FALSE columns: keep the sheet's own value when the meaning did not change.
    var tf = function (k, v) { r[k] = (v === niBool_(cur[k])) ? cur[k] : v; };
    tf('account_matched', niBool_(r.account_matched));
    tf('vendor_matched', niBool_(r.vendor_matched));
    tf('complaint_flag', (r.reason === 'Client complained' || niBool_(r.complaint_flag) === 'TRUE') ? 'TRUE' : 'FALSE');
    if (r.crew_seen !== 'Yes') { r.crew_uniform = ''; r.crew_uniform_note = ''; r.crew_names = ''; }
    if (r.crew_uniform === 'Yes') r.crew_uniform_note = '';
    var crewTouched = ['vendor_id', 'vendor_name', 'crew_names', 'crew_seen'].some(function (k) { return keys.indexOf(k) >= 0; });
    if (crewTouched) {
      r.crew_unverified = '';
      if (r.crew_names) { try { r.crew_unverified = niCrew_(r).unverified.join('\n'); } catch (ce) {} }
    }
    var now = new Date();
    r.edited_at = Utilities.formatDate(now, NI_TZ, 'yyyy-MM-dd HH:mm');
    r.edited_by = editor;
    r.flags = niFlags_(r);

    // Photos: rename to the new file name, move them if the night moved to another month.
    var mkt = niMarket_(r.market);
    var oldDate = String(cur.report_date || '').slice(0, 10), reportDate = String(r.report_date || '').slice(0, 10) || oldDate;
    var stem = niStem_(r, reportDate);
    var monthMoved = oldDate.slice(0, 7) !== reportDate.slice(0, 7);
    var photoFolder = (monthMoved && r.photo_links) ? niMonthFolder_(mkt, reportDate, 'Photos') : null;
    var embeds = [], kept = 0;
    var files = [];
    String(r.photo_links || '').split('\n').filter(String).forEach(function (u, i) {
      var m = String(u).match(/\/d\/([^\/?#]+)/) || String(u).match(/[?&]id=([^&#]+)/);
      if (!m) return;
      try {
        var f = DriveApp.getFileById(m[1]);
        var pm = f.getName().match(/^(.*) - (\d{2}) (.*?)\.jpe?g$/i);
        var label = pm ? pm[3] : 'photo';
        f.setName(stem + ' - ' + (pm ? pm[2] : ('0' + (i + 1)).slice(-2)) + ' ' + label + '.jpg');
        if (photoFolder) f.moveTo(photoFolder);
        files.push({ f: f, label: label });
      } catch (pe) {}
    });
    niPhotoOrder_(files, function (x) { return x.label; }).forEach(function (x) {
      kept++;
      if (embeds.length < NI_PDF_MAX) embeds.push({ src: niEmbedSrc_(x.f), label: x.label });
    });
    if (photoFolder) r.photo_folder_url = photoFolder.getUrl();

    var pdf = niPdf_(r, embeds, stem, mkt, reportDate, kept - embeds.length);
    r.pdf_url = pdf.url; r.pdf_name = pdf.name;

    // Write only the cells that changed, so untouched dates and times keep their sheet values.
    var out = raw.slice(), log = [];
    var when = r.edited_at;
    head.forEach(function (h, j) {
      if (!h || r[h] === undefined) return;
      var nv = String(r[h]);
      if (nv === (cur[h] || '')) return;
      out[j] = /^\d{1,2}\/\d{1,2}$/.test(nv) ? "'" + nv : nv;   // "12/14" standards met must not turn into a date
      if (h !== 'edited_at' && h !== 'edited_by' && h !== 'pdf_name') log.push([when, id, editor, h, cur[h] || '', nv]);
    });
    sh.getRange(at, 1, 1, out.length).setValues([out]);

    // Keep the old PDF as the record of what was first filed.
    var oldPdf = String(cur.pdf_url || '').match(/\/d\/([^\/?#]+)/);
    if (oldPdf && oldPdf[1] !== pdf.id) {
      try {
        var of = DriveApp.getFileById(oldPdf[1]);
        of.setName(of.getName().replace(/\.pdf$/i, '') + ' (replaced ' + Utilities.formatDate(now, NI_TZ, 'yyyy-MM-dd') + ').pdf');
        of.moveTo(niSub_(niMonthFolder_(mkt, oldDate || reportDate, 'Reports'), '_Replaced'));
      } catch (oe) {}
    }

    if (log.length) {
      var lt = niTab_(ss, NI_EDIT_TAB, NI_EDIT_HEADERS);
      var safe = log.map(function (row) { return row.map(function (c) { c = String(c); return /^[=+\-@]/.test(c) ? "'" + c : c; }); });
      lt.getRange(lt.getLastRow() + 1, 1, safe.length, NI_EDIT_HEADERS.length).setValues(safe);
    }
    return niOut_({ ok: true, inspection_id: id, changed: log.length, pdf_url: pdf.url, flags: r.flags, crew_unverified: r.crew_unverified });
  } finally { lock.releaseLock(); }
}

// ------------------------------------------------------------ reattach ----

// Photos a draft uploaded that never made it onto the recap. Looks in
// _Incoming for files named "<draft_id> - <label>.jpg", skips any that are a
// byte-for-byte size match of a photo already on the row under the same label
// (the page sometimes uploads a photo twice), files the rest next to the
// others with the next numbers, appends the links, rebuilds the PDF with the
// category photos first, keeps the old PDF in _Replaced, and logs the change.
//   data.id        inspection_id (required)
//   data.draft_id  optional; the row's own draft_id is used when blank
//   data.editor    name for the Recap Edits log; defaults to 'reattach'
function niReattach_(data) {
  var id = niStr_(data.id);
  if (!id) return niOut_({ ok: false, error: 'No recap was named.' });
  var ss = niSS_();
  var sh = niTab_(ss);
  var head = niHead_(sh);
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var at = niFindRow_(sh, head, id);
    if (!at) return niOut_({ ok: false, error: 'Recap ' + id + ' was not found.' });
    var raw = sh.getRange(at, 1, 1, head.length).getValues()[0];
    var r = {};
    head.forEach(function (h, j) { if (h) r[h] = niStr_(raw[j]); });
    niTidy_(r);
    var draft = niStr_(data.draft_id) || r.draft_id;
    if (!draft) return niOut_({ ok: false, error: 'This recap has no draft id, so its leftover photos cannot be matched.' });

    var mkt = niMarket_(r.market);
    var reportDate = String(r.report_date || '').slice(0, 10);
    var stem = niStem_(r, reportDate);
    var photoFolder = niMonthFolder_(mkt, reportDate, 'Photos');

    // What the row already has: {size, label} per filed photo, in link order.
    var have = [], links = String(r.photo_links || '').split('\n').filter(String);
    links.forEach(function (u) {
      var m = String(u).match(/\/d\/([^\/?#]+)/) || String(u).match(/[?&]id=([^&#]+)/);
      if (!m) return;
      try {
        var f = DriveApp.getFileById(m[1]);
        var pm = f.getName().match(/ - (\d{2}) (.*?)\.jpe?g$/i);
        have.push({ f: f, size: f.getSize(), label: pm ? pm[2] : 'photo' });
      } catch (e) {}
    });

    // Leftovers in _Incoming for this draft.
    var found = [], it = niIncoming_().getFiles();
    while (it.hasNext()) {
      var f = it.next();
      var nm = f.getName();
      if (nm.indexOf(draft + ' - ') !== 0) continue;
      var lm = nm.match(/^.* - (.*?)\.jpe?g$/i);
      found.push({ f: f, size: f.getSize(), label: niSafe_(lm ? lm[1] : 'photo') || 'photo', created: f.getDateCreated().getTime() });
    }
    found.sort(function (a, b) { return a.created - b.created; });

    var added = [], skipped = 0, seen = have.map(function (h) { return h.label + '|' + h.size; });
    found.forEach(function (x) {
      var key = x.label + '|' + x.size;
      if (seen.indexOf(key) >= 0) { skipped++; try { x.f.setTrashed(true); } catch (e) {} return; }
      seen.push(key);
      added.push(x);
    });
    if (!added.length) return niOut_({ ok: true, inspection_id: id, added: 0, skipped: skipped, note: 'No new photos were waiting for this recap.' });

    var n = have.length;
    added.forEach(function (x) {
      if (have.length >= NI_PHOTO_MAX) return;
      n++;
      try {
        x.f.setName(stem + ' - ' + ('0' + n).slice(-2) + ' ' + x.label + '.jpg');
        x.f.moveTo(photoFolder);
        niShare_(x.f);
        links.push(x.f.getUrl());
        have.push({ f: x.f, size: x.size, label: x.label });
      } catch (e) {}
    });

    var embeds = [];
    niPhotoOrder_(have, function (x) { return x.label; }).forEach(function (x) {
      if (embeds.length < NI_PDF_MAX) embeds.push({ src: niEmbedSrc_(x.f), label: x.label });
    });
    var oldLinks = r.photo_links, oldCount = r.photo_count, oldPdfUrl = r.pdf_url;
    r.photo_links = links.join('\n');
    r.photo_count = String(links.length);
    r.photo_folder_url = photoFolder.getUrl();
    var now = new Date();
    r.edited_at = Utilities.formatDate(now, NI_TZ, 'yyyy-MM-dd HH:mm');
    r.edited_by = niStr_(data.editor) || 'reattach';

    var pdf = niPdf_(r, embeds, stem, mkt, reportDate, have.length - embeds.length);
    r.pdf_url = pdf.url; r.pdf_name = pdf.name;

    var out = raw.slice();
    head.forEach(function (h, j) { if (h && r[h] !== undefined && String(r[h]) !== niStr_(raw[j])) out[j] = String(r[h]); });
    sh.getRange(at, 1, 1, out.length).setValues([out]);

    var oldPdf = String(oldPdfUrl || '').match(/\/d\/([^\/?#]+)/);
    if (oldPdf && oldPdf[1] !== pdf.id) {
      try {
        var of = DriveApp.getFileById(oldPdf[1]);
        of.setName(of.getName().replace(/\.pdf$/i, '') + ' (replaced ' + Utilities.formatDate(now, NI_TZ, 'yyyy-MM-dd') + ').pdf');
        of.moveTo(niSub_(niMonthFolder_(mkt, reportDate, 'Reports'), '_Replaced'));
      } catch (oe) {}
    }
    try {
      var lt = niTab_(ss, NI_EDIT_TAB, NI_EDIT_HEADERS);
      lt.getRange(lt.getLastRow() + 1, 1, 2, NI_EDIT_HEADERS.length).setValues([
        [r.edited_at, id, r.edited_by, 'photo_count', oldCount, r.photo_count],
        [r.edited_at, id, r.edited_by, 'photo_links', oldLinks, r.photo_links]
      ]);
    } catch (le) {}
    return niOut_({ ok: true, inspection_id: id, added: added.length, skipped: skipped, photo_count: links.length, pdf_url: pdf.url,
      labels: added.map(function (x) { return x.label; }) });
  } finally { lock.releaseLock(); }
}

// ------------------------------------------------------------ list --------

/**
 * Newest rows first. Without from/to: the newest `limit` rows on the sheet
 * (max 500). With from/to (Oct 23 2026, yyyy-MM-dd, inclusive, on report_date):
 * every row in that window, however old, capped at `limit`, so a picked date
 * range on the recaps page can reach past the newest 500.
 */
function niList_(data) {
  var sh = niTab_(niSS_());
  var head = niHead_(sh);
  var last = sh.getLastRow();
  if (last < 2) return niOut_({ ok: true, rows: [], sheet_url: sh.getParent().getUrl() });
  var n = Math.min(Number(data.limit) || 100, 500);
  var from = niStr_(data.from).slice(0, 10), to = niStr_(data.to).slice(0, 10);
  var ranged = !!(from || to);
  var start = ranged ? 2 : Math.max(2, last - n + 1);
  var vals = sh.getRange(start, 1, last - start + 1, head.length).getValues();
  var mkt = data.market ? NI_MARKETS[niMarket_(data.market)] : '';
  var dc = head.indexOf('report_date'), mc = head.indexOf('market');
  var rows = [];
  for (var i = vals.length - 1; i >= 0; i--) {
    if (mkt && mc >= 0 && niStr_(vals[i][mc]) !== mkt) continue;
    if (ranged && dc >= 0) {
      var d = niStr_(vals[i][dc]).slice(0, 10);
      if ((from && d < from) || (to && d > to)) continue;
    }
    var o = {};
    head.forEach(function (h, j) { o[h] = (h === 'device') ? '' : niStr_(vals[i][j]); });
    rows.push(o);
    if (rows.length >= n) break;
  }
  return niOut_({ ok: true, rows: rows, sheet_url: sh.getParent().getUrl(), from: from, to: to, truncated: rows.length >= n });
}
