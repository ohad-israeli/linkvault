// Shared between the Chrome extension and the dashboard. Plain script (no
// modules/build step) so both can load it with a <script> / importScripts tag.

var LinkVaultCore = (function () {
  var PLATFORM_MATCHERS = [
    [/(^|\.)instagram\.com$/, 'Instagram', '#C1447E'],
    [/(^|\.)linkedin\.com$/, 'LinkedIn', '#0A66C2'],
    [/(^|\.)(twitter\.com|x\.com)$/, 'X', '#5B5F63'],
    [/(^|\.)(youtube\.com|youtu\.be)$/, 'YouTube', '#D8432E'],
    [/(^|\.)tiktok\.com$/, 'TikTok', '#2AA7A1'],
    [/(^|\.)github\.com$/, 'GitHub', '#6E5494'],
    [/(^|\.)reddit\.com$/, 'Reddit', '#D9622B'],
    [/(^|\.)pinterest\.[a-z.]+$/, 'Pinterest', '#C8232C'],
    [/(^|\.)facebook\.com$/, 'Facebook', '#3B5998'],
    [/(^|\.)threads\.net$/, 'Threads', '#4A4A4A'],
    [/(^|\.)medium\.com$/, 'Medium', '#4A4A4A'],
    [/\.substack\.com$/, 'Substack', '#E0812B'],
  ];
  var DEFAULT_COLOR = '#7C8571';

  function detectPlatform(hostname) {
    for (var i = 0; i < PLATFORM_MATCHERS.length; i++) {
      if (PLATFORM_MATCHERS[i][0].test(hostname)) {
        return { name: PLATFORM_MATCHERS[i][1], color: PLATFORM_MATCHERS[i][2] };
      }
    }
    return { name: hostname.replace(/^www\./, ''), color: DEFAULT_COLOR };
  }

  function colorForPlatform(platformName) {
    for (var i = 0; i < PLATFORM_MATCHERS.length; i++) {
      if (PLATFORM_MATCHERS[i][1] === platformName) return PLATFORM_MATCHERS[i][2];
    }
    return DEFAULT_COLOR;
  }

  function normalizeUrl(raw) {
    var s = (raw || '').trim();
    if (!s) return null;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'https://' + s;
    try {
      var u = new URL(s);
      if (!u.hostname || !/\./.test(u.hostname)) return null;
      return u;
    } catch (e) {
      return null;
    }
  }

  function makeId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function newLink(rawUrl, opts) {
    var u = normalizeUrl(rawUrl);
    if (!u) return null;
    opts = opts || {};
    var platform = detectPlatform(u.hostname.replace(/^www\./, ''));
    var tags = (opts.tags || []).map(function (t) { return String(t).trim(); }).filter(Boolean).slice(0, 10);
    var now = Date.now();
    return {
      id: makeId(),
      url: u.href,
      platform: platform.name,
      tags: tags,
      note: (opts.note || '').trim(),
      done: false,
      favorite: false,
      createdAt: now,
      updatedAt: now,
    };
  }

  function emptyStore() {
    return { version: 1, links: [] };
  }

  return {
    detectPlatform: detectPlatform,
    colorForPlatform: colorForPlatform,
    normalizeUrl: normalizeUrl,
    newLink: newLink,
    emptyStore: emptyStore,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = LinkVaultCore;
