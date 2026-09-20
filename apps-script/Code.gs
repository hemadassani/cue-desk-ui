/**
 * CUE guest sign-up -> Google Sheet + Drive.
 *
 * The sheet IS the production team's dashboard: one row per participant, with
 * both photos shown inline via =IMAGE(). dashboard.html reads the same rows.
 *
 * SETUP
 *  1. Open the Google Sheet you want to use as the dashboard.
 *  2. Extensions > Apps Script. Delete the stub, paste this file, Save.
 *  3. Run `setup` once from the editor and accept the permission prompt.
 *     It creates the header row and the Drive folder.
 *  4. Deploy > New deployment > Web app
 *       Execute as:      Me
 *       Who has access:  Anyone           <- required; phones are not signed in
 *     Copy the /exec URL into config.js as `endpoint`.
 *  5. Re-deploy (Manage deployments > edit > Version: New) after ANY edit here,
 *     or the old code keeps serving.
 */

var SHEET_NAME = 'Participants';
var FOLDER_NAME = 'CUE participant photos';

/**
 * Face photos need to be link-readable for =IMAGE() in the sheet and for the
 * <img> tags in dashboard.html to render them. That means anyone holding the
 * URL can view that one photo.
 *
 * Set this to false to keep every photo private to your Drive. The sheet and the
 * dashboard then show a link and an initial instead of a face, and nothing else
 * breaks. Delete the Drive folder after the event either way.
 */
var LINK_READABLE_PHOTOS = true;

var HEADERS = ['Received', 'Event', 'Name', 'Role', 'Guest ID', 'Camera',
               'Front', 'Side', 'Consent', 'Front file', 'Side file'];
var COL = { received:1, event:2, name:3, role:4, guestId:5, camera:6,
            front:7, side:8, consent:9, frontFile:10, sideFile:11 };

/* ------------------------------------------------------------------ setup */

function setup() {
  var sheet = sheet_();
  folder_();
  SpreadsheetApp.getActiveSpreadsheet().toast('Ready. Now deploy as a web app.', 'CUE', 8);
  return sheet.getName();
}

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(COL.front, 110);
    sheet.setColumnWidth(COL.side, 110);
    sheet.setColumnWidth(COL.name, 160);
  }
  return sheet;
}

function folder_() {
  var it = DriveApp.getFoldersByName(FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER_NAME);
}

/* ------------------------------------------------------------------- read */

function doGet(e) {
  try {
    var params = (e && e.parameter) || {};
    if (params.action && params.action !== 'roster') {
      return json_({ ok: false, error: 'unknown action: ' + params.action });
    }
    return json_({
      ok: true,
      sheetUrl: SpreadsheetApp.getActiveSpreadsheet().getUrl(),
      participants: participants_(params.eventId)
    });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function participants_(eventId) {
  var sheet = sheet_();
  var last = sheet.getLastRow();
  if (last < 2) return [];
  var rows = sheet.getRange(2, 1, last - 1, HEADERS.length).getValues();
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (!r[COL.guestId - 1]) continue;
    if (eventId && r[COL.event - 1] && String(r[COL.event - 1]) !== String(eventId)) continue;
    out.push({
      guestId: String(r[COL.guestId - 1]),
      name: String(r[COL.name - 1]),
      role: String(r[COL.role - 1] || ''),
      camera: String(r[COL.camera - 1] || ''),
      /* Thumbnail URLs, not the originals: smaller, and they render in an <img>. */
      front: thumb_(r[COL.frontFile - 1]),
      side: thumb_(r[COL.sideFile - 1]),
      consent: r[COL.consent - 1] === true || String(r[COL.consent - 1]).toLowerCase() === 'yes',
      submittedAt: r[COL.received - 1] ? new Date(r[COL.received - 1]).toISOString() : ''
    });
  }
  return out;
}

function thumb_(fileId) {
  if (!fileId) return '';
  return 'https://drive.google.com/thumbnail?id=' + String(fileId) + '&sz=w320';
}

/* ------------------------------------------------------------------ write */

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (body.type === 'assign_camera') return json_(assignCamera_(body));
    if (body.type === 'export_sheet') return json_(exportToNewSpreadsheet());
    return json_(signUp_(body));
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (ignored) {}
  }
}

function signUp_(body) {
  var name = String(body.name || '').trim();
  if (name.length < 2) return { ok: false, error: 'a name is required' };
  if (body.consent !== true) return { ok: false, error: 'consent was not given' };
  if (!body.front || !body.side) return { ok: false, error: 'both photos are required' };

  var sheet = sheet_();
  var guestId = uniqueId_(sheet, slug_(name) || 'guest');
  var folder = folder_();
  var front = save_(folder, body.front, guestId + '-front');
  var side = save_(folder, body.side, guestId + '-side');

  sheet.appendRow([
    new Date(),
    String(body.eventId || ''),
    name,
    String(body.role || ''),
    guestId,
    '',
    image_(front),
    image_(side),
    true,
    front,
    side
  ]);
  sheet.setRowHeight(sheet.getLastRow(), 96);
  return { ok: true, guestId: guestId };
}

function assignCamera_(body) {
  var guestId = String(body.guestId || '');
  if (!guestId) return { ok: false, error: 'guestId is required' };
  var sheet = sheet_();
  var last = sheet.getLastRow();
  if (last < 2) return { ok: false, error: 'no participants yet' };
  var ids = sheet.getRange(2, COL.guestId, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === guestId) {
      sheet.getRange(i + 2, COL.camera).setValue(String(body.camera || ''));
      return { ok: true, guestId: guestId };
    }
  }
  return { ok: false, error: 'unknown guestId: ' + guestId };
}

/* ----------------------------------------------------------------- helpers */

function slug_(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Two people called Sarah must not collide, and must not overwrite each other. */
function uniqueId_(sheet, base) {
  var last = sheet.getLastRow();
  var taken = {};
  if (last >= 2) {
    var ids = sheet.getRange(2, COL.guestId, last - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) taken[String(ids[i][0])] = true;
  }
  if (!taken[base]) return base;
  for (var n = 2; n < 500; n++) if (!taken[base + '-' + n]) return base + '-' + n;
  return base + '-' + Date.now();
}

/** Returns the Drive file id, or '' if the data URL was unusable. */
function save_(folder, dataUrl, filename) {
  var match = /^data:(image\/[a-z+.-]+);base64,([\s\S]+)$/i.exec(String(dataUrl || ''));
  if (!match) return '';
  var blob = Utilities.newBlob(Utilities.base64Decode(match[2]), match[1], filename + '.jpg');
  var file = folder.createFile(blob);
  if (LINK_READABLE_PHOTOS) {
    try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); }
    catch (ignored) {}   /* a domain policy may forbid it; the row is still written */
  }
  return file.getId();
}

/** An =IMAGE() formula so the sheet itself shows the face, not a URL. */
function image_(fileId) {
  if (!fileId) return '';
  if (!LINK_READABLE_PHOTOS) return 'https://drive.google.com/file/d/' + fileId + '/view';
  return '=IMAGE("' + thumb_(fileId) + '", 4, 90, 68)';
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ----------------------------------------------------------------- export */

/**
 * Lift the participant list into a brand-new standalone spreadsheet, so this
 * event's data can be kept and reused without the script attached to it.
 *
 * Runnable from the editor, and also reachable from dashboard.html via
 * {type: 'export_sheet'}. The copy keeps the =IMAGE() formulas, so the faces
 * still show as long as the Drive photos still exist -- see purgeAfterEvent.
 *
 * The new file lands in your Drive root and is owned by you. Nothing is moved
 * or deleted here: the working sheet is left exactly as it was.
 */
function exportToNewSpreadsheet() {
  var sheet = sheet_();
  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH-mm');
  var name = 'CUE participants ' + stamp;

  var target = SpreadsheetApp.create(name);
  var copied = sheet.copyTo(target);
  copied.setName(SHEET_NAME);
  copied.setFrozenRows(1);

  /* SpreadsheetApp.create leaves an empty default sheet behind. */
  var blanks = target.getSheets();
  for (var i = 0; i < blanks.length; i++) {
    if (blanks[i].getSheetId() !== copied.getSheetId()) {
      target.deleteSheet(blanks[i]);
    }
  }

  var rows = Math.max(0, copied.getLastRow() - 1);
  return { ok: true, url: target.getUrl(), id: target.getId(), name: name, rows: rows };
}

/* --------------------------------------------------------------- clean-up */

/**
 * Run from the editor after the event. Deletes every photo and clears the rows,
 * leaving the header. Matches the promise the guest agreed to on the phone.
 */
function purgeAfterEvent() {
  var sheet = sheet_();
  var last = sheet.getLastRow();
  var removed = 0;
  if (last >= 2) {
    var files = sheet.getRange(2, COL.frontFile, last - 1, 2).getValues();
    for (var i = 0; i < files.length; i++) {
      for (var c = 0; c < 2; c++) {
        if (!files[i][c]) continue;
        try { DriveApp.getFileById(String(files[i][c])).setTrashed(true); removed++; } catch (ignored) {}
      }
    }
    sheet.deleteRows(2, last - 1);
  }
  SpreadsheetApp.getActiveSpreadsheet().toast(removed + ' photos trashed, rows cleared.', 'CUE', 8);
  return removed;
}
