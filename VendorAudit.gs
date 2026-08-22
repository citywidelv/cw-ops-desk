// ============================================================
// VendorAudit.gs - Quarterly vendor compliance audit (Aug 2026)
// File in the CW Solicitations Apps Script project.
// Routing: doPost in Code.gs routes any kind starting 'audit_' to auditDispatch(data).
// Kinds: audit_setup, audit_context, audit_submit, audit_list, audit_purge_test
//
// What it is: a City Wide person (DOO, GM, or FSM) records, account by account,
// who a vendor sends into each building, whether a background check is on file
// for each person, whether each is 18 or older (a City Wide policy, not a legal
// floor, so it is labelled that way), whether SDS are on site for the chemicals
// used there, and whether the vendor attests that it follows state and federal
// employment law. The submitter records yes/no answers. City Wide collects no
// proof and never directs how the vendor staffs, trains, schedules, pays, or
// supervises its crew. Control is the misclassification risk; attestation is not.
//
// Every submission:
//   1. appends one row to the "Audits" tab and one row per person per account to
//      the "Audit Accounts" tab of the CW Vendor Directory sheet (same book the
//      vendor tabs live in, because vendors.html reads both),
//   2. builds a printable PDF and saves it in Drive under
//      Team Portal / Ops Hub / Vendor Quarterly Audits / <market>,
//   3. writes last_audit, audit_result, audit_next_due, audit_pdf onto the
//      vendor's row in its market tab (columns added to VD_HEADERS Aug 22 2026).
// No email is sent by anything in this file. Nothing here deletes a row.
//
// Pass / fail is computed HERE, never trusted from the page, and the rule is
// printed on every PDF so the reader sees how the result was reached:
//   FAIL when any person has no background check on file, any person is not
//   confirmed 18 or older, the vendor does not attest to employment law
//   compliance, or any building lacks SDS for the chemicals used there.
//   Everything else (a pending check, an insurance certificate gap, badges,
//   chemical training) is a finding: recorded and counted, not a fail.
//
// Gating: every kind requires the team passcode, checked here on the server,
// exactly like vd_*.
// ============================================================

var AUD_TABS = { AUDITS: 'Audits', ACCOUNTS: 'Audit Accounts' };
var AUD_FOLDER_PROP = 'AUDIT_FOLDER_ID';
var AUD_FOLDER_PATH = ['Team Portal', 'Ops Hub', 'Vendor Quarterly Audits'];
var AUD_DAYS = 90;                       // quarterly cadence: next due = audit date + 90 days
var AUD_IMG_BASE = 'https://citywidelv.github.io/cw-ops-desk/images/audit/';
var AUD_LOGO = 'https://emailer.emfluence.com/clients/citywide/uploadedfiles/signature_logo.png';

var AUD_HEADERS = [
  'audit_id', 'audit_date', 'market', 'vendor_id', 'vendor', 'submitted_by', 'submitter_role',
  'result', 'fail_reasons', 'findings', 'finding_list', 'accounts_audited', 'people_listed',
  'law_compliance', 'insurance_current', 'id_badges', 'chemical_training',
  'vendor_rep', 'how_obtained', 'notes', 'pdf_url', 'pdf_name', 'next_due', 'received', 'test'
];

var AUD_ACC_HEADERS = [
  'audit_id', 'audit_date', 'market', 'vendor_id', 'vendor', 'account', 'person',
  'from_cleared_list', 'background_check', 'age_18_plus', 'sds_on_site', 'account_note', 'test'
];

var AUD_BC = ['On file', 'Pending', 'No'];
var AUD_YN = ['Yes', 'No'];
var AUD_ROLES = ['Director of Operations', 'General Manager', 'Facility Solutions Manager', 'Other'];

// The people who can submit. Mirrors FSM_ROSTER in Code.gs when present so a
// roster change there shows here without a second edit.
function audSubmitters_() {
  var out = [];
  try {
    if (typeof FSM_ROSTER === 'object') {
      Object.keys(FSM_ROSTER).forEach(function (k) {
        var p = FSM_ROSTER[k];
        out.push({ key: k, name: p.name, title: p.title, region: p.region });
      });
    }
  } catch (e) {}
  return out;
}

// ------------------------------------------------------------ plumbing -----

function audOut_(o) { return vdOut_(o); }

function audDispatch(data) {
  var kind = String(data.kind || '');
  if ((data.passcode || '') !== vdPass_()) return audOut_({ ok: false, error: 'Wrong passcode.' });
  try {
    if (kind === 'audit_setup')   return audSetup_(data);
    if (kind === 'audit_context') return audContext_(data);
    if (kind === 'audit_submit')  return audSubmit_(data);
    if (kind === 'audit_list')    return audList_(data);
    if (kind === 'audit_purge_test') return audPurgeTest_(data);
  } catch (err) {
    return audOut_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
  return audOut_({ ok: false, error: 'Unknown audit kind' });
}

function audToday_() { return Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyyy-MM-dd'); }
function audNow_()   { return Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyyy-MM-dd HH:mm'); }

function audAddDays_(ymd, days) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  if (!m) return '';
  var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days);
  return Utilities.formatDate(d, 'America/Los_Angeles', 'yyyy-MM-dd');
}

function audEsc_(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function audMarket_(raw) {
  return vdRegion_(raw) === 'Northern Nevada' ? 'nnv' : 'lv';
}
function audMarketName_(key) { return key === 'nnv' ? 'Northern Nevada' : 'Las Vegas'; }

// ------------------------------------------------------------ setup --------

function audSetup_(data) {
  var ss = vdSS_();
  // Vendor tabs get the four audit columns through VD_HEADERS; re-running vd_setup
  // rewrites row 1 with the full header list and leaves data untouched.
  vdSetup_({});

  var a = vdTab_(ss, AUD_TABS.AUDITS, AUD_HEADERS, '#E5B423');
  var r1 = SpreadsheetApp.newDataValidation().requireValueInList(['PASS', 'FAIL'], true).build();
  a.getRange(2, AUD_HEADERS.indexOf('result') + 1, 2000, 1).setDataValidation(r1);
  a.setColumnWidth(AUD_HEADERS.indexOf('vendor') + 1, 240);
  a.setColumnWidth(AUD_HEADERS.indexOf('fail_reasons') + 1, 300);
  a.setColumnWidth(AUD_HEADERS.indexOf('finding_list') + 1, 300);
  a.setColumnWidth(AUD_HEADERS.indexOf('notes') + 1, 300);
  a.setColumnWidth(AUD_HEADERS.indexOf('pdf_url') + 1, 200);

  var b = vdTab_(ss, AUD_TABS.ACCOUNTS, AUD_ACC_HEADERS, '#E5B423');
  b.getRange(2, AUD_ACC_HEADERS.indexOf('background_check') + 1, 5000, 1)
    .setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(AUD_BC, true).build());
  b.getRange(2, AUD_ACC_HEADERS.indexOf('age_18_plus') + 1, 5000, 1)
    .setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(AUD_YN, true).build());
  b.getRange(2, AUD_ACC_HEADERS.indexOf('sds_on_site') + 1, 5000, 1)
    .setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(AUD_YN, true).build());
  b.setColumnWidth(AUD_ACC_HEADERS.indexOf('vendor') + 1, 220);
  b.setColumnWidth(AUD_ACC_HEADERS.indexOf('account') + 1, 280);
  b.setColumnWidth(AUD_ACC_HEADERS.indexOf('person') + 1, 180);

  var folder = audFolder_();
  return audOut_({ ok: true, sheet_url: ss.getUrl(), folder_url: folder.getUrl(),
                   tabs: ss.getSheets().map(function (s) { return s.getName(); }) });
}

// Team Portal / Ops Hub / Vendor Quarterly Audits, created on first use and
// remembered in script properties. Market subfolders under it.
function audFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(AUD_FOLDER_PROP);
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var parent = DriveApp.getRootFolder();
  AUD_FOLDER_PATH.forEach(function (name) {
    var it = parent.getFoldersByName(name);
    parent = it.hasNext() ? it.next() : parent.createFolder(name);
  });
  props.setProperty(AUD_FOLDER_PROP, parent.getId());
  return parent;
}
function audMarketFolder_(key) {
  var root = audFolder_();
  var name = audMarketName_(key);
  var it = root.getFoldersByName(name);
  return it.hasNext() ? it.next() : root.createFolder(name);
}

// ------------------------------------------------------------ context ------

// Everything the page needs to run one audit: live vendors in the market with
// their audit status, cleared names keyed by vendor_id, the account name list
// for the market (Cleaner Tracker Accounts tab when reachable), the accounts and
// people recorded on each vendor's most recent audit, and the submitter roster.
function audContext_(data) {
  var mkt = data.market === 'nnv' ? 'nnv' : 'lv';
  var ss = vdSS_();
  var rows = vdAllRows_(ss).filter(function (r) { return r.dba_name && !vdTrue_(r.hide); });
  var cleared = vdCleared_(ss, rows);

  var vendors = rows.filter(function (r) {
    var region = vdRegion_(r.region);
    return vdInRegion_(region, mkt) && VD_PROSPECT_STATUS.indexOf(r.status) < 0;
  }).map(function (r) {
    return {
      vendor_id: r.vendor_id, dba_name: r.dba_name, legal_name: r.legal_name, status: r.status,
      region: vdRegion_(r.region), contact_name: r.contact_name, service_types: r.service_types,
      gl_exp: r.gl_exp, wc_exp: r.wc_exp, cw_clients: r.cw_clients,
      last_audit: r.last_audit || '', audit_result: r.audit_result || '',
      audit_next_due: r.audit_next_due || '', audit_pdf: r.audit_pdf || '',
      cleared: (cleared.byId[r.vendor_id] || []).map(function (p) { return p.name; })
    };
  });
  vendors.sort(function (a, b) { return a.dba_name.toLowerCase() < b.dba_name.toLowerCase() ? -1 : 1; });

  // Account names for the market. Lives in the Account Cleaner Tracker book; if
  // that is unreachable the page still works with free text.
  var accounts = [], accounts_source = '';
  try {
    var acc = acSS_().getSheetByName(AC_ACC);
    if (acc) {
      vdRows_(acc).rows.forEach(function (a) {
        if (!a.account_name) return;
        if (String(a.active || '1').toUpperCase() === 'FALSE' || String(a.active) === '0') return;
        var rk = audMarket_(a.region);
        if (rk === mkt) accounts.push(a.account_name);
      });
      accounts_source = 'Account Cleaner Tracker / Accounts';
    }
  } catch (e) { accounts_source = 'unavailable: ' + e; }
  accounts.sort(function (a, b) { return a.toLowerCase() < b.toLowerCase() ? -1 : 1; });

  // Last audit's accounts and people per vendor, so quarter two starts prefilled.
  var prev = {};
  var accSh = ss.getSheetByName(AUD_TABS.ACCOUNTS);
  if (accSh) {
    var byVendor = {};
    vdRows_(accSh).rows.forEach(function (r) {
      if (!r.vendor_id || vdTrue_(r.test)) return;
      byVendor[r.vendor_id] = byVendor[r.vendor_id] || {};
      var v = byVendor[r.vendor_id];
      if (!v[r.audit_id]) v[r.audit_id] = { date: r.audit_date, accounts: {} };
      var acct = v[r.audit_id].accounts;
      acct[r.account] = acct[r.account] || [];
      if (r.person) acct[r.account].push(r.person);
    });
    Object.keys(byVendor).forEach(function (vid) {
      var audits = byVendor[vid];
      var latest = Object.keys(audits).sort(function (a, b) {
        return audits[a].date < audits[b].date ? 1 : -1;
      })[0];
      var list = audits[latest].accounts;
      prev[vid] = { date: audits[latest].date, accounts: Object.keys(list).map(function (name) {
        return { account: name, people: list[name] };
      }) };
    });
  }

  return audOut_({
    ok: true, market: mkt, market_name: audMarketName_(mkt), vendors: vendors,
    accounts: accounts, accounts_source: accounts_source, previous: prev,
    submitters: audSubmitters_(), roles: AUD_ROLES, days: AUD_DAYS, today: audToday_(),
    rule: audRuleText_()
  });
}

function audRuleText_() {
  return 'FAIL when any person has no background check on file, any person is not confirmed '
    + '18 or older, the vendor does not attest that it follows state and federal employment '
    + 'law, or any building lacks Safety Data Sheets for the chemicals used there. A pending '
    + 'background check, an insurance certificate gap, badges, and chemical handling training '
    + 'are recorded as findings and do not fail the audit on their own.';
}

// ------------------------------------------------------------ submit -------

// Payload shape (all strings unless noted):
// { market:'lv'|'nnv', vendor_id, submitted_by, submitter_role, vendor_rep, how_obtained,
//   law_compliance:'Yes'|'No', insurance_current, id_badges, chemical_training, notes,
//   accounts:[ { account, sds_on_site:'Yes'|'No', note,
//                people:[ { name, from_cleared:bool, background_check:'On file'|'Pending'|'No',
//                           age_18_plus:'Yes'|'No' } ] } ],
//   test:bool }
function audSubmit_(data) {
  var p = data.payload || {};
  var mkt = p.market === 'nnv' ? 'nnv' : 'lv';
  var vid = vdStr_(p.vendor_id);
  if (!vid) return audOut_({ ok: false, error: 'Pick a vendor.' });
  if (!vdStr_(p.submitted_by)) return audOut_({ ok: false, error: 'Submitter name is required.' });
  if (AUD_YN.indexOf(p.law_compliance) < 0) return audOut_({ ok: false, error: 'Answer the employment law question.' });
  var accounts = Array.isArray(p.accounts) ? p.accounts : [];
  accounts = accounts.filter(function (a) { return a && vdStr_(a.account); });
  if (!accounts.length) return audOut_({ ok: false, error: 'Add at least one account the vendor services.' });

  var ss = vdSS_();
  if (!ss.getSheetByName(AUD_TABS.AUDITS)) audSetup_({});
  var vendor = vdAllRows_(ss).filter(function (r) { return r.vendor_id === vid; })[0];
  if (!vendor) return audOut_({ ok: false, error: 'No vendor with id ' + vid });

  // ---- result, computed here
  var fails = [], findings = [], people = 0, fromCleared = 0;
  accounts.forEach(function (a) {
    a.account = vdStr_(a.account);
    a.people = (Array.isArray(a.people) ? a.people : []).filter(function (x) { return x && vdStr_(x.name); });
    if (!a.people.length) findings.push(a.account + ': no one listed as cleaning this building');
    if (AUD_YN.indexOf(a.sds_on_site) < 0) return audOutError_('Answer the SDS question for ' + a.account);
    if (a.sds_on_site === 'No') fails.push(a.account + ': no SDS on site for the chemicals used');
    a.people.forEach(function (x) {
      x.name = vdStr_(x.name); people++;
      if (x.from_cleared) fromCleared++;
      if (AUD_BC.indexOf(x.background_check) < 0) x.background_check = 'No';
      if (AUD_YN.indexOf(x.age_18_plus) < 0) x.age_18_plus = 'No';
      if (x.background_check === 'No') fails.push(a.account + ': ' + x.name + ' has no background check on file');
      if (x.background_check === 'Pending') findings.push(a.account + ': ' + x.name + ' background check pending');
      if (x.age_18_plus === 'No') fails.push(a.account + ': ' + x.name + ' not confirmed 18 or older');
    });
  });
  if (p.law_compliance === 'No') fails.push('Vendor did not attest to state and federal employment law compliance');
  if (p.insurance_current === 'No') findings.push('Insurance certificates not current or not on file');
  if (p.id_badges === 'No') findings.push('Crew not wearing City Wide identification badges on site');
  if (p.chemical_training === 'No') findings.push('Crew not trained on the chemicals they use');
  var result = fails.length ? 'FAIL' : 'PASS';

  // ---- ids and dates
  var date = /^\d{4}-\d{2}-\d{2}$/.test(String(p.audit_date || '')) ? p.audit_date : audToday_();
  var nextDue = audAddDays_(date, AUD_DAYS);
  var id = 'AUD-' + mkt.toUpperCase() + '-' + date.replace(/-/g, '').slice(2) + '-'
    + Utilities.getUuid().replace(/-/g, '').slice(0, 4).toUpperCase();
  var isTest = !!p.test || /^test\b/i.test(vendor.dba_name) || /^zz ?test/i.test(vendor.dba_name);

  var rec = {
    audit_id: id, audit_date: date, market: audMarketName_(mkt), vendor_id: vid,
    vendor: vendor.dba_name, submitted_by: vdStr_(p.submitted_by), submitter_role: vdStr_(p.submitter_role),
    result: result, fail_reasons: fails.join('\n'), findings: findings.length, finding_list: findings.join('\n'),
    accounts_audited: accounts.length, people_listed: people,
    law_compliance: p.law_compliance, insurance_current: vdStr_(p.insurance_current),
    id_badges: vdStr_(p.id_badges), chemical_training: vdStr_(p.chemical_training),
    vendor_rep: vdStr_(p.vendor_rep), how_obtained: vdStr_(p.how_obtained), notes: vdStr_(p.notes),
    pdf_url: '', pdf_name: '', next_due: nextDue, received: audNow_(), test: isTest
  };

  // ---- PDF first, so a Drive failure is visible before anything is written
  var pdf = null, pdfErr = '';
  try {
    pdf = audPdf_(rec, vendor, accounts, fails, findings, mkt);
    rec.pdf_url = pdf.url; rec.pdf_name = pdf.name;
  } catch (e) { pdfErr = String(e); }

  // ---- sheet rows
  var sh = ss.getSheetByName(AUD_TABS.AUDITS);
  sh.getRange(audNextRow_(sh), 1, 1, AUD_HEADERS.length)
    .setValues([AUD_HEADERS.map(function (h) { return rec[h] == null ? '' : rec[h]; })]);

  var ash = ss.getSheetByName(AUD_TABS.ACCOUNTS);
  var lines = [];
  accounts.forEach(function (a) {
    if (!a.people.length) {
      lines.push([id, date, rec.market, vid, vendor.dba_name, a.account, '', '', '', '', a.sds_on_site, vdStr_(a.note), isTest]);
    }
    a.people.forEach(function (x) {
      lines.push([id, date, rec.market, vid, vendor.dba_name, a.account, x.name, !!x.from_cleared,
                  x.background_check, x.age_18_plus, a.sds_on_site, vdStr_(a.note), isTest]);
    });
  });
  if (lines.length) ash.getRange(audNextRow_(ash), 1, lines.length, AUD_ACC_HEADERS.length).setValues(lines);

  // ---- vendor row
  var col = {};
  VD_HEADERS.forEach(function (h, i) { col[h] = i + 1; });
  var vs = vendor._sheet, vr = vendor._row;
  if (col.last_audit) {
    vs.getRange(vr, col.last_audit).setValue(date);
    vs.getRange(vr, col.audit_result).setValue(result);
    vs.getRange(vr, col.audit_next_due).setValue(nextDue);
    vs.getRange(vr, col.audit_pdf).setValue(rec.pdf_url);
    vs.getRange(vr, col.updated).setValue(audToday_());
  }

  return audOut_({ ok: true, audit_id: id, result: result, fails: fails, findings: findings,
                   next_due: nextDue, pdf_url: rec.pdf_url, pdf_name: rec.pdf_name,
                   pdf_error: pdfErr, test: isTest, people: people, from_cleared: fromCleared,
                   sheet_url: ss.getUrl() });
}

function audOutError_(msg) { throw new Error(msg); }

// First empty row by column A, because appendRow lands under data-validation
// ranges at row 2001 (the same bug the other tabs hit).
function audNextRow_(sh) {
  var vals = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), 1).getValues();
  for (var i = 1; i < vals.length; i++) if (!vdStr_(vals[i][0])) return i + 1;
  return vals.length + 1;
}

// ------------------------------------------------------------ PDF ----------

function audImg_(url) {
  var cache = CacheService.getScriptCache();
  var key = 'audimg:' + url;
  var hit = cache.get(key);
  if (hit) return hit;
  try {
    var blob = UrlFetchApp.fetch(url, { muteHttpExceptions: true }).getBlob();
    var data = 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
    if (data.length < 100000) cache.put(key, data, 21600);
    return data;
  } catch (e) { return ''; }
}

function audPdf_(rec, vendor, accounts, fails, findings, mkt) {
  var logo = audImg_(AUD_LOGO);
  var crew = audImg_(AUD_IMG_BASE + 'crew-pdf.png');
  var icBg = audImg_(AUD_IMG_BASE + 'icon-bgcheck-64.png');
  var icOk = audImg_(AUD_IMG_BASE + 'icon-check-64.png');
  var icFa = audImg_(AUD_IMG_BASE + 'icon-facility-64.png');
  var pass = rec.result === 'PASS';
  var e = audEsc_;

  function yn(v) {
    v = String(v || '');
    if (v === 'Yes' || v === 'On file') return '<span class="ok">' + e(v) + '</span>';
    if (v === 'No') return '<span class="bad">No</span>';
    if (v === 'Pending') return '<span class="warn">Pending</span>';
    return '<span class="mut">not answered</span>';
  }
  function icon(src) { return src ? '<img class="ic" src="' + src + '">' : ''; }

  var acctHtml = accounts.map(function (a, i) {
    var ppl = a.people.length ? a.people.map(function (x) {
      return '<tr><td>' + e(x.name) + (x.from_cleared ? ' <span class="tag">on the background check list</span>' : '') + '</td>'
        + '<td>' + yn(x.background_check) + '</td><td>' + yn(x.age_18_plus) + '</td></tr>';
    }).join('') : '<tr><td colspan="3" class="mut">No one listed as cleaning this building.</td></tr>';
    return '<div class="acct"><div class="ah">' + icon(icFa) + '<b>' + (i + 1) + '. ' + e(a.account) + '</b>'
      + '<span class="sds">SDS on site for every chemical used here: ' + yn(a.sds_on_site) + '</span></div>'
      + '<table class="ppl"><tr><th>Who cleans here</th><th>Background check</th><th>18 or older<br><small>City Wide policy</small></th></tr>'
      + ppl + '</table>'
      + (a.note ? '<div class="an">Note: ' + e(a.note) + '</div>' : '') + '</div>';
  }).join('');

  var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>'
    + '@page{size:letter;margin:0.55in 0.6in 0.7in}'
    + 'body{font-family:Verdana,Geneva,sans-serif;color:#2D2A26;font-size:10pt;line-height:1.45;margin:0}'
    + '.top{border-bottom:3px solid #D22730;padding-bottom:8px;margin-bottom:10px}'
    + '.top img.logo{height:36px}'
    + '.top .t{float:right;text-align:right;font-size:8.5pt;color:#636466;letter-spacing:.08em;text-transform:uppercase;font-weight:bold;padding-top:10px}'
    + 'h1{font-size:19pt;margin:8px 0 2px;line-height:1.2}'
    + '.sub{color:#636466;font-size:9.5pt;margin:0 0 10px}'
    + '.hero{width:100%;border-collapse:collapse;margin-bottom:10px}'
    + '.hero td{vertical-align:top;padding:0}'
    + '.res{border:2px solid ' + (pass ? '#0AA6A9' : '#D22730') + ';border-radius:10px;padding:10px 14px;margin:0 0 8px}'
    + '.res b.r{font-size:22pt;color:' + (pass ? '#0AA6A9' : '#D22730') + ';display:block;line-height:1.1}'
    + '.res .why{font-size:9pt;margin-top:4px}'
    + '.meta{width:100%;border-collapse:collapse;font-size:9.5pt}'
    + '.meta td{padding:3px 6px 3px 0;vertical-align:top}.meta td.k{color:#636466;width:150px;font-size:8.5pt;text-transform:uppercase;letter-spacing:.05em;font-weight:bold}'
    + '.crew{width:150px;text-align:right}.crew img{width:140px}'
    + 'h2{font-size:11pt;border-left:4px solid #D22730;padding-left:8px;margin:16px 0 6px;text-transform:uppercase;letter-spacing:.06em}'
    + '.ic{width:18px;height:18px;vertical-align:middle;margin-right:6px}'
    + 'table.q{width:100%;border-collapse:collapse;font-size:9.5pt}'
    + 'table.q td{border-bottom:1px solid #E5E5E5;padding:5px 6px;vertical-align:top}table.q td.a{width:80px;text-align:center;font-weight:bold}'
    + '.acct{border:1px solid #E5E5E5;border-radius:8px;margin:0 0 8px;page-break-inside:avoid}'
    + '.ah{background:#F5F5F5;padding:6px 10px;font-size:10pt}.ah b{font-size:10.5pt}.ah .sds{float:right;font-size:9pt}'
    + 'table.ppl{width:100%;border-collapse:collapse;font-size:9.5pt}table.ppl th{text-align:left;font-size:8pt;color:#636466;text-transform:uppercase;letter-spacing:.05em;padding:5px 10px;border-bottom:1px solid #E5E5E5}'
    + 'table.ppl th small{display:block;text-transform:none;letter-spacing:0;font-weight:normal}'
    + 'table.ppl td{padding:5px 10px;border-bottom:1px solid #F0F0F0}table.ppl td:nth-child(2),table.ppl td:nth-child(3){width:110px;font-weight:bold}'
    + '.an{padding:5px 10px;font-size:9pt;color:#636466}'
    + '.tag{font-size:7.5pt;color:#0AA6A9;font-weight:bold;text-transform:uppercase;letter-spacing:.04em}'
    + '.ok{color:#0AA6A9}.bad{color:#D22730}.warn{color:#9A7B00}.mut{color:#636466;font-weight:normal}'
    + '.box{background:#F5F5F5;border-radius:8px;padding:9px 12px;font-size:9pt;margin:6px 0}'
    + '.box.rule{border-left:4px solid #E5B423;background:#FBF3D6}'
    + 'ul{margin:4px 0 0 18px;padding:0}li{margin:2px 0}'
    + '.att{font-size:9pt;margin-top:14px;page-break-inside:avoid}'
    + '.sig{margin-top:22px;width:100%;font-size:9pt}.sig td{width:50%;padding:0 12px 0 0}.sig .line{border-top:1px solid #2D2A26;padding-top:4px;margin-top:26px}'
    + '.foot{margin-top:16px;font-size:8pt;color:#636466;border-top:1px solid #E5E5E5;padding-top:6px}'
    + '</style></head><body>'
    + '<div class="top">' + (logo ? '<img class="logo" src="' + logo + '">' : '<b>City Wide Facility Solutions</b>')
    + '<span class="t">Quarterly Vendor Compliance Audit<br>' + e(rec.market) + '</span></div>'
    + '<h1>' + e(vendor.dba_name) + '</h1>'
    + '<p class="sub">Audit ' + e(rec.audit_id) + ' &middot; ' + e(rec.audit_date) + ' &middot; recorded by '
    + e(rec.submitted_by) + (rec.submitter_role ? ', ' + e(rec.submitter_role) : '') + ', City Wide Facility Solutions</p>'
    + '<table class="hero"><tr><td>'
    + '<div class="res"><b class="r">' + (pass ? 'PASS' : 'FAIL') + '</b>'
    + '<div class="why">' + (pass
        ? 'Every person listed has a background check on file and is confirmed 18 or older, the vendor attests to employment law compliance, and SDS are on site in every building audited.'
        : e(fails.length) + (fails.length === 1 ? ' reason' : ' reasons') + ' below. ') + '</div></div>'
    + '<table class="meta">'
    + '<tr><td class="k">Accounts audited</td><td>' + accounts.length + '</td></tr>'
    + '<tr><td class="k">People listed</td><td>' + rec.people_listed + '</td></tr>'
    + '<tr><td class="k">Findings</td><td>' + findings.length + '</td></tr>'
    + '<tr><td class="k">Next audit due</td><td>' + e(rec.next_due) + ' (' + AUD_DAYS + ' days)</td></tr>'
    + '<tr><td class="k">Vendor ID</td><td>' + e(rec.vendor_id) + (vendor.legal_name && vendor.legal_name !== vendor.dba_name ? ' &middot; ' + e(vendor.legal_name) : '') + '</td></tr>'
    + '</table></td><td class="crew">' + (crew ? '<img src="' + crew + '">' : '') + '</td></tr></table>'
    + (fails.length ? '<div class="box" style="border-left:4px solid #D22730"><b>Why this audit failed</b><ul>'
        + fails.map(function (f) { return '<li>' + e(f) + '</li>'; }).join('') + '</ul></div>' : '')
    + (findings.length ? '<div class="box"><b>Findings for the vendor to address</b><ul>'
        + findings.map(function (f) { return '<li>' + e(f) + '</li>'; }).join('') + '</ul></div>' : '')
    + '<h2>' + icon(icOk) + 'Vendor attestations</h2>'
    + '<table class="q">'
    + '<tr><td>The vendor attests that it follows all applicable state and federal employment laws for the people it sends to City Wide accounts.</td><td class="a">' + yn(rec.law_compliance) + '</td></tr>'
    + '<tr><td>Workers\' compensation and general liability insurance are current and certificates are on file with City Wide.'
    + (vendor.gl_exp || vendor.wc_exp ? ' <span class="mut">(On file: GL ' + e(vendor.gl_exp || 'none') + ', WC ' + e(vendor.wc_exp || 'none') + ')</span>' : '')
    + '</td><td class="a">' + yn(rec.insurance_current) + '</td></tr>'
    + '<tr><td>Crew wear City Wide identification badges while on site.</td><td class="a">' + yn(rec.id_badges) + '</td></tr>'
    + '<tr><td>Crew are trained on the safe handling of the chemicals they use.</td><td class="a">' + yn(rec.chemical_training) + '</td></tr>'
    + '</table>'
    + '<h2>' + icon(icBg) + 'Account by account</h2>' + acctHtml
    + (rec.notes ? '<h2>Notes</h2><div class="box">' + e(rec.notes).replace(/\n/g, '<br>') + '</div>' : '')
    + '<h2>How the result was reached</h2><div class="box rule">' + e(audRuleText_()) + '</div>'
    + '<div class="att"><b>About this record.</b> This audit records statements made to City Wide Facility Solutions by '
    + e(vendor.dba_name) + (rec.vendor_rep ? ' through ' + e(rec.vendor_rep) : '') + (rec.how_obtained ? ' (' + e(rec.how_obtained) + ')' : '')
    + ', together with what City Wide has on file. ' + e(vendor.dba_name) + ' is an independent business that decides how it hires, trains, '
    + 'schedules, pays, and supervises its crew. City Wide does not direct those matters and collected no documents for this audit. '
    + 'Findings are noted for the vendor to resolve in the manner it chooses. The background check and age items reflect '
    + 'requirements in the vendor agreement and City Wide policy; 18 or older is a City Wide policy, not a legal age floor.</div>'
    + '<table class="sig"><tr><td><div class="line">' + e(rec.submitted_by) + ', City Wide Facility Solutions</div></td>'
    + '<td><div class="line">Vendor acknowledgment (optional), ' + e(vendor.dba_name) + '</div></td></tr></table>'
    + '<div class="foot">City Wide Facility Solutions &middot; ' + e(rec.market) + ' &middot; GoCityWide.com &middot; Internal record, one copy may be given to the vendor.</div>'
    + '</body></html>';

  var safe = vendor.dba_name.replace(/[\\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  var name = 'Audit - ' + safe + ' - ' + rec.audit_date + ' - ' + rec.result + (rec.test ? ' - TEST' : '') + '.pdf';
  var blob = Utilities.newBlob(html, 'text/html', name.replace(/\.pdf$/, '.html')).getAs('application/pdf').setName(name);
  var file = audMarketFolder_(mkt).createFile(blob);
  return { url: file.getUrl(), name: name, id: file.getId() };
}

// ------------------------------------------------------------ list ---------

// History for one vendor (or the whole book when vendor_id is blank), newest first.
function audList_(data) {
  var ss = vdSS_();
  var sh = ss.getSheetByName(AUD_TABS.AUDITS);
  if (!sh) return audOut_({ ok: true, audits: [] });
  var vid = vdStr_(data.vendor_id);
  var rows = vdRows_(sh).rows.filter(function (r) {
    return r.audit_id && (!vid || r.vendor_id === vid) && (data.include_test || !vdTrue_(r.test));
  });
  rows.sort(function (a, b) { return a.audit_date < b.audit_date ? 1 : -1; });
  return audOut_({ ok: true, audits: rows.slice(0, Number(data.limit) || 200).map(function (r) {
    delete r._row; return r;
  }) });
}

// Clears (never deletes) rows marked test on both audit tabs, trashes their PDFs,
// and blanks the audit columns on any vendor whose latest audit was a test.
function audPurgeTest_(data) {
  var ss = vdSS_();
  var n = 0, trashed = 0;
  [AUD_TABS.AUDITS, AUD_TABS.ACCOUNTS].forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) return;
    var head = name === AUD_TABS.AUDITS ? AUD_HEADERS : AUD_ACC_HEADERS;
    vdRows_(sh).rows.forEach(function (r) {
      if (!vdTrue_(r.test)) return;
      if (name === AUD_TABS.AUDITS && r.pdf_url) {
        try { var m = /\/d\/([^\/]+)/.exec(r.pdf_url); if (m) { DriveApp.getFileById(m[1]).setTrashed(true); trashed++; } } catch (e) {}
      }
      sh.getRange(r._row, 1, 1, head.length).clearContent(); n++;
    });
  });
  var col = {};
  VD_HEADERS.forEach(function (h, i) { col[h] = i + 1; });
  var cleared = 0;
  if (col.last_audit) {
    vdAllRows_(ss).forEach(function (r) {
      var testVendor = /^test\b|^zz ?test/i.test(r.dba_name);
      var testPdf = / - TEST/.test(r.audit_pdf || '');
      if (!testVendor && !testPdf) return;
      if (!r.last_audit && !r.audit_pdf) return;
      [col.last_audit, col.audit_result, col.audit_next_due, col.audit_pdf].forEach(function (c) {
        r._sheet.getRange(r._row, c).clearContent();
      });
      cleared++;
    });
  }
  return audOut_({ ok: true, rows_cleared: n, pdfs_trashed: trashed, vendors_cleared: cleared });
}

// ------------------------------------------------------------ run helpers --

// Editor > Run. Creates the audit tabs, the Drive folder, and the four vendor
// columns. Idempotent.
function audSetupRun() {
  var r = audSetup_({});
  Logger.log(r.getContent ? r.getContent() : r);
}
