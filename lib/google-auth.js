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
  var TOKEN_CACHE_KEY = 'lv_google_token_cache';
  var EXPIRY_SAFETY_MARGIN_MS = 60000;

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
      expiresIn: params.get('expires_in'),
    };
    history.replaceState(null, '', window.location.pathname + window.location.search);
    return result;
  }

  function revokeToken(token) {
    if (!token) return Promise.resolve();
    return fetch(REVOKE_ENDPOINT + '?token=' + encodeURIComponent(token), { method: 'POST' }).catch(function () {});
  }

  /** Persists an access token (localStorage — shared across every tab/PWA
   * window/share-target invocation on this origin, unlike sessionStorage)
   * so a fresh page load can skip Google entirely until it actually
   * expires. Tokens are short-lived (~1h) and scoped to this one personal
   * vault, so caching them client-side is a deliberate, bounded trade-off
   * for not re-prompting on every single share. */
  function cacheToken(token, expiresInSeconds) {
    try {
      var ttlMs = Number(expiresInSeconds || 3600) * 1000;
      var expiresAt = Date.now() + Math.max(ttlMs - EXPIRY_SAFETY_MARGIN_MS, 0);
      localStorage.setItem(TOKEN_CACHE_KEY, JSON.stringify({ token: token, expiresAt: expiresAt }));
    } catch (e) { /* private mode / quota / disabled storage — just skip caching */ }
  }

  /** A still-valid cached token, or null (missing, unparsable, or expired
   * — expired ones are cleared as a side effect). */
  function getCachedToken() {
    try {
      var raw = localStorage.getItem(TOKEN_CACHE_KEY);
      if (!raw) return null;
      var cached = JSON.parse(raw);
      if (!cached || !cached.token || !cached.expiresAt || Date.now() >= cached.expiresAt) {
        localStorage.removeItem(TOKEN_CACHE_KEY);
        return null;
      }
      return cached.token;
    } catch (e) {
      return null;
    }
  }

  function clearCachedToken() {
    try { localStorage.removeItem(TOKEN_CACHE_KEY); } catch (e) {}
  }

  return {
    redirectUri: redirectUri,
    startSignIn: startSignIn,
    consumeRedirectResult: consumeRedirectResult,
    revokeToken: revokeToken,
    cacheToken: cacheToken,
    getCachedToken: getCachedToken,
    clearCachedToken: clearCachedToken,
  };
})();
