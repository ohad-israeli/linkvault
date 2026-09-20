(function () {
  var GOOGLE_CLIENT_ID_WEB = '1018364510823-3phvjv4bv286utncsrnulem3dmggd478.apps.googleusercontent.com';
  var SCOPES = [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/userinfo.email',
  ].join(' ');
  var ALLOWED_OWNER_EMAILS = ['ohadisra@gmail.com'];

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

  var params = new URLSearchParams(window.location.search);
  var sharedUrl = findUrl(params);

  if (!sharedUrl) {
    statusText.textContent = 'Nothing to save';
    showError('Couldn’t find a link in what was shared. Open Link Vault and paste it in manually.');
    return;
  }

  urlPreview.textContent = sharedUrl;

  var tokenClient = null;
  var silentAttempt = false;

  function initAuth() {
    if (!window.google || !google.accounts || !google.accounts.oauth2) {
      statusText.textContent = 'Could not load Google sign-in';
      showError('Check your connection, then open Link Vault and paste the link in manually.');
      return;
    }
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID_WEB,
      scope: SCOPES,
      callback: function (resp) {
        var wasSilent = silentAttempt;
        silentAttempt = false;
        if (resp.error) {
          if (!wasSilent) {
            statusText.textContent = 'Sign-in failed';
            showError(resp.error);
          } else {
            statusText.textContent = 'Sign in to save this link';
            signinPanel.hidden = false;
          }
          return;
        }
        saveWithToken(resp.access_token);
      },
    });
    silentAttempt = true;
    tokenClient.requestAccessToken({ prompt: 'none' });
  }

  signInBtn.addEventListener('click', function () {
    signinPanel.hidden = true;
    statusText.textContent = 'Saving your link…';
    tokenClient.requestAccessToken();
  });

  async function saveWithToken(accessToken) {
    try {
      var res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: 'Bearer ' + accessToken },
      });
      var info = res.ok ? await res.json() : null;
      var email = info && info.email ? info.email.toLowerCase() : '';
      if (!email || ALLOWED_OWNER_EMAILS.indexOf(email) === -1) {
        statusText.textContent = 'This vault is private';
        showError('That Google account isn’t set up for this vault.');
        return;
      }

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
      statusText.textContent = 'Could not save';
      showError((err && err.message) || 'Something went wrong — open Link Vault and add it manually.');
    }
  }

  window.addEventListener('load', initAuth);
})();
