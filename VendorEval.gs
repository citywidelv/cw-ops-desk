// ============================================================
// VendorEval.gs - Vendor Evaluation record, PDF and team email (Sep 22 2026)
// File in the CW Solicitations Apps Script project.
// Routing: doPost in Code.gs routes any kind starting 'vev_' to vevDispatch(data).
//
// What this file is for. The native Vendor Evaluation page
// (cw-vendor-hub/vendor-evaluation.html) posts kind vd_eval, which Onboarding.gs
// handles (obVendorEval_). Until now the only thing the team saw was an eight
// line plain text email: company, contact, region, services, directory id. The
// vendor answers about forty questions on that form, including the compliance
// answers the packet depends on, and every one of them was dropped on the floor.
//
// This file adds three things and changes nothing about how the submission is
// stored in the directory:
//   1. an "Evaluations" tab on the CW Vendor Directory book, one row per
//      submission, so there is a history to read and sort,
//   2. a printable PDF of the whole evaluation, saved in Drive under
//      Team Portal / Ops Hub / Vendor Evaluations / <market>, and
//   3. a branded HTML email that carries every answer, links the PDF and
//      attaches it.
//
// Why a new tab instead of a column on the vendor row: vdInvSet_ addresses
// columns by VD_HEADERS.indexOf, so the code array and the sheet column order
// have to match exactly. Adding a header means migrating every market tab.
// The Audits tab set the pattern here in August and it has held up.
//
// Sending account. MailApp always sends as the account the web app executes as.
// Verified Sep 22 2026 in Manage deployments: Execute as Me
// (citywidenv@cwfs-nv.com), the company Workspace account, Who has access
// Anyone. Drive files this script creates are owned by the same account, so the
// evaluation PDFs land in the company Drive and not in anyone's personal one.
// vevWhoAmI() prints both so this never has to be guessed again.
//
// Kinds:
//   vev_backfill   team passcode. Rebuild PDFs and Evaluations rows from the
//                  Intake Log for submissions that came in before this file
//                  existed. Safe to re-run: a submission already on the
//                  Evaluations tab is skipped unless force is true.
//   vev_list       team passcode. Evaluation history, newest first.
//   vev_whoami     team passcode. Which account sends and where PDFs land.
// ============================================================

var VEV_TAB = 'Evaluations';
var VEV_FOLDER_PROP = 'EVAL_FOLDER_ID';
var VEV_FOLDER_PATH = ['Team Portal', 'Ops Hub', 'Vendor Evaluations'];
var VEV_LOGO = 'https://emailer.emfluence.com/clients/citywide/uploadedfiles/signature_logo.png';
var VEV_PAGE = 'https://citywidelv.github.io/cw-vendor-hub/vendor-evaluation.html';

// Set to true to also send the vendor a copy of their own evaluation. The
// success screen on the form already tells them "A copy went to your email",
// which is not true today. Nothing vendor facing goes live without TJ, so this
// stays false until he says otherwise.
var VEV_CONFIRM_VENDOR = false;

var VEV_HEADERS = [
  'eval_id', 'received', 'market', 'vendor_id', 'vendor', 'legal_name', 'contact_name',
  'email', 'phone', 'action', 'services', 'service_types', 'years_in_business',
  'crew_ft', 'crew_pt', 'flags', 'flag_count', 'pdf_url', 'pdf_name', 'source'
];

// The ten yes / no questions, in the order the form asks them, with the wording
// the vendor read. Sep 26 2026 (TJ): these answers are for our records only.
// The evaluation is the first step and every answer gets talked through at the
// orientation meeting, so a No never blocks a vendor, never raises an alert and
// is never shown in red. "want" and "heavy" are kept only so the Evaluations tab
// still lists the No answers in its flags column as a plain record.
var VEV_YN = [
  { key: 'background_checks',  q: 'Do you run background checks on crew members?',        want: 'Yes', heavy: true },
  { key: 'sut_paid',           q: 'Do you pay state unemployment tax?',                   want: 'Yes', heavy: false },
  { key: 'wage_compliance',    q: 'Do you follow all wage and labor laws?',               want: 'Yes', heavy: false },
  { key: 'documented_pay',     q: 'Do you have a documented way of paying crew members?', want: 'Yes', heavy: false },
  { key: 'i9_collected',       q: 'Do you collect I-9 forms for crew members?',           want: 'Yes', heavy: true },
  { key: 'daily_supervision',  q: 'Does a supervisor check work quality daily?',          want: 'Yes', heavy: false },
  { key: 'workers_comp',       q: "Do you carry Workers' Compensation insurance?",        want: 'Yes', heavy: true },
  { key: 'general_liability',  q: 'Do you carry General Liability insurance?',            want: 'Yes', heavy: true },
  { key: 'has_brochures',      q: 'Do you have marketing brochures?',                     want: '',    heavy: false },
  { key: 'has_cards',          q: 'Do you have business cards?',                          want: '',    heavy: false }
];

var VEV_LONG = [
  { key: 'services_desc',      q: 'In your own words, what does your crew do best?' },
  { key: 'concern_process',    q: 'When a client has a concern or a job is at risk, what do you do?' },
  { key: 'family_involvement', q: 'How involved are you and your family in daily operations?' },
  { key: 'additional_notes',   q: 'Anything else you want us to know?' }
];

// ------------------------------------------------------------ dispatch -----

function vevDispatch(data) {
  var kind = String(data.kind || '');
  try {
    if ((data.passcode || '') === '' || (data.passcode || '') !== vdPass_()) {
      return vdOut_({ ok: false, error: 'Wrong passcode.' });
    }
    if (kind === 'vev_backfill') return vevBackfill_(data);
    if (kind === 'vev_list') return vevList_(data);
    if (kind === 'vev_whoami') return vdOut_({ ok: true, who: vevWhoAmI() });
    return vdOut_({ ok: false, error: 'Unknown kind ' + kind });
  } catch (e) {
    return vdOut_({ ok: false, error: 'Evaluation error: ' + String(e && e.message || e) });
  }
}

// Run from the editor (or Runner.gs) to see, in one place, which mailbox sends
// the evaluation notices and which Drive the PDFs are written to.
function vevWhoAmI() {
  var out = { sends_as: '', sender_source: '', drive_owner: '', folder: '', folder_url: '' };
  // What actually lands in the From line is decided by cwMail_, not by who owns
  // this project. A MAIL_FROM script property overrides the executing account and
  // sends through a Gmail send-as alias instead, so read that first. Do not infer
  // the sender from the Drive owner: those two can disagree, and on Sep 22 2026
  // they did (Drive citywidenv@cwfs-nv.com, mail citywideoflasvegas@gmail.com).
  try {
    var mf = String(PropertiesService.getScriptProperties().getProperty('MAIL_FROM') || '').trim();
    if (mf) { out.sends_as = mf; out.sender_source = 'MAIL_FROM script property'; }
  } catch (mfe) {}
  if (!out.sends_as) {
    try { out.sends_as = Session.getEffectiveUser().getEmail(); out.sender_source = 'executing account'; }
    catch (e) { out.sends_as = ''; }
  }
  try {
    var f = vevFolder_();
    out.folder = VEV_FOLDER_PATH.join(' / ');
    out.folder_url = f.getUrl();
    try { out.drive_owner = f.getOwner().getEmail(); } catch (e2) { out.drive_owner = out.sends_as; }
    if (!out.sends_as) { out.sends_as = out.drive_owner || 'could not read'; out.sender_source = 'assumed from Drive owner, not verified'; }
  } catch (e3) { out.folder = 'could not open: ' + e3; }
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}

// ------------------------------------------------------------ helpers ------

function vevEsc_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function vevStr_(v) { return String(v == null ? '' : v).trim(); }

// The Intake Log writes "2026-09-21 11:01" as text, but Sheets sometimes parses
// it back as a Date. Both shapes have to come out as the same readable string,
// because the backfill keys on it and the PDF prints it.
function vevWhen_(v) {
  if (v instanceof Date) {
    var tz = Session.getScriptTimeZone() || 'America/Los_Angeles';
    return Utilities.formatDate(v, tz, 'yyyy-MM-dd HH:mm');
  }
  return vevStr_(v);
}
function vevLines_(s) { return vevEsc_(s).replace(/\r?\n/g, '<br>'); }

function vevBook_() { return vdSS_(); }

function vevSheet_() {
  var ss = vevBook_();
  var sh = ss.getSheetByName(VEV_TAB);
  if (!sh) {
    sh = ss.insertSheet(VEV_TAB);
    sh.getRange(1, 1, 1, VEV_HEADERS.length).setValues([VEV_HEADERS]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, VEV_HEADERS.length).setFontWeight('bold').setBackground('#F5F5F5');
    sh.setColumnWidth(VEV_HEADERS.indexOf('vendor') + 1, 220);
    sh.setColumnWidth(VEV_HEADERS.indexOf('services') + 1, 320);
    sh.setColumnWidth(VEV_HEADERS.indexOf('pdf_url') + 1, 240);
    // Keep the received stamp as text so Sheets does not reformat it per locale.
    sh.getRange(2, VEV_HEADERS.indexOf('received') + 1, sh.getMaxRows() - 1, 1).setNumberFormat('@');
  } else {
    // Self heal a header row someone edited, without moving any data.
    var head = sh.getRange(1, 1, 1, VEV_HEADERS.length).getValues()[0];
    for (var i = 0; i < VEV_HEADERS.length; i++) {
      if (vevStr_(head[i]) !== VEV_HEADERS[i]) sh.getRange(1, i + 1).setValue(VEV_HEADERS[i]);
    }
  }
  return sh;
}

// Team Portal / Ops Hub / Vendor Evaluations, created on first use in the Drive
// of whichever account this script executes as, then remembered.
function vevFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(VEV_FOLDER_PROP);
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var parent = DriveApp.getRootFolder();
  VEV_FOLDER_PATH.forEach(function (name) {
    var it = parent.getFoldersByName(name);
    parent = it.hasNext() ? it.next() : parent.createFolder(name);
  });
  props.setProperty(VEV_FOLDER_PROP, parent.getId());
  return parent;
}
function vevMarketFolder_(market) {
  var root = vevFolder_();
  var name = vevStr_(market) || 'Las Vegas';
  var it = root.getFoldersByName(name);
  return it.hasNext() ? it.next() : root.createFolder(name);
}

function vevNextId_(sh) {
  var last = sh.getLastRow();
  var n = 0;
  if (last > 1) {
    var vals = sh.getRange(2, 1, last - 1, 1).getValues();
    vals.forEach(function (r) {
      var m = /^E-(\d+)$/.exec(vevStr_(r[0]));
      if (m) n = Math.max(n, Number(m[1]));
    });
  }
  return 'E-' + Math.max(n + 1, 1001);
}

// The record every other function in this file works from. Built once from the
// cleaned submission so the live path and the backfill path cannot drift.
function vevRecord_(v, opts) {
  opts = opts || {};
  var market = vdRegion_(vevStr_(v.region) || opts.region);
  var flags = [];
  VEV_YN.forEach(function (q) {
    var a = vevStr_(v[q.key]);
    if (!q.want) return;
    if (a && a !== q.want) flags.push({ q: q.q, a: a, heavy: q.heavy });
    else if (!a) flags.push({ q: q.q, a: 'not answered', heavy: false });
  });
  return {
    eval_id: opts.eval_id || '',
    received: vevWhen_(opts.received || (typeof obNow_ === 'function' ? obNow_() : new Date())),
    date: opts.date || (typeof obToday_ === 'function' ? obToday_() : ''),
    market: market,
    vendor_id: vevStr_(v.vendor_id) || vevStr_(opts.vendor_id),
    action: vevStr_(opts.action) || 'added',
    v: v,
    services: vevStr_(v.trade_raw),
    flags: flags,
    heavy: flags.filter(function (f) { return f.heavy; }),
    pdf_url: '', pdf_name: '',
    source: opts.source || 'Vendor Hub evaluation'
  };
}

// The internal action wording ("matched existing, not changed") is not what a
// person reading the email needs. Say what to do about it instead.
function vevActionLabel_(action) {
  var a = vevStr_(action).toLowerCase();
  if (a.indexOf('invite') >= 0) return 'Invite completed';
  if (a.indexOf('matched') >= 0) return 'Already in the directory';
  return 'New vendor';
}

function vevMarketEmails_(market) {
  var lv = 'LVCompliance@gocitywide.com', nnv = 'rncompliance@gocitywide.com';
  try {
    if (typeof OB_MARKETS === 'object' && OB_MARKETS) {
      lv = OB_MARKETS.lv.compliance; nnv = OB_MARKETS.nnv.compliance;
    }
  } catch (e) {}
  if (market === 'Both') return { to: lv + ',' + nnv, reply: lv, name: 'City Wide Nevada Compliance' };
  if (market === 'Northern Nevada') return { to: nnv, reply: nnv, name: 'City Wide Northern Nevada Compliance' };
  return { to: lv, reply: lv, name: 'City Wide Las Vegas Compliance' };
}

// ------------------------------------------------------------ PDF ----------

// Drive's HTML to PDF converter fetches https images and drops data: URIs
// (VendorAudit.gs found that Aug 22 2026), so the logo goes in as a plain URL.
// A missing image leaves a gap, it never fails the PDF.
function vevPdf_(rec) {
  var v = rec.v, e = vevEsc_;

  // Only the questions with a right answer get a colour. Brochures and business
  // cards have no right answer, so "No" there must not read as a problem.
  function ans(q) {
    var a = vevStr_(v[q.key]);
    if (!a) return '<span class="mut">not answered</span>';
    return '<b class="neutral">' + e(a) + '</b>';
  }
  function row(k, val) {
    return '<tr><td class="k">' + e(k) + '</td><td>' + (vevStr_(val) ? e(val) : '<span class="mut">not given</span>') + '</td></tr>';
  }
  function refBlock(n) {
    var co = vevStr_(v['ref' + n + '_company']);
    if (!co && !vevStr_(v['ref' + n + '_name'])) return '<div class="ref mut">Reference ' + n + ' not given.</div>';
    return '<div class="ref"><b>' + e(co || 'Reference ' + n) + '</b><br>'
      + e(vevStr_(v['ref' + n + '_name']) || 'no contact name') + '<br>'
      + e(vevStr_(v['ref' + n + '_phone']) || 'no phone') + '<br>'
      + e(vevStr_(v['ref' + n + '_email']) || 'no email') + '</div>';
  }

  var svcList = rec.services ? rec.services.split(';').map(function (s) { return vevStr_(s); }).filter(Boolean) : [];
  var svcHtml = svcList.length
    ? '<ul class="svc">' + svcList.map(function (s) { return '<li>' + e(s) + '</li>'; }).join('') + '</ul>'
    : '<p class="mut">No services were recorded on this submission.</p>';

  var longHtml = VEV_LONG.map(function (q) {
    var a = vevStr_(v[q.key]);
    if (!a) return '';
    return '<div class="qa"><div class="qq">' + e(q.q) + '</div><div class="qa-a">' + vevLines_(a) + '</div></div>';
  }).filter(Boolean).join('');

  var ynHtml = VEV_YN.map(function (q) {
    var a = vevStr_(v[q.key]);
    return '<tr><td>' + e(q.q) + '</td><td class="a">' + ans(q) + '</td></tr>';
  }).join('');

  var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>'
    + '@page{size:letter;margin:0.55in 0.6in 0.7in}'
    + 'body{font-family:Verdana,Geneva,sans-serif;color:#2D2A26;font-size:10pt;line-height:1.45;margin:0}'
    + 'table.top{width:100%;border-collapse:collapse;border-bottom:3px solid #D22730;margin-bottom:10px}'
    + 'table.top td{padding:0 0 8px;vertical-align:bottom}'
    + 'table.top img.logo{height:34px}'
    + 'table.top td.t{text-align:right;font-size:8.5pt;color:#636466;letter-spacing:.08em;text-transform:uppercase;font-weight:bold;line-height:1.4}'
    + 'h1{font-size:18pt;margin:6px 0 2px;line-height:1.2}'
    + '.sub{color:#636466;font-size:9.5pt;margin:0 0 12px}'
    + 'h2{font-size:11pt;border-left:4px solid #D22730;padding-left:8px;margin:16px 0 6px;text-transform:uppercase;letter-spacing:.06em}'
    + 'table.meta{width:100%;border-collapse:collapse;font-size:9.5pt}'
    + 'table.meta td{padding:4px 6px 4px 0;vertical-align:top;border-bottom:1px solid #F0F0F0}'
    + 'table.meta td.k{color:#636466;width:180px;font-size:8.5pt;text-transform:uppercase;letter-spacing:.05em;font-weight:bold}'
    + 'table.q{width:100%;border-collapse:collapse;font-size:9.5pt}'
    + 'table.q td{border-bottom:1px solid #E5E5E5;padding:6px;vertical-align:top}'
    + 'table.q td.a{width:110px;text-align:center}'
    + 'table.q tr.flagrow td{background:#FCEEEF}'
    + 'ul.svc{margin:4px 0 0 0;padding:0 0 0 16px;columns:2;column-gap:22px;font-size:9.5pt}'
    + 'ul.svc li{margin:2px 0;break-inside:avoid}'
    + '.qa{margin:0 0 8px;page-break-inside:avoid}'
    + '.qa .qq{font-size:8.5pt;color:#636466;text-transform:uppercase;letter-spacing:.05em;font-weight:bold;margin-bottom:2px}'
    + '.qa .qa-a{font-size:9.5pt;background:#F5F5F5;border-radius:6px;padding:7px 10px}'
    + '.ref{display:inline-block;width:47%;vertical-align:top;font-size:9.5pt;background:#F5F5F5;border-radius:6px;padding:8px 10px;margin:0 2% 6px 0}'
    + '.box{border-radius:8px;padding:10px 13px;font-size:9.5pt;margin:8px 0;page-break-inside:avoid}'
    + '.box.flag{border-left:4px solid #D22730;background:#FCEEEF}'
    + '.box.clean{border-left:4px solid #0AA6A9;background:#F1FAFA}'
    + '.ok{color:#0AA6A9}.bad{color:#D22730}.neutral{color:#2D2A26}.mut{color:#636466;font-weight:normal}'
    + 'ul.f{margin:4px 0 0 18px;padding:0}ul.f li{margin:2px 0}'
    + '.note{font-size:8.5pt;color:#636466;margin-top:14px;page-break-inside:avoid}'
    + '.foot{margin-top:14px;font-size:8pt;color:#636466;border-top:1px solid #E5E5E5;padding-top:6px}'
    + '</style></head><body>'
    + '<table class="top"><tr><td><img class="logo" src="' + VEV_LOGO + '"></td>'
    + '<td class="t">Vendor Evaluation<br>' + e(rec.market) + '</td></tr></table>'
    + '<h1>' + e(vevStr_(v.dba_name)) + '</h1>'
    + '<p class="sub">' + e(rec.eval_id) + ' &middot; submitted ' + e(rec.received)
    + ' &middot; directory id ' + e(rec.vendor_id || 'none') + ' &middot; ' + e(vevActionLabel_(rec.action)) + '</p>'


    + '<h2>The business</h2><table class="meta">'
    + row('Business name (DBA)', v.dba_name)
    + row('Legal name', v.legal_name)
    + row('Contact', vevStr_(v.contact_name))
    + row('Mobile', v.phone)
    + row('Business phone', v.business_phone)
    + row('Email', v.email)
    + row('Business address', v.business_address)
    + row('Website', v.website)
    + row('Cities the crew works in', v.metro_areas)
    + row('Years in business', v.years_in_business)
    + row('License number', v.license_no)
    + row('Crew, full time', v.crew_ft)
    + row('Crew, part time', v.crew_pt)
    + row('Market', rec.market)
    + '</table>'

    + '<h2>What they do</h2>' + svcHtml
    + (longHtml ? '<h2>In their words</h2>' + longHtml : '')
    + '<h2>How they operate</h2><table class="q">' + ynHtml + '</table>'
    + '<h2>References</h2>' + refBlock(1) + refBlock(2)

    + '<div class="note"><b>About this record.</b> These are answers ' + e(vevStr_(v.dba_name))
    + ' gave on the City Wide Vendor Hub evaluation form. City Wide collected no documents with this form and verified none of it. '
    + e(vevStr_(v.dba_name)) + ' is an independent business that decides how it hires, trains, schedules, pays and supervises its crew. '
    + 'Insurance certificates, the W-9, the bank letter and background check results are collected separately during onboarding and '
    + 'are what the file is built on.</div>'
    + '<div class="foot">City Wide Facility Solutions &middot; ' + e(rec.market) + ' &middot; GoCityWide.com &middot; Internal record.</div>'
    + '</body></html>';

  var safe = vevStr_(v.dba_name).replace(/[\\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Unnamed vendor';
  var name = 'Vendor Evaluation - ' + safe + ' - ' + (rec.date || '') + '.pdf';
  var blob = Utilities.newBlob(html, 'text/html', name.replace(/\.pdf$/, '.html'))
    .getAs('application/pdf').setName(name);
  var file = vevMarketFolder_(rec.market).createFile(blob);
  return { url: file.getUrl(), name: name, id: file.getId(), blob: blob };
}

// ------------------------------------------------------------ email --------

function vevEmailHtml_(rec) {
  var v = rec.v, e = vevEsc_;
  var F = 'font-family:Verdana,Arial,sans-serif;';
  var deskUrl = (typeof OB_DESK_URL === 'string' ? OB_DESK_URL : 'https://citywidelv.github.io/cw-admin-hub/onboarding.html')
    + '#' + encodeURIComponent(rec.vendor_id || '');

  function cell(k, val) {
    return '<tr><td style="' + F + 'font-size:11px;color:#636466;text-transform:uppercase;letter-spacing:.05em;'
      + 'font-weight:bold;padding:7px 12px 7px 0;width:170px;vertical-align:top;border-bottom:1px solid #F0F0F0;">' + e(k) + '</td>'
      + '<td style="' + F + 'font-size:14px;color:#2D2A26;padding:7px 0;vertical-align:top;border-bottom:1px solid #F0F0F0;">'
      + (vevStr_(val) ? e(val) : '<span style="color:#9a9896;">not given</span>') + '</td></tr>';
  }
  function ynRow(q) {
    var a = vevStr_(v[q.key]);
    var colour = !a ? '#9a9896' : '#2D2A26';
    return '<tr><td style="' + F + 'font-size:13px;color:#2D2A26;padding:7px 12px 7px 0;border-bottom:1px solid #F0F0F0;'
      + '">' + e(q.q) + '</td>'
      + '<td style="' + F + 'font-size:13px;font-weight:bold;color:' + colour + ';padding:7px 0;width:92px;text-align:right;'
      + 'border-bottom:1px solid #F0F0F0;' + '">'
      + (a ? e(a) : 'no answer') + '</td></tr>';
  }

  var svcList = rec.services ? rec.services.split(';').map(function (s) { return vevStr_(s); }).filter(Boolean) : [];
  var svcHtml = svcList.length
    ? svcList.map(function (s) {
        return '<span style="' + F + 'display:inline-block;font-size:12px;color:#2D2A26;background:#F5F5F5;'
          + 'border:1px solid #E5E5E5;border-radius:12px;padding:4px 11px;margin:0 5px 6px 0;">' + e(s) + '</span>';
      }).join('')
    : '<span style="' + F + 'font-size:13px;color:#9a9896;">No services recorded.</span>';

  var longHtml = VEV_LONG.map(function (q) {
    var a = vevStr_(v[q.key]);
    if (!a) return '';
    return '<div style="margin:0 0 12px;"><div style="' + F + 'font-size:11px;color:#636466;text-transform:uppercase;'
      + 'letter-spacing:.05em;font-weight:bold;margin-bottom:4px;">' + e(q.q) + '</div>'
      + '<div style="' + F + 'font-size:13px;color:#2D2A26;background:#F5F5F5;border-radius:6px;padding:10px 13px;line-height:1.5;">'
      + vevLines_(a) + '</div></div>';
  }).filter(Boolean).join('');

  function ref(n) {
    var co = vevStr_(v['ref' + n + '_company']);
    if (!co && !vevStr_(v['ref' + n + '_name'])) return '';
    return '<td style="width:50%;vertical-align:top;padding:0 8px 0 0;">'
      + '<div style="' + F + 'font-size:13px;color:#2D2A26;background:#F5F5F5;border-radius:6px;padding:10px 13px;line-height:1.6;">'
      + '<b>' + e(co || ('Reference ' + n)) + '</b><br>' + e(vevStr_(v['ref' + n + '_name']) || 'no contact name') + '<br>'
      + e(vevStr_(v['ref' + n + '_phone']) || 'no phone') + '<br>' + e(vevStr_(v['ref' + n + '_email']) || 'no email')
      + '</div></td>';
  }
  var refs = ref(1) + ref(2);

  var flagBox = '';   // Sep 26 2026: no needs-a-look box. Answers are a record for orientation.

  return '<!DOCTYPE html><html><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1"></head>'
    + '<body style="margin:0;padding:0;background:#F5F5F5;">'
    + '<table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F5F5;padding:22px 12px;"><tr><td align="center">'
    + '<table width="660" cellpadding="0" cellspacing="0" style="max-width:660px;width:100%;background:#FFFFFF;border-radius:10px;overflow:hidden;">'

    + '<tr><td style="padding:22px 30px 16px;border-bottom:3px solid #D22730;">'
    + '<table width="100%" cellpadding="0" cellspacing="0"><tr>'
    + '<td width="220" style="width:220px;"><img src="' + VEV_LOGO + '" height="34" alt="City Wide Facility Solutions" style="display:block;border:0;height:34px;width:auto;max-width:210px;"></td>'
    + '<td align="right" style="' + F + 'font-size:11px;font-weight:bold;color:#636466;text-transform:uppercase;letter-spacing:.08em;line-height:1.5;padding-left:20px;">'
    + 'Vendor Evaluation<br>' + e(rec.market) + '</td></tr></table></td></tr>'

    + '<tr><td style="padding:24px 30px 4px;">'
    + '<div style="' + F + 'font-size:11px;font-weight:bold;color:#D22730;text-transform:uppercase;letter-spacing:.1em;">'
    + e(vevActionLabel_(rec.action)) + '</div>'
    + '<div style="' + F + 'font-size:25px;font-weight:bold;color:#2D2A26;line-height:1.2;margin:6px 0 4px;">'
    + e(vevStr_(v.dba_name)) + '</div>'
    + '<div style="' + F + 'font-size:13px;color:#636466;">' + e(rec.eval_id) + ' &middot; submitted ' + e(rec.received)
    + ' &middot; directory id ' + e(rec.vendor_id || 'none') + '</div></td></tr>'

    + '<tr><td style="padding:18px 30px 6px;">'
    + '<a href="' + e(rec.pdf_url || VEV_PAGE) + '" style="' + F + 'display:inline-block;background:#D22730;color:#ffffff;'
    + 'font-size:13px;font-weight:bold;text-decoration:none;border-radius:6px;padding:11px 20px;margin:0 8px 8px 0;">Open the PDF</a>'
    + '<a href="' + e(deskUrl) + '" style="' + F + 'display:inline-block;background:#ffffff;color:#2D2A26;border:2px solid #E5E5E5;'
    + 'font-size:13px;font-weight:bold;text-decoration:none;border-radius:6px;padding:9px 18px;margin:0 8px 8px 0;">Onboarding desk</a>'
    + '</td></tr>'

    + '<tr><td style="padding:14px 30px 0;">' + flagBox + '</td></tr>'

    + '<tr><td style="padding:0 30px;">'
    + '<div style="' + F + 'font-size:12px;font-weight:bold;color:#2D2A26;text-transform:uppercase;letter-spacing:.06em;'
    + 'border-left:4px solid #D22730;padding-left:9px;margin:0 0 10px;">Who to call</div>'
    + '<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">'
    + cell('Contact', v.contact_name) + cell('Mobile', v.phone) + cell('Business phone', v.business_phone)
    + cell('Email', v.email) + cell('Address', v.business_address) + cell('Website', v.website)
    + cell('Legal name', v.legal_name) + cell('License number', v.license_no)
    + cell('Years in business', v.years_in_business)
    + cell('Crew', (vevStr_(v.crew_ft) || '0') + ' full time, ' + (vevStr_(v.crew_pt) || '0') + ' part time')
    + cell('Cities worked', v.metro_areas)
    + '</table></td></tr>'

    + '<tr><td style="padding:22px 30px 0;">'
    + '<div style="' + F + 'font-size:12px;font-weight:bold;color:#2D2A26;text-transform:uppercase;letter-spacing:.06em;'
    + 'border-left:4px solid #D22730;padding-left:9px;margin:0 0 12px;">What they do ('
    + svcList.length + (svcList.length === 1 ? ' service' : ' services') + ')</div>'
    + svcHtml + '</td></tr>'

    + (longHtml ? '<tr><td style="padding:22px 30px 0;">'
        + '<div style="' + F + 'font-size:12px;font-weight:bold;color:#2D2A26;text-transform:uppercase;letter-spacing:.06em;'
        + 'border-left:4px solid #D22730;padding-left:9px;margin:0 0 12px;">In their words</div>'
        + longHtml + '</td></tr>' : '')

    + '<tr><td style="padding:22px 30px 0;">'
    + '<div style="' + F + 'font-size:12px;font-weight:bold;color:#2D2A26;text-transform:uppercase;letter-spacing:.06em;'
    + 'border-left:4px solid #D22730;padding-left:9px;margin:0 0 10px;">How they operate</div>'
    + '<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">'
    + VEV_YN.map(ynRow).join('') + '</table></td></tr>'

    + (refs ? '<tr><td style="padding:22px 30px 0;">'
        + '<div style="' + F + 'font-size:12px;font-weight:bold;color:#2D2A26;text-transform:uppercase;letter-spacing:.06em;'
        + 'border-left:4px solid #D22730;padding-left:9px;margin:0 0 12px;">References</div>'
        + '<table width="100%" cellpadding="0" cellspacing="0"><tr>' + refs + '</tr></table></td></tr>' : '')

    + '<tr><td style="padding:26px 30px 24px;">'
    + '<div style="border-top:1px solid #E5E5E5;padding-top:14px;' + F + 'font-size:11px;color:#636466;line-height:1.6;">'
    + 'The PDF of this evaluation is attached and is filed in Google Drive under '
    + e(VEV_FOLDER_PATH.join(' / ')) + ' / ' + e(rec.market) + '.<br>'
    + 'These are answers the vendor gave on the Vendor Hub form. Nothing here has been verified. '
    + 'Certificates, the W-9, the bank letter and background checks are collected during onboarding.<br><br>'
    + '<b style="color:#2D2A26;">City Wide Facility Solutions</b> &middot; ' + e(rec.market) + ' &middot; GoCityWide.com'
    + '</div></td></tr>'

    + '</table></td></tr></table></body></html>';
}

// Plain text twin. Some clients never render the HTML, and cwQueueDigest_ reads
// body when it summarises. This one carries the same answers, not a stub.
function vevEmailText_(rec) {
  var v = rec.v, L = [];
  L.push('VENDOR EVALUATION - ' + vevStr_(v.dba_name));
  L.push(rec.market + ' | ' + rec.eval_id + ' | submitted ' + rec.received + ' | directory id ' + (rec.vendor_id || 'none'));
  L.push(vevActionLabel_(rec.action));
  L.push('');
  L.push('WHO TO CALL');
  L.push('  Contact: ' + vevStr_(v.contact_name));
  L.push('  Mobile: ' + vevStr_(v.phone) + (vevStr_(v.business_phone) ? '   Business: ' + vevStr_(v.business_phone) : ''));
  L.push('  Email: ' + vevStr_(v.email));
  if (vevStr_(v.business_address)) L.push('  Address: ' + vevStr_(v.business_address));
  if (vevStr_(v.website)) L.push('  Website: ' + vevStr_(v.website));
  if (vevStr_(v.legal_name)) L.push('  Legal name: ' + vevStr_(v.legal_name));
  if (vevStr_(v.license_no)) L.push('  License: ' + vevStr_(v.license_no));
  L.push('  Years in business: ' + (vevStr_(v.years_in_business) || 'not given'));
  L.push('  Crew: ' + (vevStr_(v.crew_ft) || '0') + ' full time, ' + (vevStr_(v.crew_pt) || '0') + ' part time');
  if (vevStr_(v.metro_areas)) L.push('  Cities: ' + vevStr_(v.metro_areas));
  L.push('');
  L.push('WHAT THEY DO');
  (rec.services ? rec.services.split(';') : []).forEach(function (s) { if (vevStr_(s)) L.push('  - ' + vevStr_(s)); });
  L.push('');
  VEV_LONG.forEach(function (q) {
    var a = vevStr_(v[q.key]);
    if (a) { L.push(q.q.toUpperCase()); L.push('  ' + a.replace(/\r?\n/g, '\n  ')); L.push(''); }
  });
  L.push('HOW THEY OPERATE');
  VEV_YN.forEach(function (q) { L.push('  ' + q.q + '  ' + (vevStr_(v[q.key]) || 'no answer')); });
  L.push('');
  L.push('REFERENCES');
  [1, 2].forEach(function (n) {
    var co = vevStr_(v['ref' + n + '_company']);
    if (!co && !vevStr_(v['ref' + n + '_name'])) { L.push('  ' + n + '. not given'); return; }
    L.push('  ' + n + '. ' + (co || 'no company') + ' - ' + (vevStr_(v['ref' + n + '_name']) || 'no name')
      + ' - ' + (vevStr_(v['ref' + n + '_phone']) || 'no phone') + ' - ' + (vevStr_(v['ref' + n + '_email']) || 'no email'));
  });
  L.push('');
  if (rec.pdf_url) L.push('PDF: ' + rec.pdf_url);
  L.push('Filed in Drive under ' + VEV_FOLDER_PATH.join(' / ') + ' / ' + rec.market + '.');
  L.push('Answers the vendor gave on the Vendor Hub form. Nothing here has been verified.');
  return L.join('\n');
}

// ------------------------------------------------------------ the hook -----

// Called by obVendorEval_ after the directory row and the onboarding record are
// written. Everything in here is best effort: a Drive or mail failure must never
// fail the vendor's submission, because the submission is already saved.
// Returns { eval_id, pdf_url, pdf_name, error } so the caller can log it.
function vevOnSubmit_(clean, action, region, vendorId) {
  var out = { eval_id: '', pdf_url: '', pdf_name: '', error: '' };
  try {
    var rec = vevRecord_(clean, { action: action, region: region, vendor_id: vendorId });
    var sh = vevSheet_();
    rec.eval_id = vevNextId_(sh);
    out.eval_id = rec.eval_id;

    var pdf = null;
    try { pdf = vevPdf_(rec); rec.pdf_url = pdf.url; rec.pdf_name = pdf.name; }
    catch (pe) { out.error = 'PDF: ' + String(pe && pe.message || pe); }
    out.pdf_url = rec.pdf_url; out.pdf_name = rec.pdf_name;

    try { vevAppendRow_(sh, rec); } catch (se) { out.error += ' | row: ' + String(se && se.message || se); }

    try {
      var mk = vevMarketEmails_(rec.market);
      var opts = {
        to: mk.to, name: mk.name, replyTo: mk.reply,
        subject: 'Vendor evaluation: ' + vevStr_(clean.dba_name) + ' (' + rec.market + ')',
        htmlBody: vevEmailHtml_(rec),
        body: vevEmailText_(rec)
      };
      // An attachment makes cwMail_ send now rather than queue to the digest,
      // which is what we want: an evaluation is a person waiting on a callback.
      if (pdf) opts.attachments = [pdf.blob];
      cwMail_('vd_eval', opts);
    } catch (me) { out.error += ' | mail: ' + String(me && me.message || me); }

    if (VEV_CONFIRM_VENDOR) {
      try { vevVendorCopy_(rec, pdf); } catch (ve) { out.error += ' | vendor copy: ' + String(ve && ve.message || ve); }
    }
  } catch (e) {
    out.error = String(e && e.message || e);
  }
  return out;
}

function vevAppendRow_(sh, rec) {
  var v = rec.v;
  var vals = {
    eval_id: rec.eval_id, received: rec.received, market: rec.market,
    vendor_id: rec.vendor_id, vendor: vevStr_(v.dba_name), legal_name: vevStr_(v.legal_name),
    contact_name: vevStr_(v.contact_name), email: vevStr_(v.email), phone: vevStr_(v.phone),
    action: rec.action, services: rec.services, service_types: vevStr_(v.service_types),
    years_in_business: vevStr_(v.years_in_business), crew_ft: vevStr_(v.crew_ft), crew_pt: vevStr_(v.crew_pt),
    flags: rec.flags.map(function (f) { return f.q + ' = ' + f.a; }).join(' | '),
    flag_count: rec.flags.length, pdf_url: rec.pdf_url, pdf_name: rec.pdf_name, source: rec.source
  };
  sh.appendRow(VEV_HEADERS.map(function (h) { return vals[h] == null ? '' : String(vals[h]); }));
}

// The vendor's own copy. Off by default (VEV_CONFIRM_VENDOR). Their own answers
// only, no internal flags, no directory id, no onboarding links.
function vevVendorCopy_(rec, pdf) {
  var v = rec.v;
  var to = vevStr_(v.email);
  if (to.indexOf('@') < 1) return;
  var mk = vevMarketEmails_(rec.market);
  var F = 'font-family:Verdana,Arial,sans-serif;';
  var html = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#F5F5F5;">'
    + '<table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F5F5;padding:22px 12px;"><tr><td align="center">'
    + '<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:10px;">'
    + '<tr><td style="padding:22px 30px 16px;border-bottom:3px solid #D22730;">'
    + '<img src="' + VEV_LOGO + '" height="34" alt="City Wide Facility Solutions" style="display:block;border:0;"></td></tr>'
    + '<tr><td style="padding:24px 30px;' + F + 'font-size:14px;color:#2D2A26;line-height:1.6;">'
    + '<div style="font-size:22px;font-weight:bold;margin-bottom:10px;">You are on file</div>'
    + 'Thanks, ' + vevEsc_(vevStr_(v.contact_name).split(' ')[0]) + '. We have '
    + vevEsc_(vevStr_(v.dba_name)) + ' on file with City Wide ' + vevEsc_(rec.market) + '.<br><br>'
    + 'Your answers are attached as a PDF. Keep it. If anything in it is wrong, reply to this email and tell us what to change.<br><br>'
    + 'When work opens that matches what your crew does, you hear from us.'
    + '</td></tr>'
    + '<tr><td style="padding:0 30px 26px;' + F + 'font-size:11px;color:#636466;border-top:1px solid #E5E5E5;padding-top:14px;">'
    + '<b style="color:#2D2A26;">City Wide Facility Solutions</b> &middot; ' + vevEsc_(rec.market) + ' &middot; GoCityWide.com</td></tr>'
    + '</table></td></tr></table></body></html>';
  var opts = { to: to, name: mk.name, replyTo: mk.reply,
    subject: 'We have ' + vevStr_(v.dba_name) + ' on file', htmlBody: html,
    body: 'Thanks. We have ' + vevStr_(v.dba_name) + ' on file with City Wide ' + rec.market
      + '. Your answers are attached. If anything is wrong, reply and tell us what to change.' };
  if (pdf) opts.attachments = [pdf.blob];
  cwMail_('vd_eval_vendor', opts);
}

// ------------------------------------------------------------ backfill -----

// Rebuild the Evaluations rows and the PDFs for submissions that arrived before
// this file existed. The Intake Log on the CW Vendor Directory book stores the
// whole cleaned submission as JSON in the raw column, so nothing has to be
// retyped. business_address is deliberately not in that JSON, so backfilled
// PDFs show the address as not given. Everything else is complete.
//
// data: { passcode, force:false, email:false, limit:50 }
function vevBackfill_(data) {
  var ss = vevBook_();
  var log = ss.getSheetByName(typeof VD_TABS === 'object' && VD_TABS.INTAKE ? VD_TABS.INTAKE : 'Intake Log');
  if (!log) return vdOut_({ ok: false, error: 'No Intake Log tab on the vendor directory book.' });

  var sh = vevSheet_();
  var done = {};
  var last = sh.getLastRow();
  if (last > 1) {
    var iRec = VEV_HEADERS.indexOf('received'), iVen = VEV_HEADERS.indexOf('vendor');
    var have = sh.getRange(2, 1, last - 1, VEV_HEADERS.length).getValues();
    have.forEach(function (r) { done[vevWhen_(r[iRec]) + '|' + vevStr_(r[iVen]).toLowerCase()] = true; });
  }

  var vals = log.getDataRange().getValues();
  var head = vals[0].map(vevStr_);
  var c = {};
  head.forEach(function (h, i) { c[h] = i; });
  var force = !!data.force, wantMail = !!data.email, limit = Number(data.limit) || 50;

  vevBackfill_._dir = null;
  var made = [], skipped = 0, failed = [];
  for (var i = 1; i < vals.length && made.length < limit; i++) {
    var row = vals[i];
    if (vevStr_(row[c.submission_id]).toUpperCase() !== 'EVAL') continue;
    var received = vevWhen_(row[c.received]);
    var biz = vevStr_(row[c.business_name]);
    var key = received + '|' + biz.toLowerCase();
    if (done[key] && !force) { skipped++; continue; }
    // force re-runs replace the earlier record rather than stacking a second one:
    // the old row is cleared and its PDF trashed before the new one is written.
    if (done[key] && force) { try { vevDropExisting_(sh, key); } catch (de) {} }

    var v = null;
    try { v = JSON.parse(vevStr_(row[c.raw]) || '{}'); } catch (pe) { v = null; }
    if (!v || !vevStr_(v.dba_name)) {
      // The raw JSON is missing or unreadable. Rebuild what the log columns hold
      // so there is still a record, and say so on the PDF.
      v = { dba_name: biz, contact_name: vevStr_(row[c.contact_name]), email: vevStr_(row[c.email]),
            phone: vevStr_(row[c.phone]), region: vevStr_(row[c.region]),
            service_types: vevStr_(row[c.service_types]),
            additional_notes: 'Rebuilt from the intake log. The full submission was not stored.' };
    }
    if (!vevStr_(v.region)) v.region = vevStr_(row[c.region]);
    // business_address is deliberately left out of the intake log JSON, but the
    // vendor gave it and it is on their directory row. Take it from there so a
    // backfilled PDF does not claim the address was never provided.
    if (!vevStr_(v.business_address)) {
      try {
        var vid0 = vevStr_(row[c.matched_vendor_id]);
        if (vid0) {
          if (!vevBackfill_._dir) vevBackfill_._dir = vdAllRows_(ss);
          var hitRow = vevBackfill_._dir.filter(function (d) { return vevStr_(d.vendor_id) === vid0; })[0];
          if (hitRow && vevStr_(hitRow.business_address)) v.business_address = vevStr_(hitRow.business_address);
        }
      } catch (ae) {}
    }

    var rec = vevRecord_(v, {
      action: vevStr_(row[c.action]) || 'added',
      region: vevStr_(row[c.region]),
      vendor_id: vevStr_(row[c.matched_vendor_id]),
      received: received,
      date: received.slice(0, 10),
      source: 'Backfilled from intake log'
    });
    rec.eval_id = vevNextId_(sh);

    try {
      var pdf = vevPdf_(rec);
      rec.pdf_url = pdf.url; rec.pdf_name = pdf.name;
      vevAppendRow_(sh, rec);
      if (wantMail) {
        var mk = vevMarketEmails_(rec.market);
        cwMail_('vd_eval', { to: mk.to, name: mk.name, replyTo: mk.reply,
          subject: 'Vendor evaluation (backfilled): ' + vevStr_(v.dba_name) + ' (' + rec.market + ')',
          htmlBody: vevEmailHtml_(rec), body: vevEmailText_(rec), attachments: [pdf.blob] });
      }
      made.push({ eval_id: rec.eval_id, vendor: vevStr_(v.dba_name), received: received,
                  market: rec.market, vendor_id: rec.vendor_id, flags: rec.flags.length, pdf_url: rec.pdf_url });
      done[key] = true;
    } catch (e) {
      failed.push({ vendor: biz, received: received, error: String(e && e.message || e) });
    }
  }

  return vdOut_({ ok: true, made: made.length, skipped: skipped, failed: failed,
                  folder: vevFolder_().getUrl(), sends_as: vevWhoAmI().sends_as, evaluations: made });
}

// Run this one straight from the editor when the hub is not handy.
function vevBackfillNow() {
  var r = vevBackfill_({ force: false, email: false, limit: 50 });
  var t = r.getContent ? r.getContent() : JSON.stringify(r);
  Logger.log(t);
  return t;
}


// Used by a forced backfill: clear the row for one received|vendor key and send
// its PDF to the Drive trash, so a re-run leaves one record, not two.
function vevDropExisting_(sh, key) {
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var iRec = VEV_HEADERS.indexOf('received'), iVen = VEV_HEADERS.indexOf('vendor'), iPdf = VEV_HEADERS.indexOf('pdf_url');
  var rng = sh.getRange(2, 1, last - 1, VEV_HEADERS.length), vals = rng.getValues(), n = 0;
  for (var i = vals.length - 1; i >= 0; i--) {
    var k = vevWhen_(vals[i][iRec]) + '|' + vevStr_(vals[i][iVen]).toLowerCase();
    if (k !== key) continue;
    var url = vevStr_(vals[i][iPdf]);
    if (url) { try { var mm = /\/d\/([^\/]+)/.exec(url); if (mm) DriveApp.getFileById(mm[1]).setTrashed(true); } catch (te) {} }
    sh.deleteRow(i + 2);
    n++;
  }
  return n;
}

// ------------------------------------------------------------ list ---------

function vevList_(data) {
  var sh = vevSheet_();
  var last = sh.getLastRow();
  if (last < 2) return vdOut_({ ok: true, evaluations: [] });
  var vals = sh.getRange(2, 1, last - 1, VEV_HEADERS.length).getValues();
  var vid = vevStr_(data.vendor_id);
  var rows = [];
  vals.forEach(function (r) {
    var o = {};
    // Sheets parses the received stamp back into a Date, which stringifies as
    // 'Sun Sep 20 2026 12:43:00 GMT-0700 (...)'. Normalise it, or the hub shows
    // that to a person and the sort below runs on the wrong text.
    VEV_HEADERS.forEach(function (h, i) { o[h] = (h === 'received') ? vevWhen_(r[i]) : vevStr_(r[i]); });
    if (!o.eval_id) return;
    if (vid && o.vendor_id !== vid) return;
    rows.push(o);
  });
  // Newest first. eval_id breaks a tie and covers any row whose stamp is blank.
  rows.sort(function (a, b) {
    if (a.received !== b.received) return a.received < b.received ? 1 : -1;
    return a.eval_id < b.eval_id ? 1 : -1;
  });
  return vdOut_({ ok: true, evaluations: rows.slice(0, Number(data.limit) || 200) });
}
