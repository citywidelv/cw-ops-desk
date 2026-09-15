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
  'standards', 'standards_failed', 'standards_met', 'prior_complaints'
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
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(NI_PROP);
  if (id) { try { return SpreadsheetApp.openById(id); } catch (e) {} }
  var ss = SpreadsheetApp.create('CW Night Inspections');
  props.setProperty(NI_PROP, ss.getId());
  try { ss.addEditor(NI_EDITOR); } catch (e) {}
  return ss;
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
    if (kind === 'ni_setup') return niSetup_(data);
    if (kind === 'ni_context') return niContext_(data);
    if (kind === 'ni_photo') return niPhoto_(data);
    if (kind === 'ni_submit') return niSubmit_(data);
    if (kind === 'ni_request') return niRequest_(data);
    if (kind === 'ni_list') return niList_(data);
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
    accounts: [], vendors: [], night_managers: [], fsms: [], last_vendor: {}, prior_complaints: {}, roster: {}, warnings: [] };

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
        if (cCN >= 0 && niStr_(vals[k][cCN])) niStr_(vals[k][cCN]).split('\n').forEach(function (n) { niRosterAdd_(out.roster, key, n); if (cAN >= 0) niRosterAdd_(out.roster, niStr_(vals[k][cAN]).toLowerCase(), n); });
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
      acRows_(AC_ROS, AC_ROS_HEAD).forEach(function (x) {
        var st = String(x.status || '');
        if (/removed/i.test(st)) return;
        var n = (String(x.cleaner_first || '') + ' ' + String(x.cleaner_last || '')).trim();
        var acct = String(x.account_matched || x.account_raw || '').toLowerCase().trim();
        if (n && acct) niRosterAdd_(out.roster, acct, n);
      });
    }
  } catch (e) { out.warnings.push('roster: ' + e.message); }

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
    var photos = Array.isArray(data.photos) ? data.photos.slice(0, 16) : [];
    var links = [], embeds = [], photoFolder = null;
    if (photos.length) {
      photoFolder = niMonthFolder_(mkt, reportDate, 'Photos');
      photos.forEach(function (p, i) {
        try {
          var label = niSafe_(p.label || '') || 'photo';
          var name = stem + ' - ' + ('0' + (i + 1)).slice(-2) + ' ' + label + '.jpg';
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
          var small = String(p.small || '');
          if (!/^data:image/.test(small)) small = 'data:image/jpeg;base64,' + Utilities.base64Encode(f.getBlob().getBytes());
          embeds.push({ src: small, label: label });
        } catch (e) {}
      });
    }
    r.photo_count = String(links.length);
    r.photo_links = links.join('\n');
    r.photo_folder_url = photoFolder ? photoFolder.getUrl() : '';
    r.flags = niFlags_(r);

    var pdf = niPdf_(r, embeds, stem, mkt, reportDate);
    r.pdf_url = pdf.url; r.pdf_name = pdf.name;

    var row = head.map(function (h) { return r[h] === undefined ? '' : r[h]; });
    sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setValues([row]);

    return niOut_({ ok: true, inspection_id: id, pdf_url: pdf.url, photo_count: links.length, flags: r.flags });
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
  try { if (typeof cwMail_ === 'function') cwMail_('ni_request', opts); else MailApp.sendEmail(opts); } catch (e) { status = 'mail failed: ' + e.message; }
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

function niPdf_(r, embeds, stem, mkt, reportDate) {
  var e = niEsc_;
  function row(label, val) { return val === '' || val == null ? '' : '<tr><th>' + e(label) + '</th><td>' + e(val).replace(/\n/g, '<br>') + '</td></tr>'; }
  function sec(title, rows) { var body = rows.join(''); return body ? '<h2>' + e(title) + '</h2><table>' + body + '</table>' : ''; }
  var flags = r.flags || niFlags_(r);
  var flagNames = { low_score: 'Low score', complaint: 'Complaint', unresolved: 'Unresolved', fsm_action: 'FSM action', unmatched_vendor: 'Company not in directory', unmatched_account: 'Building not in directory', supplies: 'Supplies', uniform: 'Uniform', crew_unverified: 'Crew not background checked', standards_failed: 'Standard not met' };
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

  if (embeds.length) {
    html += '<h2>Photos (' + embeds.length + ')</h2><div class="ph">';
    embeds.forEach(function (p) { if (/^data:image/.test(p.src)) html += '<div class="cap">' + e(p.label) + '</div><img src="' + p.src + '">'; });
    html += '</div>';
  }
  html += '<div class="foot">City Wide Facility Solutions &middot; ' + e(r.market) + ' &middot; ' + e(r.inspection_id) + ' &middot; Internal record &middot; GoCityWide.com</div></body></html>';

  var name = stem + '.pdf';
  var blob = Utilities.newBlob(html, 'text/html', name.replace(/\.pdf$/, '.html')).getAs('application/pdf').setName(name);
  var file = niMonthFolder_(mkt, reportDate, 'Reports').createFile(blob);
  niShare_(file);
  return { url: file.getUrl(), id: file.getId(), name: name };
}

// ------------------------------------------------------------ list --------

function niList_(data) {
  var sh = niTab_(niSS_());
  var head = niHead_(sh);
  var last = sh.getLastRow();
  if (last < 2) return niOut_({ ok: true, rows: [], sheet_url: sh.getParent().getUrl() });
  var n = Math.min(Number(data.limit) || 100, 500);
  var start = Math.max(2, last - n + 1);
  var vals = sh.getRange(start, 1, last - start + 1, head.length).getValues();
  var mkt = data.market ? NI_MARKETS[niMarket_(data.market)] : '';
  var rows = [];
  for (var i = vals.length - 1; i >= 0; i--) {
    var o = {};
    head.forEach(function (h, j) { o[h] = (h === 'device') ? '' : niStr_(vals[i][j]); });
    if (mkt && o.market !== mkt) continue;
    rows.push(o);
  }
  return niOut_({ ok: true, rows: rows, sheet_url: sh.getParent().getUrl() });
}
