(function () {
  var GOOGLE_CLIENT_ID_WEB = '1018364510823-3phvjv4bv286utncsrnulem3dmggd478.apps.googleusercontent.com';
  var SCOPES = [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/userinfo.email',
  ].join(' ');
  var ALLOWED_OWNER_EMAILS = ['ohadisra@gmail.com'];
  var PENDING_URL_KEY = 'lv_share_pending_url';
  var SILENT_TRIED_KEY = 'lv_share_tried_silent';

  var statusText = document.getElementById('status-text');
  var urlPreview = document.getElementById('url-preview');
  var shareError = document.getElementById('share-error');
  var signinPanel = document.getElementById('signin-panel');
  var signInBtn = document.getElementById('sign-in-btn');

  function showError(msg) {
    shareError.hidden = false;
    shareError.textContent = msg;
  }

  function findUrl(params) {
    var direct = (params.get('url') || '').trim();
    if (LinkVaultCore.normalizeUrl(direct)) return direct;
    var candidates = [params.get('text') || '', params.get('title') || ''];
    for (var i = 0; i < candidates.length; i++) {
      var match = candidates[i].match(/https?:\/\/\S+/);
      if (match) return match[0];
    }
    return null;
  }

  function retryWithFreshSignIn(sharedUrl) {
    sessionStorage.setItem(PENDING_URL_KEY, sharedUrl);
    sessionStorage.setItem(SILENT_TRIED_KEY, '1');
    statusText.textContent = 'Saving your link…';
    LinkVaultAuth.startSignIn(GOOGLE_CLIENT_ID_WEB, SCOPES, { prompt: 'none' });
  }

  signInBtn.addEventListener('click', function () {
    signinPanel.hidden = true;
    statusText.textContent = 'Saving your link…';
    sessionStorage.removeItem(SILENT_TRIED_KEY);
    LinkVaultAuth.startSignIn(GOOGLE_CLIENT_ID_WEB, SCOPES, {});
  });

  async function saveWithToken(accessToken, sharedUrl, opts) {
    opts = opts || {};
    try {
      var res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: 'Bearer ' + accessToken },
      });
      if (res.status === 401) {
        LinkVaultAuth.clearCachedToken();
        if (opts.isCached) { retryWithFreshSignIn(sharedUrl); return; }
        statusText.textContent = 'Sign-in expired';
        showError('Please try sharing again.');
        return;
      }
      var info = res.ok ? await res.json() : null;
      var email = info && info.email ? info.email.toLowerCase() : '';
      if (!email || ALLOWED_OWNER_EMAILS.indexOf(email) === -1) {
        statusText.textContent = 'This vault is private';
        showError('That Google account isn’t set up for this vault.');
        return;
      }
      if (!opts.isCached) LinkVaultAuth.cacheToken(accessToken, opts.expiresIn);

      var link = LinkVaultCore.newLink(sharedUrl, {});
      if (!link) {
        statusText.textContent = 'Could not save';
        showError('That doesn’t look like a valid link.');
        return;
      }

      var fileId = await LinkVaultDrive.ensureStoreFile(accessToken);
      var store = await LinkVaultDrive.readStore(accessToken, fileId);
      store.links.unshift(link);
      await LinkVaultDrive.writeStore(accessToken, fileId, store);

      statusText.textContent = 'Saved to Link Vault ✓';
    } catch (err) {
      if (err && err.status === 401) {
        LinkVaultAuth.clearCachedToken();
        if (opts.isCached) { retryWithFreshSignIn(sharedUrl); return; }
      }
      statusText.textContent = 'Could not save';
      showError((err && err.message) || 'Something went wrong — open Link Vault and add it manually.');
    }
  }

  function init() {
    var params = new URLSearchParams(window.location.search);
    var sharedUrlFromQuery = findUrl(params);

    // Fast path: a token already cached from an earlier sign-in (this page
    // or the dashboard) — skip Google entirely.
    if (sharedUrlFromQuery) {
      var cached = LinkVaultAuth.getCachedToken();
      if (cached) {
        urlPreview.textContent = sharedUrlFromQuery;
        saveWithToken(cached, sharedUrlFromQuery, { isCached: true });
        return;
      }
    }

    var result = LinkVaultAuth.consumeRedirectResult();

    if (result) {
      var wasSilent = sessionStorage.getItem(SILENT_TRIED_KEY) === '1';
      sessionStorage.removeItem(SILENT_TRIED_KEY);
      var pendingUrl = sessionStorage.getItem(PENDING_URL_KEY);

      if (result.error) {
        if (wasSilent && pendingUrl) {
          // Silent attempt failed as expected (no session yet) — ask
          // visibly instead of showing an alarming error.
          urlPreview.textContent = pendingUrl;
          statusText.textContent = 'Sign in to save this link';
          signinPanel.hidden = false;
          return;
        }
        statusText.textContent = 'Sign-in failed';
        showError(result.error);
        return;
      }

      sessionStorage.removeItem(PENDING_URL_KEY);
      if (!pendingUrl) {
        statusText.textContent = 'Nothing to save';
        showError('Lost track of the shared link — open Link Vault and paste it in manually.');
        return;
      }
      urlPreview.textContent = pendingUrl;
      saveWithToken(result.accessToken, pendingUrl, { isCached: false, expiresIn: result.expiresIn });
      return;
    }

    // Fresh load, directly from the share sheet.
    if (!sharedUrlFromQuery) {
      statusText.textContent = 'Nothing to save';
      showError('Couldn’t find a link in what was shared. Open Link Vault and paste it in manually.');
      return;
    }

    urlPreview.textContent = sharedUrlFromQuery;
    retryWithFreshSignIn(sharedUrlFromQuery);
  }

  init();
})();
