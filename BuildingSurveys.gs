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
 *   bs_delete     -> remove one survey (index row, JSON file and its photos go to Drive trash)
 *   bs_import_legacy -> one-time pull of the old "Save to Sheets" tabs (CW Building Survey Results)
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
    if (kind === 'bs_delete') return bsvDelete_(d);
    if (kind === 'bs_import_legacy') return bsvImportLegacy_(d);
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
  var meta = bsvUpsert_(s);
  return bsvOut_({ ok: true, id: meta.id, updatedAt: meta.updated_at });
}

function bsvUpsert_(s) {
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
  return meta;
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

function bsvDelete_(d) {
  var id = String(d.id || '');
  if (!/^survey_[\w-]{1,40}$/.test(id)) return bsvOut_({ ok: false, error: 'Bad survey id' });
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var sh = bsvSheet_();
    var r = bsvFindRow_(sh, id);
    if (!r) return bsvOut_({ ok: false, error: 'Survey not found' });
    var fileId = String(sh.getRange(r, BSV_HEADERS.indexOf('json_file') + 1).getValue() || '');
    if (fileId) { try { DriveApp.getFileById(fileId).setTrashed(true); } catch (e) {} }
    var photos = 0;
    try {
      var it = bsvFolder_().searchFiles("title contains 'bsv_" + id + "_'");
      while (it.hasNext()) { it.next().setTrashed(true); photos++; }
    } catch (e2) {}
    sh.deleteRow(r);
  } finally {
    lock.releaseLock();
  }
  return bsvOut_({ ok: true, id: id, photos: photos });
}


// ------------------------------------------------- legacy import (Sep 25 2026) --
// The old Building Survey "Save to Sheets" button wrote one flattened tab per survey to
// "CW Building Survey Results" (label / value rows under Inputs, Walkthrough Areas,
// Special Requests, Results). This rebuilds each tab into a real survey so the team can
// open and edit its history. Safe to re-run: the id is derived from the tab name.
var BSV_LEGACY_SHEET_ID = '1Z4Wuvs9Xpwcaz0s0DTB5GVTuBfr8iSG4IaL6bfVd9GI';
var BSV_LEGACY_FIELDS = {
  'Surveyed By': 'surveyor', 'Surveyor Email': 'surveyorEmail',
  'Company Name': 'companyName', 'Address': 'address', 'City': 'city', 'State, Zip': 'stateZip',
  'Industry Type': 'businessType', 'Region & Shift': 'rateTier', 'Contact Name': 'contactName', 'Title': 'contactTitle',
  'Phone': 'phone', 'Email': 'email', 'Survey Date': 'surveyDate',
  'Building Survey For': 'buildingSurveyFor', 'Pre-Research': 'preResearch', 'Qualifying Info': 'qualifyingInfo',
  'Rapport Notes': 'rapportNotes',
  'Current JS Company': 'currentJSComp', 'Time with Current': 'timeWithCurrent',
  'Previous JS Company': 'previousJSComp', 'Companies Past 5 Years': 'numCompPast5',
  'Current Situation': 'currentSituation', 'Likes About Current': 'likesAboutCurrent', 'Wants Changed': 'wantChanged',
  'Satisfaction (1-5)': 'satisfactionScale', 'Time Spent on JS': 'timeOnJS', 'Most Important Change': 'mostImportantChange',
  'Budget (Monthly)': 'budgetAmount', 'Budget Notes': 'budgetNotes',
  'Days / Week': 'daysPerWeek', 'Crew / Night': 'peoplePerNight', 'Hours / Night': 'hoursPerNight',
  'Density': 'density', 'Traffic': 'traffic', 'Occupants': 'occupants', 'Building Hours': 'buildingHours',
  'Day Porter Interest': 'porterInterest', 'Porter Coverage': 'porterCoverage',
  'Access Method': 'accessMethod', 'Access / Security Notes': 'accessNotes',
  'Dumpster Location': 'dumpsterLocation', 'Janitor Closet / Water': 'janitorCloset',
  'Dumpster Walk (one way)': 'dumpsterWalk', 'Trash Run Route': 'dumpsterRoute', 'Trash Run Notes': 'dumpsterNotes',
  'Floors Served': 'floorsCount', 'Elevator': 'elevator',
  'Total Cleanable SqFt': 'totalSqft', 'Total Restrooms': 'totalRR', 'Total Fixtures': 'totalFixtures',
  'Timeline to Switch': 'timelineToSwitch', 'Start Restrictions': 'startRestrictions',
  'Other Decision Makers': 'otherDecisionMakers', 'Decision Process': 'decisionProcess', 'Proposal Date': 'proposalDate',
  'Floor Care Frequency': 'fcFrequency', 'Primary Floor Type': 'fcFloorType', 'Bundle FC with JS': 'bundleWithJS',
  'Extra Notes': 'extraNotes',
  'Supply Brands': 'supplyBrands', 'Toilet Paper': 'supplyTP', 'Towels': 'supplyTowels',
  'Soap': 'supplySoap', 'Dispensers': 'supplyDispensers'
};
var BSV_LEGACY_CHECKS = {
  'Meeting Objectives': { 'Build Trust': 'obj_trust', 'Develop Relationships': 'obj_relationships', 'Learn Key Info': 'obj_keyInfo', 'Confirm Timeline': 'obj_timeline', 'Establish Objective': 'obj_objective', 'Scope of Work': 'obj_scope', 'Floor Plan': 'obj_floorPlan', 'Recap Last Convo': 'obj_recap' },
  'Biggest Frustrations': { 'Attention to Detail': 'frust_detail', 'Basics': 'frust_basics', 'Communication': 'frust_comm', 'Consistency': 'frust_consistency', 'Costs': 'frust_costs', 'Never Improves': 'frust_neverImproves', 'Not Enough Time': 'frust_time', 'Security/Theft': 'frust_security', 'Turnover': 'frust_turnover' },
  'Value Prop Delivered': { 'We represent the client': 'vp_represent', 'Proactive management': 'vp_proactive', 'One contact / 20+ solutions': 'vp_oneContact', 'A+B+C explained': 'vp_abc' },
  'Hard Surface Floor Care': { 'Strip & Wax': 'fc_stripWax', 'Top Scrub & Wax': 'fc_topScrub', 'Machine Scrub Ceramic': 'fc_machineScrub', 'Hi-Speed Buff': 'fc_buff' },
  'Carpet Care': { 'Extraction': 'cc_extraction', 'Traffic Pattern': 'cc_trafficPattern', 'Bonnet': 'cc_bonnet' },
  'Additional Services': { 'COI': 'svc_coi', 'Bloodborne': 'svc_bloodborne', 'Hazard Comm': 'svc_hazard', 'Initial Clean': 'svc_initialClean', 'Kitchen': 'svc_kitchen', 'Alarm Code': 'svc_alarm', 'Dumpsters': 'svc_dumpsters', 'Recycling': 'svc_recycling', 'Window Wash': 'svc_windowWash', 'Pest Control': 'svc_pest', 'Sidelights': 'svc_sidelights', 'Blinds': 'svc_blinds', 'High Work': 'svc_highWork', 'Pressure Wash': 'svc_pressureWash', 'Matting': 'svc_matting' }
};
var BSV_AREA_TYPES = ['General Office', 'Private Offices', 'Cubicles / Open Office', 'Conference Room', 'Entry / Lobby / Reception', 'Waiting Area', 'Hallway / Corridor', 'Break Room / Lunch', 'Kitchen (Full Clean)', 'Restroom', 'Locker Room', 'Exam Room', 'Lab Area', 'Patient Room', 'Classroom', 'Gym / Workout Area', 'Cafeteria / Dining', 'Teller Area', 'Retail Floor', 'Sanctuary', 'Warehouse / Plant', 'Service Bay', 'Storage', 'Stairwell', 'Elevator', 'Server / Copy Room', 'Other'];
var BSV_FLOOR_NAMES = { 'Carpet': 'Carpet', 'CPT': 'Carpet', 'VCT': 'VCT', 'LVT': 'LVT', 'LVP': 'LVP', 'Ceramic': 'Ceramic Tile', 'Ceramic Tile': 'Ceramic Tile', 'CER': 'Ceramic Tile',
  'Concrete': 'Concrete', 'CONC': 'Concrete', 'Polished': 'Polished Concrete', 'Polished Concrete': 'Polished Concrete', 'Epoxy': 'Epoxy', 'Marble': 'Marble', 'Terrazzo': 'Terrazzo', 'Wood': 'Wood', 'Rubber': 'Rubber', 'Other': 'Other' };

function bsvLegacyId_(tab) {
  var slug = String(tab).replace(/[^A-Za-z0-9]/g, '').slice(0, 32);
  return 'survey_legacy_' + (slug || 'tab');
}

// "General Office · 392 sqft · (14x28) · Carpet 60%/VCT 40% · 2T/1U/2S (5 fix) · FLEX | HOT SPOT: x | Notes: y | 2 photo(s) on device"
function bsvParseArea_(label, text, idx) {
  var name = String(label).replace(/^Area \d+:\s*/, '').trim();
  var a = { id: 'area_legacy_' + idx, name: name === 'Unnamed' ? '' : name, type: '', len: '', wid: '', dims: '', sqft: '', sqftAuto: false,
    floorTypes: [], floorSplit: {}, floorOther: '', toilets: 0, urinals: 0, sinks: 0, trash: 0, trashSize: '', cleanLevel: 'Normal Clean',
    walkNext: '', walkThru: 0, flex: false, hotspot: false, hotspotNote: '', notes: '', photos: [], collapsed: true, copyOf: '' };
  var parts = String(text || '').split(' | ');
  var desc = parts.shift() || '';
  parts.forEach(function (p) {
    p = p.trim();
    var m;
    if ((m = p.match(/^HOT SPOT:?\s*(.*)$/))) { a.hotspot = true; a.hotspotNote = m[1] || ''; }
    else if ((m = p.match(/^Notes:\s*(.*)$/))) { a.notes = m[1] || ''; }
    else if ((m = p.match(/^(\d+) photo\(s\) on device$/))) { a.notes = (a.notes ? a.notes + ' | ' : '') + m[1] + ' photo(s) stayed on the phone that walked this survey'; }
    else if (p) { a.notes = (a.notes ? a.notes + ' | ' : '') + p; }
  });
  desc.split(' · ').forEach(function (bit, bi) {
    bit = bit.trim();
    var m;
    if (!bit) return;
    // The old line put the room type first. "Other" anywhere later is the floor chip.
    if (BSV_AREA_TYPES.indexOf(bit) >= 0 && (bi === 0 || bit !== 'Other')) { a.type = bit; return; }
    if ((m = bit.match(/^([\d,\.]+)\s*sqft$/i))) { a.sqft = m[1].replace(/,/g, ''); return; }
    if ((m = bit.match(/^\((\d+(?:\.\d+)?)\s*[xX]\s*(\d+(?:\.\d+)?)\)$/))) { a.len = m[1]; a.wid = m[2]; a.dims = m[1] + 'x' + m[2]; return; }
    if ((m = bit.match(/^(\d+)T\/(\d+)U\/(\d+)S/))) { a.toilets = Number(m[1]); a.urinals = Number(m[2]); a.sinks = Number(m[3]); return; }
    if (bit === 'FLEX') { a.flex = true; return; }
    if (/^(NOT CLEANED|DEEP CLEAN|SPOT CLEAN|FLOORS ONLY|CLEAN ROOM)$/.test(bit)) { a.cleanLevel = bit === 'NOT CLEANED' ? 'Not Cleaned' : bit.charAt(0) + bit.slice(1).toLowerCase().replace(/ (\w)/g, function (x, c) { return ' ' + c.toUpperCase(); }); return; }
    if ((m = bit.match(/^(\d+) trash/))) { a.trash = Number(m[1]); return; }
    // floors: "Carpet 60%/VCT 40%" or "Ceramic" or "Carpet/VCT"
    var floorBits = bit.split('/');
    var ok = true, types = [], split = {};
    floorBits.forEach(function (f) {
      var fm = f.trim().match(/^(.+?)(?:\s+(\d+)%)?$/);
      var nm = fm ? fm[1].trim() : f.trim();
      if (BSV_FLOOR_NAMES[nm]) { types.push(BSV_FLOOR_NAMES[nm]); if (fm && fm[2]) split[BSV_FLOOR_NAMES[nm]] = fm[2]; }
      else ok = false;
    });
    if (ok && types.length) { a.floorTypes = types; a.floorSplit = split; return; }
    if (!a.type && !a.floorTypes.length && bit.length < 40 && !/\d/.test(bit)) { a.floorTypes = ['Other']; a.floorOther = bit; return; }
    a.notes = (a.notes ? a.notes + ' | ' : '') + bit;
  });
  if (!a.type && a.name) {
    var low = a.name.toLowerCase();
    if (/restroom|bathroom|rr\b/.test(low)) a.type = 'Restroom';
    else if (/office/.test(low)) a.type = 'General Office';
    else if (/conference/.test(low)) a.type = 'Conference Room';
    else if (/hall/.test(low)) a.type = 'Hallway / Corridor';
    else if (/kitchen|break/.test(low)) a.type = 'Break Room / Lunch';
    else if (/lobby|recept|entry|vestibule/.test(low)) a.type = 'Entry / Lobby / Reception';
    else if (/storage|closet/.test(low)) a.type = 'Storage';
    else if (/exam|treatment/.test(low)) a.type = 'Exam Room';
    else if (/lab/.test(low)) a.type = 'Lab Area';
  }
  return a;
}

function bsvParseLegacyTab_(sh) {
  var v = sh.getDataRange().getValues();
  var fd = {}, areas = [], requests = [], section = '', savedText = '';
  for (var i = 0; i < v.length; i++) {
    var label = String(v[i][0] || '').trim(), val = v[i][1];
    var valStr = (val instanceof Date) ? Utilities.formatDate(val, 'America/Los_Angeles', 'yyyy-MM-dd') : String(val === null || val === undefined ? '' : val);
    if (i < 4) { if (/^Saved /.test(label)) savedText = label; continue; }
    if (!label) continue;
    if (/^(Inputs|Walkthrough Areas|Special Requests|Results)$/.test(label) && !valStr) { section = label; continue; }
    if (section === 'Inputs') {
      if (BSV_LEGACY_FIELDS[label]) { fd[BSV_LEGACY_FIELDS[label]] = valStr.trim(); continue; }
      if (BSV_LEGACY_CHECKS[label]) {
        var map = BSV_LEGACY_CHECKS[label];
        valStr.split(',').forEach(function (item) { item = item.trim(); if (map[item]) fd[map[item]] = true; });
        continue;
      }
      fd.extraNotes = (fd.extraNotes ? fd.extraNotes + '\n' : '') + label + ': ' + valStr;
    } else if (section === 'Walkthrough Areas') {
      if (/^Area \d+:/.test(label)) areas.push(bsvParseArea_(label, valStr, areas.length + 1));
    } else if (section === 'Special Requests') {
      var who = '', where = '', text = valStr;
      var mw = text.match(/\s*\|\s*Where:\s*(.*)$/); if (mw) { where = mw[1].trim(); text = text.replace(mw[0], ''); }
      var mb = text.match(/\s*\|\s*By:\s*(.*)$/); if (mb) { who = mb[1].trim(); text = text.replace(mb[0], ''); }
      requests.push({ id: 'req_legacy_' + (requests.length + 1), text: text.trim(), who: who, where: where, photos: [] });
    }
  }
  var dens = { 'Dense': 'Heavy Use', 'Average': 'Normal', 'Light': 'Light Use' };
  if (dens[fd.density]) fd.density = dens[fd.density];
  var saved = new Date();
  var sm = savedText.match(/Saved (.+)$/);
  if (sm) { var dt = new Date(sm[1].replace(/ at /, ' ')); if (!isNaN(dt.getTime())) saved = dt; }
  var tab = sh.getName();
  var s = { id: bsvLegacyId_(tab), formData: fd, areas: areas, requests: requests, step: 4,
    updatedAt: saved.toISOString(), companyName: fd.companyName || tab, surveyor: fd.surveyor || '', surveyorEmail: fd.surveyorEmail || '',
    legacy: { sheet: sh.getParent().getId(), tab: tab, importedAt: new Date().toISOString() } };
  return s;
}

function bsvImportLegacy_(d) {
  var ss = SpreadsheetApp.openById(String(d.sheetId || BSV_LEGACY_SHEET_ID));
  var dry = !!d.dry;
  var out = [];
  ss.getSheets().forEach(function (sh) {
    if (sh.getName() === 'Log') return;
    var s = bsvParseLegacyTab_(sh);
    if (!s.areas.length && !s.formData.companyName) return;
    var info = { tab: sh.getName(), id: s.id, company: s.companyName, areas: s.areas.length, typed: s.areas.filter(function (a) { return a.type; }).length,
      sqft: s.areas.reduce(function (t, a) { return t + (Number(a.sqft) || 0); }, 0), fixtures: s.areas.reduce(function (t, a) { return t + a.toilets + a.urinals + a.sinks; }, 0),
      requests: s.requests.length, fields: Object.keys(s.formData).length, updatedAt: s.updatedAt };
    if (!dry) bsvUpsert_(s);
    out.push(info);
  });
  return bsvOut_({ ok: true, dry: dry, imported: out });
}
