// ============================================================
// Alerts.gs - Ops Hub alerts (Sep 11 2026)
// One list of the things that used to sit in the service inboxes:
//   vendor responses   -> Responses tab of the CW Solicitations book
//   supply orders      -> Supply Orders tab of the CW Supply and Inventory book (supSS_)
//   shop orders        -> Orders tab of the CW Vendor Shop Catalog book
// Grouped by FSM. Responses carry the posting's fsm. Supply and shop orders
// are matched by building / account name against the Account Directory
// (actAccountRows_), which holds an fsm per account. No match = "unmatched".
// Check-offs are shared: one row per item on the Alert Status tab of the
// CW Solicitations book. Nothing is ever deleted from any source tab.
// POST {kind:'alerts_list', passcode}                       -> {ok, items, roster, statuses}
// POST {kind:'alerts_set',  passcode, keys:[..], status, by} -> {ok, saved:[..]}
//   status '' (or 'Open') reopens an item.
// Sep 15 2026: night manager escalations (fsm_action_needed = Yes on the CW Night
// Inspections sheet, NightInspection.gs) join the list as type 'night'.
// Sep 18 2026: postings and responses carry 'internal', the account_name from the
// Solicitations row. The hub shows it beside the vendor-facing title so an FSM
// knows which account they are looking at. doGet deletes account_name from the
// public feed, so this field must never be echoed to anything vendor facing.
// ============================================================
var AL_TAB = 'Alert Status';
var AL_HEAD = ['alert_key', 'type', 'status', 'handled_by', 'handled_at', 'summary'];
var AL_DAYS = 45;          // items older than this drop off the list
var AL_DONE_DAYS = 7;      // handled items stay visible (collapsed) this long
var AL_SHOP_ID = '1p0CJVr6UJnYTBvAF3-VPBA_6uBHG9BLlByryXLwlOTw';
var AL_TZ = 'America/Los_Angeles';
var AL_STATUS = {
  response: ['Responded to', 'Not a fit'],
  supply: ['Ordered', 'Sent to client', 'Not needed'],
  shop: ['Processed', 'Picked up'],
  posting: ['Mark filled'],
  night: ['Handled']
};

function alDispatch(d) {
  if (String(d.passcode || '') !== PASSCODE) return _json({ ok: false, error: 'Wrong passcode.' });
  var kind = String(d.kind || '');
  try {
    if (kind === 'alerts_list') return _json(alList_(d));
    if (kind === 'alerts_set') return _json(alSet_(d));
  } catch (e) {
    return _json({ ok: false, error: String(e && e.message || e) });
  }
  return _json({ ok: false, error: 'Unknown alerts kind ' + kind });
}

// ------------------------------------------------------------ plumbing -----
function alStr_(v) { return (v === null || v === undefined) ? '' : String(v).trim(); }
function alNorm_(s) {
  return alStr_(s).toLowerCase().replace(/&/g, 'and')
    .replace(/\b(llc|inc|corp|ltd|co|the)\b\.?/g, '').replace(/[^a-z0-9]+/g, '');
}
function alDate_(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  var s = alStr_(v);
  if (!s) return null;
  var d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
function alIso_(d) { return d ? Utilities.formatDate(d, AL_TZ, "yyyy-MM-dd'T'HH:mm:ss") : ''; }
function alNice_(d) { return d ? Utilities.formatDate(d, AL_TZ, 'MMM d, h:mm a') : ''; }
function alFresh_(d, days) {
  if (!d) return true; // no date: keep it rather than lose it
  return (Date.now() - d.getTime()) <= days * 86400000;
}
function alRows_(sh) {
  var last = sh.getLastRow(), lastC = sh.getLastColumn();
  if (last < 2 || lastC < 1) return [];
  var vals = sh.getRange(1, 1, last, lastC).getValues();
  var head = vals[0].map(alStr_);
  var out = [];
  for (var i = 1; i < vals.length; i++) {
    var o = { _row: i + 1 }, any = false;
    for (var c = 0; c < head.length; c++) {
      if (!head[c]) continue;
      var v = vals[i][c];
      if (v !== '' && v !== null && v !== undefined) any = true;
      o[head[c]] = v;
    }
    if (any) out.push(o);
  }
  return out;
}
function alSheet_() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(AL_TAB);
  if (!sh) {
    sh = ss.insertSheet(AL_TAB);
    sh.getRange(1, 1, 1, AL_HEAD.length).setValues([AL_HEAD])
      .setFontWeight('bold').setBackground('#2D2A26').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
  }
  return sh;
}
function alStatusMap_(sh) {
  var map = {};
  alRows_(sh).forEach(function (r) {
    var k = alStr_(r.alert_key);
    if (!k) return;
    map[k] = { row: r._row, status: alStr_(r.status), by: alStr_(r.handled_by), at: alDate_(r.handled_at) };
  });
  return map;
}

// ------------------------------------------------------------ FSM lookup -----
function alRoster_() {
  var out = [];
  Object.keys(FSM_ROSTER).forEach(function (k) {
    var f = FSM_ROSTER[k];
    out.push({ key: k, name: f.name, title: f.title, region: f.region });
  });
  return out;
}
function alFsmKey_(v) {
  var s = alStr_(v);
  if (!s) return '';
  if (FSM_ROSTER[s.toLowerCase()]) return s.toLowerCase();
  var n = s.toLowerCase();
  var keys = Object.keys(FSM_ROSTER);
  for (var i = 0; i < keys.length; i++) {
    var name = String(FSM_ROSTER[keys[i]].name || '').toLowerCase();
    if (name === n) return keys[i];
  }
  var first = n.split(/\s+/)[0];
  for (var j = 0; j < keys.length; j++) {
    var nm = String(FSM_ROSTER[keys[j]].name || '').toLowerCase();
    if (nm.split(/\s+/)[0] === first) return keys[j];
  }
  return '';
}
function alAccounts_() {
  var list = [];
  try {
    actAccountRows_(actSS_()).forEach(function (a) {
      if (a.hide === true || String(a.hide).toUpperCase() === 'TRUE') return;
      var names = [alStr_(a.name)].concat(alStr_(a.former_names).split(/[;,|]/));
      names = names.map(alNorm_).filter(function (x) { return x.length >= 4; });
      if (!names.length) return;
      list.push({ name: alStr_(a.name), norms: names, fsm: alFsmKey_(a.fsm), region: alStr_(a.region) });
    });
  } catch (e) { /* Account Directory unavailable: everything lands unmatched */ }
  // Postings are a second source: account_name -> the posting FSM, and the posting id
  // itself (vendors sometimes type the posting id into the account box).
  try {
    alRows_(SpreadsheetApp.openById(SHEET_ID).getSheetByName(TAB)).forEach(function (p) {
      var fsm = alFsmKey_(p.fsm) || alFsmKey_(p.contact_name);
      if (!fsm) return;
      var norms = [alNorm_(p.account_name), alNorm_(p.id)].filter(function (x) { return x.length >= 4; });
      if (!norms.length) return;
      list.push({ name: alStr_(p.account_name) || alStr_(p.id), norms: norms, fsm: fsm, region: alStr_(p.region) });
    });
  } catch (e) {}
  return list;
}
function alMatch_(text, region, accounts) {
  var t = alNorm_(text);
  if (!t || t.length < 4) return null;
  var best = null, bestScore = 0;
  for (var i = 0; i < accounts.length; i++) {
    var a = accounts[i];
    for (var j = 0; j < a.norms.length; j++) {
      var n = a.norms[j], score = 0;
      if (n === t) score = 3;
      else if (t.indexOf(n) >= 0 || n.indexOf(t) >= 0) score = 2;
      if (!score) continue;
      if (region && a.region && alStr_(a.region).toLowerCase() === alStr_(region).toLowerCase()) score += 0.5;
      if (score > bestScore) { bestScore = score; best = a; }
    }
  }
  return best;
}

// ------------------------------------------------------------ sources -----
// Open postings (Filled unchecked). Marking one filled checks Filled on the
// Solicitations row, which is what takes it off the vendor board.
function alPostings_(statusMap) {
  var items = [];
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(TAB);
  if (!sh) return items;
  alRows_(sh).forEach(function (p) {
    var id = alStr_(p.id);
    if (!id) return;
    var filled = p.filled === true || String(p.filled).toUpperCase() === 'TRUE';
    var key = 'post:' + id;
    if (filled && !(statusMap[key] && statusMap[key].status)) return; // filled from the sheet: not an alert
    var when = alDate_(p.posted);
    var n = Number(p.responses) || 0;
    var dlD = alDate_(p.deadline);
    var dl = dlD ? Utilities.formatDate(dlD, AL_TZ, 'MMM d') : alStr_(p.deadline);
    items.push({
      key: key, type: 'posting',
      fsm: alFsmKey_(p.fsm) || alFsmKey_(p.contact_name),
      region: alStr_(p.region),
      when: alIso_(when), when_nice: alNice_(when),
      from: alStr_(p.title) || id,
      about: '',
      // TJ, Sep 18 2026: the title is the vendor-facing one, so an FSM cannot tell
      // which of their accounts it is. account_name is the internal name and is
      // stripped from the public feed in doGet, so it is safe here and only here.
      internal: alStr_(p.account_name),
      summary: 'Open on the vendor board. ' + (n === 1 ? '1 reply so far.' : n + ' replies so far.') + (dl ? ' Deadline ' + dl + '.' : ''),
      email: '', phone: '',
      link: 'responses.html#' + id,
      ref: id
    });
  });
  return items;
}
function alPostingFilled_(id, flag) {
  var sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName(TAB);
  if (!sh) return false;
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(alStr_);
  var cId = head.indexOf('id') + 1, cFilled = head.indexOf('filled') + 1;
  if (!cId || !cFilled) return false;
  var ids = sh.getRange(1, cId, sh.getLastRow(), 1).getValues();
  for (var i = 1; i < ids.length; i++) {
    if (alStr_(ids[i][0]) === id) { sh.getRange(i + 1, cFilled).setValue(!!flag); return true; }
  }
  return false;
}
function alResponses_(statusMap) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var posts = {};
  alRows_(ss.getSheetByName(TAB)).forEach(function (p) {
    var id = alStr_(p.id);
    if (id) posts[id] = p;
  });
  var items = [];
  var sh = ss.getSheetByName(RESP_TAB);
  if (!sh) return items;
  alRows_(sh).forEach(function (r) {
    var rid = alStr_(r.response_id);
    if (!rid) return;
    var when = alDate_(r.received);
    if (!alFresh_(when, AL_DAYS)) return;
    var p = posts[alStr_(r.posting_id)] || {};
    var mode = alStr_(r.mode).toLowerCase();
    var amt = alStr_(r.quote_amount);
    var summary = mode === 'quote' && amt
      ? 'Quoted ' + (/^\$/.test(amt) ? amt : '$' + amt) + (alStr_(r.quote_basis) ? ' ' + alStr_(r.quote_basis) : '')
      : 'Interested';
    var filled = p.filled === true || String(p.filled).toUpperCase() === 'TRUE';
    if (filled) return; // posting is filled: its replies leave the list with it
    items.push({
      key: 'resp:' + rid, type: 'response',
      pid: alStr_(r.posting_id),
      fsm: alFsmKey_(p.fsm) || alFsmKey_(p.contact_name),
      region: alStr_(r.region) || alStr_(p.region),
      when: alIso_(when), when_nice: alNice_(when),
      from: alStr_(r.company) + (alStr_(r.contact_name) ? ' (' + alStr_(r.contact_name) + ')' : ''),
      about: alStr_(r.posting_title) || alStr_(p.title) || alStr_(r.posting_id),
      internal: alStr_(p.account_name),
      summary: summary,
      email: alStr_(r.email), phone: alStr_(r.phone),
      link: alStr_(r.pdf_url) || ('responses.html#' + alStr_(r.posting_id)),
      ref: rid
    });
  });
  return items;
}
function alSupply_(accounts) {
  var items = [];
  var ss;
  try { ss = supSS_(); } catch (e) { return items; }
  var sh = ss.getSheetByName(SUP_TAB);
  if (!sh) return items;
  alRows_(sh).forEach(function (r) {
    var id = alStr_(r.order_id);
    if (!id) return;
    var when = alDate_(r.received);
    if (!alFresh_(when, AL_DAYS)) return;
    var names = [];
    try { (JSON.parse(alStr_(r.items) || '[]') || []).forEach(function (it) { names.push((it.qty ? it.qty + ' x ' : '') + alStr_(it.name)); }); } catch (e) {}
    var acct = alMatch_(r.building, r.region, accounts);
    items.push({
      key: 'sup:' + id, type: 'supply',
      fsm: acct ? acct.fsm : '',
      region: alStr_(r.region),
      when: alIso_(when), when_nice: alNice_(when),
      from: alStr_(r.requester),
      about: alStr_(r.building) + (acct && alNorm_(acct.name) !== alNorm_(r.building) ? ' (matched to ' + acct.name + ')' : ''),
      summary: (names.length ? names.join(', ') : alStr_(r.item_count) + ' items') + (alStr_(r.comments) ? ' - ' + alStr_(r.comments) : ''),
      email: alStr_(r.email), phone: alStr_(r.phone),
      link: ss.getUrl(),
      ref: id
    });
  });
  return items;
}
function alShop_(accounts) {
  var items = [];
  var ss, sh;
  try { ss = SpreadsheetApp.openById(AL_SHOP_ID); sh = ss.getSheetByName('Orders'); } catch (e) { return items; }
  if (!sh) return items;
  alRows_(sh).forEach(function (r) {
    var when = alDate_(r['Date']);
    var email = alStr_(r['Email']).toLowerCase();
    if (!when && !email) return;
    if (!alFresh_(when, AL_DAYS)) return;
    if (r['Picked Up'] === true || String(r['Picked Up']).toUpperCase() === 'TRUE') return; // already closed on the sheet
    var key = 'shop:' + (when ? Utilities.formatDate(when, AL_TZ, 'yyyyMMddHHmmss') : 'nodate') + '|' + email;
    var acct = alMatch_(r['Primary Account'], '', accounts);
    var total = r['Total'];
    var totalStr = (typeof total === 'number') ? '$' + total.toFixed(2) : alStr_(total);
    var placed = r['Order Placed'] === true || String(r['Order Placed']).toUpperCase() === 'TRUE';
    items.push({
      key: key, type: 'shop',
      fsm: acct ? acct.fsm : '',
      region: acct ? acct.region : '',
      when: alIso_(when), when_nice: alNice_(when),
      from: alStr_(r['Vendor Name']) + (alStr_(r['Company']) ? ' (' + alStr_(r['Company']) + ')' : ''),
      about: alStr_(r['Primary Account']) || 'No account given',
      summary: alStr_(r['Items']) + (totalStr ? ' - ' + totalStr : '') + (placed ? ' - order placed with supplier' : '') + (alStr_(r['Notes']) ? ' - ' + alStr_(r['Notes']) : ''),
      email: email, phone: '',
      link: ss.getUrl(),
      ref: key, _row: r._row
    });
  });
  return items;
}

// Night manager escalations. One item per recap where the night manager said
// the FSM has to act in the morning. The row's fsm column names the FSM.
function alNight_() {
  var items = [];
  if (typeof niSS_ !== 'function' || typeof niTab_ !== 'function') return items;
  var sh;
  try { sh = niTab_(niSS_()); } catch (e) { return items; }
  alRows_(sh).forEach(function (r) {
    var id = alStr_(r.inspection_id);
    if (!id) return;
    if (alStr_(r.fsm_action_needed) !== 'Yes') return;
    var when = alDate_(r.submitted_at);
    if (!alFresh_(when, AL_DAYS)) return;
    var bits = [];
    if (alStr_(r.fsm_action_note)) bits.push(alStr_(r.fsm_action_note));
    if (alStr_(r.score)) bits.push('score ' + alStr_(r.score));
    if (alStr_(r.flags)) bits.push(alStr_(r.flags).split(',').filter(function (f) { return f !== 'fsm_action'; }).join(', '));
    items.push({
      key: 'ni:' + id, type: 'night',
      fsm: alFsmKey_(r.fsm),
      region: alStr_(r.market),
      when: alIso_(when), when_nice: alNice_(when),
      from: alStr_(r.nm_name),
      about: alStr_(r.account_name),
      summary: bits.join(' - '),
      email: alStr_(r.nm_email), phone: '',
      link: alStr_(r.pdf_url) || 'night-inspections.html',
      ref: id
    });
  });
  return items;
}

// ------------------------------------------------------------ handlers -----
function alList_(d) {
  var sh = alSheet_();
  var map = alStatusMap_(sh);
  var accounts = alAccounts_();
  var items = alPostings_(map).concat(alResponses_(map)).concat(alSupply_(accounts)).concat(alShop_(accounts)).concat(alNight_());
  var out = [];
  items.forEach(function (it) {
    var st = map[it.key];
    delete it._row;
    if (st && st.status && st.status !== 'Open') {
      if (!alFresh_(st.at, AL_DONE_DAYS)) return; // handled a while ago: gone
      it.status = st.status; it.by = st.by; it.at = alIso_(st.at); it.at_nice = alNice_(st.at);
    } else {
      it.status = ''; it.by = ''; it.at = ''; it.at_nice = '';
    }
    out.push(it);
  });
  out.sort(function (a, b) { return (b.when || '').localeCompare(a.when || ''); });
  return { ok: true, items: out, roster: alRoster_(), statuses: AL_STATUS, days: AL_DAYS,
           accounts_loaded: accounts.length, generated: alIso_(new Date()) };
}
function alSet_(d) {
  var keys = d.keys || (d.key ? [d.key] : []);
  if (!keys.length) return { ok: false, error: 'Nothing to mark.' };
  var status = alStr_(d.status);
  if (status === 'Open') status = '';
  var by = alStr_(d.by).slice(0, 60) || 'Unknown';
  var valid = {};
  Object.keys(AL_STATUS).forEach(function (t) { AL_STATUS[t].forEach(function (s) { valid[s] = t; }); });
  if (status && !valid[status]) return { ok: false, error: 'Unknown status ' + status };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = alSheet_();
    var map = alStatusMap_(sh);
    var now = new Date();
    var saved = [];
    keys.slice(0, 200).forEach(function (k) {
      k = alStr_(k);
      if (!k) return;
      var type = k.indexOf('resp:') === 0 ? 'response' : k.indexOf('sup:') === 0 ? 'supply' : k.indexOf('shop:') === 0 ? 'shop' : k.indexOf('post:') === 0 ? 'posting' : k.indexOf('ni:') === 0 ? 'night' : '';
      if (!type) return;
      if (status && valid[status] !== type) return; // status must fit the item
      var row = map[k] ? map[k].row : alNextRow_(sh);
      sh.getRange(row, 1, 1, AL_HEAD.length).setValues([[k, type, status, status ? by : '', status ? now : '', alStr_(d.summary).slice(0, 200)]]);
      map[k] = { row: row, status: status, by: by, at: now };
      saved.push({ key: k, status: status, by: status ? by : '', at: status ? alIso_(now) : '', at_nice: status ? alNice_(now) : '' });
      if (type === 'shop') { try { alShopSync_(k, status); } catch (e) {} }
      if (type === 'posting') { try { alPostingFilled_(k.slice(5), !!status); } catch (e) {} }
    });
    return { ok: true, saved: saved };
  } finally {
    lock.releaseLock();
  }
}
function alNextRow_(sh) {
  var last = Math.max(sh.getLastRow(), 1);
  var vals = sh.getRange(1, 1, last, 1).getValues();
  for (var i = 1; i < vals.length; i++) if (!alStr_(vals[i][0])) return i + 1;
  return vals.length + 1;
}
// Shop orders already have Order Placed / Picked Up checkboxes on the Orders tab.
// Keep them in step so the sheet still tells the same story as the hub.
function alShopSync_(key, status) {
  var ss = SpreadsheetApp.openById(AL_SHOP_ID);
  var sh = ss.getSheetByName('Orders');
  if (!sh) return;
  var rows = alRows_(sh);
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(alStr_);
  var cPlaced = head.indexOf('Order Placed') + 1, cPicked = head.indexOf('Picked Up') + 1;
  if (!cPlaced || !cPicked) return;
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var when = alDate_(r['Date']);
    var k = 'shop:' + (when ? Utilities.formatDate(when, AL_TZ, 'yyyyMMddHHmmss') : 'nodate') + '|' + alStr_(r['Email']).toLowerCase();
    if (k !== key) continue;
    if (status === 'Processed') sh.getRange(r._row, cPlaced).setValue(true);
    if (status === 'Picked up') { sh.getRange(r._row, cPlaced).setValue(true); sh.getRange(r._row, cPicked).setValue(true); }
    return;
  }
}
// Editor helper: run once to create the Alert Status tab ahead of the first hub load.
function alSetupRun() { var sh = alSheet_(); Logger.log('Alert Status tab ready, rows: ' + sh.getLastRow()); }

// Editor helper: summarizes what the hub would receive. Safe to run any time.
function alSelfTest() {
  var r = alList_({});
  var byType = {}, byFsm = {};
  r.items.forEach(function (i) { byType[i.type] = (byType[i.type] || 0) + 1; var k = i.fsm || '(none)'; byFsm[k] = (byFsm[k] || 0) + 1; });
  var sample = r.items.filter(function (i) { return i.type !== 'response'; }).map(function (i) {
    return i.type + ' | fsm=' + i.fsm + ' | ' + i.from + ' | ' + i.about + ' | ' + i.when_nice + ' | ' + i.summary.slice(0, 70);
  });
  var rs = r.items.filter(function (i) { return i.type === 'response'; }).slice(0, 3).map(function (i) {
    return 'response | fsm=' + i.fsm + ' | ' + i.from + ' | ' + i.about + ' | ' + i.when_nice + ' | ' + i.summary + ' | ' + i.link;
  });
  var text = ['items=' + r.items.length, 'accounts_loaded=' + r.accounts_loaded, 'byType=' + JSON.stringify(byType), 'byFsm=' + JSON.stringify(byFsm), '--- non-response items ---'].concat(sample, ['--- responses ---'], rs).join('\n');
  Logger.log(text);
  return text;
}
