/**
 * CW Building Surveys - the cloud copy of every building survey (Sep 25 2026).
 *
 * The Building Survey page (citywidelv.github.io/BuildingSurvey/) saves to the phone
 * first and mirrors here, so a survey walked on a phone opens on any device, is listed
 * by the person who walked it, and can be edited or exported from the office.
 *
 * Routed from doPost: kinds starting bs_ come here. Team passcode, checked server side.
 *   bs_list       -> every survey (index rows), newest first
 *   bs_get        -> one survey, full JSON
 *   bs_save       -> upsert one survey (index row + JSON file)
 *   bs_photo_put  -> store one photo (JPEG, base64) in the survey folder
 *   bs_photo_get  -> read one photo back (base64)
 *
 * Storage is self-provisioning, same pattern as Inventory.gs: the first save creates
 * the "CW Building Surveys" spreadsheet (index) and Drive folder (JSON + photos) and
 * stores their ids in script properties SURVEY_SHEET_ID and SURVEY_FOLDER_ID, then adds
 * TJ as editor. Photos never go in the sheet; the JSON file never holds photo bytes.
 */
var BSV_SHEET_PROP = 'SURVEY_SHEET_ID';
var BSV_FOLDER_PROP = 'SURVEY_FOLDER_ID';
var BSV_TAB = 'Surveys';
var BSV_EDITOR = 'tjroberts@gocitywide.com';
var BSV_HEADERS = ['id', 'company', 'address', 'surveyor', 'surveyor_email', 'survey_date', 'industry', 'region_shift',
  'updated_at', 'step', 'areas', 'sqft', 'fixtures', 'trash', 'walk_min', 'hot_spots', 'photos', 'json_file'];

function bsvPass_() {
  try { if (typeof PASSCODE !== 'undefined') return PASSCODE; } catch (e) {}
  return PropertiesService.getScriptProperties().getProperty('PASSCODE') || '';
}
function bsvOut_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function bsvDispatch(d) {
  var kind = String(d.kind || '');
  if ((d.passcode || '') !== bsvPass_()) return bsvOut_({ ok: false, error: 'Bad passcode' });
  try {
    if (kind === 'bs_list') return bsvList_(d);
    if (kind === 'bs_get') return bsvGet_(d);
    if (kind === 'bs_save') return bsvSave_(d);
    if (kind === 'bs_photo_put') return bsvPhotoPut_(d);
    if (kind === 'bs_photo_get') return bsvPhotoGet_(d);
    return bsvOut_({ ok: false, error: 'Unknown bs kind' });
  } catch (err) {
    return bsvOut_({ ok: false, error: String(err && err.message || err) });
  }
}

// ---------------------------------------------------------------- storage --
function bsvSheet_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(BSV_SHEET_PROP) || '';
  var ss = null;
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; } }
  if (!ss) {
    ss = SpreadsheetApp.create('CW Building Surveys');
    props.setProperty(BSV_SHEET_PROP, ss.getId());
    try { DriveApp.getFileById(ss.getId()).addEditor(BSV_EDITOR); } catch (e) {}
    try { var f = bsvFolder_(); DriveApp.getFileById(ss.getId()).moveTo(f); } catch (e2) {}
  }
  var sh = ss.getSheetByName(BSV_TAB);
  if (!sh) {
    sh = ss.getSheets()[0];
    if (sh.getLastRow() > 0 && sh.getName() !== 'Sheet1') sh = ss.insertSheet(BSV_TAB);
    else sh.setName(BSV_TAB);
    sh.getRange(1, 1, 1, BSV_HEADERS.length).setValues([BSV_HEADERS]).setFontWeight('bold').setBackground('#D22730').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
  }
  return sh;
}

function bsvFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(BSV_FOLDER_PROP) || '';
  var folder = null;
  if (id) { try { folder = DriveApp.getFolderById(id); } catch (e) { folder = null; } }
  if (!folder) {
    folder = DriveApp.createFolder('CW Building Surveys');
    props.setProperty(BSV_FOLDER_PROP, folder.getId());
    try { folder.addEditor(BSV_EDITOR); } catch (e) {}
  }
  return folder;
}

function bsvRows_(sh) {
  var last = sh.getLastRow();
  if (last < 2) return [];
  var v = sh.getRange(2, 1, last - 1, BSV_HEADERS.length).getValues();
  var rows = [];
  for (var i = 0; i < v.length; i++) {
    if (!v[i][0]) continue;
    var o = { _row: i + 2 };
    for (var c = 0; c < BSV_HEADERS.length; c++) {
      var val = v[i][c];
      if (val instanceof Date) val = val.toISOString();
      o[BSV_HEADERS[c]] = val;
    }
    rows.push(o);
  }
  return rows;
}

function bsvFindRow_(sh, id) {
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === id) return i + 2;
  return 0;
}

// ------------------------------------------------------------------ kinds --
function bsvList_(d) {
  var sh = bsvSheet_();
  var rows = bsvRows_(sh);
  rows.forEach(function (r) { delete r._row; delete r.json_file; });
  rows.sort(function (a, b) { return String(b.updated_at).localeCompare(String(a.updated_at)); });
  return bsvOut_({ ok: true, surveys: rows, url: sh.getParent().getUrl() });
}

function bsvGet_(d) {
  var id = String(d.id || '');
  if (!id) return bsvOut_({ ok: false, error: 'Missing id' });
  var sh = bsvSheet_();
  var r = bsvFindRow_(sh, id);
  if (!r) return bsvOut_({ ok: false, error: 'Survey not found' });
  var fileId = String(sh.getRange(r, BSV_HEADERS.indexOf('json_file') + 1).getValue() || '');
  if (!fileId) return bsvOut_({ ok: false, error: 'Survey has no saved data' });
  var text = DriveApp.getFileById(fileId).getBlob().getDataAsString();
  var survey = JSON.parse(text);
  return bsvOut_({ ok: true, survey: survey });
}

function bsvNum_(v) { return Number(String(v === undefined || v === null ? '' : v).replace(/[^\d.]/g, '')) || 0; }

// Index columns are derived from the survey so the list page never needs the JSON.
function bsvMeta_(s) {
  var fd = s.formData || {};
  var areas = s.areas || [];
  var sqft = 0, fixtures = 0, trash = 0, walk = 0, hot = 0, photos = 0;
  areas.forEach(function (a) {
    var cleaned = (a.cleanLevel || 'Normal Clean') !== 'Not Cleaned';
    if (cleaned) {
      sqft += bsvNum_(a.sqft);
      fixtures += (Number(a.toilets) || 0) + (Number(a.urinals) || 0) + (Number(a.sinks) || 0);
    } else {
      walk += Number(a.walkThru) || 0;
    }
    trash += Number(a.trash) || 0;
    walk += Number(a.walkNext) || 0;
    if (a.hotspot) hot++;
    photos += (a.photos || []).length;
  });
  (s.requests || []).forEach(function (r) { photos += (r.photos || []).length; });
  return {
    id: String(s.id || ''),
    company: String(fd.companyName || s.companyName || 'Untitled Survey').slice(0, 200),
    address: [fd.address, fd.city, fd.stateZip].filter(Boolean).join(', ').slice(0, 200),
    surveyor: String(s.surveyor || fd.surveyor || '').slice(0, 120),
    surveyor_email: String(s.surveyorEmail || fd.surveyorEmail || '').slice(0, 120),
    survey_date: String(fd.surveyDate || ''),
    industry: String(fd.businessType || '').slice(0, 120),
    region_shift: String(fd.rateTier || '').slice(0, 60),
    updated_at: String(s.updatedAt || new Date().toISOString()),
    step: Number(s.step) || 1,
    areas: areas.length, sqft: Math.round(sqft), fixtures: fixtures, trash: trash,
    walk_min: walk, hot_spots: hot, photos: photos
  };
}

function bsvSave_(d) {
  var s = d.survey;
  if (typeof s === 'string') { try { s = JSON.parse(s); } catch (e) { s = null; } }
  if (!s || !s.id) return bsvOut_({ ok: false, error: 'Missing survey' });
  if (!/^survey_[\w-]{1,40}$/.test(String(s.id))) return bsvOut_({ ok: false, error: 'Bad survey id' });
  // Photo bytes never ride along; the page uploads them separately.
  (s.areas || []).forEach(function (a) { delete a.photoData; });
  var meta = bsvMeta_(s);
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var sh = bsvSheet_();
    var folder = bsvFolder_();
    var r = bsvFindRow_(sh, meta.id);
    var fileId = r ? String(sh.getRange(r, BSV_HEADERS.indexOf('json_file') + 1).getValue() || '') : '';
    var json = JSON.stringify(s);
    var file = null;
    if (fileId) { try { file = DriveApp.getFileById(fileId); } catch (e) { file = null; } }
    if (file) file.setContent(json);
    else { file = folder.createFile('bsv_' + meta.id + '.json', json, 'application/json'); fileId = file.getId(); }
    var row = BSV_HEADERS.map(function (h) { return h === 'json_file' ? fileId : (meta[h] !== undefined ? meta[h] : ''); });
    if (!r) r = sh.getLastRow() + 1;
    sh.getRange(r, 1, 1, row.length).setValues([row]);
  } finally {
    lock.releaseLock();
  }
  return bsvOut_({ ok: true, id: meta.id, updatedAt: meta.updated_at });
}

function bsvPhotoPut_(d) {
  var sid = String(d.surveyId || ''), pid = String(d.pid || '');
  if (!/^survey_[\w-]{1,40}$/.test(sid) || !/^ph_[\w-]{1,40}$/.test(pid)) return bsvOut_({ ok: false, error: 'Bad ids' });
  var data = String(d.data || '');
  var m = data.match(/^data:image\/(jpeg|jpg|png);base64,(.+)$/);
  if (!m) return bsvOut_({ ok: false, error: 'Photo must be a base64 JPEG' });
  var bytes = Utilities.base64Decode(m[2]);
  var name = 'bsv_' + sid + '_' + pid + '.jpg';
  var folder = bsvFolder_();
  // Same pid uploaded twice (retry after a dropped connection): keep one copy.
  var existing = folder.getFilesByName(name);
  while (existing.hasNext()) { existing.next().setTrashed(true); }
  var file = folder.createFile(Utilities.newBlob(bytes, 'image/jpeg', name));
  return bsvOut_({ ok: true, pid: pid, fileId: file.getId(), w: Number(d.w) || 0, h: Number(d.h) || 0 });
}

function bsvPhotoGet_(d) {
  var fileId = String(d.fileId || '');
  var sid = String(d.surveyId || ''), pid = String(d.pid || '');
  var file = null;
  if (fileId) { try { file = DriveApp.getFileById(fileId); } catch (e) { file = null; } }
  if (!file && sid && pid) {
    var it = bsvFolder_().getFilesByName('bsv_' + sid + '_' + pid + '.jpg');
    if (it.hasNext()) file = it.next();
  }
  if (!file || file.isTrashed()) return bsvOut_({ ok: false, error: 'Photo not found' });
  var blob = file.getBlob();
  return bsvOut_({ ok: true, data: 'data:image/jpeg;base64,' + Utilities.base64Encode(blob.getBytes()) });
}
