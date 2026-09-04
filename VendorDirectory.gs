// ============================================================
// VendorDirectory.gs - the Active Vendors directory (Aug 2026)
// File in the CW Solicitations Apps Script project.
// Routing: doPost in Code.gs routes any kind starting 'vd_' to vdDispatch(data).
// Kinds: vd_setup, vd_seed, vd_append, vd_region_backfill, vd_list, vd_save,
//        vd_patch, vd_types, vd_intake, vd_bc_seed, vd_bc_list, vd_bc_send,
//        vd_bc_rows, vd_bc_upsert, vd_bom_auth, vd_bom_setpass, vd_bom_asana (Sep 4 2026, BOM Hub)
// Aug 22 2026: VD_HEADERS gained last_audit, audit_result, audit_next_due, audit_pdf,
// written by VendorAudit.gs and shown on vendors.html.
//
// Purpose: one internal roster of every vendor City Wide can actually call.
// Janitorial is one bucket. Everything else is grouped by service type, and the
// service-type list is a Sheet tab, so ops adds a category without a deployment.
//
// Own spreadsheet ("CW Vendor Directory"), created by vd_setup and remembered in
// the VD_SHEET_ID script property. It deliberately does NOT share the Violation
// Notices book: that book's Roster tab is a CRM snapshot owned by the violation
// and insurance flows, and joining them would make two systems fight over status.
// bc_vendor_no is carried on every row as the join key back to Dynamics and to
// that Roster, so the two can be reconciled without being coupled.
//
// Aug 22 2026: the vendor list is split into two tabs, one per market
// ("Vendors Las Vegas" and "Vendors Northern Nevada"). The old single "Vendors"
// tab is migrated once by vd_setup, then renamed and hidden as an archive.
// A vendor marked Both lives on the Las Vegas tab and still shows under both
// markets on the page. Every reader and writer below goes through the helpers
// vdVendorSheets_ / vdAllRows_ / vdTabFor_, so nothing else needs to know which
// tab a row sits on.
//
// Aug 22 2026: background checks. Two more tabs, "Background checks Las Vegas"
// and "Background checks Northern Nevada", hold one row per cleaner with a
// completed check. vd_list returns, per vendor, the names whose status is
// Cleared (or blank). The Ops Hub shows those names only; nothing about them
// ever goes to the vendor site. The team maintains the tabs by hand: a new row
// with the vendor and the person's name is enough, vendor_id is optional and
// wins when present, otherwise the vendor column is matched to dba_name or
// legal_name, case-insensitive.
//
// Privacy: business_address is stored in the Sheet and NEVER returned by vd_list.
// Several vendors registered a home address. The directory shows city and state.
//
// Gating: every kind except vd_intake requires the team passcode, checked here on
// the server. The pages that call this are in a public repo; the passcode is the
// only wall, exactly as with vio_* and ins_*.
// ============================================================

var VD_TABS = { VENDORS: 'Vendors', TYPES: 'Service Types', INTAKE: 'Intake Log' };
var VD_PROP = 'VD_SHEET_ID';

// One vendor tab per market. Region on the row still wins; the tab is where the
// row lives and the default region when the cell is blank.
var VD_VENDOR_TABS = [
  { key: 'lv',  name: 'Vendors Las Vegas',       region: 'Las Vegas' },
  { key: 'nnv', name: 'Vendors Northern Nevada', region: 'Northern Nevada' }
];
var VD_ARCHIVE_TAB = 'Vendors (archive, do not edit)';

var VD_BC_TABS = [
  { key: 'lv',  name: 'Background checks Las Vegas' },
  { key: 'nnv', name: 'Background checks Northern Nevada' }
];
var VD_BC_HEADERS = [
  'vendor_id', 'vendor', 'last_name', 'first_name', 'status', 'check_type',
  'ten_year', 'first_check', 'most_recent_check', 'vf_file_no',
  'roster_company_as_typed', 'notes', 'added',
  // Sep 4 2026: BOM Hub review columns. result is the Business Operations
  // Manager's call (Pass / Fail / Pending); status keeps driving the Ops Hub list.
  'result', 'result_date', 'reviewed_by', 'market'
];
var VD_BC_STATUS = ['Cleared', 'Pending', 'Removed'];
var VD_BC_RESULT = ['Pass', 'Fail', 'Pending'];
var VD_BC_TYPES = ['Standard', '10-Year', 'Standard + 10-Year'];
// Sep 4 2026: the BOM Hub has its own passcode (script property BOM_PASSCODE, set
// with vd_bom_setpass using the team passcode). It unlocks only the kinds below.
var VD_BOM_PROP = 'BOM_PASSCODE';
var VD_BOM_KINDS = ['vd_bom_auth', 'vd_list', 'vd_bc_list', 'vd_bc_rows', 'vd_bc_upsert', 'vd_bom_asana', 'vd_types'];

var VD_HEADERS = [
  'vendor_id', 'status', 'dba_name', 'legal_name', 'service_types', 'region',
  'contact_name', 'email', 'phone', 'business_phone', 'website', 'business_address',
  'city_state', 'years_in_business', 'crew_ft', 'crew_pt', 'metro_areas',
  'services_desc', 'workers_comp', 'general_liability', 'background_checks',
  'sut_paid', 'wage_compliance', 'documented_pay', 'i9_collected', 'daily_supervision',
  'concern_process', 'ref1_company', 'ref1_name', 'ref1_phone', 'ref1_email',
  'ref2_company', 'ref2_name', 'ref2_phone', 'ref2_email', 'family_involvement',
  'additional_notes', 'business_card_url', 'has_brochures', 'has_cards',
  'bc_vendor_no', 'ic_type', 'cw_start_date', 'cw_clients', 'monthly_revenue',
  'gl_exp', 'wc_exp', 'source', 'eval_date', 'added_by', 'updated',
  'internal_notes', 'hide', 'outreach', 'license_no', 'trade_raw',
  // Aug 22 2026: quarterly audit columns, written by VendorAudit.gs (audit_submit)
  'last_audit', 'audit_result', 'audit_next_due', 'audit_pdf'
];

var VD_TYPE_HEADERS = ['slug', 'name', 'description', 'sort', 'active'];

var VD_INTAKE_HEADERS = [
  'received', 'submission_id', 'business_name', 'contact_name', 'email', 'phone',
  'region', 'service_types', 'matched_vendor_id', 'action', 'raw'
];

// Vendors carrying any of these are janitorial and live on the Janitorial page.
var VD_JANITORIAL = 'janitorial';

// Statuses that count as a vendor City Wide can call today. Everything else is
// visible but badged, because an FSM still needs to see who is in the pipeline.
var VD_LIVE_STATUS = ['Active', 'Waiting for Account', 'In Progress'];

// Outreach targets. They are real rows with real service types, but they sit in
// their own branch so nobody dispatches one by accident.
var VD_PROSPECT_STATUS = ['Prospect', 'Do Not Contact'];

// The two markets. 'Both' shows under each. Anything unrecognised or blank falls
// to Las Vegas, which is where every record City Wide has handed over came from.
var VD_REGIONS = [
  { key: 'lv',  name: 'Las Vegas',       match: ['las vegas', 'lv', 'southern nevada'] },
  { key: 'nnv', name: 'Northern Nevada', match: ['northern nevada', 'nnv', 'reno', 'sparks', 'carson'] }
];

function vdRegion_(raw) {
  var s = vdStr_(raw).toLowerCase();
  if (!s) return 'Las Vegas';
  if (s.indexOf('both') >= 0) return 'Both';
  for (var i = 0; i < VD_REGIONS.length; i++) {
    for (var j = 0; j < VD_REGIONS[i].match.length; j++) {
      if (s.indexOf(VD_REGIONS[i].match[j]) >= 0) return VD_REGIONS[i].name;
    }
  }
  return 'Las Vegas';
}

function vdInRegion_(region, key) {
  if (region === 'Both') return true;
  var r = VD_REGIONS.filter(function (x) { return x.key === key; })[0];
  return !!r && region === r.name;
}

// ------------------------------------------------------------ plumbing -----

function vdPass_() {
  try { if (typeof PASSCODE !== 'undefined') return PASSCODE; } catch (e) {}
  return PropertiesService.getScriptProperties().getProperty('PASSCODE') || '';
}

function vdBomPass_() {
  return PropertiesService.getScriptProperties().getProperty(VD_BOM_PROP) || '';
}

function vdOut_(o) {
  // Uses Code.gs's _json when present so every handler answers the same shape.
  try { if (typeof _json === 'function') return _json(o); } catch (e) {}
  return ContentService.createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}

function vdDispatch(data) {
  var kind = String(data.kind || '');

  // Jotform cannot send the team passcode. It carries a shared secret instead,
  // and it can only ever create an In Progress row, never read or edit one.
  if (kind === 'vd_intake') return vdIntake_(data);

  var teamOk = (data.passcode || '') !== '' && (data.passcode || '') === vdPass_();
  var bomOk = !teamOk && vdBomPass_() && (data.passcode || '') === vdBomPass_() && VD_BOM_KINDS.indexOf(kind) >= 0;
  if (!teamOk && !bomOk) return vdOut_({ ok: false, error: 'Wrong passcode.' });
  data._bom = bomOk;

  if (kind === 'vd_bom_auth') return vdOut_({ ok: true, who: bomOk ? 'bom' : 'team' });
  if (kind === 'vd_bom_setpass') return vdBomSetPass_(data);
  if (kind === 'vd_bom_asana') return vdBomAsana_(data);
  if (kind === 'vd_bc_rows') return vdBcRows_(data);
  if (kind === 'vd_bc_upsert') return vdBcUpsert_(data);
  if (kind === 'vd_setup') return vdSetup_(data);
  if (kind === 'vd_seed')  return vdSeed_(data);
  if (kind === 'vd_append') return vdAppend_(data);
  if (kind === 'vd_region_backfill') return vdRegionBackfill_(data);
  if (kind === 'vd_list')  return vdList_(data);
  if (kind === 'vd_save')  return vdSave_(data);
  if (kind === 'vd_patch') return vdPatch_(data);
  if (kind === 'vd_types') return vdTypes_(data);
  if (kind === 'vd_bc_seed') return vdBcSeed_(data);
  if (kind === 'vd_bc_list') return vdBcList_(data);
  if (kind === 'vd_bc_send') return vdBcSend_(data);
  return vdOut_({ ok: false, error: 'Unknown vd kind' });
}

function vdSS_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(VD_PROP);
  if (id) {
    try { return SpreadsheetApp.openById(id); } catch (e) {}
  }
  var ss = SpreadsheetApp.create('CW Vendor Directory');
  props.setProperty(VD_PROP, ss.getId());
  return ss;
}

function vdTab_(ss, name, headers, color) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  sh.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground(color).setFontColor('#FFFFFF');
  sh.setFrozenRows(1);
  return sh;
}

function vdStr_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'America/Los_Angeles', 'yyyy-MM-dd');
  return String(v == null ? '' : v).replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
}

function vdYes_(v) { return vdStr_(v).toLowerCase() === 'yes'; }
function vdTrue_(v) { return vdStr_(v).toUpperCase() === 'TRUE'; }

function vdSlugs_(v) {
  return vdStr_(v).split(',').map(function (s) { return s.trim().toLowerCase(); })
    .filter(function (s) { return s; });
}

function vdRows_(sh) {
  var vals = sh.getDataRange().getValues();
  if (vals.length < 2) return { head: vals[0] || [], rows: [] };
  var head = vals[0].map(function (h) { return vdStr_(h); });
  var rows = [];
  for (var i = 1; i < vals.length; i++) {
    var o = { _row: i + 1 };
    for (var c = 0; c < head.length; c++) if (head[c]) o[head[c]] = vdStr_(vals[i][c]);
    rows.push(o);
  }
  return { head: head, rows: rows };
}

// ------------------------------------------------------------ market tabs --

// The vendor sheets in order. Before migration (no market tabs yet) this falls
// back to the legacy single tab so nothing breaks between deploy and setup.
function vdVendorSheets_(ss) {
  var out = [];
  VD_VENDOR_TABS.forEach(function (t) {
    var sh = ss.getSheetByName(t.name);
    if (sh) out.push({ sh: sh, tab: t });
  });
  if (!out.length) {
    var legacy = ss.getSheetByName(VD_TABS.VENDORS);
    if (legacy) out.push({ sh: legacy, tab: { key: 'legacy', name: VD_TABS.VENDORS, region: '' } });
  }
  return out;
}

// Every vendor row across the market tabs. Each row carries _sheet (the Sheet
// object) and _tab so writers can go straight back to the right cell.
function vdAllRows_(ss) {
  var all = [];
  vdVendorSheets_(ss).forEach(function (s) {
    vdRows_(s.sh).rows.forEach(function (r) {
      r._sheet = s.sh;
      r._tab = s.tab.name;
      if (!vdStr_(r.region) && s.tab.region) r.region = s.tab.region;
      all.push(r);
    });
  });
  return all;
}

// Which tab a row belongs on. Northern Nevada goes north; Las Vegas, Both, and
// anything unrecognised go to the Las Vegas tab.
function vdTabFor_(ss, region) {
  var key = vdRegion_(region) === 'Northern Nevada' ? 'nnv' : 'lv';
  var t = VD_VENDOR_TABS.filter(function (x) { return x.key === key; })[0];
  var sh = ss.getSheetByName(t.name);
  if (!sh) {
    vdSetup_({});
    sh = ss.getSheetByName(t.name);
  }
  return sh;
}

function vdStatusRules_(sh) {
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(VD_LIVE_STATUS.concat(VD_PROSPECT_STATUS), true).build();
  sh.getRange(2, VD_HEADERS.indexOf('status') + 1, 2000, 1).setDataValidation(rule);
  var cb = SpreadsheetApp.newDataValidation().requireCheckbox().build();
  sh.getRange(2, VD_HEADERS.indexOf('hide') + 1, 2000, 1).setDataValidation(cb);
}

// ------------------------------------------------------------ setup --------

function vdSetup_(data) {
  var ss = vdSS_();

  // Market tabs. Created empty here; the one-time migration below fills them
  // from the legacy tab the first time it finds one.
  var legacy = ss.getSheetByName(VD_TABS.VENDORS);
  var fresh = !VD_VENDOR_TABS.some(function (t) { return !!ss.getSheetByName(t.name); });
  VD_VENDOR_TABS.forEach(function (t) { vdTab_(ss, t.name, VD_HEADERS, '#D22730'); });

  var migrated = 0;
  if (legacy && fresh) {
    var rows = legacy.getDataRange().getValues();
    var regionCol = VD_HEADERS.indexOf('region');
    var byTab = {};
    for (var i = 1; i < rows.length; i++) {
      if (!vdStr_(rows[i][VD_HEADERS.indexOf('dba_name')]) && !vdStr_(rows[i][0])) continue;
      var key = vdRegion_(rows[i][regionCol]) === 'Northern Nevada' ? 'nnv' : 'lv';
      byTab[key] = byTab[key] || [];
      var row = rows[i].slice(0, VD_HEADERS.length);
      while (row.length < VD_HEADERS.length) row.push('');
      byTab[key].push(row);
    }
    VD_VENDOR_TABS.forEach(function (t) {
      var list = byTab[t.key] || [];
      if (!list.length) return;
      var sh = ss.getSheetByName(t.name);
      sh.getRange(2, 1, list.length, VD_HEADERS.length).setValues(list);
      migrated += list.length;
    });
    legacy.setName(VD_ARCHIVE_TAB);
    legacy.hideSheet();
  }

  VD_VENDOR_TABS.forEach(function (t) {
    var sh = ss.getSheetByName(t.name);
    vdStatusRules_(sh);
    sh.autoResizeColumns(1, 5);
  });

  var t = vdTab_(ss, VD_TABS.TYPES, VD_TYPE_HEADERS, '#2D2A26');
  vdTab_(ss, VD_TABS.INTAKE, VD_INTAKE_HEADERS, '#636466');

  // Background check tabs: status dropdown, frozen header, readable widths.
  VD_BC_TABS.forEach(function (b) {
    var sh = vdTab_(ss, b.name, VD_BC_HEADERS, '#0AA6A9');
    var rule = SpreadsheetApp.newDataValidation().requireValueInList(VD_BC_STATUS, true).build();
    sh.getRange(2, VD_BC_HEADERS.indexOf('status') + 1, 2000, 1).setDataValidation(rule);
    var rr = SpreadsheetApp.newDataValidation().requireValueInList(VD_BC_RESULT, true).build();
    sh.getRange(2, VD_BC_HEADERS.indexOf('result') + 1, 2000, 1).setDataValidation(rr);
    var tr = SpreadsheetApp.newDataValidation().requireValueInList(VD_BC_TYPES, true).build();
    sh.getRange(2, VD_BC_HEADERS.indexOf('check_type') + 1, 2000, 1).setDataValidation(tr);
    sh.setColumnWidth(VD_BC_HEADERS.indexOf('vendor') + 1, 260);
    sh.setColumnWidth(VD_BC_HEADERS.indexOf('last_name') + 1, 150);
    sh.setColumnWidth(VD_BC_HEADERS.indexOf('first_name') + 1, 130);
    sh.setColumnWidth(VD_BC_HEADERS.indexOf('roster_company_as_typed') + 1, 240);
    sh.setColumnWidth(VD_BC_HEADERS.indexOf('notes') + 1, 300);
  });

  var first = ss.getSheets()[0];
  if (first.getName() === 'Sheet1' && first.getLastRow() === 0) ss.deleteSheet(first);

  // Upsert, not seed-once: re-running setup adds new categories without touching
  // the name, description, sort or active flag anyone has edited on the sheet.
  if (data && data.types && data.types.length) {
    var have = {};
    var tv = t.getDataRange().getValues();
    for (var ti = 1; ti < tv.length; ti++) {
      var sl = vdStr_(tv[ti][0]).toLowerCase();
      if (sl) have[sl] = true;
    }
    var add = data.types.filter(function (x) { return !have[String(x.slug).toLowerCase()]; })
      .map(function (x) { return [x.slug, x.name, x.description || '', Number(x.sort || 0), true]; });
    if (add.length) t.getRange(t.getLastRow() + 1, 1, add.length, VD_TYPE_HEADERS.length).setValues(add);
    t.getRange(2, 5, 500, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireCheckbox().build());
  }

  return vdOut_({ ok: true, sheet_id: ss.getId(), url: ss.getUrl(), migrated: migrated,
                  tabs: ss.getSheets().map(function (s) { return s.getName(); }) });
}

// Bulk load. Replaces the vendor rows wholesale, so it is safe to re-run while
// the initial data is still being corrected, and refuses once real edits exist
// unless data.force is set.
//
// The payload is POSTed in, never fetched from a URL. The seed carries every
// vendor's registered address, several of which are homes, and the pages that
// call this service live in a PUBLIC repo. Nothing that holds vendor data may be
// parked anywhere a URL can reach. If a url is passed explicitly it is honored,
// but it must be a location inside the City Wide Google account.
function vdSeed_(data) {
  var payload = data.payload;
  if (!payload && data.url) {
    payload = JSON.parse(UrlFetchApp.fetch(data.url, { muteHttpExceptions: true }).getContentText());
  }
  if (!payload || !payload.vendors) {
    return vdOut_({ ok: false, error: 'No seed payload. POST vd_seed with a payload object.' });
  }

  vdSetup_({ types: payload.service_types });
  var ss = vdSS_();

  var existing = vdAllRows_(ss).length;
  if (existing > 0 && !data.force) {
    return vdOut_({ ok: false, error: 'Vendor tabs already hold ' + existing +
      ' rows. Re-run with force to replace them.' });
  }
  vdVendorSheets_(ss).forEach(function (s) {
    var n = s.sh.getLastRow() - 1;
    if (n > 0) s.sh.getRange(2, 1, n, VD_HEADERS.length).clearContent();
  });

  var byTab = {};
  payload.vendors.forEach(function (v) {
    var key = vdRegion_(v.region) === 'Northern Nevada' ? 'nnv' : 'lv';
    byTab[key] = byTab[key] || [];
    byTab[key].push(VD_HEADERS.map(function (h) { return v[h] == null ? '' : String(v[h]); }));
  });
  var total = 0;
  VD_VENDOR_TABS.forEach(function (t) {
    var list = byTab[t.key] || [];
    if (!list.length) return;
    var sh = ss.getSheetByName(t.name);
    sh.getRange(2, 1, list.length, VD_HEADERS.length).setValues(list);
    total += list.length;
  });

  return vdOut_({ ok: true, seeded: total, url: ss.getUrl() });
}

// Adds rows without touching what is already there, unlike vd_seed which replaces
// the tabs. Skips any dba_name already on the list so it is safe to re-run.
function vdAppend_(data) {
  var payload = data.payload;
  if (!payload || !payload.vendors) return vdOut_({ ok: false, error: 'No payload' });

  vdSetup_({ types: payload.service_types });
  var ss = vdSS_();
  var all = vdAllRows_(ss);

  var seen = {};
  all.forEach(function (r) { if (r.dba_name) seen[r.dba_name.toLowerCase()] = true; });

  var next = vdNextId_(all);
  var n = Number(next.slice(2));
  var out = {}, skipped = [], added = 0;
  payload.vendors.forEach(function (v) {
    var key = vdStr_(v.dba_name).toLowerCase();
    if (!key) return;
    if (seen[key]) { skipped.push(v.dba_name); return; }
    seen[key] = true;
    v.vendor_id = 'V-' + ('000' + n).slice(-3);
    n++;
    if (v.region !== undefined) v.region = vdRegion_(v.region);
    var tk = vdRegion_(v.region) === 'Northern Nevada' ? 'nnv' : 'lv';
    out[tk] = out[tk] || [];
    out[tk].push(VD_HEADERS.map(function (h) { return v[h] == null ? '' : String(v[h]); }));
  });

  VD_VENDOR_TABS.forEach(function (t) {
    var list = out[t.key] || [];
    if (!list.length) return;
    var sh = ss.getSheetByName(t.name);
    sh.getRange(vdNextRow_(sh), 1, list.length, VD_HEADERS.length).setValues(list);
    added += list.length;
  });
  return vdOut_({ ok: true, added: added, skipped: skipped.length, skipped_names: skipped.slice(0, 20) });
}

// One-time repair for rows loaded before the market column existed. Everything
// City Wide handed over was the Las Vegas book, with the corrections passed in.
function vdRegionBackfill_(data) {
  var ss = vdSS_();
  var col = VD_HEADERS.indexOf('region') + 1;
  var rows = vdAllRows_(ss);
  var fixes = {};
  (data.fixes || []).forEach(function (f) { fixes[String(f.name).toLowerCase()] = f.region; });

  var filled = 0, corrected = 0;
  rows.forEach(function (r) {
    if (!r.dba_name) return;
    var want = fixes[r.dba_name.toLowerCase()];
    if (want && vdRegion_(r.region) !== want) {
      r._sheet.getRange(r._row, col).setValue(want); corrected++; return;
    }
    if (!vdStr_(r._sheet.getRange(r._row, col).getValue())) {
      r._sheet.getRange(r._row, col).setValue(r.region || 'Las Vegas'); filled++;
    }
  });
  return vdOut_({ ok: true, filled: filled, corrected: corrected });
}

// ------------------------------------------------------------ read ---------

function vdTypes_(data) {
  var ss = vdSS_();
  var sh = ss.getSheetByName(VD_TABS.TYPES);
  if (!sh) return vdOut_({ ok: true, types: [] });
  var r = vdRows_(sh).rows.filter(function (x) { return x.slug && vdTrue_(x.active); });
  r.sort(function (a, b) { return (Number(a.sort) || 999) - (Number(b.sort) || 999); });
  return vdOut_({ ok: true, types: r.map(function (x) {
    return { slug: x.slug.toLowerCase(), name: x.name, description: x.description,
             sort: Number(x.sort) || 999 };
  }) });
}

// Cleared names per vendor, read from the two background check tabs.
// Returns { byId: {vendor_id: [ {name, tab} ]}, unmatched: [...], rows: n }.
// A row counts when status is Cleared or blank. Pending and Removed stay in the
// sheet as history and never reach the page.
function vdCleared_(ss, vendors) {
  var byId = {}, byName = {};
  vendors.forEach(function (v) {
    if (v.dba_name) byName[v.dba_name.toLowerCase()] = v.vendor_id;
    if (v.legal_name && !byName[v.legal_name.toLowerCase()]) byName[v.legal_name.toLowerCase()] = v.vendor_id;
  });
  var out = {}, unmatched = [], n = 0;
  VD_BC_TABS.forEach(function (b) {
    var sh = ss.getSheetByName(b.name);
    if (!sh) return;
    vdRows_(sh).rows.forEach(function (r) {
      var name = [vdStr_(r.first_name), vdStr_(r.last_name)].filter(function (x) { return x; }).join(' ');
      if (!name) return;
      n++;
      var st = vdStr_(r.status);
      if (st && st !== 'Cleared') return;
      if (vdStr_(r.result) === 'Fail') return;   // a failed review never reaches the page
      var id = vdStr_(r.vendor_id);
      if (!id) id = byName[vdStr_(r.vendor).toLowerCase()] || '';
      if (!id) { unmatched.push({ vendor: vdStr_(r.vendor), name: name, tab: b.name }); return; }
      out[id] = out[id] || [];
      out[id].push({ name: name, tab: b.key, last: vdStr_(r.last_name), first: vdStr_(r.first_name),
                     check_type: vdStr_(r.check_type), result: vdStr_(r.result), ten_year: vdYes_(r.ten_year) });
    });
  });
  Object.keys(out).forEach(function (k) {
    out[k].sort(function (a, b) {
      var x = (a.last + ' ' + a.first).toLowerCase(), y = (b.last + ' ' + b.first).toLowerCase();
      return x < y ? -1 : x > y ? 1 : 0;
    });
    out[k] = out[k].map(function (p) { return { name: p.name, tab: p.tab, check_type: p.check_type, result: p.result, ten_year: p.ten_year }; });
  });
  return { byId: out, unmatched: unmatched.slice(0, 50), unmatched_count: unmatched.length, rows: n };
}

function vdBcList_(data) {
  var ss = vdSS_();
  var vendors = vdAllRows_(ss).filter(function (r) { return r.dba_name; });
  var c = vdCleared_(ss, vendors);
  return vdOut_({ ok: true, cleared: c.byId, unmatched: c.unmatched,
                  unmatched_count: c.unmatched_count, rows: c.rows });
}

// The directory payload. business_address is dropped on purpose; see the header.
function vdList_(data) {
  var ss = vdSS_();
  var sheets = vdVendorSheets_(ss);
  if (!sheets.length) return vdOut_({ ok: false, error: 'Run vd_setup first.' });

  var tsh = ss.getSheetByName(VD_TABS.TYPES);
  var types = [];
  if (tsh) {
    types = vdRows_(tsh).rows.filter(function (x) { return x.slug && vdTrue_(x.active); })
      .map(function (x) {
        return { slug: x.slug.toLowerCase(), name: x.name, description: x.description,
                 sort: Number(x.sort) || 999 };
      });
    types.sort(function (a, b) { return a.sort - b.sort; });
  }

  var drop = { business_address: 1, _row: 1, hide: 1, _sheet: 1, _tab: 1 };
  var vendors = [];
  var counts = {}, statusCounts = {};
  // Counts are kept per region and per branch so the landing pages can show real
  // numbers without the client having to re-derive them from the whole list.
  var regionCounts = {};
  VD_REGIONS.forEach(function (r) {
    regionCounts[r.key] = { name: r.name, janitorial: 0, other: 0, prospects: 0, total: 0, types: {} };
  });

  var allRows = vdAllRows_(ss);
  allRows.forEach(function (r) {
    if (!r.dba_name || vdTrue_(r.hide)) return;
    var o = {};
    Object.keys(r).forEach(function (k) { if (!drop[k]) o[k] = r[k]; });
    o.tab = r._tab;
    o.slugs = vdSlugs_(r.service_types);
    o.janitorial = o.slugs.indexOf(VD_JANITORIAL) >= 0;
    o.live = VD_LIVE_STATUS.indexOf(r.status) >= 0;
    o.prospect = VD_PROSPECT_STATUS.indexOf(r.status) >= 0;
    o.region = vdRegion_(r.region);
    o.regions = VD_REGIONS.filter(function (x) { return vdInRegion_(o.region, x.key); })
                          .map(function (x) { return x.key; });
    vendors.push(o);

    o.slugs.forEach(function (s) { counts[s] = (counts[s] || 0) + 1; });
    statusCounts[r.status || 'Unknown'] = (statusCounts[r.status || 'Unknown'] || 0) + 1;

    o.regions.forEach(function (k) {
      var rc = regionCounts[k];
      rc.total++;
      if (o.prospect) rc.prospects++;
      else {
        if (o.janitorial) rc.janitorial++;
        if (o.slugs.some(function (s) { return s !== VD_JANITORIAL; })) rc.other++;
      }
      o.slugs.forEach(function (s) {
        rc.types[s] = rc.types[s] || { all: 0, prospects: 0 };
        rc.types[s].all++;
        if (o.prospect) rc.types[s].prospects++;
      });
    });
  });

  vendors.sort(function (a, b) {
    if (a.prospect !== b.prospect) return a.prospect ? 1 : -1;   // working bench first
    if (a.live !== b.live) return a.live ? -1 : 1;
    return a.dba_name.toLowerCase() < b.dba_name.toLowerCase() ? -1 : 1;
  });

  // A type with no vendors still shows, so ops can see the empty bench and fill it.
  types.forEach(function (t) { t.count = counts[t.slug] || 0; });

  // Background checks: names only, keyed by vendor_id. Hidden vendors are
  // excluded above so their names never ship either.
  var cleared = vdCleared_(ss, allRows.filter(function (r) { return r.dba_name; }));
  var clearedOut = {};
  vendors.forEach(function (v) { if (cleared.byId[v.vendor_id]) clearedOut[v.vendor_id] = cleared.byId[v.vendor_id]; });

  return vdOut_({
    ok: true, vendors: vendors, types: types, counts: counts,
    regions: VD_REGIONS.map(function (r) { return { key: r.key, name: r.name }; }),
    region_counts: regionCounts,
    status_counts: statusCounts, total: vendors.length,
    cleared: clearedOut,
    cleared_meta: { rows: cleared.rows, unmatched_count: cleared.unmatched_count,
                    tabs: VD_BC_TABS.map(function (b) { return { key: b.key, name: b.name }; }) },
    vendor_tabs: VD_VENDOR_TABS.map(function (t) { return { key: t.key, name: t.name }; }),
    sheet_url: ss.getUrl(), generated: new Date().toISOString()
  });
}

// ------------------------------------------------------------ write --------

// First empty row by column A. getLastRow() counts the validation and checkbox
// ranges setup paints down to row 2000, which is why new vendors were landing at
// row 1001 (found Aug 22 2026 while building the audit page).
function vdNextRow_(sh) {
  var vals = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), 1).getValues();
  for (var i = 1; i < vals.length; i++) if (!vdStr_(vals[i][0])) return i + 1;
  return vals.length + 1;
}

function vdNextId_(rows) {
  var max = 0;
  rows.forEach(function (r) {
    var m = /^V-(\d+)$/.exec(vdStr_(r.vendor_id));
    if (m) max = Math.max(max, Number(m[1]));
  });
  return 'V-' + ('000' + (max + 1)).slice(-3);
}

// Add a vendor, or update one when vendor_id is supplied. Only fields present in
// the payload are written, so a partial edit never blanks the rest of the row.
function vdSave_(data) {
  var v = data.vendor || {};
  var dba = vdStr_(v.dba_name);
  var isUpdate = !!vdStr_(v.vendor_id);

  // A new record needs a name and a home. An update is a patch: it only has to
  // keep whatever it does send valid, so a one-field status change is allowed.
  if (!isUpdate) {
    if (!dba) return vdOut_({ ok: false, error: 'Business name is required.' });
    if (!vdStr_(v.service_types)) return vdOut_({ ok: false, error: 'Pick at least one service type.' });
  } else {
    if (v.dba_name !== undefined && !dba) return vdOut_({ ok: false, error: 'Business name cannot be blanked.' });
    if (v.service_types !== undefined && !vdStr_(v.service_types)) {
      return vdOut_({ ok: false, error: 'A vendor must keep at least one service type.' });
    }
  }

  var ss = vdSS_();
  if (!vdVendorSheets_(ss).length) return vdOut_({ ok: false, error: 'Run vd_setup first.' });
  var all = vdAllRows_(ss);

  var target = null;
  if (isUpdate) {
    target = all.filter(function (r) { return r.vendor_id === vdStr_(v.vendor_id); })[0] || null;
    if (!target) return vdOut_({ ok: false, error: 'No vendor with id ' + vdStr_(v.vendor_id) });
  } else {
    var key = dba.toLowerCase();
    var dupe = all.filter(function (r) { return r.dba_name.toLowerCase() === key; })[0];
    if (dupe && !data.allow_duplicate) {
      return vdOut_({ ok: false, duplicate: true, vendor_id: dupe.vendor_id,
        error: dba + ' is already on the list as ' + dupe.vendor_id + ' (' + dupe.status +
               '). Open it to edit, or resubmit to add a second record.' });
    }
  }

  var sh, row;
  if (target) {
    sh = target._sheet;
    row = target._row;
  } else {
    sh = vdTabFor_(ss, v.region);
    row = vdNextRow_(sh);
    v.vendor_id = vdNextId_(all);
    if (!vdStr_(v.status)) v.status = 'Prospect';
    if (!vdStr_(v.source)) v.source = 'Ops Hub';
  }
  v.updated = Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyyy-MM-dd');
  if (v.region !== undefined) v.region = vdRegion_(v.region);

  VD_HEADERS.forEach(function (h, i) {
    if (v[h] === undefined) return;
    sh.getRange(row, i + 1).setValue(String(v[h] == null ? '' : v[h]));
  });

  return vdOut_({ ok: true, vendor_id: vdStr_(v.vendor_id) || (target && target.vendor_id),
                  updated: !!target, tab: sh.getName(), url: ss.getUrl() });
}

// ------------------------------------------------------------ bulk patch ---

// vd_save is one vendor and one setValue per field, which is fine from a form and
// unusable for a few hundred rows. vd_patch takes an array of partial records keyed
// by vendor_id, mutates the sheet values in memory, and writes each tab back once.
// Fields absent from a patch are left exactly as they are. A patch that changes
// region does not move the row between tabs; the region cell wins on the page.
function vdPatch_(data) {
  var patches = (data && data.patches) || [];
  if (!patches.length) return vdOut_({ ok: false, error: 'No patches' });
  var ss = vdSS_();
  if (!vdVendorSheets_(ss).length) return vdOut_({ ok: false, error: 'Run vd_setup first.' });
  var r = vdPatchCore_(ss, patches);
  return vdOut_({ ok: true, applied: r.applied, fields: r.fields, missing: r.missing });
}

// Sep 3 2026: the in-memory patch loop split out of vdPatch_ so vd_bc_send can
// stamp internal_notes after a batch without a second round trip from the page.
function vdPatchCore_(ss, patches) {
  var sheets = vdVendorSheets_(ss);
  var col = {};
  VD_HEADERS.forEach(function (h, i) { col[h] = i; });
  var today = Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyyy-MM-dd');
  var applied = 0, fields = 0, missing = [];
  var wanted = {};
  patches.forEach(function (p) { wanted[vdStr_(p.vendor_id)] = p; });
  var found = {};

  sheets.forEach(function (s) {
    var sh = s.sh;
    var last = sh.getLastRow();
    if (last < 2) return;
    var rng = sh.getRange(2, 1, last - 1, VD_HEADERS.length);
    var vals = rng.getValues();
    var touchedSheet = false;
    for (var r = 0; r < vals.length; r++) {
      var id = vdStr_(vals[r][col.vendor_id]);
      var p = wanted[id];
      if (!p) continue;
      found[id] = true;
      var touched = false;
      Object.keys(p).forEach(function (k) {
        if (k === 'vendor_id') return;
        if (col[k] === undefined) return;
        var val = p[k] == null ? '' : String(p[k]);
        if (k === 'region') val = vdRegion_(val);
        if (String(vals[r][col[k]]) === val) return;
        vals[r][col[k]] = val;
        touched = true;
        fields++;
      });
      if (touched) { vals[r][col.updated] = today; applied++; touchedSheet = true; }
    }
    if (touchedSheet) rng.setValues(vals);
  });

  Object.keys(wanted).forEach(function (id) { if (!found[id]) missing.push(id); });
  return { applied: applied, fields: fields, missing: missing };
}

// ------------------------------------------------------ background check notices

// Sep 3 2026. Sends the "who we have background checks on file for" notice to
// each vendor in the batch from the platform Gmail (display name City Wide
// Compliance, replies to the market compliance mailbox), the same way
// Insurance.gs sends COI requests. The page (bc-notices.html) fills the
// subject and body per vendor; this side wraps the text in the branded shell,
// sends, logs a row on the BC Notices tab of the directory sheet, and stamps
// internal_notes so the page can show the last notice date. Test mode sends
// every email to data.test_to instead and still logs, flagged test=TRUE.
var VD_BC_LOG_TAB = 'BC Notices';
var VD_BC_LOG_HEADERS = ['sent', 'test', 'batch_id', 'market', 'vendor_id', 'vendor', 'to',
  'subject', 'names_on_file', 'status', 'error'];
var VD_BC_BATCH_MAX = 50;
var VD_BC_SENDER = 'City Wide Compliance';
var VD_BC_LINK_TEXT = 'Upload or Request a Background Check';

function vdBcSend_(data) {
  var rows = (data && data.rows) || [];
  if (!rows.length) return vdOut_({ ok: false, error: 'No vendors in the batch.' });
  if (rows.length > VD_BC_BATCH_MAX) {
    return vdOut_({ ok: false, error: 'Batch of ' + rows.length + ' is over the limit of ' +
      VD_BC_BATCH_MAX + '. Send it in smaller runs.' });
  }
  var mkName = String(data.market || '').toLowerCase() === 'nnv' ? 'Northern Nevada' : 'Las Vegas';
  var mk = (typeof INS_MARKETS !== 'undefined' && INS_MARKETS[mkName]) || null;
  if (!mk) return vdOut_({ ok: false, error: 'Market table missing (Insurance.gs).' });

  var test = data.test === true || String(data.test).toUpperCase() === 'TRUE';
  var testTo = vdStr_(data.test_to);
  if (test && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(testTo)) {
    return vdOut_({ ok: false, error: 'Test mode needs a valid test address.' });
  }

  var quota = -1;
  try { quota = MailApp.getRemainingDailyQuota(); } catch (e) {}
  if (quota >= 0 && quota < rows.length) {
    return vdOut_({ ok: false, error: 'Only ' + quota + ' emails left on today\'s shared Google quota, and this batch needs ' +
      rows.length + '. Nothing was sent. Send fewer, or use the mail app option.' });
  }

  var ss = vdSS_();
  var log = ss.getSheetByName(VD_BC_LOG_TAB);
  if (!log) {
    log = ss.insertSheet(VD_BC_LOG_TAB);
    log.getRange(1, 1, 1, VD_BC_LOG_HEADERS.length).setValues([VD_BC_LOG_HEADERS]).setFontWeight('bold');
    log.setFrozenRows(1);
  }
  var now = new Date();
  var stamp = Utilities.formatDate(now, 'America/Los_Angeles', 'yyyy-MM-dd HH:mm');
  var batchId = 'BC-B-' + Utilities.formatDate(now, 'America/Los_Angeles', 'yyMMdd') + '-' +
    Math.random().toString(36).slice(2, 5).toUpperCase();

  var results = [], logRows = [], patches = [];
  rows.forEach(function (r) {
    var to = vdStr_(r.to), subject = vdStr_(r.subject), body = String(r.body || '');
    var out = { vendor_id: vdStr_(r.vendor_id), vendor: vdStr_(r.vendor), to: to, status: 'sent', error: '' };
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) { out.status = 'skipped'; out.error = 'Bad email address'; }
    else if (!subject || !body.trim()) { out.status = 'skipped'; out.error = 'Empty subject or body'; }
    else {
      try {
        MailApp.sendEmail({
          to: test ? testTo : to,
          replyTo: mk.compliance,
          name: VD_BC_SENDER,
          subject: (test ? '[TEST for ' + to + '] ' : '') + subject,
          htmlBody: vdBcHtml_(body, mk, test, to),
          body: (test ? 'TEST. Would have gone to ' + to + '\n\n' : '') + body + '\n\n' + vdBcFooterText_(mk)
        });
        if (r.notes != null && out.vendor_id) patches.push({ vendor_id: out.vendor_id, internal_notes: String(r.notes) });
      } catch (e) { out.status = 'failed'; out.error = String(e && e.message || e); }
    }
    results.push(out);
    logRows.push([stamp, test, batchId, mkName, out.vendor_id, out.vendor, to, subject,
      Number(r.names_on_file) || 0, out.status, out.error]);
  });
  if (logRows.length) log.getRange(log.getLastRow() + 1, 1, logRows.length, VD_BC_LOG_HEADERS.length).setValues(logRows);

  var stamped = 0;
  if (patches.length && !test) {
    try { stamped = vdPatchCore_(ss, patches).applied; } catch (e) {}
  }
  var left = -1;
  try { left = MailApp.getRemainingDailyQuota(); } catch (e) {}
  return vdOut_({ ok: true, batch_id: batchId, test: test, results: results, stamped: stamped, quota_left: left });
}

function vdBcEsc_(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Plain text from the page -> simple HTML. Blank line = paragraph, lines that
// start with "- " inside a paragraph = bullet list, bare URLs = links.
function vdBcHtml_(text, mk, test, realTo) {
  var logo = (typeof INS_LOGO !== 'undefined') ? INS_LOGO : 'https://emailer.emfluence.com/clients/citywide/uploadedfiles/signature_logo.png';
  var paras = String(text).replace(/\r/g, '').split(/\n{2,}/);
  var inner = paras.map(function (p) {
    var lines = p.split('\n').filter(function (l) { return l.trim() !== ''; });
    if (!lines.length) return '';
    if (lines.every(function (l) { return /^\s*-\s+/.test(l); })) {
      return '<ul style="margin:0 0 14px;padding-left:22px;">' + lines.map(function (l) {
        return '<li style="margin:0 0 4px;">' + vdBcEsc_(l.replace(/^\s*-\s+/, '')) + '</li>';
      }).join('') + '</ul>';
    }
    // A paragraph that is only a URL (the {link} line) becomes a button.
    if (lines.length === 1 && /^https?:\/\/\S+$/.test(lines[0].trim())) {
      return '<p style="margin:4px 0 18px;"><a href="' + vdBcEsc_(lines[0].trim()) + '" style="display:inline-block;background:#D22730;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:6px;">' +
        VD_BC_LINK_TEXT + '</a></p>';
    }
    var html = lines.map(vdBcEsc_).join('<br>');
    html = html.replace(/(https?:\/\/[^\s<]+)/g, function (u) {
      return '<a href="' + u + '" style="color:#D22730;font-weight:bold;">' + u + '</a>';
    });
    return '<p style="margin:0 0 14px;">' + html + '</p>';
  }).join('');
  var banner = test ? '<div style="background:#fff6d8;border:1px solid #E5B423;padding:10px 14px;font-size:12px;margin:0 0 14px;">TEST. Live send would have gone to ' + vdBcEsc_(realTo) + '</div>' : '';
  return '<div style="background:#f4f5f7;padding:24px 12px;font-family:Verdana,Geneva,Tahoma,sans-serif;color:#2D2A26;font-size:14px;line-height:1.55;">' +
    '<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;">' +
    '<tr><td style="padding:22px 28px 10px;"><img src="' + logo + '" alt="City Wide Facility Solutions" style="height:40px;width:auto;display:block;"></td></tr>' +
    '<tr><td style="height:4px;background:#D22730;font-size:0;line-height:0;">&nbsp;</td></tr>' +
    '<tr><td style="padding:22px 28px 8px;">' + banner + inner + '</td></tr>' +
    '<tr><td style="padding:14px 28px 24px;border-top:1px solid #eee;font-size:11.5px;color:#636466;line-height:1.5;">' +
    vdBcEsc_(mk.label) + '<br>' + vdBcEsc_(mk.entity) + '<br>' + vdBcEsc_(mk.addr1) + ', ' + vdBcEsc_(mk.addr2) +
    '<br>Replies go to ' + vdBcEsc_(mk.compliance) + '</td></tr></table></div>';
}

function vdBcFooterText_(mk) {
  return mk.label + '\n' + mk.entity + '\n' + mk.addr1 + ', ' + mk.addr2 + '\nReplies go to ' + mk.compliance;
}

// ------------------------------------------------------------ background checks

// Loads cleaner rows into the background check tabs. Each row carries market
// 'lv' or 'nnv' plus the VD_BC_HEADERS fields. Duplicates (same vendor_id or
// vendor, last_name, first_name already on that tab) are skipped, so re-running a
// seed never doubles anyone. data.replace clears both tabs first.
function vdBcSeed_(data) {
  var rows = (data && data.rows) || [];
  if (!rows.length) return vdOut_({ ok: false, error: 'No rows' });
  var ss = vdSS_();
  VD_BC_TABS.forEach(function (b) {
    if (!ss.getSheetByName(b.name)) vdSetup_({});
  });
  if (data.replace) {
    VD_BC_TABS.forEach(function (b) {
      var sh = ss.getSheetByName(b.name);
      var n = sh.getLastRow() - 1;
      if (n > 0) sh.getRange(2, 1, n, VD_BC_HEADERS.length).clearContent();
    });
  }
  var today = Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyyy-MM-dd');
  var added = 0, skipped = 0, bad = 0;
  VD_BC_TABS.forEach(function (b) {
    var sh = ss.getSheetByName(b.name);
    var have = {};
    vdRows_(sh).rows.forEach(function (r) {
      have[[vdStr_(r.vendor_id) || vdStr_(r.vendor).toLowerCase(), vdStr_(r.last_name).toLowerCase(),
            vdStr_(r.first_name).toLowerCase()].join('|')] = true;
    });
    var out = [];
    rows.forEach(function (r) {
      if ((r.market || 'lv') !== b.key) return;
      if (!vdStr_(r.last_name) && !vdStr_(r.first_name)) { bad++; return; }
      var k = [vdStr_(r.vendor_id) || vdStr_(r.vendor).toLowerCase(), vdStr_(r.last_name).toLowerCase(),
               vdStr_(r.first_name).toLowerCase()].join('|');
      if (have[k]) { skipped++; return; }
      have[k] = true;
      if (!vdStr_(r.status)) r.status = 'Cleared';
      if (!vdStr_(r.added)) r.added = today;
      out.push(VD_BC_HEADERS.map(function (h) { return r[h] == null ? '' : String(r[h]); }));
    });
    if (out.length) {
      sh.getRange(vdNextRow_(sh), 1, out.length, VD_BC_HEADERS.length).setValues(out);
      added += out.length;
    }
  });
  return vdOut_({ ok: true, added: added, skipped: skipped, bad: bad });
}


// ------------------------------------------------------------ BOM Hub ------

// Sep 4 2026. The Business Operations Manager runs and reviews every background
// check. The BOM Hub (citywidelv.github.io/cw-bom-hub/) records the outcome per
// person: result Pass / Fail / Pending plus the check type (Standard, or the
// 10-Year package Arroweye requires). status stays the switch the Ops Hub reads:
// Pass -> Cleared, Fail -> Removed, Pending -> Pending, so the vendor directory
// never shows a failed person and nothing else on the platform had to change.

// One-time, or whenever TJ rotates it: {kind:'vd_bom_setpass', passcode:TEAM, new_pass}.
// Team passcode only; the BOM passcode itself never appears in code or a repo.
function vdBomSetPass_(data) {
  if (data._bom) return vdOut_({ ok: false, error: 'Team passcode required.' });
  var np = vdStr_(data.new_pass);
  if (np.length < 8) return vdOut_({ ok: false, error: 'New passcode must be at least 8 characters.' });
  PropertiesService.getScriptProperties().setProperty(VD_BOM_PROP, np);
  return vdOut_({ ok: true });
}

// Every row on both background check tabs, with the sheet row number so the
// page can patch a person in place. Unlike vdCleared_ this includes Pending,
// Removed and Fail rows: the BOM needs the whole history, the Ops Hub does not.
function vdBcRows_(data) {
  var ss = vdSS_();
  var vendors = vdAllRows_(ss).filter(function (r) { return r.dba_name; });
  var byName = {}, byId = {};
  vendors.forEach(function (v) {
    byId[v.vendor_id] = v;
    if (v.dba_name) byName[v.dba_name.toLowerCase()] = v.vendor_id;
    if (v.legal_name && !byName[v.legal_name.toLowerCase()]) byName[v.legal_name.toLowerCase()] = v.vendor_id;
  });
  var rows = [];
  VD_BC_TABS.forEach(function (b) {
    var sh = ss.getSheetByName(b.name);
    if (!sh) return;
    vdRows_(sh).rows.forEach(function (r) {
      if (!vdStr_(r.last_name) && !vdStr_(r.first_name)) return;
      var o = { row: r._row, market: b.key };
      VD_BC_HEADERS.forEach(function (h) { o[h] = vdStr_(r[h]); });
      o.market = b.key;
      if (!o.vendor_id) o.vendor_id = byName[o.vendor.toLowerCase()] || '';
      o.matched = !!(o.vendor_id && byId[o.vendor_id]);
      if (o.matched && !o.vendor) o.vendor = byId[o.vendor_id].dba_name;
      o.vendor_status = o.matched ? byId[o.vendor_id].status : '';
      rows.push(o);
    });
  });
  return vdOut_({ ok: true, rows: rows, headers: VD_BC_HEADERS, results: VD_BC_RESULT,
                  types: VD_BC_TYPES, tabs: VD_BC_TABS });
}

// Add or update people. data.rows = [{ market:'lv'|'nnv', row?:n, vendor_id?, vendor?,
// first_name, last_name, check_type?, result?, notes?, vf_file_no?, most_recent_check? }].
// A row number means patch that sheet row (only fields sent are touched); no row
// number means append, unless the same vendor + name already sits on that tab, in
// which case that row is patched instead so a double add never doubles a person.
function vdBcUpsert_(data) {
  var rows = (data && data.rows) || [];
  if (!rows.length) return vdOut_({ ok: false, error: 'No rows' });
  var ss = vdSS_();
  VD_BC_TABS.forEach(function (b) { if (!ss.getSheetByName(b.name)) vdSetup_({}); });
  var vendors = vdAllRows_(ss).filter(function (r) { return r.dba_name; });
  var byId = {};
  vendors.forEach(function (v) { byId[v.vendor_id] = v; });
  var today = Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyyy-MM-dd');
  var who = vdStr_(data.reviewed_by) || (data._bom ? 'BOM Hub' : 'Ops Hub');
  var col = {};
  VD_BC_HEADERS.forEach(function (h, i) { col[h] = i; });

  var added = 0, updated = 0, errors = [], out = [];
  VD_BC_TABS.forEach(function (b) {
    var mine = rows.filter(function (r) { return (r.market || 'lv') === b.key; });
    if (!mine.length) return;
    var sh = ss.getSheetByName(b.name);
    var last = Math.max(sh.getLastRow(), 1);
    var rng = sh.getRange(1, 1, last, VD_BC_HEADERS.length);
    var vals = rng.getValues();
    var head = vals[0].map(vdStr_);
    // Tabs created before Sep 4 2026 lack the review columns; write the headers in.
    var headFix = false;
    VD_BC_HEADERS.forEach(function (h, i) { if (head[i] !== h) { vals[0][i] = h; headFix = true; } });
    var index = {};
    for (var i = 1; i < vals.length; i++) {
      var k = [vdStr_(vals[i][col.vendor_id]) || vdStr_(vals[i][col.vendor]).toLowerCase(),
               vdStr_(vals[i][col.last_name]).toLowerCase(), vdStr_(vals[i][col.first_name]).toLowerCase()].join('|');
      index[k] = i;
    }
    var appends = [], pending = {};
    mine.forEach(function (r) {
      var p = {};
      VD_BC_HEADERS.forEach(function (h) { if (r[h] !== undefined && h !== 'added') p[h] = vdStr_(r[h]); });
      if (p.vendor_id && byId[p.vendor_id]) p.vendor = byId[p.vendor_id].dba_name;
      if (p.result !== undefined) {
        if (p.result && VD_BC_RESULT.indexOf(p.result) < 0) { errors.push('Bad result for ' + r.first_name + ' ' + r.last_name); return; }
        p.status = p.result === 'Pass' ? 'Cleared' : p.result === 'Fail' ? 'Removed' : p.result === 'Pending' ? 'Pending' : (p.status || 'Cleared');
        p.result_date = p.result ? today : '';
        p.reviewed_by = p.result ? who : '';
      }
      if (p.check_type !== undefined) p.ten_year = /10-Year/.test(p.check_type) ? 'Yes' : '';
      var i = Number(r.row) >= 2 ? Number(r.row) - 1 : -1;
      var k = [p.vendor_id || vdStr_(p.vendor).toLowerCase(), vdStr_(p.last_name).toLowerCase(), vdStr_(p.first_name).toLowerCase()].join('|');
      if (i < 0 || i >= vals.length) {
        if (index[k] !== undefined) i = index[k];
        else if (pending[k] !== undefined) {   // same person twice in one batch
          Object.keys(p).forEach(function (h) { if (col[h] !== undefined) appends[pending[k]][col[h]] = p[h]; });
          return;
        }
      }
      if (i >= 1) {
        Object.keys(p).forEach(function (h) { if (col[h] !== undefined) vals[i][col[h]] = p[h]; });
        updated++;
        out.push({ row: i + 1, market: b.key, vendor_id: vdStr_(vals[i][col.vendor_id]) });
      } else {
        if (!vdStr_(p.first_name) && !vdStr_(p.last_name)) { errors.push('A person needs a name'); return; }
        if (!p.status) p.status = 'Cleared';
        if (!p.check_type) { p.check_type = 'Standard'; p.ten_year = ''; }
        p.added = today;
        if (!p.most_recent_check) p.most_recent_check = today;
        if (!p.first_check) p.first_check = p.most_recent_check;
        pending[k] = appends.length;
        appends.push(VD_BC_HEADERS.map(function (h) { return p[h] == null ? '' : p[h]; }));
      }
    });
    if (headFix || updated) rng.setValues(vals);
    if (appends.length) {
      var at = vdNextRow_(sh);
      sh.getRange(at, 1, appends.length, VD_BC_HEADERS.length).setValues(appends);
      appends.forEach(function (a, j) { out.push({ row: at + j, market: b.key, vendor_id: a[col.vendor_id] }); });
      added += appends.length;
    }
  });
  return vdOut_({ ok: true, added: added, updated: updated, errors: errors, rows: out });
}

// Asana, read-only, for the BOM Hub cards. app.asana.com refuses to be framed, so
// the hub shows live task lists fetched here with a personal access token kept in
// the ASANA_PAT script property (Project Settings > Script properties, or the
// vd_bom_asana_setup kind below with the team passcode). Cached two minutes.
var VD_ASANA_PROP = 'ASANA_PAT';
function vdBomAsana_(data) {
  var pat = PropertiesService.getScriptProperties().getProperty(VD_ASANA_PROP) || '';
  if (!data._bom && vdStr_(data.set_token)) {
    PropertiesService.getScriptProperties().setProperty(VD_ASANA_PROP, vdStr_(data.set_token));
    return vdOut_({ ok: true, saved: true });
  }
  if (!pat) return vdOut_({ ok: false, needs_setup: true, error: 'Asana token not set.' });
  var cache = CacheService.getScriptCache();
  // Team mode: the projects in one Asana team, so a new project shows on the hub
  // without a code change. {kind:'vd_bom_asana', team:'<team gid>'}
  var team = vdStr_(data.team);
  if (/^\d+$/.test(team)) {
    var tk = 'asana_team_' + team, th = cache.get(tk);
    if (th && !data.fresh) return vdOut_(JSON.parse(th));
    var tf = 'name,color,permalink_url,notes,archived,current_status.title,current_status.color,default_view,modified_at';
    var tr = UrlFetchApp.fetch('https://app.asana.com/api/1.0/teams/' + team + '/projects?archived=false&limit=100&opt_fields=' + encodeURIComponent(tf),
      { headers: { Authorization: 'Bearer ' + pat }, muteHttpExceptions: true });
    if (tr.getResponseCode() !== 200) return vdOut_({ ok: false, error: 'Asana said ' + tr.getResponseCode(), detail: tr.getContentText().slice(0, 300) });
    var projects = (JSON.parse(tr.getContentText()).data || []).map(function (p) {
      return { gid: p.gid, name: p.name, color: p.color || '', url: p.permalink_url, notes: String(p.notes || '').slice(0, 300),
               view: p.default_view || 'list', status: p.current_status ? { title: p.current_status.title, color: p.current_status.color } : null,
               modified: p.modified_at };
    });
    var tp = { ok: true, team: team, projects: projects, fetched: new Date().toISOString() };
    try { cache.put(tk, JSON.stringify(tp), 300); } catch (e) {}
    return vdOut_(tp);
  }
  var project = vdStr_(data.project);
  if (!/^\d+$/.test(project)) return vdOut_({ ok: false, error: 'project id required' });
  var limit = Math.min(Number(data.limit) || 100, 100);
  var ck = 'asana_' + project + '_' + limit + '_' + (data.completed ? 'all' : 'open');
  var hit = cache.get(ck);
  if (hit && !data.fresh) return vdOut_(JSON.parse(hit));
  var fields = 'name,completed,completed_at,due_on,assignee.name,permalink_url,memberships.section.name,modified_at,custom_fields.name,custom_fields.display_value,notes';
  var url = 'https://app.asana.com/api/1.0/projects/' + project + '/tasks?opt_fields=' + encodeURIComponent(fields) +
            '&limit=' + limit + (data.completed ? '' : '&completed_since=now');
  var resp = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + pat }, muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) {
    return vdOut_({ ok: false, error: 'Asana said ' + resp.getResponseCode(), detail: resp.getContentText().slice(0, 300) });
  }
  var body = JSON.parse(resp.getContentText());
  var tasks = (body.data || []).map(function (t) {
    var sec = (t.memberships || []).map(function (m) { return m.section && m.section.name; }).filter(Boolean)[0] || '';
    var cf = {};
    (t.custom_fields || []).forEach(function (f) { if (f.display_value) cf[f.name] = f.display_value; });
    return { gid: t.gid, name: t.name, completed: !!t.completed, due: t.due_on || '', assignee: t.assignee ? t.assignee.name : '',
             url: t.permalink_url, section: sec, modified: t.modified_at, fields: cf, notes: String(t.notes || '').slice(0, 240) };
  });
  var payload = { ok: true, project: project, tasks: tasks, more: !!body.next_page, fetched: new Date().toISOString() };
  try { cache.put(ck, JSON.stringify(payload), 120); } catch (e) {}
  return vdOut_(payload);
}

// ------------------------------------------------------------ intake -------

// Jotform eval-form feed. Logs every submission, and creates an In Progress row for
// business names not already on the list. It never touches an existing vendor:
// a returning name is logged as "matched" and left for an FSM to reconcile, so a
// vendor cannot rewrite their own status or contact record from a public form.
function vdIntake_(data) {
  var secret = PropertiesService.getScriptProperties().getProperty('VD_INTAKE_SECRET') || '';
  if (!secret || String(data.secret || '') !== secret) {
    return vdOut_({ ok: false, error: 'Bad intake secret' });
  }
  if (vdStr_(data.website)) return vdOut_({ ok: true });   // honeypot

  var v = data.vendor || {};
  var dba = vdStr_(v.dba_name);
  if (!dba) return vdOut_({ ok: false, error: 'No business name' });

  var ss = vdSS_();
  if (!vdVendorSheets_(ss).length) vdSetup_({});
  var all = vdAllRows_(ss);

  var key = dba.toLowerCase();
  var hit = all.filter(function (r) { return r.dba_name.toLowerCase() === key; })[0];
  var action = 'added', vid = '';

  if (hit) {
    action = 'matched existing, not changed';
    vid = hit.vendor_id;
  } else {
    vid = vdNextId_(all);
    v.vendor_id = vid;
    v.status = 'In Progress';
    v.source = 'Eval Form';
    v.added_by = 'Jotform intake';
    v.region = vdRegion_(v.region);
    v.updated = Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyyy-MM-dd');
    var out = VD_HEADERS.map(function (h) { return v[h] == null ? '' : String(v[h]); });
    var sh = vdTabFor_(ss, v.region);
    sh.getRange(vdNextRow_(sh), 1, 1, VD_HEADERS.length).setValues([out]);
  }

  var log = ss.getSheetByName(VD_TABS.INTAKE);
  if (log) {
    log.appendRow([
      Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyyy-MM-dd HH:mm'),
      vdStr_(data.submission_id), dba, vdStr_(v.contact_name), vdStr_(v.email),
      vdStr_(v.phone), vdStr_(v.region), vdStr_(v.service_types), vid, action,
      JSON.stringify(v).slice(0, 45000)
    ]);
  }

  return vdOut_({ ok: true, vendor_id: vid, action: action });
}

// ------------------------------------------------------------ run helpers --

// Editor > Run. Creates the book, the market tabs (migrating the legacy Vendors
// tab the first time), the background check tabs, and seeds the service types.
function vdSetupRun() {
  var r = vdSetup_({});
  Logger.log(r.getContent ? r.getContent() : r);
}

// Seeding is a one-time POST of {kind:'vd_seed', passcode, force:true, payload}
// from an authenticated tab, so the vendor data goes straight from the operator's
// machine into the Sheet without ever being stored at a fetchable URL. There is
// deliberately no Run helper that pulls the seed from anywhere.

// Editor > Run once. Prints the Jotform intake secret, creating it if missing.
function vdIntakeSecretRun() {
  var props = PropertiesService.getScriptProperties();
  var s = props.getProperty('VD_INTAKE_SECRET');
  if (!s) {
    s = Utilities.getUuid().replace(/-/g, '');
    props.setProperty('VD_INTAKE_SECRET', s);
  }
  Logger.log('VD_INTAKE_SECRET = ' + s);
}

// Editor > Run. Prints the directory Sheet URL.
function vdUrlRun() { Logger.log(vdSS_().getUrl()); }
