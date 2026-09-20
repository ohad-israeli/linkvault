(function () {
  // --- Fill in after creating the "Web application" OAuth client in
  // Google Cloud Console (see README.md). ---
  var GOOGLE_CLIENT_ID_WEB = '1018364510823-3phvjv4bv286utncsrnulem3dmggd478.apps.googleusercontent.com';
  var SCOPES = [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/userinfo.email',
  ].join(' ');
  var POLL_INTERVAL_MS = 20000;

  // Belt-and-suspenders on top of the Google OAuth consent screen's
  // Testing-mode test-user list (the real gate): even if a token is ever
  // issued to some other account, the app refuses to touch Drive unless
  // the signed-in email is one of these.
  var ALLOWED_OWNER_EMAILS = ['ohadisra@gmail.com'];

  var accessToken = null;
  var fileId = null;
  var allLinks = [];
  var search = '';
  var platformFilter = 'all';
  var statusFilter = 'all'; // all | unread | done
  var tagFilter = null;
  var pendingDelete = {};
  var pollTimer = null;

  var signinPanel = document.getElementById('signin-panel');
  var signinStatus = document.getElementById('signin-status');
  var signInBtn = document.getElementById('sign-in-btn');
  var appContent = document.getElementById('app-content');
  var userBar = document.getElementById('user-bar');
  var userAvatar = document.getElementById('user-avatar');
  var userName = document.getElementById('user-name');
  var signOutBtn = document.getElementById('sign-out-btn');

  var listEl = document.getElementById('list');
  var countLabel = document.getElementById('count-label');
  var filtersEl = document.getElementById('filters');
  var chipsEl = document.getElementById('platform-chips');
  var statusChipsEl = document.getElementById('status-chips');
  var tagBannerEl = document.getElementById('tag-banner');
  var statusArea = document.getElementById('status-area');
  var formErrorEl = document.getElementById('form-error');
  var saveBtn = document.getElementById('save-btn');
  var addForm = document.getElementById('add-form');
  var urlInput = document.getElementById('url-input');
  var tagsInput = document.getElementById('tags-input');
  var noteInput = document.getElementById('note-input');

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function formatDate(ts) {
    var d = new Date(ts);
    var now = new Date();
    var sameYear = d.getFullYear() === now.getFullYear();
    var opts = sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' };
    return d.toLocaleDateString(undefined, opts);
  }

  function showFormError(msg) {
    if (!msg) { formErrorEl.hidden = true; formErrorEl.textContent = ''; return; }
    formErrorEl.hidden = false;
    formErrorEl.textContent = msg;
  }

  function setStatus(msg) {
    statusArea.innerHTML = msg ? '<div class="status-banner">' + escapeHtml(msg) + '</div>' : '';
  }

  // ---------- Auth ----------
  var tokenClient = null;

  function initAuth() {
    if (!window.google || !google.accounts || !google.accounts.oauth2) {
      signinStatus.hidden = false;
      signinStatus.textContent = 'Could not load Google sign-in. Check your connection and reload.';
      return;
    }
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID_WEB,
      scope: SCOPES,
      callback: function (resp) {
        if (resp.error) {
          signinStatus.hidden = false;
          signinStatus.textContent = 'Sign-in failed: ' + resp.error;
          return;
        }
        accessToken = resp.access_token;
        onSignedIn();
      },
    });
  }

  signInBtn.addEventListener('click', function () {
    signinStatus.hidden = true;
    tokenClient.requestAccessToken();
  });

  signOutBtn.addEventListener('click', function () {
    if (accessToken && window.google) {
      google.accounts.oauth2.revoke(accessToken, function () {});
    }
    accessToken = null;
    fileId = null;
    allLinks = [];
    if (pollTimer) clearInterval(pollTimer);
    appContent.hidden = true;
    userBar.hidden = true;
    signinPanel.hidden = false;
  });

  async function onSignedIn() {
    var info = await fetchUserInfo();
    var email = info && info.email ? info.email.toLowerCase() : '';
    if (!email || ALLOWED_OWNER_EMAILS.indexOf(email) === -1) {
      rejectSignIn();
      return;
    }

    signinPanel.hidden = true;
    appContent.hidden = false;
    userBar.hidden = false;
    userName.textContent = info.name || info.given_name || email;
    if (info.picture) { userAvatar.src = info.picture; userAvatar.hidden = false; }

    setStatus('Connecting to your Drive…');
    try {
      fileId = await LinkVaultDrive.ensureStoreFile(accessToken);
      await refreshFromDrive();
      setStatus('');
      pollTimer = setInterval(refreshFromDrive, POLL_INTERVAL_MS);
    } catch (err) {
      setStatus('Could not reach your Google Drive: ' + err.message);
    }
  }

  function rejectSignIn() {
    if (accessToken && window.google) {
      google.accounts.oauth2.revoke(accessToken, function () {});
    }
    accessToken = null;
    signinStatus.hidden = false;
    signinStatus.textContent = 'This vault is private and isn’t set up for that Google account.';
  }

  async function fetchUserInfo() {
    try {
      var res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: 'Bearer ' + accessToken },
      });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      return null;
    }
  }

  async function refreshFromDrive() {
    try {
      var store = await LinkVaultDrive.readStore(accessToken, fileId);
      allLinks = store.links.slice().sort(function (a, b) { return b.createdAt - a.createdAt; });
      render();
    } catch (err) {
      setStatus('Lost the connection to your vault. Reload to reconnect.');
    }
  }

  async function persist() {
    await LinkVaultDrive.writeStore(accessToken, fileId, { version: 1, links: allLinks });
  }

  // ---------- Filtering / rendering ----------
  function getFiltered() {
    var q = search.trim().toLowerCase();
    return allLinks.filter(function (l) {
      if (platformFilter !== 'all' && l.platform !== platformFilter) return false;
      if (statusFilter === 'unread' && l.done) return false;
      if (statusFilter === 'done' && !l.done) return false;
      if (tagFilter && (!l.tags || l.tags.indexOf(tagFilter) === -1)) return false;
      if (q) {
        var hay = (l.url + ' ' + (l.note || '') + ' ' + (l.tags || []).join(' ')).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  function renderChips() {
    var counts = {};
    allLinks.forEach(function (l) { counts[l.platform] = (counts[l.platform] || 0) + 1; });
    var platforms = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });
    if (platforms.length === 0) { filtersEl.hidden = true; return; }
    filtersEl.hidden = false;

    var html = '<button type="button" class="chip' + (platformFilter === 'all' ? ' active' : '') + '" data-platform="all">All · ' + allLinks.length + '</button>';
    platforms.forEach(function (p) {
      var color = LinkVaultCore.colorForPlatform(p);
      html += '<button type="button" class="chip' + (platformFilter === p ? ' active' : '') + '" data-platform="' + escapeHtml(p) + '">' +
        '<span class="dot" style="background:' + color + '"></span>' + escapeHtml(p) + ' · ' + counts[p] + '</button>';
    });
    chipsEl.innerHTML = html;

    var unreadCount = allLinks.filter(function (l) { return !l.done; }).length;
    var doneCount = allLinks.length - unreadCount;
    statusChipsEl.innerHTML =
      '<button type="button" class="chip' + (statusFilter === 'all' ? ' active' : '') + '" data-status="all">All statuses</button>' +
      '<button type="button" class="chip' + (statusFilter === 'unread' ? ' active' : '') + '" data-status="unread">Unread · ' + unreadCount + '</button>' +
      '<button type="button" class="chip' + (statusFilter === 'done' ? ' active' : '') + '" data-status="done">Done · ' + doneCount + '</button>';

    if (tagFilter) {
      tagBannerEl.hidden = false;
      tagBannerEl.innerHTML = 'Filtering by tag <strong class="mono">' + escapeHtml(tagFilter) + '</strong> <button type="button" id="clear-tag">Clear</button>';
    } else {
      tagBannerEl.hidden = true;
      tagBannerEl.innerHTML = '';
    }
  }

  function render() {
    countLabel.textContent = allLinks.length + (allLinks.length === 1 ? ' link' : ' links');
    renderChips();

    var filtered = getFiltered();

    if (allLinks.length === 0) {
      listEl.innerHTML = '<div class="empty-state">' +
        '<span class="big">Your vault is empty</span>' +
        '<span>Paste any link above — <code>instagram.com</code>, <code>linkedin.com</code>, anything — and save it.</span>' +
        '</div>';
      return;
    }

    if (filtered.length === 0) {
      listEl.innerHTML = '<div class="empty-state"><span>No links match your filters.</span></div>';
      return;
    }

    listEl.innerHTML = filtered.map(function (l) {
      var color = LinkVaultCore.colorForPlatform(l.platform);
      var confirming = !!pendingDelete[l.id];
      var tagsHtml = (l.tags || []).map(function (t) {
        return '<span class="tag' + (t === tagFilter ? ' active-tag' : '') + '" data-tag="' + escapeHtml(t) + '">' + escapeHtml(t) + '</span>';
      }).join('');
      return '<div class="card' + (l.done ? ' done' : '') + '" style="--card-color:' + color + '">' +
        '<div class="card-top">' +
          '<div class="card-meta"><span class="platform-label">' + escapeHtml(l.platform) + '</span></div>' +
          '<div class="card-actions">' +
            '<span class="timestamp">' + formatDate(l.createdAt) + '</span>' +
            '<button type="button" class="icon-btn' + (l.done ? ' active' : '') + '" data-action="toggle-done" data-id="' + l.id + '">' + (l.done ? '✓ Done' : 'Mark done') + '</button>' +
            '<button type="button" class="icon-btn' + (confirming ? ' confirm' : '') + '" data-action="delete" data-id="' + l.id + '">' + (confirming ? 'Confirm' : 'Delete') + '</button>' +
          '</div>' +
        '</div>' +
        '<a class="card-url" href="' + escapeHtml(l.url) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(l.url) + '</a>' +
        (l.note ? '<div class="card-note">' + escapeHtml(l.note) + '</div>' : '') +
        (tagsHtml ? '<div class="card-tags">' + tagsHtml + '</div>' : '') +
      '</div>';
    }).join('');
  }

  // ---------- Event wiring ----------
  addForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    showFormError(null);
    if (!accessToken || !fileId) { showFormError('Not connected yet — try again in a moment.'); return; }
    var link = LinkVaultCore.newLink(urlInput.value, {
      tags: tagsInput.value.split(','),
      note: noteInput.value,
    });
    if (!link) { showFormError('That doesn\'t look like a valid link.'); return; }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    allLinks.unshift(link);
    render();
    try {
      await persist();
      urlInput.value = '';
      tagsInput.value = '';
      noteInput.value = '';
      urlInput.focus();
    } catch (err) {
      allLinks = allLinks.filter(function (l) { return l.id !== link.id; });
      render();
      showFormError('Could not save that link — try again.');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
    }
  });

  document.getElementById('search-input').addEventListener('input', function (e) {
    search = e.target.value;
    render();
  });

  chipsEl.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-platform]');
    if (!btn) return;
    platformFilter = btn.getAttribute('data-platform');
    render();
  });

  statusChipsEl.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-status]');
    if (!btn) return;
    statusFilter = btn.getAttribute('data-status');
    render();
  });

  tagBannerEl.addEventListener('click', function (e) {
    if (e.target.id === 'clear-tag') { tagFilter = null; render(); }
  });

  listEl.addEventListener('click', async function (e) {
    var tagEl = e.target.closest('[data-tag]');
    if (tagEl) {
      var t = tagEl.getAttribute('data-tag');
      tagFilter = (tagFilter === t) ? null : t;
      render();
      return;
    }

    var toggleBtn = e.target.closest('[data-action="toggle-done"]');
    if (toggleBtn) {
      var id1 = toggleBtn.getAttribute('data-id');
      var link1 = allLinks.find(function (l) { return l.id === id1; });
      if (!link1) return;
      link1.done = !link1.done;
      link1.updatedAt = Date.now();
      render();
      try { await persist(); } catch (err) { setStatus('Could not save that change — try again.'); }
      return;
    }

    var delBtn = e.target.closest('[data-action="delete"]');
    if (delBtn) {
      var id2 = delBtn.getAttribute('data-id');
      if (!pendingDelete[id2]) {
        pendingDelete[id2] = setTimeout(function () { delete pendingDelete[id2]; render(); }, 3000);
        render();
        return;
      }
      clearTimeout(pendingDelete[id2]);
      delete pendingDelete[id2];
      var before = allLinks;
      allLinks = allLinks.filter(function (l) { return l.id !== id2; });
      render();
      try {
        await persist();
      } catch (err) {
        allLinks = before;
        render();
        setStatus('Could not delete that link — try again.');
      }
    }
  });

  window.addEventListener('load', initAuth);
})();
