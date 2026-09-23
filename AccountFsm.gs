// ============================================================
// AccountFsm.gs - which FSM owns each account, from the CRM export (Sep 23 2026)
// File in the CW Solicitations Apps Script project. Reached through alDispatch in
// Alerts.gs (alerts_ prefix, team passcode), so doPost needs no new router line.
//
// Why: supply reports and shop orders name a building in free text and carried no
// FSM, so many landed in "No FSM matched". The Dynamics view "Active Customers - JS
// and OS Clients" exported to Excel is the source of truth for who owns what. The
// Admin Hub page account-fsm.html reads that workbook in the browser and sends the
// rows here. This file keeps one row per CRM account on the "Account FSM" tab of the
// CW Solicitations book, and the alerts match reports against it.
//
// Tabs (CW Solicitations book, created on first use)
//   Account FSM     one row per CRM account, keyed on the CRM account id (GUID)
//   Alert Assign    one row per alert someone reassigned on the hub
//   Account FSM Log every import and every hand change: when, who, what, old, new
//
// Rules
//   - CRM wins when CRM changes. If someone reassigns an account on the hub, the hub
//     choice holds until CRM itself changes that account's FSM; then CRM takes over.
//   - No FSM in CRM: best guess from the other accounts in the same ZIP code, else
//     the account's DOO. Marked as a guess so the admin can confirm it.
//   - Nothing is deleted. Accounts missing from a later export are marked
//     in_last_import = FALSE and still match.
//
// Kinds (all through alDispatch)
//   alerts_acct_list    -> {ok, accounts:[...], roster, last}
//   alerts_acct_import  {rows, dry, by, file} -> {ok, summary}   dry = preview only
//   alerts_acct_set     {crm_id, fsm, by, remove_alias?} -> {ok, account}
//   alerts_assign       {key, fsm, crm_id?, forward?, alias?, by} -> {ok, fsm, account}
// ============================================================
var AF_TAB = 'Account FSM';
var AF_HEAD = ['crm_id', 'name', 'region', 'bc_no', 'fsm', 'fsm_source', 'crm_fsm', 'night_manager', 'doo',
  'industry', 'address1', 'address2', 'city', 'state', 'zip', 'rel_js', 'rel_os', 'aliases', 'in_last_import',
  'crm_modified', 'imported_at', 'updated_by', 'updated_at'];
var AF_ASSIGN_TAB = 'Alert Assign';
var AF_ASSIGN_HEAD = ['alert_key', 'fsm', 'crm_id', 'by', 'at', 'note'];
var AF_LOG_TAB = 'Account FSM Log';
var AF_LOG_HEAD = ['when', 'who', 'action', 'crm_id', 'account', 'field', 'old', 'new'];
var AF_PROP_LAST = 'AF_LAST_IMPORT';
// CRM spells some names differently from the roster. first name in CRM -> roster key
var AF_FSM_ALIAS = { alejandro: 'alex', alexander: 'alex', joshua: 'josh', theodore: 'tj', curtis: 'tj' };
var AF_NNV_CITIES = ['reno', 'sparks', 'carson city', 'gardnerville', 'minden', 'fernley', 'dayton', 'mccarran',
  'verdi', 'sun valley', 'washoe valley', 'incline village', 'stateline', 'fallon', 'yerington', 'truckee', 'south lake tahoe'];
var AF_STOP = {};
('the and of llc inc co corp ltd dba at by a an nv usa ste suite unit fl floor bldg las vegas dr st ave blvd rd ln way ct ' +
 'pkwy hwy cir pl ter trl lp loop n s e w ne nw se sw pmb all main account accounts').split(' ').forEach(function (w) { AF_STOP[w] = 1; });

// ------------------------------------------------------------ plumbing -----
function afSS_() { return SpreadsheetApp.openById(SHEET_ID); }
function afTab_(ss, name, head) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, head.length).setValues([head])
      .setFontWeight('bold').setBackground('#2D2A26').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
  }
  return sh;
}
function afNow_() { return Utilities.formatDate(new Date(), AL_TZ, 'yyyy-MM-dd HH:mm'); }
function afTrue_(v) { return v === true || String(v).toUpperCase() === 'TRUE'; }
function afZip5_(z) { var m = /(\d{5})/.exec(alStr_(z)); return m ? m[1] : ''; }
function afRoster_() { return alRoster_(); }
function afRosterName_(key) { return key && FSM_ROSTER[key] ? FSM_ROSTER[key].name : ''; }

// "Alejandro Manon" -> alex, "TJ Roberts - NNNV" -> tj, "" -> ''. Unknown people -> ''.
function afFsmKey_(v) {
  var s = alStr_(v).replace(/\s+-\s+.*$/, '').trim();
  if (!s) return '';
  var first = s.toLowerCase().split(/\s+/)[0];
  if (AF_FSM_ALIAS[first]) return AF_FSM_ALIAS[first];
  return alFsmKey_(s);
}
function afSameName_(a, b) { return alStr_(a).toLowerCase().replace(/\s+/g, ' ') === alStr_(b).toLowerCase().replace(/\s+/g, ' '); }

// Region from the BC customer number (LV 0108..., NNV 0111...), then city, then FSM.
function afRegion_(r) {
  var bc = alStr_(r.bc_no);
  if (/^0111/.test(bc)) return 'Northern Nevada';
  if (/^0108/.test(bc)) return 'Las Vegas';
  var city = alStr_(r.city).toLowerCase();
  if (AF_NNV_CITIES.indexOf(city) >= 0) return 'Northern Nevada';
  if (/nnnv|northern/i.test(alStr_(r.doo)) || afFsmKey_(r.fsm) === 'jeremy') return 'Northern Nevada';
  return 'Las Vegas';
}

function afRead_(ss) {
  var sh = afTab_(ss, AF_TAB, AF_HEAD);
  var head = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(alStr_);
  // add any column this version knows about and the tab does not have yet (append only)
  var missing = AF_HEAD.filter(function (h) { return head.indexOf(h) < 0; });
  if (missing.length) {
    sh.getRange(1, head.length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold').setBackground('#2D2A26').setFontColor('#FFFFFF');
    head = head.concat(missing);
  }
  var rows = [];
  var last = sh.getLastRow();
  if (last >= 2) {
    var vals = sh.getRange(2, 1, last - 1, head.length).getValues();
    for (var i = 0; i < vals.length; i++) {
      var o = { _row: i + 2 };
      for (var c = 0; c < head.length; c++) if (head[c]) o[head[c]] = vals[i][c];
      if (!alStr_(o.crm_id) && !alStr_(o.name)) continue;
      rows.push(o);
    }
  }
  return { sh: sh, head: head, rows: rows };
}
function afRowVals_(head, o) {
  return head.map(function (h) {
    var v = o[h];
    if (v === undefined || v === null) return '';
    if (h === 'in_last_import') return afTrue_(v);
    return v;
  });
}
function afLog_(ss, lines) {
  if (!lines.length) return;
  var sh = afTab_(ss, AF_LOG_TAB, AF_LOG_HEAD);
  var start = sh.getLastRow() + 1;
  var rows = lines.map(function (l) {
    return [afNow_(), alStr_(l.who).slice(0, 60), l.action, alStr_(l.crm_id), alStr_(l.account).slice(0, 120),
            alStr_(l.field), alStr_(l.old).slice(0, 300), alStr_(l['new']).slice(0, 300)];
  });
  sh.getRange(start, 1, rows.length, AF_LOG_HEAD.length).setNumberFormat('@').setValues(rows);
}
function afAliases_(o) { return alStr_(o.aliases).split('|').map(alStr_).filter(String); }

// ------------------------------------------------------------ list -----
function afList_(d) {
  var ss = afSS_();
  var t = afRead_(ss);
  var accounts = t.rows.map(function (r) {
    return {
      id: alStr_(r.crm_id), name: alStr_(r.name), region: alStr_(r.region), bc: alStr_(r.bc_no),
      fsm: alStr_(r.fsm), src: alStr_(r.fsm_source), crm_fsm: alStr_(r.crm_fsm), nm: alStr_(r.night_manager),
      doo: alStr_(r.doo), addr: alStr_(r.address1), city: alStr_(r.city), zip: alStr_(r.zip),
      rel: [alStr_(r.rel_js), alStr_(r.rel_os)].filter(String).join(' / '), aliases: afAliases_(r),
      in_last: r.in_last_import === '' ? true : afTrue_(r.in_last_import), by: alStr_(r.updated_by), at: alStr_(r.updated_at)
    };
  });
  var last = {};
  try { last = JSON.parse(PropertiesService.getScriptProperties().getProperty(AF_PROP_LAST) || '{}'); } catch (e) {}
  return { ok: true, accounts: accounts, roster: afRoster_(), last: last, sheet_url: ss.getUrl() + '#gid=' + t.sh.getSheetId() };
}

// ------------------------------------------------------------ import -----
function afImport_(d) {
  var incoming = d.rows || [];
  if (!incoming.length) return { ok: false, error: 'The file had no account rows.' };
  if (incoming.length > 5000) return { ok: false, error: 'Too many rows (' + incoming.length + '). Export one market at a time.' };
  var who = alStr_(d.by).slice(0, 60) || 'Unknown';
  var dry = !!d.dry;
  var lock = null;
  if (!dry) { lock = LockService.getScriptLock(); lock.waitLock(25000); }
  try {
    var ss = afSS_();
    var t = afRead_(ss);
    var byId = {}, byBc = {};
    t.rows.forEach(function (r) {
      if (alStr_(r.crm_id)) byId[alStr_(r.crm_id).toLowerCase()] = r;
      if (alStr_(r.bc_no)) byBc[alStr_(r.bc_no)] = r;
    });
    var now = afNow_();
    var seen = {}, regions = {};
    var sum = { total: 0, added: [], updated: 0, unchanged: 0, fsm_changes: [], kept_overrides: [], guessed: [],
                no_fsm: [], unknown_fsm: [], dropped: [], skipped: [], renamed: [] };
    var logs = [];
    var work = [];   // {o, ex, key, pending}
    incoming.forEach(function (x, i) {
      var id = alStr_(x.crm_id).toLowerCase();
      var name = alStr_(x.name);
      if (!name) { sum.skipped.push('Row ' + (i + 2) + ': no account name'); return; }
      if (!/^[0-9a-f-]{30,40}$/.test(id)) { sum.skipped.push(name + ': no CRM account id (was a column removed?)'); return; }
      if (seen[id]) { sum.skipped.push(name + ': listed twice in the file'); return; }
      seen[id] = 1;
      sum.total++;
      var ex = byId[id] || (alStr_(x.bc_no) && byBc[alStr_(x.bc_no)]) || null;
      var region = afRegion_(x);
      regions[region] = (regions[region] || 0) + 1;
      var crmText = alStr_(x.fsm);
      var key = afFsmKey_(crmText);
      if (crmText && !key) sum.unknown_fsm.push({ name: name, crm_fsm: crmText });
      var o = ex ? ex : { aliases: '' };
      var before = ex ? { fsm: alStr_(ex.fsm), src: alStr_(ex.fsm_source), name: alStr_(ex.name) } : null;
      var keepHub = ex && alStr_(ex.fsm_source) === 'hub' && afSameName_(ex.crm_fsm, crmText) && alStr_(ex.fsm);
      var copy = {
        crm_id: id, name: name, region: region, bc_no: alStr_(x.bc_no), crm_fsm: crmText,
        night_manager: alStr_(x.night_manager), doo: alStr_(x.doo), industry: alStr_(x.industry),
        address1: alStr_(x.address1), address2: alStr_(x.address2), city: alStr_(x.city), state: alStr_(x.state).toUpperCase(),
        zip: alStr_(x.zip), rel_js: alStr_(x.rel_js), rel_os: alStr_(x.rel_os), crm_modified: alStr_(x.crm_modified)
      };
      var nw = {};
      Object.keys(o).forEach(function (k) { nw[k] = o[k]; });
      Object.keys(copy).forEach(function (k) { nw[k] = copy[k]; });
      nw.in_last_import = true;
      nw.imported_at = now;
      var pending = false;
      if (keepHub) {
        nw.fsm = alStr_(ex.fsm); nw.fsm_source = 'hub';
        if (nw.fsm !== key) sum.kept_overrides.push({ name: name, region: region, fsm: afRosterName_(nw.fsm), crm_fsm: crmText || '(blank in CRM)' });
      } else if (key) {
        nw.fsm = key; nw.fsm_source = 'crm';
      } else {
        pending = true;
      }
      work.push({ o: nw, ex: ex, before: before, key: key, pending: pending });
    });
    if (!sum.total) return { ok: false, error: 'No usable rows. ' + sum.skipped.slice(0, 3).join(' ') };

    // ZIP neighbours, from every account in the file that CRM assigns
    var zipVotes = {};
    work.forEach(function (w) {
      if (w.pending || !w.o.fsm) return;
      if (w.o.fsm_source !== 'crm' && w.o.fsm_source !== 'hub') return;
      var z = w.o.region + '|' + afZip5_(w.o.zip);
      if (!afZip5_(w.o.zip)) return;
      zipVotes[z] = zipVotes[z] || {};
      zipVotes[z][w.o.fsm] = (zipVotes[z][w.o.fsm] || 0) + 1;
    });
    work.forEach(function (w) {
      if (!w.pending) return;
      var o = w.o;
      var z = afZip5_(o.zip), votes = zipVotes[o.region + '|' + z] || {};
      var ks = Object.keys(votes).sort(function (a, b) { return votes[b] - votes[a]; });
      var total = 0; ks.forEach(function (k) { total += votes[k]; });
      if (ks.length && (ks.length === 1 || votes[ks[0]] > votes[ks[1]])) {
        o.fsm = ks[0]; o.fsm_source = 'zip guess';
        sum.guessed.push({ name: o.name, region: o.region, zip: z, fsm: afRosterName_(ks[0]), how: votes[ks[0]] + ' of ' + total + ' accounts in ' + z });
      } else if (afFsmKey_(o.doo)) {
        o.fsm = afFsmKey_(o.doo); o.fsm_source = 'doo';
        sum.guessed.push({ name: o.name, region: o.region, zip: z, fsm: afRosterName_(o.fsm), how: 'no FSM nearby, sent to the DOO' });
      } else if (w.ex && alStr_(w.ex.fsm) && alStr_(w.ex.fsm_source) !== 'crm') {
        o.fsm = alStr_(w.ex.fsm); o.fsm_source = alStr_(w.ex.fsm_source);   // keep the earlier guess or hub pick
      } else {
        o.fsm = ''; o.fsm_source = '';
        sum.no_fsm.push({ name: o.name, region: o.region, zip: z });
      }
    });

    // diff for the preview and the log
    work.forEach(function (w) {
      var o = w.o;
      if (!w.ex) {
        sum.added.push({ name: o.name, region: o.region, fsm: afRosterName_(o.fsm), src: o.fsm_source });
        o.updated_by = who; o.updated_at = now;
        logs.push({ who: who, action: 'import add', crm_id: o.crm_id, account: o.name, field: 'fsm', old: '', 'new': o.fsm + ' (' + o.fsm_source + ')' });
        return;
      }
      var b = w.before;
      var changed = false;
      if (b.fsm !== alStr_(o.fsm)) {
        changed = true;
        sum.fsm_changes.push({ name: o.name, region: o.region, from: afRosterName_(b.fsm) || '(none)', to: afRosterName_(o.fsm) || '(none)', src: o.fsm_source, was_src: b.src });
        logs.push({ who: who, action: 'import fsm', crm_id: o.crm_id, account: o.name, field: 'fsm', old: b.fsm + ' (' + b.src + ')', 'new': o.fsm + ' (' + o.fsm_source + ')' });
      }
      if (b.name && b.name !== o.name) {
        changed = true;
        sum.renamed.push({ from: b.name, to: o.name });
        logs.push({ who: who, action: 'import rename', crm_id: o.crm_id, account: o.name, field: 'name', old: b.name, 'new': o.name });
        // the old name keeps matching: add it as an alias
        var al = afAliases_(o);
        if (al.map(alNorm_).indexOf(alNorm_(b.name)) < 0) { al.push(b.name); o.aliases = al.join(' | '); }
      }
      if (changed) { o.updated_by = who; o.updated_at = now; sum.updated++; } else sum.unchanged++;
    });

    // accounts on the tab, in a market this file covers, that are no longer in CRM's active list
    var dropLogs = [];
    t.rows.forEach(function (r) {
      var id = alStr_(r.crm_id).toLowerCase();
      if (seen[id] || !regions[alStr_(r.region)]) return;
      var matchedByBc = work.some(function (w) { return w.ex === r; });
      if (matchedByBc) return;
      if (r.in_last_import !== '' && !afTrue_(r.in_last_import)) return; // already marked
      sum.dropped.push({ name: alStr_(r.name), region: alStr_(r.region), fsm: afRosterName_(alStr_(r.fsm)) });
      if (!dry) { r.in_last_import = false; dropLogs.push({ who: who, action: 'import dropped', crm_id: id, account: r.name, field: 'in_last_import', old: 'TRUE', 'new': 'FALSE' }); }
    });

    sum.regions = regions;
    sum.added_n = sum.added.length;
    if (dry) return { ok: true, dry: true, summary: sum };

    // write: existing rows in place, new rows appended, one setValues each way
    var head = t.head;
    var existing = t.rows.map(function (r) { return r; });
    work.forEach(function (w) {
      if (w.ex) { Object.keys(w.o).forEach(function (k) { w.ex[k] = w.o[k]; }); }
    });
    if (existing.length) {
      var maxRow = 1;
      existing.forEach(function (r) { if (r._row > maxRow) maxRow = r._row; });
      var grid = t.sh.getRange(2, 1, maxRow - 1, head.length).getValues();
      existing.forEach(function (r) { grid[r._row - 2] = afRowVals_(head, r); });
      t.sh.getRange(2, 1, maxRow - 1, head.length).setValues(grid);
    }
    var adds = work.filter(function (w) { return !w.ex; }).map(function (w) { return afRowVals_(head, w.o); });
    if (adds.length) {
      var start = t.sh.getLastRow() + 1;
      t.sh.getRange(start, 1, adds.length, head.length).setValues(adds);
    }
    // text columns stay text (BC numbers keep their leading zero)
    var cBc = head.indexOf('bc_no') + 1, cZip = head.indexOf('zip') + 1;
    var lastRow = t.sh.getLastRow();
    if (lastRow >= 2) {
      if (cBc) t.sh.getRange(2, cBc, lastRow - 1, 1).setNumberFormat('@');
      if (cZip) t.sh.getRange(2, cZip, lastRow - 1, 1).setNumberFormat('@');
    }
    logs = logs.concat(dropLogs);
    logs.unshift({ who: who, action: 'import', crm_id: '', account: alStr_(d.file).slice(0, 120), field: 'rows',
                   old: '', 'new': sum.total + ' rows; ' + sum.added.length + ' new; ' + sum.fsm_changes.length + ' FSM changes; ' + sum.guessed.length + ' guessed; ' + sum.dropped.length + ' no longer in CRM' });
    afLog_(ss, logs);
    try {
      var props = PropertiesService.getScriptProperties();
      var last = {};
      try { last = JSON.parse(props.getProperty(AF_PROP_LAST) || '{}'); } catch (e) {}
      Object.keys(regions).forEach(function (rg) { last[rg] = { when: now, by: who, file: alStr_(d.file).slice(0, 120), rows: regions[rg] }; });
      props.setProperty(AF_PROP_LAST, JSON.stringify(last));
    } catch (e) {}
    return { ok: true, dry: false, summary: sum };
  } finally {
    if (lock) lock.releaseLock();
  }
}

// ------------------------------------------------------------ hand edits -----
// Set the routing FSM on one account (source 'hub'), or remove one learned alias.
function afSet_(d) {
  var who = alStr_(d.by).slice(0, 60) || 'Unknown';
  var id = alStr_(d.crm_id).toLowerCase();
  if (!id) return { ok: false, error: 'No account given.' };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ss = afSS_();
    var t = afRead_(ss);
    var r = t.rows.filter(function (x) { return alStr_(x.crm_id).toLowerCase() === id; })[0];
    if (!r) return { ok: false, error: 'That account is not on the list. Upload the CRM export first.' };
    var logs = [];
    if (d.remove_alias !== undefined) {
      var al = afAliases_(r), gone = alNorm_(d.remove_alias);
      var keep = al.filter(function (a) { return alNorm_(a) !== gone; });
      if (keep.length !== al.length) {
        logs.push({ who: who, action: 'alias remove', crm_id: id, account: r.name, field: 'aliases', old: al.join(' | '), 'new': keep.join(' | ') });
        r.aliases = keep.join(' | ');
      }
    }
    if (d.fsm !== undefined) {
      var fsm = alStr_(d.fsm).toLowerCase();
      if (fsm && !FSM_ROSTER[fsm]) return { ok: false, error: 'Unknown FSM ' + d.fsm };
      var src = fsm && fsm === afFsmKey_(r.crm_fsm) ? 'crm' : (fsm ? 'hub' : '');
      if (!fsm && afFsmKey_(r.crm_fsm)) { fsm = afFsmKey_(r.crm_fsm); src = 'crm'; } // clearing goes back to CRM
      if (fsm !== alStr_(r.fsm) || src !== alStr_(r.fsm_source)) {
        logs.push({ who: who, action: 'fsm set', crm_id: id, account: r.name, field: 'fsm', old: alStr_(r.fsm) + ' (' + alStr_(r.fsm_source) + ')', 'new': fsm + ' (' + src + ')' });
        r.fsm = fsm; r.fsm_source = src;
      }
    }
    if (logs.length) {
      r.updated_by = who; r.updated_at = afNow_();
      t.sh.getRange(r._row, 1, 1, t.head.length).setValues([afRowVals_(t.head, r)]);
      afLog_(ss, logs);
    }
    return { ok: true, account: { id: id, name: alStr_(r.name), fsm: alStr_(r.fsm), src: alStr_(r.fsm_source), aliases: afAliases_(r), by: alStr_(r.updated_by), at: alStr_(r.updated_at) } };
  } finally {
    lock.releaseLock();
  }
}

// Add a building name someone typed as an alias of an account, so the next report with
// the same words routes on its own. Caller holds the lock.
function afAddAlias_(ss, t, r, text, who) {
  var raw = alStr_(text).slice(0, 120);
  if (!raw || alNorm_(raw).length < 3) return false;
  if (alNorm_(raw) === alNorm_(r.name)) return false;
  var al = afAliases_(r);
  if (al.map(alNorm_).indexOf(alNorm_(raw)) >= 0) return false;
  al.push(raw);
  afLog_(ss, [{ who: who, action: 'alias add', crm_id: r.crm_id, account: r.name, field: 'aliases', old: afAliases_(r).join(' | '), 'new': al.join(' | ') }]);
  r.aliases = al.join(' | ');
  return true;
}

// Reassign one alert. fsm '' with no crm_id clears the reassignment.
//   crm_id: tie the alert to this account (and learn `alias` as a name for it)
//   forward: also make fsm the account's FSM from now on
function afAssign_(d) {
  var who = alStr_(d.by).slice(0, 60) || 'Unknown';
  var key = alStr_(d.key);
  if (!/^(sup|shop|resp|post|ni):/.test(key)) return { ok: false, error: 'That alert cannot be reassigned.' };
  var fsm = alStr_(d.fsm).toLowerCase();
  if (fsm && !FSM_ROSTER[fsm]) return { ok: false, error: 'Unknown FSM ' + d.fsm };
  var id = alStr_(d.crm_id).toLowerCase();
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ss = afSS_();
    var acct = null;
    if (id) {
      var t = afRead_(ss);
      var r = t.rows.filter(function (x) { return alStr_(x.crm_id).toLowerCase() === id; })[0];
      if (!r) return { ok: false, error: 'That account is not on the list.' };
      var dirty = false;
      if (d.alias) dirty = afAddAlias_(ss, t, r, d.alias, who) || dirty;
      if (!fsm) fsm = alStr_(r.fsm);
      if (d.forward && fsm && (fsm !== alStr_(r.fsm) || alStr_(r.fsm_source) !== 'hub')) {
        var src = fsm === afFsmKey_(r.crm_fsm) ? 'crm' : 'hub';
        if (fsm !== alStr_(r.fsm) || src !== alStr_(r.fsm_source)) {
          afLog_(ss, [{ who: who, action: 'fsm set (alert)', crm_id: id, account: r.name, field: 'fsm', old: alStr_(r.fsm) + ' (' + alStr_(r.fsm_source) + ')', 'new': fsm + ' (' + src + ')' }]);
          r.fsm = fsm; r.fsm_source = src; dirty = true;
        }
      }
      if (dirty) {
        r.updated_by = who; r.updated_at = afNow_();
        t.sh.getRange(r._row, 1, 1, t.head.length).setValues([afRowVals_(t.head, r)]);
      }
      acct = { id: id, name: alStr_(r.name), fsm: alStr_(r.fsm), src: alStr_(r.fsm_source) };
    }
    var sh = afTab_(ss, AF_ASSIGN_TAB, AF_ASSIGN_HEAD);
    var map = afAssignMap_(sh);
    var row = map[key] ? map[key].row : sh.getLastRow() + 1;
    var now = new Date();
    var note = (d.forward && acct ? 'account changed too' : '') + (d.alias && acct ? (d.forward ? '; ' : '') + 'linked "' + alStr_(d.alias).slice(0, 60) + '"' : '');
    sh.getRange(row, 1, 1, AF_ASSIGN_HEAD.length).setValues([[key, fsm, id, fsm || id ? who : '', fsm || id ? now : '', note]]);
    return { ok: true, key: key, fsm: fsm, by: who, at: alIso_(now), at_nice: alNice_(now), account: acct };
  } finally {
    lock.releaseLock();
  }
}
function afAssignMap_(sh) {
  var map = {};
  var last = sh.getLastRow();
  if (last < 2) return map;
  var vals = sh.getRange(2, 1, last - 1, AF_ASSIGN_HEAD.length).getValues();
  for (var i = 0; i < vals.length; i++) {
    var k = alStr_(vals[i][0]);
    if (!k) continue;
    map[k] = { row: i + 2, fsm: alStr_(vals[i][1]).toLowerCase(), crm_id: alStr_(vals[i][2]).toLowerCase(), by: alStr_(vals[i][3]), at: alDate_(vals[i][4]) };
  }
  return map;
}

// ------------------------------------------------------------ matching -----
// Token match with rare words weighted up (IDF), so "Azura henderson" picks Azura
// Surgery Center Henderson over the Las Vegas one, "Renewal by Anderson" still finds
// Andersen (one letter off), and "Proud moments Flamingo" stays ambiguous (six Proud
// Moments sites, none on Flamingo) instead of guessing.
function afTok_(s) {
  var out = [], seen = {};
  alStr_(s).toLowerCase().replace(/&/g, ' and ').split(/[^a-z0-9]+/).forEach(function (w) {
    if (!w || AF_STOP[w] || seen[w]) return;
    if (w.length < 2) return;
    seen[w] = 1; out.push(w);
  });
  return out;
}
function afEdit1_(a, b) {
  // true when a and b differ by at most one insert, delete or swap of a letter
  if (Math.abs(a.length - b.length) > 1) return false;
  var i = 0, j = 0, diff = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++diff > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return diff + (a.length - i) + (b.length - j) <= 1;
}
function afIndex_() {
  var accts = [];
  try {
    afRead_(afSS_()).rows.forEach(function (r) {
      var id = alStr_(r.crm_id);
      if (!id) return;
      var aliases = afAliases_(r);
      var toks = {};
      afTok_(r.name).forEach(function (w) { toks[w] = 1; });
      aliases.forEach(function (a) { afTok_(a).forEach(function (w) { toks[w] = 1; }); });
      afTok_(r.address1).forEach(function (w) { if (!/^\d+$/.test(w)) toks[w] = 1; });
      afTok_(r.city).forEach(function (w) { toks[w] = 1; });
      accts.push({
        id: id.toLowerCase(), name: alStr_(r.name), region: alStr_(r.region), fsm: alStr_(r.fsm), src: alStr_(r.fsm_source),
        norm: alNorm_(r.name), anorms: aliases.map(alNorm_).filter(function (x) { return x.length >= 3; }),
        toks: Object.keys(toks)
      });
    });
  } catch (e) { /* tab missing: nothing to match */ }
  var df = {};
  accts.forEach(function (a) { a.toks.forEach(function (w) { df[w] = (df[w] || 0) + 1; }); });
  var n = Math.max(accts.length, 1);
  var byId = {};
  accts.forEach(function (a) { byId[a.id] = a; });
  return { accts: accts, byId: byId, idf: function (w) { return Math.log((n + 1) / ((df[w] || 0) + 0.5)); } };
}
// -> {acct, how} | {acct:null, cands:[...]} | null
function afMatch_(text, region, idx) {
  if (!idx || !idx.accts.length) return null;
  var t = alNorm_(text);
  if (!t || t.length < 3) return null;
  var rg = alStr_(region);
  var pool = idx.accts.filter(function (a) { return !rg || !a.region || a.region === rg; });
  if (!pool.length) pool = idx.accts;
  // learned alias or the exact name
  var exact = pool.filter(function (a) { return a.norm === t || a.anorms.indexOf(t) >= 0; });
  if (exact.length === 1) return { acct: exact[0], how: exact[0].norm === t ? 'name' : 'learned name' };
  var q = afTok_(text);
  if (!q.length) return null;
  var total = 0;
  q.forEach(function (w) { total += idx.idf(w); });
  var scored = [];
  pool.forEach(function (a) {
    var s = 0, strong = false;
    q.forEach(function (w) {
      var best = 0;
      for (var i = 0; i < a.toks.length; i++) {
        var at = a.toks[i];
        if (at === w) { best = 1; break; }
        if (w.length >= 5 && at.length >= 5 && afEdit1_(w, at)) best = Math.max(best, 0.7);
        else if (w.length >= 3 && at.length >= 3 && (at.indexOf(w) === 0 || w.indexOf(at) === 0)) best = Math.max(best, 0.6);
      }
      if (best) { s += best * idx.idf(w); if (idx.idf(w) >= 2.5) strong = true; }
    });
    var bonus = 0;
    if (t.length >= 4 && (a.norm.indexOf(t) >= 0 || (a.norm.length >= 5 && t.indexOf(a.norm) >= 0))) bonus = 3;
    a.anorms.forEach(function (x) { if (t.length >= 4 && (x.indexOf(t) >= 0 || (x.length >= 5 && t.indexOf(x) >= 0))) bonus = Math.max(bonus, 4); });
    if (!s && !bonus) return;
    scored.push({ a: a, cov: total ? s / total : 0, score: s + bonus, strong: strong || bonus > 0 });
  });
  if (!scored.length) return null;
  scored.sort(function (x, y) { return y.score - x.score; });
  var top = scored[0], second = scored[1];
  var clear = !second || (top.score - second.score) >= 1.5;
  if (top.strong && (top.cov >= 0.55 || top.score >= 6) && clear) return { acct: top.a, how: 'close match' };
  if (top.strong && top.cov >= 0.35) {
    var cands = scored.filter(function (x) { return x.score >= top.score * 0.6 && x.strong; }).slice(0, 4)
      .map(function (x) { return { id: x.a.id, name: x.a.name, fsm: x.a.fsm }; });
    return { acct: null, cands: cands };
  }
  return null;
}

// Editor helper: how the current supply and shop alerts would match. Safe any time.
function afSelfTest() {
  var idx = afIndex_();
  var lines = ['accounts=' + idx.accts.length];
  ['Renewal by Anderson', 'First person care clinic / Henderson', 'Azura henderson', 'Proud moments Flamingo', 'Spread the word', 'Fox 5', 'Gaming Arts / Orville', 'MOB', 'Octapharma']
    .forEach(function (s) {
      var m = afMatch_(s, /azura|octa|proud/i.test(s) ? '' : 'Las Vegas', idx);
      lines.push(s + ' -> ' + (m ? (m.acct ? m.acct.name + ' [' + m.acct.fsm + '] ' + m.how : 'ambiguous: ' + m.cands.map(function (c) { return c.name; }).join(' / ')) : 'no match'));
    });
  Logger.log(lines.join('\n'));
  return lines.join('\n');
}
