// ============================================================
// JotformFeeds.gs - Jotform submissions on the Ops Hub (Sep 24 2026)
//
// Every Jotform the team still uses has its own Google Sheets integration
// (set in the Jotform builder, Settings > Integrations > Google Sheets,
// account citywideoflasvegas@gmail.com = the same Google account as
// citywidenv@cwfs-nv.com). Jotform writes one row per submission into a
// sheet it owns, tab "Form responses". Submissions stay in Jotform; the
// sheet is a copy, and this module only ever READS those sheets.
//
// The registry of feeds is a tab (Feeds) on its own book, CW Jotform Feeds
// (script property JF_SHEET_ID). Adding a form = add a Google Sheets
// integration in Jotform, then add one row on the Feeds tab. No deploy.
//
// Kinds (team passcode, prefix jf_):
//   jf_feeds  -> {ok, feeds:[{slug,label,group,account,form_id,sheet_url,form_url,
//                 alert, total, d7, d30, last, last_nice, last_who, last_where}]}
//   jf_list   -> {slug, days?, limit?} -> {ok, feed, cols:[..], rows:[{id,when,when_nice,who,where,
//                 title,summary,photos:[..],url,fields:{header:value}}]}
//   jf_setup  -> creates the registry book + the Jotform Submissions Drive folder,
//                seeds JF_SEED (only rows whose slug is missing), files the synced
//                sheets in that folder. Idempotent. Also runnable as jfSetupRun().
//
// Alerts: Alerts.gs calls jfAlertItems_(accounts, idx) and shows a feed on the
// hub Alerts card only when its Feeds row has something in the alert column:
//   workreq  -> a client asked for work (CCCNV site work requests)
//   workdone -> a completed work order report (off by default)
//   review   -> anything else worth a check-off
// Everything else is review-only on forms.html / form-view.html.
// ============================================================
var JF_TAB = 'Feeds';
var JF_HEAD = ['slug', 'label', 'group', 'account', 'form_id', 'sheet_id', 'tab', 'alert', 'region',
               'who_col', 'where_col', 'summary_col', 'fsm_col', 'hidden', 'notes'];
var JF_FOLDER_TEAM = '1j6EKIby3zJDTyvzw-iYSrq8b6DJ5i_MH';   // Team Portal > Team and Admin (registry book lives here)
var JF_TZ = 'America/Los_Angeles';
var JF_CACHE_FEEDS = 180;   // seconds
var JF_CACHE_LIST = 60;
var JF_MAX_ROWS = 400;      // most rows one jf_list reply carries

// slug, label, group, account, form_id, sheet_id, alert, region, notes
var JF_SEED = [
  ['ni_lv',      'Night Manager Inspection (Las Vegas)',      'Night Ops', '',                          '233486327771060', '1RHnq3Yu_Olp7851f_guFffrtCyh04LWSYPVt2ASGNZA', '',        'Las Vegas',       'Old Jotform. The hub night-inspection.html page is the replacement.'],
  ['ni_nnv',     'Night Manager Inspection (Northern Nevada)','Night Ops', '',                          '261328145353151', '1qjI9yquxROKR4fy2kcWOKFN9xKNNb6k8lHVEqiV1ZVQ', '',        'Northern Nevada', ''],
  ['nm_supply',  'Night Manager Supply Orders',               'Night Ops', '',                          '251408022161140', '1ZoiiVEfu3S-6eQpFDERq-e6XfTquqrsAalpy9Q2GPvk', '',        'Las Vegas',       ''],
  ['cccnv_req',  'CCCNV Site Work Requests',                  'Work',      'Comprehensive Cancer Centers', '252935932465163', '1n3Vjd3z-bOZ_aGVVgWWczBd5xMqiZIjUgXefGYt1Ygc', 'workreq', 'Las Vegas',    'Client staff file these. Alerts go to the FSM for the CCCNV site.'],
  ['handyman_wo','Handyman Work Orders (completed)',          'Work',      '',                          '240175011302033', '1iscQlU3CVZ1v5WLGSH5I2ZNU_7vN3pfGvOfaLR_-xZw', '',        'Las Vegas',       'The office bills from the other tabs of this sheet. Put workdone in alert to notify the requesting FSM.'],
  ['arroweye',   'Arroweye Porter Check-In / Check-Out',      'Site checklists', 'Arroweye Production', '261766991201057', '1qDEudi0-lCdzHxFvIOPrGvVMn02nf93ApmryVHK49eY', '',     'Las Vegas',       ''],
  ['kens_shift', "Ken's Foods End of Shift Checklist",        'Site checklists', "Ken's Foods",         '260535045408049', '1gTb76EEzDc77BbtyiUlso0InFxv5DHIQX2OgcGro19c', '',     'Las Vegas',       ''],
  ['kens_area',  "Ken's Foods Area Cleaning Checklist",       'Site checklists', "Ken's Foods",         '262447669553066', '1rtuj54Qx6BHqkjS3sKvSSyGh5oSC4iPKE1syN4Ndhus', '',     'Las Vegas',       ''],
  ['infinity',   'Infinity Hospice In Patient Unit Checklist','Site checklists', 'Infinity Hospice',    '250616285458160', '1XJEgz5LIvTp2r8IfY7i20Ocaz7FOvPBBE-azOajJ7q4', '',     'Las Vegas',       ''],
  ['southridge', 'Southridge HOA Porter Visit Recap',         'Site checklists', 'Southridge HOA',      '250137910913149', '11EWW3GH3u1Fucc1HPuG_TOwRMWV4GzIiS7tiVAWJRis', '',     'Las Vegas',       ''],
  ['sands',      "Sand's Kitchen Communication and Feedback", 'Client feedback', "Sand's Kitchen",      '262526132580150', '1oFjaybH7HPqGDxT2l0ILY6EGvXpwx6XPXNVGsjxAbTk', '',     'Las Vegas',       ''],
  ['stile',      'Stile Aesthetic Feedback Form',             'Client feedback', 'Stile Aesthetic',     '260467241313046', '1SNfrKMQ0iiXELb16tZZfjvgIEeYs7GlFSJKqP9Frj2o', '',     'Las Vegas',       ''],
  ['cfs_supply', 'Center for Sight Supply Orders',            'Supplies',  'Center for Sight',          '241717318584159', '1xXeXJzSYMBDRMb2k51DASSh6pT0P9I032R1aVteB9F0', '',        'Las Vegas',       ''],
  ['vendor_sup', 'Vendor Supplies and Equipment',             'Supplies',  '',                          '233504769775065', '14G3uPSAaxJMvlOcs2xZyNxGp7fzXW0UP6iv4STNn5po', '',        '',                ''],
  ['field_sup',  'Supply Item Requests (Field Sales)',        'Supplies',  '',                          '240596164431052', '1JV9Veehl2ELG7sbDLFDV3bOOfexwgJpp1p0yAQfySos', '',        '',                ''],
  ['fsm_weekly', 'FSM Weekly Operations Data',                'Team',      '',                          '252717322371049', '139uxKRLCohdCC8nyMBG2pGfNn6Nd2eu52g67wDsu-Kg', '',        '',                ''],
  ['shipto',     'New Ship To Requests',                      'Team',      '',                          '251336133643148', '1REaMUaCGjd2rhdFh-sB9AUlLNhjDVIWWuy90N_KFA8Y', '',        '',                '']
];

function jfDispatch(d) {
  if (String(d.passcode || '') !== PASSCODE) return _json({ ok: false, error: 'Wrong passcode.' });
  var kind = String(d.kind || '');
  try {
    if (kind === 'jf_feeds') return _json(jfFeeds_(d));
    if (kind === 'jf_list') return _json(jfList_(d));
    if (kind === 'jf_setup') return _json({ ok: true, report: jfSetup_() });
  } catch (e) {
    return _json({ ok: false, error: String(e && e.message || e) });
  }
  return _json({ ok: false, error: 'Unknown jf kind ' + kind });
}

// ------------------------------------------------------------ plumbing -----
function jfStr_(v) { return (v === null || v === undefined) ? '' : String(v).trim(); }
function jfIso_(d) { return d ? Utilities.formatDate(d, JF_TZ, "yyyy-MM-dd'T'HH:mm:ss") : ''; }
function jfNice_(d) { return d ? Utilities.formatDate(d, JF_TZ, 'MMM d, h:mm a') : ''; }
function jfDate_(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  var s = jfStr_(v);
  if (!s) return null;
  var m;
  // Jotform writes "2026-09-09 8:35:36" (form time zone) and "09-09-2026"
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/))) {
    return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  }
  if ((m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/))) return new Date(+m[3], +m[1] - 1, +m[2]);
  var d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
function jfBook_() {
  var id = PropertiesService.getScriptProperties().getProperty('JF_SHEET_ID');
  if (!id) throw new Error('Jotform feeds are not set up yet (script property JF_SHEET_ID). Run jfSetupRun once.');
  return SpreadsheetApp.openById(id);
}
function jfRows_(sh) {
  var last = sh.getLastRow(), lastC = sh.getLastColumn();
  if (last < 2 || lastC < 1) return { head: [], rows: [] };
  var vals = sh.getRange(1, 1, last, lastC).getValues();
  var head = vals[0].map(jfStr_);
  var rows = [];
  for (var i = 1; i < vals.length; i++) {
    var o = { _row: i + 1 }, any = false;
    for (var c = 0; c < head.length; c++) {
      if (!head[c]) continue;
      var v = vals[i][c];
      if (v !== '' && v !== null && v !== undefined) any = true;
      o[head[c]] = v;
    }
    if (any) rows.push(o);
  }
  return { head: head, rows: rows };
}
// Registry rows, hidden ones dropped unless all=true.
function jfRegistry_(all) {
  var sh = jfBook_().getSheetByName(JF_TAB);
  if (!sh) return [];
  var out = [];
  jfRows_(sh).rows.forEach(function (r) {
    var f = {};
    JF_HEAD.forEach(function (h) { f[h] = jfStr_(r[h]); });
    if (!f.slug || !f.sheet_id) return;
    f.hidden = /^(true|yes|1)$/i.test(f.hidden);
    if (f.hidden && !all) return;
    f.form_url = f.form_id ? 'https://form.jotform.com/' + f.form_id : '';
    f.sheet_url = 'https://docs.google.com/spreadsheets/d/' + f.sheet_id + '/edit';
    f.inbox_url = f.form_id ? 'https://www.jotform.com/inbox/' + f.form_id : '';
    out.push(f);
  });
  return out;
}
function jfFeedBySlug_(slug) {
  var list = jfRegistry_(true);
  for (var i = 0; i < list.length; i++) if (list[i].slug === slug) return list[i];
  return null;
}
// The tab Jotform writes. "Form responses" by default; otherwise the first tab
// carrying a Submission ID header; otherwise the first tab.
function jfSyncTab_(feed) {
  var ss = SpreadsheetApp.openById(feed.sheet_id);
  if (feed.tab) { var t = ss.getSheetByName(feed.tab); if (t) return t; }
  var fr = ss.getSheetByName('Form responses');
  if (fr) return fr;
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var lc = sheets[i].getLastColumn();
    if (!lc) continue;
    var head = sheets[i].getRange(1, 1, 1, lc).getValues()[0].map(jfStr_);
    if (head.indexOf('Submission ID') >= 0) return sheets[i];
  }
  return sheets[0];
}

// ------------------------------------------------------------ shaping -----
// Which column plays which role. Registry overrides win; otherwise header text.
function jfRoles_(head, feed) {
  var find = function (re, list) { for (var i = 0; i < list.length; i++) if (re.test(list[i])) return list[i]; return ''; };
  var pick = function (over, re) { return (over && head.indexOf(over) >= 0) ? over : find(re, head); };
  var r = {};
  r.when = head.indexOf('Submission Date') >= 0 ? 'Submission Date' : pick('', /^(Date|Date and Time|Submission Date|Date of Visit|Inspection Date)$/i) || find(/date/i, head);
  r.id = head.indexOf('Submission ID') >= 0 ? 'Submission ID' : '';
  r.url = head.indexOf('Submission URL') >= 0 ? 'Submission URL' : '';
  // names: Jotform splits "Name - First Name" / "Name - Last Name"
  r.first = pick(feed.who_col, /^(Name|Your Name|Name of Person Submitting:?|Sender Name|Night Manager|Porter Name|Employee Name|Full Name)( - First Name)?$/i);
  if (r.first && head.indexOf(r.first.replace(/ - First Name$/, '') + ' - Last Name') >= 0) r.last = r.first.replace(/ - First Name$/, '') + ' - Last Name';
  if (!r.first) r.first = find(/ - First Name$/, head);
  if (r.first && !r.last) { var ln = r.first.replace(/ - First Name$/, '') + ' - Last Name'; if (head.indexOf(ln) >= 0) r.last = ln; }
  if (!r.first) r.first = find(/^(Name|Your Name|Who .*name)/i, head);
  r.where = pick(feed.where_col, /^(Location \/ Account|Select Site|Site|Account|Building|Location|Property|Ship To|What is the name of the site.*|Which (site|building|location).*)$/i) || find(/site|account|building|location/i, head);
  r.title = find(/^(Report Type|Inspection Type|Maintenance Task Type|Which shift\??|Select your shift|Are you checking IN or OUT\??|Type of (Inspection|Request)|Request Type|Item Requested)$/i, head);
  r.summary = pick(feed.summary_col, /^(Summary|Please provide more details.*|Please provide a brief description.*|Feedback, Issues, or Anything You Noticed|Anything additional.*|Comments|Notes|Feedback|Report|Details|Description|What did you notice.*)$/i) || find(/summary|details|description|feedback|comments|notes/i, head);
  r.fsm = feed.fsm_col && head.indexOf(feed.fsm_col) >= 0 ? feed.fsm_col : find(/^(Who at City Wide Requested This Work\??|FSM|FSM Email|Requested By)$/i, head);
  return r;
}
function jfIsUpload_(v) { return /^https?:\/\/(www\.)?jotform\.com\/(uploads|widget-uploads)\//i.test(jfStr_(v)); }
function jfShape_(row, head, roles) {
  var g = function (k) { return k ? jfStr_(row[k]) : ''; };
  var when = jfDate_(row[roles.when]);
  var who = [g(roles.first), g(roles.last)].filter(Boolean).join(' ');
  var photos = [], fields = {};
  head.forEach(function (h) {
    if (!h || h === 'Submission ID' || h === 'Submission URL') return;
    var v = row[h];
    if (v instanceof Date) v = Utilities.formatDate(v, JF_TZ, 'yyyy-MM-dd h:mm a');
    v = jfStr_(v);
    if (!v) return;
    if (jfIsUpload_(v) || (/\n/.test(v) && v.split(/\s+/).every(jfIsUpload_))) { v.split(/\s+/).forEach(function (u) { if (jfIsUpload_(u)) photos.push(u); }); return; }
    fields[h] = v;
  });
  var summary = g(roles.summary);
  return {
    id: g(roles.id) || String(row._row),
    when: jfIso_(when), when_nice: jfNice_(when), ts: when ? when.getTime() : 0,
    who: who, where: g(roles.where), title: g(roles.title),
    summary: summary.length > 600 ? summary.slice(0, 600) + '...' : summary,
    fsm: g(roles.fsm),
    photos: photos, url: g(roles.url),
    fields: fields
  };
}
// All rows of one feed shaped and sorted newest first. Cached briefly.
function jfLoad_(feed) {
  var cache = null, key = 'jf_rows_' + feed.slug;
  try { cache = CacheService.getScriptCache(); var hit = cache.get(key); if (hit) return JSON.parse(hit); } catch (e) { cache = null; }
  var sh = jfSyncTab_(feed);
  var data = jfRows_(sh);
  var roles = jfRoles_(data.head, feed);
  var rows = data.rows.map(function (r) { return jfShape_(r, data.head, roles); });
  rows.sort(function (a, b) { return b.ts - a.ts; });
  var out = { cols: data.head.filter(Boolean), roles: roles, rows: rows };
  try { var s = JSON.stringify(out); if (s.length < 95000) cache.put(key, s, JF_CACHE_LIST); } catch (e) {}
  return out;
}

// ------------------------------------------------------------ handlers -----
function jfFeeds_(d) {
  var cache = null;
  var fresh = !!(d && d.fresh);
  try { cache = CacheService.getScriptCache(); if (!fresh) { var hit = cache.get('jf_feeds_v1'); if (hit) return JSON.parse(hit); } } catch (e) { cache = null; }
  var now = Date.now();
  var feeds = jfRegistry_(false).map(function (f) {
    var o = { slug: f.slug, label: f.label, group: f.group, account: f.account, region: f.region, alert: f.alert,
              form_id: f.form_id, form_url: f.form_url, sheet_url: f.sheet_url, inbox_url: f.inbox_url, notes: f.notes,
              total: 0, d7: 0, d30: 0, last: '', last_nice: '', last_who: '', last_where: '', error: '' };
    // per-feed summary cached longer than the aggregate, so one slow sheet does not
    // make every landing page load slow
    var pk = 'jf_sum_' + f.slug, hit2 = null;
    try { if (cache && !fresh) hit2 = cache.get(pk); } catch (e) { hit2 = null; }
    if (hit2) { var s2 = JSON.parse(hit2); Object.keys(s2).forEach(function (k) { o[k] = s2[k]; }); return o; }
    try {
      var data = jfLoad_(f);
      o.total = data.rows.length;
      data.rows.forEach(function (r) {
        if (!r.ts) return;
        var age = now - r.ts;
        if (age <= 7 * 864e5) o.d7++;
        if (age <= 30 * 864e5) o.d30++;
      });
      var top = data.rows[0];
      if (top) { o.last = top.when; o.last_nice = top.when_nice; o.last_who = top.who; o.last_where = top.where || top.title; }
      try { cache.put(pk, JSON.stringify({ total: o.total, d7: o.d7, d30: o.d30, last: o.last, last_nice: o.last_nice, last_who: o.last_who, last_where: o.last_where }), 600); } catch (e) {}
    } catch (e) { o.error = String(e && e.message || e).slice(0, 160); }
    return o;
  });
  var regUrl = ''; try { regUrl = jfBook_().getUrl(); } catch (e) {}
  var out = { ok: true, feeds: feeds, registry_url: regUrl, generated: jfIso_(new Date()) };
  try { cache.put('jf_feeds_v1', JSON.stringify(out), JF_CACHE_FEEDS); } catch (e) {}
  return out;
}
function jfList_(d) {
  var slug = jfStr_(d.slug);
  var feed = jfFeedBySlug_(slug);
  if (!feed) return { ok: false, error: 'No feed called ' + slug + '. Check the Feeds tab.' };
  var days = Number(d.days) || 0;
  var limit = Math.min(Number(d.limit) || JF_MAX_ROWS, JF_MAX_ROWS);
  var q = jfStr_(d.q).toLowerCase();
  var data = jfLoad_(feed);
  var cut = days ? Date.now() - days * 864e5 : 0;
  var rows = data.rows.filter(function (r) {
    if (cut && r.ts && r.ts < cut) return false;
    if (q) {
      var hay = (r.who + ' ' + r.where + ' ' + r.title + ' ' + r.summary + ' ' + Object.keys(r.fields).map(function (k) { return r.fields[k]; }).join(' ')).toLowerCase();
      if (hay.indexOf(q) < 0) return false;
    }
    return true;
  });
  var total = rows.length;
  rows = rows.slice(0, limit);
  return { ok: true, feed: { slug: feed.slug, label: feed.label, group: feed.group, account: feed.account, region: feed.region,
                             form_url: feed.form_url, sheet_url: feed.sheet_url, inbox_url: feed.inbox_url, alert: feed.alert, notes: feed.notes },
           cols: data.cols, roles: data.roles, rows: rows, total: total, all: data.rows.length, generated: jfIso_(new Date()) };
}

// ------------------------------------------------------------ alerts -----
// Called from Alerts.gs alList_. Only feeds with an alert value. Keys are
// jf:<slug>:<submission id>, so a check-off survives resyncs.
function jfAlertItems_(accounts, idx) {
  var items = [];
  var feeds;
  try { feeds = jfRegistry_(false).filter(function (f) { return /^(workreq|workdone|review)$/.test(f.alert); }); } catch (e) { return items; }
  feeds.forEach(function (f) {
    var data;
    try { data = jfLoad_(f); } catch (e) { return; }
    data.rows.forEach(function (r) {
      if (!r.ts || !alFresh_(new Date(r.ts), AL_DAYS)) return;
      var fsm = '', acct = { fsm: '', name: '', id: '', region: '', how: '', cands: [] };
      if (r.fsm) fsm = alFsmKey_(r.fsm);
      if (!fsm) {
        var text = (f.account ? f.account + ' ' : '') + (r.where || '');
        acct = alAcct_(text, f.region, accounts, idx);
        fsm = acct.fsm;
      }
      var head = (f.account ? f.account + (r.where ? ' - ' + r.where : '') : (r.where || f.label));
      var bits = [];
      if (r.title) bits.push(r.title);
      if (r.summary) bits.push(r.summary.length > 220 ? r.summary.slice(0, 220) + '...' : r.summary);
      Object.keys(r.fields).forEach(function (k) {
        if (/emergency|when|must\/can be done|priority|urgent/i.test(k) && bits.length < 4) bits.push(k.replace(/\?$/, '') + ': ' + r.fields[k]);
      });
      items.push({
        key: 'jf:' + f.slug + ':' + r.id, type: f.alert,
        fsm: fsm,
        region: f.region || acct.region,
        when: r.when, when_nice: r.when_nice,
        from: r.who || f.label,
        about: head + (acct.name && alNorm_(acct.name) !== alNorm_(head) ? ' (matched to ' + acct.name + ')' : ''),
        typed: head, acct_id: acct.id, acct_name: acct.name, match: acct.how, cands: acct.cands,
        summary: bits.join(' - '),
        email: r.fields['Email'] || r.fields['E-mail'] || '', phone: r.fields['Phone'] || r.fields['Phone Number'] || '',
        link: 'form-view.html?f=' + encodeURIComponent(f.slug) + '#' + encodeURIComponent(r.id),
        ref: r.id, feed: f.slug, feed_label: f.label
      });
    });
  });
  return items;
}

// ------------------------------------------------------------ setup -----
function jfSetup_() {
  var report = [];
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('JF_SHEET_ID');
  var ss;
  if (id) { ss = SpreadsheetApp.openById(id); report.push('registry book exists ' + id); }
  else {
    ss = SpreadsheetApp.create('CW Jotform Feeds');
    id = ss.getId();
    props.setProperty('JF_SHEET_ID', id);
    try { DriveApp.getFileById(id).moveTo(DriveApp.getFolderById(JF_FOLDER_TEAM)); } catch (e) { report.push('folder move failed ' + e); }
    try { ss.addEditor('tjroberts@gocitywide.com'); } catch (e) {}
    report.push('registry book created ' + id);
  }
  var sh = ss.getSheetByName(JF_TAB);
  if (!sh) {
    sh = ss.getSheets()[0].getName() === 'Sheet1' ? ss.getSheets()[0].setName(JF_TAB) : ss.insertSheet(JF_TAB);
    sh.getRange(1, 1, 1, JF_HEAD.length).setValues([JF_HEAD]).setFontWeight('bold').setBackground('#2D2A26').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
    report.push('Feeds tab created');
  }
  var have = {};
  jfRows_(sh).rows.forEach(function (r) { if (jfStr_(r.slug)) have[jfStr_(r.slug)] = true; });
  var add = [];
  JF_SEED.forEach(function (s) {
    if (have[s[0]]) return;
    // slug, label, group, account, form_id, sheet_id, tab, alert, region, who_col, where_col, summary_col, fsm_col, hidden, notes
    add.push([s[0], s[1], s[2], s[3], s[4], s[5], '', s[6], s[7], '', '', '', '', '', s[8]]);
  });
  if (add.length) { sh.getRange(sh.getLastRow() + 1, 1, add.length, JF_HEAD.length).setValues(add); report.push('seeded ' + add.length + ' feeds'); }
  else report.push('nothing to seed');
  // File the synced sheets in Team Portal > Jotform Submissions so they are easy to find.
  try {
    var team = DriveApp.getFolderById(JF_FOLDER_TEAM);
    var root = team.getParents().hasNext() ? team.getParents().next() : DriveApp.getRootFolder();
    var it = root.getFoldersByName('Jotform Submissions');
    var folder = it.hasNext() ? it.next() : root.createFolder('Jotform Submissions');
    props.setProperty('JF_FOLDER_ID', folder.getId());
    var moved = 0;
    jfRegistry_(true).forEach(function (f) {
      try {
        var file = DriveApp.getFileById(f.sheet_id);
        var inIt = false, ps = file.getParents();
        while (ps.hasNext()) if (ps.next().getId() === folder.getId()) inIt = true;
        if (!inIt) { file.moveTo(folder); moved++; }
      } catch (e) { report.push(f.slug + ' :: cannot file sheet (' + String(e).slice(0, 80) + ')'); }
    });
    report.push('Jotform Submissions folder ' + folder.getId() + ', moved ' + moved);
  } catch (e) { report.push('folder step failed ' + e); }
  try { CacheService.getScriptCache().remove('jf_feeds_v1'); } catch (e) {}
  return report;
}
function jfSetupRun() { Logger.log(jfSetup_().join('\n')); }
// Editor helper: one line per feed with counts, or the error that feed throws.
function jfSelfTest() {
  var r = jfFeeds_({ fresh: 1 });
  var lines = r.feeds.map(function (f) { return f.slug + ' | total ' + f.total + ' | 7d ' + f.d7 + ' | 30d ' + f.d30 + ' | last ' + f.last_nice + ' | ' + (f.error || 'ok'); });
  var a = jfAlertItems_([], null);
  lines.push('alert items: ' + a.length);
  Logger.log(lines.join('\n'));
  return lines.join('\n');
}
