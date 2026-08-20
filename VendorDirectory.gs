// ============================================================
// VendorDirectory.gs - the Active Vendors directory (Aug 2026)
// New FILE in the CW Solicitations Apps Script project.
// Routing: doPost in Code.gs routes any kind starting 'vd_' to vdDispatch(data).
// Kinds: vd_setup, vd_seed, vd_list, vd_save, vd_types, vd_intake
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
// Privacy: business_address is stored in the Sheet and NEVER returned by vd_list.
// Several vendors registered a home address. The directory shows city and state.
//
// Gating: every kind except vd_intake requires the team passcode, checked here on
// the server. The pages that call this are in a public repo; the passcode is the
// only wall, exactly as with vio_* and ins_*.
// ============================================================

var VD_TABS = { VENDORS: 'Vendors', TYPES: 'Service Types', INTAKE: 'Intake Log' };
var VD_PROP = 'VD_SHEET_ID';

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
  'internal_notes', 'hide'
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
var VD_LIVE_STATUS = ['Active IC', 'Waiting for Account', 'In Progress'];

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
  // and it can only ever create an Applicant row, never read or edit one.
  if (kind === 'vd_intake') return vdIntake_(data);

  if ((data.passcode || '') !== vdPass_()) return vdOut_({ ok: false, error: 'Wrong passcode.' });

  if (kind === 'vd_setup') return vdSetup_(data);
  if (kind === 'vd_seed')  return vdSeed_(data);
  if (kind === 'vd_list')  return vdList_(data);
  if (kind === 'vd_save')  return vdSave_(data);
  if (kind === 'vd_types') return vdTypes_(data);
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

// ------------------------------------------------------------ setup --------

function vdSetup_(data) {
  var ss = vdSS_();
  vdTab_(ss, VD_TABS.VENDORS, VD_HEADERS, '#D22730');
  var t = vdTab_(ss, VD_TABS.TYPES, VD_TYPE_HEADERS, '#2D2A26');
  vdTab_(ss, VD_TABS.INTAKE, VD_INTAKE_HEADERS, '#636466');

  var first = ss.getSheets()[0];
  if (first.getName() === 'Sheet1' && first.getLastRow() === 0) ss.deleteSheet(first);

  // Status dropdown so nobody invents a fourth spelling of "Active".
  var vsh = ss.getSheetByName(VD_TABS.VENDORS);
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['Active IC', 'Waiting for Account', 'In Progress', 'Applicant',
                         'Not Approved', 'Inactive'], true).build();
  vsh.getRange(2, VD_HEADERS.indexOf('status') + 1, 2000, 1).setDataValidation(rule);
  var cb = SpreadsheetApp.newDataValidation().requireCheckbox().build();
  vsh.getRange(2, VD_HEADERS.indexOf('hide') + 1, 2000, 1).setDataValidation(cb);

  if (t.getLastRow() < 2 && data && data.types && data.types.length) {
    var tv = data.types.map(function (x) {
      return [x.slug, x.name, x.description || '', Number(x.sort || 0), true];
    });
    t.getRange(2, 1, tv.length, VD_TYPE_HEADERS.length).setValues(tv);
    t.getRange(2, 5, 500, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireCheckbox().build());
  }

  return vdOut_({ ok: true, sheet_id: ss.getId(), url: ss.getUrl() });
}

// Bulk load. Replaces the Vendors rows wholesale, so it is safe to re-run while
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
  var sh = ss.getSheetByName(VD_TABS.VENDORS);

  var existing = sh.getLastRow() - 1;
  if (existing > 0 && !data.force) {
    return vdOut_({ ok: false, error: 'Vendors tab already holds ' + existing +
      ' rows. Re-run with force to replace them.' });
  }
  if (existing > 0) sh.getRange(2, 1, existing, VD_HEADERS.length).clearContent();

  var out = payload.vendors.map(function (v) {
    return VD_HEADERS.map(function (h) { return v[h] == null ? '' : String(v[h]); });
  });
  if (out.length) sh.getRange(2, 1, out.length, VD_HEADERS.length).setValues(out);
  sh.autoResizeColumns(1, 5);

  return vdOut_({ ok: true, seeded: out.length, url: ss.getUrl() });
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

// The directory payload. business_address is dropped on purpose; see the header.
function vdList_(data) {
  var ss = vdSS_();
  var vsh = ss.getSheetByName(VD_TABS.VENDORS);
  if (!vsh) return vdOut_({ ok: false, error: 'Run vd_setup first.' });

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

  var drop = { business_address: 1, _row: 1, hide: 1 };
  var vendors = [];
  var counts = {}, statusCounts = {};

  vdRows_(vsh).rows.forEach(function (r) {
    if (!r.dba_name || vdTrue_(r.hide)) return;
    var o = {};
    Object.keys(r).forEach(function (k) { if (!drop[k]) o[k] = r[k]; });
    o.slugs = vdSlugs_(r.service_types);
    o.janitorial = o.slugs.indexOf(VD_JANITORIAL) >= 0;
    o.live = VD_LIVE_STATUS.indexOf(r.status) >= 0;
    vendors.push(o);
    o.slugs.forEach(function (s) { counts[s] = (counts[s] || 0) + 1; });
    statusCounts[r.status || 'Unknown'] = (statusCounts[r.status || 'Unknown'] || 0) + 1;
  });

  vendors.sort(function (a, b) {
    if (a.live !== b.live) return a.live ? -1 : 1;           // callable vendors first
    return a.dba_name.toLowerCase() < b.dba_name.toLowerCase() ? -1 : 1;
  });

  // A type with no vendors still shows, so ops can see the empty bench and fill it.
  types.forEach(function (t) { t.count = counts[t.slug] || 0; });

  return vdOut_({
    ok: true, vendors: vendors, types: types, counts: counts,
    status_counts: statusCounts, total: vendors.length,
    sheet_url: ss.getUrl(), generated: new Date().toISOString()
  });
}

// ------------------------------------------------------------ write --------

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
  var sh = ss.getSheetByName(VD_TABS.VENDORS);
  if (!sh) return vdOut_({ ok: false, error: 'Run vd_setup first.' });
  var all = vdRows_(sh).rows;

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

  var row;
  if (target) {
    row = target._row;
  } else {
    row = sh.getLastRow() + 1;
    v.vendor_id = vdNextId_(all);
    if (!vdStr_(v.status)) v.status = 'Applicant';
    if (!vdStr_(v.source)) v.source = 'Ops Hub';
  }
  v.updated = Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyyy-MM-dd');

  VD_HEADERS.forEach(function (h, i) {
    if (v[h] === undefined) return;
    sh.getRange(row, i + 1).setValue(String(v[h] == null ? '' : v[h]));
  });

  return vdOut_({ ok: true, vendor_id: vdStr_(v.vendor_id) || (target && target.vendor_id),
                  updated: !!target, url: ss.getUrl() });
}

// Jotform eval-form feed. Logs every submission, and creates an Applicant row for
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
  var sh = ss.getSheetByName(VD_TABS.VENDORS);
  if (!sh) { vdSetup_({}); sh = ss.getSheetByName(VD_TABS.VENDORS); }
  var all = vdRows_(sh).rows;

  var key = dba.toLowerCase();
  var hit = all.filter(function (r) { return r.dba_name.toLowerCase() === key; })[0];
  var action = 'added', vid = '';

  if (hit) {
    action = 'matched existing, not changed';
    vid = hit.vendor_id;
  } else {
    vid = vdNextId_(all);
    v.vendor_id = vid;
    v.status = 'Applicant';
    v.source = 'Eval Form';
    v.added_by = 'Jotform intake';
    v.updated = Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyyy-MM-dd');
    var out = VD_HEADERS.map(function (h) { return v[h] == null ? '' : String(v[h]); });
    sh.getRange(sh.getLastRow() + 1, 1, 1, VD_HEADERS.length).setValues([out]);
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

// Editor > Run. Creates the book and seeds the service types only.
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
