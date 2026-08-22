// ============================================================
// VendorDirectory.gs - the Active Vendors directory (Aug 2026)
// File in the CW Solicitations Apps Script project.
// Routing: doPost in Code.gs routes any kind starting 'vd_' to vdDispatch(data).
// Kinds: vd_setup, vd_seed, vd_append, vd_region_backfill, vd_list, vd_save,
//        vd_patch, vd_types, vd_intake, vd_bc_seed, vd_bc_list
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
  'roster_company_as_typed', 'notes', 'added'
];
var VD_BC_STATUS = ['Cleared', 'Pending', 'Removed'];

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

  if ((data.passcode || '') !== vdPass_()) return vdOut_({ ok: false, error: 'Wrong passcode.' });

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
      var id = vdStr_(r.vendor_id);
      if (!id) id = byName[vdStr_(r.vendor).toLowerCase()] || '';
      if (!id) { unmatched.push({ vendor: vdStr_(r.vendor), name: name, tab: b.name }); return; }
      out[id] = out[id] || [];
      out[id].push({ name: name, tab: b.key, last: vdStr_(r.last_name), first: vdStr_(r.first_name) });
    });
  });
  Object.keys(out).forEach(function (k) {
    out[k].sort(function (a, b) {
      var x = (a.last + ' ' + a.first).toLowerCase(), y = (b.last + ' ' + b.first).toLowerCase();
      return x < y ? -1 : x > y ? 1 : 0;
    });
    out[k] = out[k].map(function (p) { return { name: p.name, tab: p.tab }; });
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
  var sheets = vdVendorSheets_(ss);
  if (!sheets.length) return vdOut_({ ok: false, error: 'Run vd_setup first.' });

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
  return vdOut_({ ok: true, applied: applied, fields: fields, missing: missing });
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
