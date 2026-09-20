// Minimal Google Drive REST client shared by the extension's background
// worker and the dashboard page. Plain script, no build step.
//
// Uses the broad `drive` scope (see README) so the file created by one
// OAuth client (the extension) is visible to the other (the dashboard) —
// drive.file access is per-(user, OAuth client) and would not cross apps.

var LinkVaultDrive = (function () {
  var API = 'https://www.googleapis.com/drive/v3';
  var UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
  var FOLDER_NAME = 'Link Vault';
  var FILE_NAME = 'links.json';
  var FOLDER_MIME = 'application/vnd.google-apps.folder';

  function authHeaders(token) {
    return { Authorization: 'Bearer ' + token };
  }

  async function driveFetch(url, token, opts) {
    opts = opts || {};
    opts.headers = Object.assign({}, opts.headers, authHeaders(token));
    var res = await fetch(url, opts);
    if (!res.ok) {
      var body = await res.text().catch(function () { return ''; });
      var err = new Error('Drive API error ' + res.status + ': ' + body);
      err.status = res.status;
      throw err;
    }
    return res;
  }

  async function findByName(token, name, mimeType, parentId) {
    var q = ["name = '" + name.replace(/'/g, "\\'") + "'", 'trashed = false'];
    if (mimeType) q.push("mimeType = '" + mimeType + "'");
    if (parentId) q.push("'" + parentId + "' in parents");
    var url = API + '/files?q=' + encodeURIComponent(q.join(' and ')) +
      '&fields=' + encodeURIComponent('files(id,name)') + '&spaces=drive';
    var res = await driveFetch(url, token);
    var data = await res.json();
    return (data.files && data.files[0]) || null;
  }

  async function createFolder(token, name) {
    var res = await driveFetch(API + '/files?fields=id', token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, mimeType: FOLDER_MIME }),
    });
    var data = await res.json();
    return data.id;
  }

  async function createFile(token, name, parentId, content) {
    var boundary = 'linkvault-' + Date.now();
    var metadata = { name: name, parents: [parentId] };
    var body =
      '--' + boundary + '\r\n' +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) + '\r\n' +
      '--' + boundary + '\r\n' +
      'Content-Type: application/json\r\n\r\n' +
      content + '\r\n' +
      '--' + boundary + '--';
    var res = await driveFetch(UPLOAD_API + '/files?uploadType=multipart&fields=id', token, {
      method: 'POST',
      headers: { 'Content-Type': 'multipart/related; boundary=' + boundary },
      body: body,
    });
    var data = await res.json();
    return data.id;
  }

  /** Finds (or creates) the `Link Vault/links.json` file, returning its id. */
  async function ensureStoreFile(token) {
    var folder = await findByName(token, FOLDER_NAME, FOLDER_MIME, null);
    var folderId = folder ? folder.id : await createFolder(token, FOLDER_NAME);
    var file = await findByName(token, FILE_NAME, null, folderId);
    if (file) return file.id;
    return createFile(token, FILE_NAME, folderId, JSON.stringify({ version: 1, links: [] }));
  }

  async function readStore(token, fileId) {
    var res = await driveFetch(API + '/files/' + fileId + '?alt=media', token);
    var text = await res.text();
    try {
      var data = JSON.parse(text);
      if (!data || !Array.isArray(data.links)) return { version: 1, links: [] };
      return data;
    } catch (e) {
      return { version: 1, links: [] };
    }
  }

  async function writeStore(token, fileId, store) {
    await driveFetch(UPLOAD_API + '/files/' + fileId + '?uploadType=media', token, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(store),
    });
  }

  return {
    ensureStoreFile: ensureStoreFile,
    readStore: readStore,
    writeStore: writeStore,
  };
})();
