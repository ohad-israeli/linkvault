// Full-page-redirect Google OAuth (implicit grant), shared by the dashboard
// and the share-target page. Deliberately NOT the Google Identity Services
// popup flow (google.accounts.oauth2.initTokenClient) — popups are
// unreliable inside an installed PWA's standalone window on Android
// (the share-target page, and the dashboard when launched from its
// home-screen icon, both run in that context), so a plain top-level
// navigation is used instead.

var LinkVaultAuth = (function () {
  var AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
  var REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';

  function redirectUri() {
    return window.location.origin + window.location.pathname;
  }

  function buildAuthUrl(clientId, scope, opts) {
    opts = opts || {};
    var params = {
      client_id: clientId,
      redirect_uri: redirectUri(),
      response_type: 'token',
      scope: scope,
      include_granted_scopes: 'true',
    };
    if (opts.prompt) params.prompt = opts.prompt;
    var qs = Object.keys(params).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }).join('&');
    return AUTH_ENDPOINT + '?' + qs;
  }

  /** Navigates the current page to Google's consent screen. Never returns
   * (the page unloads); Google redirects back to this same URL with the
   * result in the fragment, which consumeRedirectResult() picks up. */
  function startSignIn(clientId, scope, opts) {
    window.location.href = buildAuthUrl(clientId, scope, opts);
  }

  /** Call once on load, before anything else touches the URL. Returns
   * null when this load isn't a return from Google (the common case),
   * or { accessToken, error } when it is. Strips the token/error out of
   * the visible URL and history either way. */
  function consumeRedirectResult() {
    var hash = window.location.hash;
    if (!hash || hash.length < 2) return null;
    var params = new URLSearchParams(hash.substring(1));
    if (!params.has('access_token') && !params.has('error')) return null;
    var result = {
      accessToken: params.get('access_token'),
      error: params.get('error'),
    };
    history.replaceState(null, '', window.location.pathname + window.location.search);
    return result;
  }

  function revokeToken(token) {
    if (!token) return Promise.resolve();
    return fetch(REVOKE_ENDPOINT + '?token=' + encodeURIComponent(token), { method: 'POST' }).catch(function () {});
  }

  return {
    redirectUri: redirectUri,
    startSignIn: startSignIn,
    consumeRedirectResult: consumeRedirectResult,
    revokeToken: revokeToken,
  };
})();
