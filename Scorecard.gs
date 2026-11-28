// ============================================================
// Scorecard.gs - FSM scorecard store for the Ops Hub home strip (Nov 21 2026)
// File in the CW Team Portal Backend Apps Script project. doPost routes the sc_ prefix here.
//
// Why: the hub repos are public, and the scorecard holds customer names, vendor cost and
// margin, so the numbers cannot sit in a file on GitHub. A morning run pulls Dynamics CRM in
// the browser (cw-ops-desk/scorecard-pull.js), then posts each market here. The Ops Hub home
// reads it back with the team passcode.
//
// Storage (own book and own folder, created on first use, ids in script properties)
//   Drive folder "CW FSM Scorecard"   SC_FOLDER_ID   holds scorecard.json (SC_FILE_ID)
//   Sheet "CW FSM Scorecard"          SC_SHEET_ID    tab Log: one row per save
//
// Kinds (team passcode)
//   sc_get  {}                      -> {ok, data:{lv:{data,saved,by}, nnv:{...}, supplies:{...}}}
//   sc_put  {section, data, by}     -> {ok, section, bytes}   section = lv | nnv | supplies | platinum
//   sc_get  {section?}              -> only that section when given (Team Portal reads platinum this way)
// One section is replaced per put, so a market run never wipes the other market or supplies.
// ============================================================
var SC_NAME = 'CW FSM Scorecard';
var SC_EDITOR = 'tjroberts@gocitywide.com';
var SC_SECTIONS = { lv: 1, nnv: 1, supplies: 1, platinum: 1 };
var SC_CACHE_KEY = 'sc_json_v1';
var SC_MAX_BYTES = 400000;

function scDispatch(d) {
  if (String(d.passcode || '') !== PASSCODE) return _json({ ok: false, error: 'Wrong passcode.' });
  var kind = String(d.kind || '');
  try {
    if (kind === 'sc_get') return _json(scGet_(d));
    if (kind === 'sc_put') return _json(scPut_(d));
  } catch (e) {
    return _json({ ok: false, error: String(e && e.message || e) });
  }
  return _json({ ok: false, error: 'Unknown scorecard kind ' + kind });
}

function scProps_() { return PropertiesService.getScriptProperties(); }

function scFolder_() {
  var props = scProps_(), id = props.getProperty('SC_FOLDER_ID') || '';
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var folder = DriveApp.createFolder(SC_NAME);
  props.setProperty('SC_FOLDER_ID', folder.getId());
  try { folder.addEditor(SC_EDITOR); } catch (e2) {}
  try {
    var tp = DriveApp.getFoldersByName('Team Portal');
    if (tp.hasNext()) {
      var sub = tp.next().getFoldersByName('Team and Admin');
      if (sub.hasNext()) folder.moveTo(sub.next());
    }
  } catch (e3) {}
  return folder;
}

function scFile_(create) {
  var props = scProps_(), id = props.getProperty('SC_FILE_ID') || '';
  if (id) { try { return DriveApp.getFileById(id); } catch (e) {} }
  if (!create) return null;
  var f = scFolder_().createFile('scorecard.json', '{}', 'application/json');
  props.setProperty('SC_FILE_ID', f.getId());
  return f;
}

function scBook_() {
  var props = scProps_(), id = props.getProperty('SC_SHEET_ID') || '';
  if (id) { try { return SpreadsheetApp.openById(id); } catch (e) {} }
  var ss = SpreadsheetApp.create(SC_NAME);
  props.setProperty('SC_SHEET_ID', ss.getId());
  var sh = ss.getSheets()[0];
  sh.setName('Log');
  sh.getRange(1, 1, 1, 6).setValues([['when', 'by', 'section', 'as_of', 'bytes', 'note']]).setFontWeight('bold');
  sh.setFrozenRows(1);
  try { DriveApp.getFileById(ss.getId()).addEditor(SC_EDITOR); } catch (e2) {}
  try { DriveApp.getFileById(ss.getId()).moveTo(scFolder_()); } catch (e3) {}
  return ss;
}

function scRead_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get(SC_CACHE_KEY);
  if (hit) return hit;
  var f = scFile_(false);
  var txt = f ? f.getBlob().getDataAsString() : '{}';
  if (txt.length < 90000) { try { cache.put(SC_CACHE_KEY, txt, 21600); } catch (e) {} }
  return txt;
}

function scGet_(d) {
  var obj = {};
  try { obj = JSON.parse(scRead_() || '{}') || {}; } catch (e) { obj = {}; }
  // Optional {section}: return only that section, so a page that needs one small section (the Team Portal
  // platinum thermometer) does not download the whole scorecard. No section = everything, as before.
  var sec = String((d && d.section) || '');
  if (sec) { var one = {}; if (obj[sec]) one[sec] = obj[sec]; return { ok: true, data: one }; }
  return { ok: true, data: obj };
}

function scPut_(d) {
  var section = String(d.section || '');
  if (!SC_SECTIONS[section]) return { ok: false, error: 'Unknown section ' + section + '. Use lv, nnv, supplies or platinum.' };
  if (!d.data || typeof d.data !== 'object') return { ok: false, error: 'Nothing to save.' };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var f = scFile_(true), obj = {};
    try { obj = JSON.parse(f.getBlob().getDataAsString() || '{}') || {}; } catch (e) { obj = {}; }
    var when = Utilities.formatDate(new Date(), 'America/Los_Angeles', "yyyy-MM-dd'T'HH:mm:ss");
    var by = String(d.by || '').slice(0, 80);
    obj[section] = { data: d.data, saved: when, by: by };
    var txt = JSON.stringify(obj);
    if (txt.length > SC_MAX_BYTES) return { ok: false, error: 'Scorecard is too large to save (' + txt.length + ' bytes).' };
    f.setContent(txt);
    var cache = CacheService.getScriptCache();
    try { if (txt.length < 90000) cache.put(SC_CACHE_KEY, txt, 21600); else cache.remove(SC_CACHE_KEY); } catch (e2) {}
    try {
      scBook_().getSheetByName('Log').appendRow([when, by, section, String(d.data.asOf || ''), JSON.stringify(d.data).length, String(d.note || '').slice(0, 200)]);
    } catch (e3) {}
    return { ok: true, section: section, bytes: txt.length, saved: when };
  } finally {
    lock.releaseLock();
  }
}
