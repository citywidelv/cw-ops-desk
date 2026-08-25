/**
 * CW Team Directory - staff list for the Ops Hub (first consumer: create-exhibit-a.html).
 *
 * Standalone Google Sheet per the one-sheet-per-purpose rule. The sheet ID lives in
 * ScriptProperties key STAFF_SHEET_ID; staff_setup creates the sheet on first run.
 * Team members edit the Staff tab directly (names, roles, phones, emails); pages read
 * it through kind "staff_list" on the same /exec URL.
 *
 * Wire-up in the main file's doPost router:
 *   if (kind.indexOf('staff_') === 0) return staffDispatch(data);
 *
 * Kinds:
 *   staff_setup - idempotent; creates the "CW Team Directory" sheet, Staff tab,
 *                 headers, dropdown validations, and the seed roster if missing.
 *   staff_list  - active staff rows plus the sheet URL for the "Open the team list" link.
 */

var STAFF_HEADERS = ['name', 'role', 'market', 'phone', 'email', 'active'];
var STAFF_ROLES = ['Facility Solutions Manager', 'Night Manager', 'Director of Operations', 'General Manager', 'Business Operations Manager', 'Chief Operating Officer', 'Sales', 'Accounting', 'Other'];
var STAFF_MARKETS = ['Las Vegas', 'Northern Nevada', 'Both'];
var STAFF_SEED = [
  ['Alex Manon', 'Facility Solutions Manager', 'Las Vegas', '', '', 'TRUE'],
  ['Brett Stephens', 'Facility Solutions Manager', 'Las Vegas', '', '', 'TRUE'],
  ['Jake Schmidt', 'Facility Solutions Manager', 'Las Vegas', '', '', 'TRUE'],
  ['Sam Morse', 'Facility Solutions Manager', 'Northern Nevada', '(775) 842-5591', 'smorse@gocitywide.com', 'TRUE'],
  ['Jeremy Walker', 'General Manager', 'Northern Nevada', '(775) 217-7280', '', 'TRUE'],
  ['Robert Krause', 'Director of Operations', 'Las Vegas', '(702) 544-0492', 'rkraus@gocitywide.com', 'TRUE'],
  ['Joshua Smith', 'Business Operations Manager', 'Both', '', '', 'TRUE'],
  ['TJ Roberts', 'Chief Operating Officer', 'Both', '', 'tjroberts@gocitywide.com', 'TRUE']
];

function staffPass_() {
  try { if (typeof PASSCODE !== 'undefined') return PASSCODE; } catch (e) {}
  return PropertiesService.getScriptProperties().getProperty('PASSCODE') || '';
}

function staffOut_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function staffSS_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('STAFF_SHEET_ID');
  if (id) { try { return SpreadsheetApp.openById(id); } catch (e) {} }
  var ss = SpreadsheetApp.create('CW Team Directory');
  props.setProperty('STAFF_SHEET_ID', ss.getId());
  return ss;
}

function staffDispatch(data) {
  var kind = String(data.kind || '');
  if ((data.passcode || '') !== staffPass_()) return staffOut_({ ok: false, error: 'Bad passcode' });
  if (kind === 'staff_setup') return staffSetup_(data);
  if (kind === 'staff_list') return staffList_(data);
  if (kind === 'staff_options') return staffOptions_(data);
  if (kind === 'staff_option_add') return staffOptionAdd_(data);
  return staffOut_({ ok: false, error: 'Unknown staff kind' });
}

function staffSetup_(data) {
  var ss = staffSS_();
  var sh = ss.getSheetByName('Staff');
  if (!sh) {
    sh = ss.insertSheet('Staff');
    sh.getRange(1, 1, 1, STAFF_HEADERS.length).setValues([STAFF_HEADERS])
      .setFontWeight('bold').setBackground('#D22730').setFontColor('#FFFFFF');
    sh.getRange(2, 1, STAFF_SEED.length, STAFF_HEADERS.length).setValues(STAFF_SEED);
    var roleRule = SpreadsheetApp.newDataValidation().requireValueInList(STAFF_ROLES, true).setAllowInvalid(true).build();
    sh.getRange(2, STAFF_HEADERS.indexOf('role') + 1, 500, 1).setDataValidation(roleRule);
    var mktRule = SpreadsheetApp.newDataValidation().requireValueInList(STAFF_MARKETS, true).setAllowInvalid(true).build();
    sh.getRange(2, STAFF_HEADERS.indexOf('market') + 1, 500, 1).setDataValidation(mktRule);
    var actRule = SpreadsheetApp.newDataValidation().requireValueInList(['TRUE', 'FALSE'], true).setAllowInvalid(true).build();
    sh.getRange(2, STAFF_HEADERS.indexOf('active') + 1, 500, 1).setDataValidation(actRule);
    sh.setFrozenRows(1);
    sh.setColumnWidths(1, STAFF_HEADERS.length, 170);
    var d = ss.getSheetByName('Sheet1');
    if (d && ss.getSheets().length > 1) ss.deleteSheet(d);
  }
  return staffOut_({ ok: true, url: ss.getUrl(), id: ss.getId() });
}

function staffList_(data) {
  var ss = staffSS_();
  var sh = ss.getSheetByName('Staff');
  if (!sh) return staffOut_({ ok: false, error: 'Run staff_setup first.' });
  var v = sh.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < v.length; i++) {
    if (!v[i][0]) continue;
    if (String(v[i][5]).toUpperCase() === 'FALSE') continue;
    out.push({
      name: String(v[i][0]), role: String(v[i][1] || ''), market: String(v[i][2] || ''),
      phone: String(v[i][3] || ''), email: String(v[i][4] || '')
    });
  }
  return staffOut_({ ok: true, staff: out, url: ss.getUrl() });
}

/**
 * Exhibit A Options tab: custom checklist items the team adds from the
 * Create an Exhibit A page (kind staff_option_add) or straight in the sheet.
 * Sections match the directive section titles on the page. Set active FALSE
 * to retire an item without losing it.
 */
var STAFF_OPT_TAB = 'Exhibit A Options';
var STAFF_OPT_HEADERS = ['section', 'item', 'active'];
var STAFF_OPT_SECTIONS = ['Service Specifications', 'Supplies and Equipment', 'Conduct on Site', 'Required Training'];

function staffOptTab_(ss) {
  var sh = ss.getSheetByName(STAFF_OPT_TAB);
  if (!sh) {
    sh = ss.insertSheet(STAFF_OPT_TAB);
    sh.getRange(1, 1, 1, 3).setValues([STAFF_OPT_HEADERS])
      .setFontWeight('bold').setBackground('#D22730').setFontColor('#FFFFFF');
    sh.getRange(2, 1, 1, 3).setValues([['Service Specifications', 'Cleanroom Cleaning', 'TRUE']]);
    var secRule = SpreadsheetApp.newDataValidation().requireValueInList(STAFF_OPT_SECTIONS, true).setAllowInvalid(true).build();
    sh.getRange(2, 1, 500, 1).setDataValidation(secRule);
    var actRule = SpreadsheetApp.newDataValidation().requireValueInList(['TRUE', 'FALSE'], true).setAllowInvalid(true).build();
    sh.getRange(2, 3, 500, 1).setDataValidation(actRule);
    sh.setFrozenRows(1);
    sh.setColumnWidths(1, 3, 220);
  }
  return sh;
}

function staffOptions_(data) {
  var ss = staffSS_();
  var sh = staffOptTab_(ss);
  var v = sh.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < v.length; i++) {
    if (!v[i][0] || !v[i][1]) continue;
    if (String(v[i][2]).toUpperCase() === 'FALSE') continue;
    out.push({ section: String(v[i][0]), item: String(v[i][1]) });
  }
  return staffOut_({ ok: true, options: out, url: ss.getUrl() });
}

function staffOptionAdd_(data) {
  var section = String(data.section || '').trim();
  var item = String(data.item || '').trim();
  if (!section || !item) return staffOut_({ ok: false, error: 'Need a section and an item.' });
  if (item.length > 120) return staffOut_({ ok: false, error: 'Keep items under 120 characters.' });
  var sh = staffOptTab_(staffSS_());
  var v = sh.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) {
    if (String(v[i][0]) === section && String(v[i][1]).toLowerCase() === item.toLowerCase()) {
      return staffOut_({ ok: true, existed: true });
    }
  }
  sh.appendRow([section, item, 'TRUE']);
  return staffOut_({ ok: true, existed: false });
}
