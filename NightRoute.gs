/**
 * NightRoute.gs  -  City Wide Nevada  -  Night Manager Route Out
 * ---------------------------------------------------------------------------
 * Replaces Jotform 241440730763149 ("Night Manager Route Out").
 *
 * What it does
 *   1. FSMs build tonight's route on cw-ops-desk/night-route.html. One row per
 *      STOP, not one row per submission, which is what makes status, linkage
 *      and the FSM view possible. The old form packed 10 stops onto one row.
 *   2. Buildings are picked from the Account Directory, never typed. The
 *      Jotform used free text and the spellings drifted so badly that nothing
 *      downstream could join on them.
 *   3. An FSM can also keep a STANDING checklist on a building. Those items
 *      ride every future inspection at that building whether or not the
 *      building is on tonight's route.
 *   4. The night inspection page pulls both. The night manager answers each
 *      item Yes / No / Couldn't with one line back, and the answer lands on
 *      the stop row so the FSM sees a direct reply.
 *
 * Kinds (routed from niDispatch on the shared ni_ prefix)
 *   ni_route_setup   create tabs, seed config, install the 4:00 PM trigger
 *   ni_route_list    stops for a night, plus standing checklists
 *   ni_route_save    upsert tonight's stops for one FSM + night manager
 *   ni_route_checks  save a building's standing checklist
 *   ni_route_send    build and send the route email (trigger or Send now)
 *
 * Rows are upserted by stop_id and retired by status, never deleted, so an
 * answered stop survives an FSM edit.
 */

var NR_TAB = 'Routes';
var NR_CHK_TAB = 'AccountChecks';
var NR_CFG_TAB = 'RouteConfig';
var NR_TRIGGER = 'niRouteDaily';

var NR_HEADERS = [
  'route_id', 'stop_id', 'created_at', 'updated_at', 'market', 'report_date',
  'fsm', 'fsm_email', 'nm_name', 'nm_email',
  'account_id', 'account_name',
  'reason', 'priority', 'instructions', 'check_items',
  'status', 'answered_at', 'inspection_id', 'check_answers', 'nm_note',
  'sent_at', 'flags'
];
var NR_CHK_HEADERS = ['account_id', 'account_name', 'market', 'items', 'updated_at', 'updated_by'];
var NR_CFG_HEADERS = ['key', 'value', 'note'];

var NR_PRIORITY = ['Must do', 'If you can'];
var NR_OPEN = ['Assigned'];

// Config lives in a tab so ops can change recipients and send time without a
// deploy. These are only the first-run defaults.
var NR_CFG_DEFAULTS = [
  ['send_hour', '16', 'Hour of the day the route email goes out, 0-23, Pacific. 16 = 4:00 PM.'],
  ['lv_to', 'cwlv_nm@gocitywide.com', 'Las Vegas night managers. Comma separated.'],
  ['lv_cc', 'lvservicecall@gocitywide.com', 'Las Vegas copy.'],
  ['nnv_to', '', 'Northern Nevada night managers. Blank = every active Night Manager on the Staff tab for that market.'],
  ['nnv_cc', 'rnservicecall@gocitywide.com', 'Northern Nevada copy.'],
  ['cc_fsm', 'TRUE', 'TRUE also copies the FSM who wrote each route.'],
  ['send_empty', 'TRUE', 'TRUE sends the message even when no route was written, so silence is never ambiguous.'],
  ['hub_url', 'https://citywidelv.github.io/cw-ops-desk/night-inspection.html', 'Where the email points the night manager.']
];

// ---------------------------------------------------------------- helpers --

function nrDispatch_(data) {
  var kind = String(data.kind || '');
  if (kind === 'ni_route_setup') return nrSetup_(data);
  if (kind === 'ni_route_list') return nrList_(data);
  if (kind === 'ni_route_save') return nrSave_(data);
  if (kind === 'ni_route_checks') return nrChecks_(data);
  if (kind === 'ni_route_send') return nrSend_(data);
  return niOut_({ ok: false, error: 'Unknown kind ' + kind });
}

function nrTab_() { return niTab_(niSS_(), NR_TAB, NR_HEADERS); }
function nrChkTab_() { return niTab_(niSS_(), NR_CHK_TAB, NR_CHK_HEADERS); }

function nrCfgTab_() {
  var sh = niTab_(niSS_(), NR_CFG_TAB, NR_CFG_HEADERS);
  if (sh.getLastRow() < 2) sh.getRange(2, 1, NR_CFG_DEFAULTS.length, 3).setValues(NR_CFG_DEFAULTS);
  return sh;
}

function nrCfg_() {
  var out = {};
  NR_CFG_DEFAULTS.forEach(function (d) { out[d[0]] = d[1]; });
  try {
    var sh = nrCfgTab_();
    var last = sh.getLastRow();
    if (last > 1) sh.getRange(2, 1, last - 1, 2).getValues().forEach(function (r) {
      var k = niStr_(r[0]); if (k) out[k] = niStr_(r[1]);
    });
  } catch (e) {}
  return out;
}

function nrTrue_(v) { return String(v).toUpperCase() === 'TRUE'; }
function nrList2_(s) { return niStr_(s).split(/[\n,;]+/).map(function (x) { return x.trim(); }).filter(String); }
/* Sheets turns a 'yyyy-MM-dd' string into a real Date on write, and niStr_
   renders a Date as 'yyyy-MM-dd HH:mm'. Compare the day only, so a stored
   date and a typed one always match. */
function nrDate_(v) { return niStr_(v).slice(0, 10); }
function nrId_(p) { return p + '-' + Utilities.formatDate(new Date(), NI_TZ, 'yyMMdd-HHmmss') + '-' + Math.random().toString(36).slice(2, 6); }

/**
 * The night a recap belongs to. Night managers work past midnight, so a recap
 * filed at 2:00 AM answers the route written the previous afternoon. Anything
 * before noon counts as the night before.
 */
function nrNightDate_(d) {
  d = d || new Date();
  var hour = Number(Utilities.formatDate(d, NI_TZ, 'H'));
  var use = new Date(d.getTime() - (hour < 12 ? 86400000 : 0));
  return Utilities.formatDate(use, NI_TZ, 'yyyy-MM-dd');
}

function nrRows_(sh) {
  sh = sh || nrTab_();
  var head = niHead_(sh), last = sh.getLastRow();
  if (last < 2) return { head: head, rows: [] };
  var vals = sh.getRange(2, 1, last - 1, head.length).getValues();
  var rows = vals.map(function (v, i) {
    var o = { _row: i + 2 };
    head.forEach(function (h, c) { if (h) o[h] = niStr_(v[c]); });
    return o;
  });
  return { head: head, rows: rows };
}

function nrWrite_(sh, head, rowNum, obj) {
  var line = head.map(function (h) { return obj[h] == null ? '' : obj[h]; });
  sh.getRange(rowNum, 1, 1, head.length).setValues([line]);
}

// ------------------------------------------------------------------ setup --

function nrSetup_(data) {
  nrTab_(); nrChkTab_(); nrCfgTab_();
  // The trigger needs the script.scriptapp scope. If the project has never been
  // authorized for it, create the tabs anyway and report the miss rather than
  // failing the whole setup.
  var t;
  try { t = nrInstallTrigger(); } catch (e) { t = { error: String(e && e.message || e) }; }
  return niOut_({ ok: true, tabs: [NR_TAB, NR_CHK_TAB, NR_CFG_TAB], trigger: t, sheet_url: niSS_().getUrl() });
}

/** One daily trigger at the configured hour. Replaces any earlier copy. */
function nrInstallTrigger() {
  var hour = Number(nrCfg_().send_hour || 16);
  if (isNaN(hour) || hour < 0 || hour > 23) hour = 16;
  var killed = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === NR_TRIGGER) { ScriptApp.deleteTrigger(t); killed++; }
  });
  ScriptApp.newTrigger(NR_TRIGGER).timeBased().atHour(hour).nearMinute(0).everyDays(1).inTimezone(NI_TZ).create();
  return { hour: hour, replaced: killed };
}

/** Time-driven entry point. Sends both markets. */
function niRouteDaily() {
  ['lv', 'nnv'].forEach(function (m) {
    try { nrSendMarket_(m, nrNightDate_(), false); } catch (e) {
      console.error('route send ' + m + ': ' + (e && e.message || e));
    }
  });
}

// ------------------------------------------------------------------- list --

/**
 * Everything the FSM page and the night inspection page need about a night.
 *   stops   the route for that night, newest edit wins, retired rows dropped
 *   checks  every building's standing checklist for the market
 */
function nrList_(data) {
  var mkt = niMarket_(data.market);
  var region = NI_MARKETS[mkt];
  var date = niStr_(data.report_date) || nrNightDate_();
  var wantFsm = niStr_(data.fsm), wantNm = niStr_(data.nm_name);
  var out = { ok: true, market: mkt, region: region, report_date: date, stops: [], checks: {}, warnings: [] };

  try {
    nrRows_().rows.forEach(function (r) {
      if (r.market !== region || nrDate_(r.report_date) !== date) return;
      if (r.status === 'Removed') return;
      if (wantFsm && r.fsm !== wantFsm) return;
      if (wantNm && r.nm_name !== wantNm) return;
      out.stops.push({
        route_id: r.route_id, stop_id: r.stop_id, fsm: r.fsm, nm_name: r.nm_name,
        account_id: r.account_id, account_name: r.account_name,
        reason: r.reason, priority: r.priority, instructions: r.instructions,
        check_items: r.check_items ? r.check_items.split('\n').filter(String) : [],
        status: r.status || 'Assigned', inspection_id: r.inspection_id,
        check_answers: r.check_answers, nm_note: r.nm_note, answered_at: r.answered_at
      });
    });
  } catch (e) { out.warnings.push('stops: ' + e.message); }

  try {
    var sh = nrChkTab_(), head = niHead_(sh), last = sh.getLastRow();
    if (last > 1) sh.getRange(2, 1, last - 1, head.length).getValues().forEach(function (v) {
      var o = {}; head.forEach(function (h, c) { if (h) o[h] = niStr_(v[c]); });
      if (o.market && o.market !== region) return;
      var items = (o.items || '').split('\n').filter(String);
      if (!items.length) return;
      var rec = { account_id: o.account_id, account_name: o.account_name, items: items, updated_at: o.updated_at, updated_by: o.updated_by };
      if (o.account_id) out.checks[o.account_id] = rec;
      if (o.account_name) out.checks[o.account_name.toLowerCase()] = rec;
    });
  } catch (e) { out.warnings.push('checks: ' + e.message); }

  return niOut_(out);
}

// ------------------------------------------------------------------- save --

/**
 * Upsert one FSM's route for one night manager on one night.
 *   - a stop already on the sheet is updated in place, keyed by stop_id
 *   - a stop the FSM dropped is marked Removed, never deleted, so an answer
 *     that already came back is not lost
 *   - a stop that has been answered is left alone apart from its instructions
 */
function nrSave_(data) {
  var mkt = niMarket_(data.market);
  var region = NI_MARKETS[mkt];
  var date = niStr_(data.report_date) || nrNightDate_();
  var fsm = niStr_(data.fsm);
  var nm = niStr_(data.nm_name);
  var stops = data.stops || [];
  if (!fsm) return niOut_({ ok: false, error: 'Pick your name first.' });
  if (!nm) return niOut_({ ok: false, error: 'Pick the night manager first.' });
  if (!stops.length) return niOut_({ ok: false, error: 'Add at least one building.' });

  var bad = [];
  stops.forEach(function (s, i) {
    if (!niStr_(s.account_name)) bad.push('Stop ' + (i + 1) + ' has no building.');
    if (!niStr_(s.instructions)) bad.push('Stop ' + (i + 1) + ' has no instructions.');
  });
  if (bad.length) return niOut_({ ok: false, error: bad[0] });

  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e) { return niOut_({ ok: false, error: 'Busy, try again.' }); }

  try {
    var sh = nrTab_(), rd = nrRows_(sh), head = rd.head;
    var now = new Date();
    var stamp = Utilities.formatDate(now, NI_TZ, 'yyyy-MM-dd HH:mm');
    var mine = {}, order = [];
    rd.rows.forEach(function (r) {
      if (r.market === region && nrDate_(r.report_date) === date && r.fsm === fsm && r.nm_name === nm) mine[r.stop_id] = r;
    });

    var routeId = niStr_(data.route_id) || nrId_('RT');
    var keep = {}, saved = 0, added = 0;

    stops.forEach(function (s) {
      var sid = niStr_(s.stop_id) || nrId_('ST');
      keep[sid] = true;
      var items = (s.check_items || []).map(function (x) { return niStr_(x); }).filter(String);
      var prev = mine[sid];
      var obj = {
        route_id: prev ? prev.route_id : routeId,
        stop_id: sid,
        created_at: prev ? prev.created_at : stamp,
        updated_at: stamp,
        market: region,
        report_date: date,
        fsm: fsm,
        fsm_email: niStr_(data.fsm_email),
        nm_name: nm,
        nm_email: niStr_(data.nm_email),
        account_id: niStr_(s.account_id),
        account_name: niStr_(s.account_name),
        reason: NI_REASONS.indexOf(niStr_(s.reason)) >= 0 ? niStr_(s.reason) : 'Regular check',
        priority: NR_PRIORITY.indexOf(niStr_(s.priority)) >= 0 ? niStr_(s.priority) : 'Must do',
        instructions: niStr_(s.instructions),
        check_items: items.join('\n'),
        status: prev ? (prev.status || 'Assigned') : 'Assigned',
        answered_at: prev ? prev.answered_at : '',
        inspection_id: prev ? prev.inspection_id : '',
        check_answers: prev ? prev.check_answers : '',
        nm_note: prev ? prev.nm_note : '',
        sent_at: prev ? prev.sent_at : '',
        flags: ''
      };
      if (prev) { nrWrite_(sh, head, prev._row, obj); saved++; }
      else { order.push(obj); added++; }
    });

    if (order.length) {
      var start = sh.getLastRow() + 1;
      sh.getRange(start, 1, order.length, head.length).setValues(order.map(function (o) {
        return head.map(function (h) { return o[h] == null ? '' : o[h]; });
      }));
    }

    // Stops the FSM took off the route. Keep anything already answered.
    var removed = 0;
    Object.keys(mine).forEach(function (sid) {
      if (keep[sid]) return;
      var r = mine[sid];
      if (r.inspection_id) return;
      var c = head.indexOf('status') + 1;
      if (c > 0) { sh.getRange(r._row, c).setValue('Removed'); removed++; }
    });

    // Standing checklists the FSM asked to keep on the building.
    var kept = 0;
    stops.forEach(function (s) {
      if (!s.keep_on_account) return;
      var items = (s.check_items || []).map(function (x) { return niStr_(x); }).filter(String);
      if (!items.length) return;
      nrChkPut_(region, niStr_(s.account_id), niStr_(s.account_name), items, fsm);
      kept++;
    });

    return niOut_({ ok: true, route_id: routeId, report_date: date, saved: saved, added: added, removed: removed, standing: kept });
  } catch (e) {
    return niOut_({ ok: false, error: String(e && e.message || e) });
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

// -------------------------------------------------- standing account checks --

function nrChkPut_(region, accountId, accountName, items, who) {
  var sh = nrChkTab_(), head = niHead_(sh), last = sh.getLastRow();
  var stamp = Utilities.formatDate(new Date(), NI_TZ, 'yyyy-MM-dd HH:mm');
  var found = 0;
  if (last > 1) {
    var vals = sh.getRange(2, 1, last - 1, head.length).getValues();
    var cId = head.indexOf('account_id'), cNm = head.indexOf('account_name');
    for (var i = 0; i < vals.length; i++) {
      var id = niStr_(vals[i][cId]), nm = niStr_(vals[i][cNm]).toLowerCase();
      if ((accountId && id === accountId) || (!accountId && nm && nm === accountName.toLowerCase())) { found = i + 2; break; }
    }
  }
  var obj = { account_id: accountId, account_name: accountName, market: region, items: items.join('\n'), updated_at: stamp, updated_by: who };
  nrWrite_(sh, head, found || (last + 1), obj);
  return true;
}

function nrChecks_(data) {
  var mkt = niMarket_(data.market);
  var name = niStr_(data.account_name);
  if (!name) return niOut_({ ok: false, error: 'Pick a building first.' });
  var items = (data.items || []).map(function (x) { return niStr_(x); }).filter(String);
  nrChkPut_(NI_MARKETS[mkt], niStr_(data.account_id), name, items, niStr_(data.fsm));
  return niOut_({ ok: true, account_name: name, count: items.length });
}

// ------------------------------------------------------------------- send --

function nrSend_(data) {
  var mkt = niMarket_(data.market);
  var date = niStr_(data.report_date) || nrNightDate_();
  var res = nrSendMarket_(mkt, date, true);
  return niOut_(res);
}

function nrRecipients_(mkt, cfg) {
  var to = nrList2_(cfg[mkt + '_to']);
  if (!to.length) {
    // Fall back to the Staff tab so a market with no shared mailbox still gets it.
    try {
      var sh = staffSS_().getSheetByName('Staff');
      var v = sh ? sh.getDataRange().getValues() : [];
      for (var i = 1; i < v.length; i++) {
        if (!v[i][0] || String(v[i][5]).toUpperCase() === 'FALSE') continue;
        if (String(v[i][1] || '').trim() !== 'Night Manager') continue;
        var m = String(v[i][2] || '').trim();
        if (m !== 'Both' && m !== NI_MARKETS[mkt]) continue;
        var em = String(v[i][4] || '').trim();
        if (em && to.indexOf(em) < 0) to.push(em);
      }
    } catch (e) {}
  }
  return to;
}

function nrSendMarket_(mkt, date, manual) {
  var cfg = nrCfg_();
  var region = NI_MARKETS[mkt];
  var sh = nrTab_(), rd = nrRows_(sh), head = rd.head;
  var stops = rd.rows.filter(function (r) {
    return r.market === region && nrDate_(r.report_date) === date && r.status !== 'Removed';
  });

  var to = nrRecipients_(mkt, cfg);
  if (!to.length) return { ok: false, error: 'No recipients configured for ' + region + '. Set ' + mkt + '_to on the RouteConfig tab.' };

  var cc = nrList2_(cfg[mkt + '_cc']);
  if (nrTrue_(cfg.cc_fsm)) stops.forEach(function (r) { if (r.fsm_email && cc.indexOf(r.fsm_email) < 0) cc.push(r.fsm_email); });

  if (!stops.length && !nrTrue_(cfg.send_empty) && !manual) return { ok: true, sent: false, reason: 'No route written and send_empty is FALSE.' };

  var byNm = {}, nmOrder = [];
  stops.forEach(function (r) {
    if (!byNm[r.nm_name]) { byNm[r.nm_name] = []; nmOrder.push(r.nm_name); }
    byNm[r.nm_name].push(r);
  });
  nmOrder.sort();

  var pretty = Utilities.formatDate(new Date(date.replace(/-/g, '/') + ' 12:00:00'), NI_TZ, 'EEEE, MMMM d');
  var hub = cfg.hub_url || 'https://citywidelv.github.io/cw-ops-desk/night-inspection.html';
  var subject = 'Tonight\'s route  ' + pretty + '  ' + (mkt === 'nnv' ? 'Northern Nevada' : 'Las Vegas')
    + (stops.length ? '  (' + stops.length + ' stop' + (stops.length === 1 ? '' : 's') + ')' : '  (nothing assigned)');

  var html = nrHtml_(nmOrder, byNm, pretty, region, hub, stops.length);
  var text = nrText_(nmOrder, byNm, pretty, region, hub, stops.length);

  var opts = {
    to: to.join(','), subject: subject, body: text, htmlBody: html,
    name: 'City Wide ' + (mkt === 'nnv' ? 'NNV' : 'LV') + ' Night Ops',
    replyTo: NI_SERVICE[mkt]
  };
  if (cc.length) opts.cc = cc.join(',');

  try {
    if (typeof cwMail_ === 'function') cwMail_('ni_route', opts); else cwSend_(opts);
  } catch (e) {
    return { ok: false, error: 'Mail failed: ' + (e && e.message || e) };
  }

  var stamp = Utilities.formatDate(new Date(), NI_TZ, 'yyyy-MM-dd HH:mm');
  var cSent = head.indexOf('sent_at') + 1;
  if (cSent > 0) stops.forEach(function (r) { try { sh.getRange(r._row, cSent).setValue(stamp); } catch (e) {} });

  return { ok: true, sent: true, market: region, report_date: date, stops: stops.length, to: to, cc: cc, subject: subject };
}

function nrHtml_(nmOrder, byNm, pretty, region, hub, count) {
  var RED = '#D22730', BLACK = '#2D2A26', GREY = '#636466', LINE = '#E5E5E5';
  var F = "Verdana,Geneva,Tahoma,sans-serif";
  var h = '<div style="font-family:' + F + ';color:' + BLACK + ';max-width:640px;margin:0 auto;padding:0 4px">';
  h += '<div style="border-top:4px solid ' + RED + ';padding-top:14px">'
    + '<div style="font-size:12px;font-weight:bold;letter-spacing:.08em;text-transform:uppercase;color:' + GREY + '">City Wide ' + niEsc_(region) + '  Night Ops</div>'
    + '<div style="font-size:21px;font-weight:bold;margin-top:4px">Tonight\'s route</div>'
    + '<div style="font-size:15px;color:' + GREY + ';margin-top:2px">' + niEsc_(pretty) + '</div></div>';

  if (!count) {
    h += '<p style="font-size:15px;line-height:1.6;margin:18px 0">No stops were assigned tonight. Work your normal route and file a recap for every building you visit.</p>';
  } else {
    nmOrder.forEach(function (nm) {
      var rows = byNm[nm];
      h += '<div style="margin-top:22px;padding-bottom:6px;border-bottom:2px solid ' + BLACK + '">'
        + '<span style="font-size:17px;font-weight:bold">' + niEsc_(nm || 'Unassigned') + '</span>'
        + '<span style="font-size:13px;color:' + GREY + '">  ' + rows.length + ' stop' + (rows.length === 1 ? '' : 's') + '</span></div>';
      rows.forEach(function (r, i) {
        var must = r.priority === 'Must do';
        h += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;border:1px solid ' + LINE + ';border-left:4px solid ' + (must ? RED : LINE) + ';border-radius:6px"><tr><td style="padding:14px 16px">';
        h += '<div style="font-size:17px;font-weight:bold">' + (i + 1) + '. ' + niEsc_(r.account_name) + '</div>';
        h += '<div style="font-size:12px;color:' + GREY + ';margin-top:4px;text-transform:uppercase;letter-spacing:.06em;font-weight:bold">'
          + niEsc_(r.reason || 'Regular check') + (must ? '  &bull;  <span style="color:' + RED + '">Must do</span>' : '  &bull;  If you can') + '</div>';
        h += '<div style="font-size:12px;font-weight:bold;letter-spacing:.06em;text-transform:uppercase;color:' + GREY + ';margin-top:12px">What to do</div>'
          + '<div style="font-size:15px;line-height:1.6;margin-top:3px;white-space:pre-wrap">' + niEsc_(r.instructions) + '</div>';
        var items = (r.check_items || '').split('\n').filter(String);
        if (items.length) {
          h += '<div style="font-size:12px;font-weight:bold;letter-spacing:.06em;text-transform:uppercase;color:' + GREY + ';margin-top:12px">What to check for</div><ul style="margin:4px 0 0 18px;padding:0">';
          items.forEach(function (it) { h += '<li style="font-size:15px;line-height:1.6">' + niEsc_(it) + '</li>'; });
          h += '</ul>';
        }
        h += '<div style="font-size:12px;color:' + GREY + ';margin-top:12px">Asked by ' + niEsc_(r.fsm) + '</div>';
        h += '</td></tr></table>';
      });
    });
  }

  h += '<div style="margin:26px 0 8px"><a href="' + hub + '" style="display:inline-block;background:' + RED + ';color:#fff;text-decoration:none;font-size:15px;font-weight:bold;padding:14px 22px;border-radius:6px">Open the night inspection page</a></div>';
  h += '<p style="font-size:13px;line-height:1.6;color:' + GREY + ';margin:14px 0 0">Pick your name on that page and tonight\'s stops are already there with these instructions. Answer the check-for items as you file each recap. You can still inspect any other building.</p>';
  h += '<div style="border-top:1px solid ' + LINE + ';margin-top:22px;padding-top:12px;font-size:12px;color:' + GREY + '">City Wide Facility Solutions  &bull;  GoCityWide.com</div></div>';
  return h;
}

function nrText_(nmOrder, byNm, pretty, region, hub, count) {
  var t = 'CITY WIDE ' + region.toUpperCase() + ' NIGHT OPS\nTonight\'s route  ' + pretty + '\n\n';
  if (!count) {
    t += 'No stops were assigned tonight. Work your normal route and file a recap for every building you visit.\n\n';
  } else {
    nmOrder.forEach(function (nm) {
      t += '== ' + (nm || 'Unassigned') + '  (' + byNm[nm].length + ') ==\n';
      byNm[nm].forEach(function (r, i) {
        t += '\n' + (i + 1) + '. ' + r.account_name + '  [' + (r.reason || 'Regular check') + ' / ' + (r.priority || 'Must do') + ']\n';
        t += 'What to do: ' + r.instructions + '\n';
        var items = (r.check_items || '').split('\n').filter(String);
        if (items.length) { t += 'What to check for:\n'; items.forEach(function (it) { t += '  - ' + it + '\n'; }); }
        t += 'Asked by ' + r.fsm + '\n';
      });
      t += '\n';
    });
  }
  t += 'Open the night inspection page: ' + hub + '\n\nPick your name and tonight\'s stops are already there. You can still inspect any other building.\n\nCity Wide Facility Solutions';
  return t;
}

// ------------------------------------------------ answer back from a recap --

/**
 * Called from niSubmit_ once the recap row is written. Writes the night
 * manager's answers onto the stop so the FSM sees a direct reply instead of
 * having to read the whole recap.
 */
function nrAnswer_(r) {
  var sid = niStr_(r.route_stop_id);
  if (!sid) return null;
  try {
    var sh = nrTab_(), rd = nrRows_(sh), head = rd.head;
    var hit = null;
    for (var i = 0; i < rd.rows.length; i++) if (rd.rows[i].stop_id === sid) { hit = rd.rows[i]; break; }
    if (!hit) return null;
    var stamp = Utilities.formatDate(new Date(), NI_TZ, 'yyyy-MM-dd HH:mm');
    var answers = niStr_(r.route_answers);
    var missed = answers.split('\n').filter(function (l) { return /\|\s*(No|Couldn't|Couldnt)\s*\|/i.test(l); });
    var set = {
      status: 'Done',
      answered_at: stamp,
      inspection_id: niStr_(r.inspection_id),
      check_answers: answers,
      nm_note: niStr_(r.summary).slice(0, 500),
      flags: missed.length ? 'not_met' : ''
    };
    Object.keys(set).forEach(function (k) {
      var c = head.indexOf(k) + 1;
      if (c > 0) sh.getRange(hit._row, c).setValue(set[k]);
    });
    return { stop_id: sid, status: 'Done', not_met: missed.length };
  } catch (e) {
    return { stop_id: sid, error: String(e && e.message || e) };
  }
}
