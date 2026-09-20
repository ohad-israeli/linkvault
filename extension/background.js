importScripts('lib/linkvault-core.js', 'lib/drive-client.js');

var DASHBOARD_URL = 'https://ohad-israeli.github.io/linkvault/';

chrome.runtime.onInstalled.addListener(function () {
  chrome.contextMenus.create({
    id: 'save-link-to-linkvault',
    title: 'Save link to Link Vault',
    contexts: ['link'],
  });
  chrome.contextMenus.create({
    id: 'save-page-to-linkvault',
    title: 'Save this page to Link Vault',
    contexts: ['page'],
  });
});

chrome.contextMenus.onClicked.addListener(function (info, tab) {
  var url = info.menuItemId === 'save-link-to-linkvault' ? info.linkUrl : info.pageUrl;
  if (!url) return;
  saveLink(url, {}).then(function (result) {
    notify(result.ok ? 'Saved to Link Vault' : 'Could not save: ' + result.error);
  });
});

function getAuthToken(interactive) {
  return new Promise(function (resolve, reject) {
    chrome.identity.getAuthToken({ interactive: interactive }, function (token) {
      if (chrome.runtime.lastError || !token) {
        reject(new Error((chrome.runtime.lastError && chrome.runtime.lastError.message) || 'No auth token'));
        return;
      }
      resolve(token);
    });
  });
}

async function saveLink(rawUrl, opts) {
  var link = LinkVaultCore.newLink(rawUrl, opts);
  if (!link) return { ok: false, error: 'That doesn\'t look like a valid link' };
  try {
    var token = await getAuthToken(true);
    var fileId = await LinkVaultDrive.ensureStoreFile(token);
    var store = await LinkVaultDrive.readStore(token, fileId);
    store.links.unshift(link);
    await LinkVaultDrive.writeStore(token, fileId, store);
    return { ok: true, link: link };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

async function fetchRecentLinks(limit) {
  try {
    var token = await getAuthToken(false);
    var fileId = await LinkVaultDrive.ensureStoreFile(token);
    var store = await LinkVaultDrive.readStore(token, fileId);
    return { ok: true, links: store.links.slice(0, limit || 5) };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

function notify(message) {
  chrome.action.setBadgeText({ text: message.indexOf('Saved') === 0 ? '✓' : '!' });
  setTimeout(function () { chrome.action.setBadgeText({ text: '' }); }, 2000);
}

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (msg && msg.type === 'save-link') {
    saveLink(msg.url, { tags: msg.tags, note: msg.note }).then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'get-recent-links') {
    fetchRecentLinks(msg.limit).then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'get-dashboard-url') {
    sendResponse({ url: DASHBOARD_URL });
    return false;
  }
});
