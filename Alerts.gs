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
// Sep 22 2026: filling a posting now CLOSES its replies on the Alert Status tab
// (status AL_FILL_CLOSE, summary 'filled post:<id>') instead of only hiding them
// while Filled stays checked. Brett's SVN posting showed why: it was marked filled
// Sep 17, the Filled box was unchecked on the sheet Sep 21, and all ten replies came
// back. Now a reopened posting keeps its old replies closed and shows as open again
// (it IS back on the vendor board). Postings filled outside the hub (the sheet, the
// Admin Desk records page) get their replies closed on the next list build. Undo on
// the posting in the hub reopens exactly the replies its fill closed.
// Sep 23 2026: supply reports and shop orders match first against the Account FSM tab
// (the CRM export uploaded on the Admin Hub, AccountFsm.gs), with a token matcher that
// weights rare words, then fall back to the Account Directory and postings as before.
// Anyone can reassign an alert on the hub (alerts_assign, Alert Assign tab); replies
// follow their posting. Kinds alerts_acct_list / alerts_acct_import / alerts_acct_set /
// alerts_assign are served from AccountFsm.gs.
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
  night: ['Handled'],
  // Sep 24 2026: Jotform feeds (JotformFeeds.gs) whose Feeds row carries an alert value
  workreq: ['Scheduled', 'Dispatched', 'Done', 'Not ours'],
  workdone: ['Reviewed'],
  review: ['Reviewed']
};
var AL_JF_TYPES = { workreq: 1, workdone: 1, review: 1 };
var AL_FILL_CLOSE = 'Posting filled';   // reply status written when its posting is filled

function alDispatch(d) {
  if (String(d.passcode || '') !== PASSCODE) return _json({ ok: false, error: 'Wrong passcode.' });
  var kind = String(d.kind || '');
  try {
    if (kind === 'alerts_list') return _json(alList_(d));
    if (kind === 'alerts_set') return _json(alSet_(d));
    if (kind === 'alerts_assign') return _json(afAssign_(d));
    if (kind === 'alerts_acct_list') return _json(afList_(d));
    if (kind === 'alerts_acct_import') return _json(afImport_(d));
    if (kind === 'alerts_acct_set') return _json(afSet_(d));
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
  var ss = cwSS_(AL_TAB);   // CW Hub Alerts workbook (Books.gs)
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
    map[k] = { row: r._row, status: alStr_(r.status), by: alStr_(r.handled_by), at: alDate_(r.handled_at), summary: alStr_(r.summary) };
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
    alRows_(cwSS_().getSheetByName(TAB)).forEach(function (p) {
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
  var ss = cwSS_();
  var sh = ss.getSheetByName(TAB);
  if (!sh) return items;
  alRows_(sh).forEach(function (p) {
    var id = alStr_(p.id);
    if (!id) return;
    var filled = p.filled === true || String(p.filled).toUpperCase() === 'TRUE';
    var key = 'post:' + id;
    var st = statusMap[key];
    if (filled && !(st && st.status)) return; // filled from the sheet: not an alert
    // Marked filled in the hub, but Filled is unchecked on the sheet now, so it is live on
    // the vendor board again. Show it as open so the hub matches the board.
    var reopened = !filled && !!(st && st.status && st.status !== 'Open');
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
      summary: (reopened ? 'Back on the vendor board. Filled was unchecked after it was marked filled. ' : 'Open on the vendor board. ') + (n === 1 ? '1 reply so far.' : n + ' replies so far.') + (dl ? ' Deadline ' + dl + '.' : ''),
      email: '', phone: '',
      link: 'responses.html#' + id,
      ref: id,
      reopened: reopened
    });
  });
  return items;
}
function alPostingFilled_(id, flag) {
  var sh = cwSS_().getSheetByName(TAB);
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
function alResponses_(statusMap, toClose) {
  var ss = cwSS_();
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
    if (filled) {
      // posting is filled: its replies leave the list with it, and any still open are
      // queued so alList_ closes them for good (in case the posting is ever reopened)
      var rst = statusMap['resp:' + rid];
      if (toClose && !(rst && rst.status)) toClose.push({ key: 'resp:' + rid, pid: alStr_(r.posting_id) });
      return;
    }
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
// CRM account match first, then the old directory/postings match. Returns the fields
// every supply or shop item carries about its account.
function alAcct_(text, region, accounts, idx) {
  var m = null;
  try { m = afMatch_(text, region, idx); } catch (e) { m = null; }
  if (m && m.acct) return { fsm: m.acct.fsm, name: m.acct.name, id: m.acct.id, region: m.acct.region, how: m.how, cands: [] };
  if (m && m.cands && m.cands.length) return { fsm: '', name: '', id: '', region: '', how: 'unsure', cands: m.cands };
  var a = alMatch_(text, region, accounts);
  // The old matcher accepts any 4-letter name inside the text ("All accounts" -> ACCO).
  // Keep its result only when a whole name, or most of one, lines up.
  var t = alNorm_(text);
  if (a && !a.norms.some(function (n) { return n === t || (n.length >= 6 && t.indexOf(n) >= 0) || (t.length >= 5 && n.indexOf(t) >= 0); })) a = null;
  if (a) return { fsm: a.fsm, name: a.name, id: '', region: a.region, how: 'directory', cands: [] };
  return { fsm: '', name: '', id: '', region: '', how: '', cands: [] };
}
function alSupply_(accounts, idx) {
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
    var acct = alAcct_(r.building, r.region, accounts, idx);
    items.push({
      key: 'sup:' + id, type: 'supply',
      fsm: acct.fsm,
      region: alStr_(r.region),
      when: alIso_(when), when_nice: alNice_(when),
      from: alStr_(r.requester),
      about: alStr_(r.building) + (acct.name && alNorm_(acct.name) !== alNorm_(r.building) ? ' (matched to ' + acct.name + ')' : ''),
      typed: alStr_(r.building), acct_id: acct.id, acct_name: acct.name, match: acct.how, cands: acct.cands,
      summary: (names.length ? names.join(', ') : alStr_(r.item_count) + ' items') + (alStr_(r.comments) ? ' - ' + alStr_(r.comments) : ''),
      email: alStr_(r.email), phone: alStr_(r.phone),
      link: ss.getUrl(),
      ref: id
    });
  });
  return items;
}
function alShop_(accounts, idx) {
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
    var acct = alAcct_(r['Primary Account'], '', accounts, idx);
    var total = r['Total'];
    var totalStr = (typeof total === 'number') ? '$' + total.toFixed(2) : alStr_(total);
    var placed = r['Order Placed'] === true || String(r['Order Placed']).toUpperCase() === 'TRUE';
    items.push({
      key: key, type: 'shop',
      fsm: acct.fsm,
      region: acct.region,
      when: alIso_(when), when_nice: alNice_(when),
      from: alStr_(r['Vendor Name']) + (alStr_(r['Company']) ? ' (' + alStr_(r['Company']) + ')' : ''),
      about: (alStr_(r['Primary Account']) || 'No account given') + (acct.name && alNorm_(acct.name) !== alNorm_(r['Primary Account']) ? ' (matched to ' + acct.name + ')' : ''),
      typed: alStr_(r['Primary Account']), acct_id: acct.id, acct_name: acct.name, match: acct.how, cands: acct.cands,
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
  var idx = null;
  try { idx = afIndex_(); } catch (e) { idx = null; }
  var toClose = [];
  var items = alPostings_(map).concat(alResponses_(map, toClose)).concat(alSupply_(accounts, idx)).concat(alShop_(accounts, idx)).concat(alNight_());
  // Jotform feeds flagged for alerts (client work requests and the like), JotformFeeds.gs
  if (typeof jfAlertItems_ === 'function') { try { items = items.concat(jfAlertItems_(accounts, idx)); } catch (e) { /* feeds unavailable: the rest of the list still renders */ } }
  // Reassignments made on the hub (Alert Assign tab). Replies follow their posting.
  var asg = {};
  try { asg = afAssignMap_(afTab_(cwSS_(), AF_ASSIGN_TAB, AF_ASSIGN_HEAD)); } catch (e) { asg = {}; }
  items.forEach(function (it) {
    it.auto_fsm = it.fsm || '';
    var a = asg[it.key] || (it.type === 'response' && it.pid ? asg['post:' + it.pid] : null);
    if (a && a.crm_id && idx && idx.byId[a.crm_id]) {
      it.acct_id = a.crm_id; it.acct_name = idx.byId[a.crm_id].name; it.match = 'linked'; it.cands = [];
      if (!a.fsm) it.fsm = idx.byId[a.crm_id].fsm;
    }
    if (a && a.fsm && FSM_ROSTER[a.fsm]) {
      it.fsm = a.fsm; it.assigned = true; it.assigned_by = a.by; it.assigned_nice = alNice_(a.at);
    }
  });
  if (toClose.length) { try { alCloseLater_(toClose); } catch (e) { /* hidden anyway while filled; retried next build */ } }
  var out = [];
  items.forEach(function (it) {
    var st = map[it.key];
    delete it._row;
    var reopened = !!it.reopened;
    delete it.reopened;
    if (st && st.status && st.status !== 'Open' && !reopened) {
      if (!alFresh_(st.at, AL_DONE_DAYS)) return; // handled a while ago: gone
      it.status = st.status; it.by = st.by; it.at = alIso_(st.at); it.at_nice = alNice_(st.at);
    } else {
      it.status = ''; it.by = ''; it.at = ''; it.at_nice = '';
    }
    out.push(it);
  });
  out.sort(function (a, b) { return (b.when || '').localeCompare(a.when || ''); });
  return { ok: true, items: out, roster: alRoster_(), statuses: AL_STATUS, days: AL_DAYS,
           accounts_loaded: accounts.length, crm_accounts: idx ? idx.accts.length : 0, generated: alIso_(new Date()) };
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
      if (!type && k.indexOf('jf:') === 0) {
        // a Jotform feed item: the status names its type; a reopen keeps the type already on the row
        type = (status && AL_JF_TYPES[valid[status]]) ? valid[status] : (map[k] && AL_JF_TYPES[alJfRowType_(sh, map[k].row)] ? alJfRowType_(sh, map[k].row) : 'review');
      }
      if (!type) return;
      if (status && valid[status] !== type) return; // status must fit the item
      var row = map[k] ? map[k].row : alNextRow_(sh);
      sh.getRange(row, 1, 1, AL_HEAD.length).setValues([[k, type, status, status ? by : '', status ? now : '', alStr_(d.summary).slice(0, 200)]]);
      map[k] = { row: row, status: status, by: by, at: now };
      saved.push({ key: k, status: status, by: status ? by : '', at: status ? alIso_(now) : '', at_nice: status ? alNice_(now) : '' });
      if (type === 'shop') { try { alShopSync_(k, status); } catch (e) {} }
      if (type === 'posting') {
        try { alPostingFilled_(k.slice(5), !!status); } catch (e) {}
        try { saved = saved.concat(status ? alCloseReplies_(sh, map, alRepliesFor_(k.slice(5)), by, now) : alReopenReplies_(sh, map, k.slice(5))); } catch (e) {}
      }
    });
    return { ok: true, saved: saved };
  } finally {
    lock.releaseLock();
  }
}
// Every reply to one posting, newest data straight from the Responses tab.
function alRepliesFor_(pid) {
  var out = [];
  var sh = cwSS_().getSheetByName(RESP_TAB);
  if (!sh) return out;
  alRows_(sh).forEach(function (r) {
    var rid = alStr_(r.response_id);
    if (rid && alStr_(r.posting_id) === pid) out.push({ key: 'resp:' + rid, pid: pid });
  });
  return out;
}
// Close replies as AL_FILL_CLOSE. Replies someone already handled (Responded to,
// Not a fit) are left exactly as they are. New rows go in as one block.
function alCloseReplies_(sh, map, list, by, now) {
  var add = [], addKeys = [], saved = [];
  list.forEach(function (x) {
    var st = map[x.key];
    if (st && st.status && st.status !== 'Open') return;
    var who = x.by || by || 'Unknown';
    var vals = [x.key, 'response', AL_FILL_CLOSE, who, now, 'filled post:' + x.pid];
    if (st && st.row) sh.getRange(st.row, 1, 1, AL_HEAD.length).setValues([vals]);
    else { add.push(vals); addKeys.push(x.key); }
    map[x.key] = { row: st ? st.row : 0, status: AL_FILL_CLOSE, by: who, at: now, summary: vals[5] };
    saved.push({ key: x.key, status: AL_FILL_CLOSE, by: who, at: alIso_(now), at_nice: alNice_(now) });
  });
  if (add.length) {
    var start = sh.getLastRow() + 1;
    sh.getRange(start, 1, add.length, AL_HEAD.length).setValues(add);
    addKeys.forEach(function (k, i) { map[k].row = start + i; });
  }
  return saved;
}
// Undo on a posting: reopen only the replies that its own fill closed.
function alReopenReplies_(sh, map, pid) {
  var saved = [];
  Object.keys(map).forEach(function (k) {
    var st = map[k];
    if (k.indexOf('resp:') !== 0 || st.status !== AL_FILL_CLOSE || st.summary !== 'filled post:' + pid || !st.row) return;
    sh.getRange(st.row, 1, 1, AL_HEAD.length).setValues([[k, 'response', '', '', '', '']]);
    map[k] = { row: st.row, status: '', by: '', at: null, summary: '' };
    saved.push({ key: k, status: '', by: '', at: '', at_nice: '' });
  });
  return saved;
}
// List build found open replies under postings that are filled (on the sheet, the
// Admin Desk, or the hub before this change). Close them now, under the lock, re-reading
// the status tab first so nothing handled a moment ago is overwritten. Credited to
// whoever marked the posting filled in the hub, if anyone did.
function alCloseLater_(list) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    var sh = alSheet_();
    var map = alStatusMap_(sh);
    list.forEach(function (x) {
      var ps = map['post:' + x.pid];
      x.by = (ps && ps.status && ps.by) ? ps.by : 'Filled box on the sheet';
    });
    alCloseReplies_(sh, map, list, '', new Date());
  } finally {
    lock.releaseLock();
  }
}
function alJfRowType_(sh, row) { try { return row ? alStr_(sh.getRange(row, 2).getValue()) : ''; } catch (e) { return ''; } }
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
