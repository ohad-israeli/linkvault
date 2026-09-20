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
  var statusFilter = 'all'; // all | unread | done | favorite
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
  var toolbarEl = document.getElementById('toolbar');
  var statsStripEl = document.getElementById('stats-strip');
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
  var addModal = document.getElementById('add-modal');
  var modalTitleEl = document.getElementById('modal-title');
  var openAddBtn = document.getElementById('open-add-btn');
  var cancelAddBtn = document.getElementById('cancel-add-btn');
  var closeModalBtn = document.getElementById('close-modal-btn');
  var editingId = null;

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

  // ---------- Add/edit-link modal ----------
  function openAddModal(link) {
    showFormError(null);
    if (link) {
      editingId = link.id;
      modalTitleEl.textContent = 'Edit link';
      saveBtn.textContent = 'Save changes';
      urlInput.value = link.url;
      tagsInput.value = (link.tags || []).join(', ');
      noteInput.value = link.note || '';
    } else {
      editingId = null;
      modalTitleEl.textContent = 'Add a link';
      saveBtn.textContent = 'Save link';
      addForm.reset();
    }
    addModal.hidden = false;
    urlInput.focus();
  }

  function closeAddModal() {
    addModal.hidden = true;
    addForm.reset();
    editingId = null;
    showFormError(null);
  }

  openAddBtn.addEventListener('click', function () { openAddModal(null); });
  cancelAddBtn.addEventListener('click', closeAddModal);
  closeModalBtn.addEventListener('click', closeAddModal);
  addModal.addEventListener('click', function (e) {
    if (e.target === addModal) closeAddModal();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !addModal.hidden) closeAddModal();
  });

  // ---------- Auth ----------
  var tokenClient = null;
  var silentAttempt = false;

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
        var wasSilent = silentAttempt;
        silentAttempt = false;
        if (resp.error) {
          // A failed background re-auth attempt on page load is normal
          // (no session yet, or it needs a fresh consent click) — only
          // surface an error for a sign-in the person actually clicked.
          if (!wasSilent) {
            signinStatus.hidden = false;
            signinStatus.textContent = 'Sign-in failed: ' + resp.error;
          }
          return;
        }
        accessToken = resp.access_token;
        onSignedIn();
      },
    });

    // Try to pick back up an existing Google session without a click —
    // this can fail silently (e.g. blocked as a non-gesture popup), in
    // which case it's a no-op and the normal sign-in button still works.
    silentAttempt = true;
    tokenClient.requestAccessToken({ prompt: 'none' });
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
    toolbarEl.hidden = false;
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
      if (statusFilter === 'favorite' && !l.favorite) return false;
      if (tagFilter && (!l.tags || l.tags.indexOf(tagFilter) === -1)) return false;
      if (q) {
        var hay = (l.url + ' ' + (l.note || '') + ' ' + (l.tags || []).join(' ')).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  function renderStats() {
    var unread = allLinks.filter(function (l) { return !l.done; }).length;
    var favorites = allLinks.filter(function (l) { return l.favorite; }).length;
    statsStripEl.innerHTML = [
      ['links', allLinks.length],
      ['unread', unread],
      ['favorites', favorites],
    ].map(function (pair) {
      return '<div class="stat-cell"><span class="stat-num mono">' + pair[1] + '</span><span class="stat-label">' + pair[0] + '</span></div>';
    }).join('');
  }

  function renderChips() {
    var counts = {};
    allLinks.forEach(function (l) { counts[l.platform] = (counts[l.platform] || 0) + 1; });
    var platforms = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });

    var html = '<button type="button" class="chip' + (platformFilter === 'all' ? ' active' : '') + '" data-platform="all">All<span class="chip-count mono">' + allLinks.length + '</span></button>';
    platforms.forEach(function (p) {
      var color = LinkVaultCore.colorForPlatform(p);
      html += '<button type="button" class="chip' + (platformFilter === p ? ' active' : '') + '" data-platform="' + escapeHtml(p) + '">' +
        '<span class="dot" style="background:' + color + '"></span>' + escapeHtml(p) + '<span class="chip-count mono">' + counts[p] + '</span></button>';
    });
    chipsEl.innerHTML = html;

    var unreadCount = allLinks.filter(function (l) { return !l.done; }).length;
    var doneCount = allLinks.length - unreadCount;
    var favCount = allLinks.filter(function (l) { return l.favorite; }).length;
    statusChipsEl.innerHTML =
      '<button type="button" class="chip' + (statusFilter === 'all' ? ' active' : '') + '" data-status="all">All statuses</button>' +
      '<button type="button" class="chip' + (statusFilter === 'unread' ? ' active' : '') + '" data-status="unread">Unread<span class="chip-count mono">' + unreadCount + '</span></button>' +
      '<button type="button" class="chip' + (statusFilter === 'done' ? ' active' : '') + '" data-status="done">Done<span class="chip-count mono">' + doneCount + '</span></button>' +
      '<button type="button" class="chip' + (statusFilter === 'favorite' ? ' active' : '') + '" data-status="favorite">Favorites<span class="chip-count mono">' + favCount + '</span></button>';

    if (tagFilter) {
      tagBannerEl.hidden = false;
      tagBannerEl.innerHTML = 'Filtering by tag <strong class="mono">' + escapeHtml(tagFilter) + '</strong> <button type="button" id="clear-tag">Clear</button>';
    } else {
      tagBannerEl.hidden = true;
      tagBannerEl.innerHTML = '';
    }
  }

  function render() {
    renderStats();
    renderChips();

    var filtered = getFiltered();

    if (allLinks.length === 0) {
      listEl.innerHTML = '<div class="empty-state">' +
        '<span class="big">Your vault is empty</span>' +
        '<span>Add a link above — <code>instagram.com</code>, <code>linkedin.com</code>, anything — to start.</span>' +
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
          '<span class="platform-label">' + escapeHtml(l.platform) + '</span>' +
          '<span class="timestamp">' + formatDate(l.createdAt) + '</span>' +
        '</div>' +
        '<a class="card-url" href="' + escapeHtml(l.url) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(l.url) + '</a>' +
        (l.note ? '<div class="card-note">' + escapeHtml(l.note) + '</div>' : '') +
        (tagsHtml ? '<div class="card-tags">' + tagsHtml + '</div>' : '') +
        '<div class="card-footer">' +
          '<div class="card-footer-left">' +
            '<button type="button" class="star-btn' + (l.favorite ? ' active' : '') + '" data-action="toggle-favorite" data-id="' + l.id + '" aria-label="' + (l.favorite ? 'Remove from favorites' : 'Add to favorites') + '" title="Favorite">' + (l.favorite ? '★' : '☆') + '</button>' +
            '<button type="button" class="done-btn' + (l.done ? ' active' : '') + '" data-action="toggle-done" data-id="' + l.id + '">' + (l.done ? '✓ Done' : 'Mark done') + '</button>' +
          '</div>' +
          '<div class="card-footer-right">' +
            '<button type="button" class="icon-btn" data-action="edit" data-id="' + l.id + '">Edit</button>' +
            '<button type="button" class="icon-btn' + (confirming ? ' confirm' : '') + '" data-action="delete" data-id="' + l.id + '">' + (confirming ? 'Confirm' : 'Delete') + '</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  // ---------- Event wiring ----------
  addForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    showFormError(null);
    if (!accessToken || !fileId) { showFormError('Not connected yet — try again in a moment.'); return; }

    var tags = tagsInput.value.split(',').map(function (t) { return t.trim(); }).filter(Boolean).slice(0, 10);
    var note = noteInput.value.trim();
    var restoreLabel = editingId ? 'Save changes' : 'Save link';

    if (editingId) {
      var existing = allLinks.find(function (l) { return l.id === editingId; });
      if (!existing) { closeAddModal(); return; }
      var u = LinkVaultCore.normalizeUrl(urlInput.value);
      if (!u) { showFormError('That doesn\'t look like a valid link.'); return; }
      var before = { url: existing.url, platform: existing.platform, tags: existing.tags, note: existing.note };

      existing.url = u.href;
      existing.platform = LinkVaultCore.detectPlatform(u.hostname.replace(/^www\./, '')).name;
      existing.tags = tags;
      existing.note = note;
      existing.updatedAt = Date.now();

      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
      render();
      try {
        await persist();
        closeAddModal();
      } catch (err) {
        Object.assign(existing, before);
        render();
        showFormError('Could not save those changes — try again.');
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = restoreLabel;
      }
      return;
    }

    var link = LinkVaultCore.newLink(urlInput.value, { tags: tags, note: note });
    if (!link) { showFormError('That doesn\'t look like a valid link.'); return; }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    allLinks.unshift(link);
    render();
    try {
      await persist();
      closeAddModal();
    } catch (err) {
      allLinks = allLinks.filter(function (l) { return l.id !== link.id; });
      render();
      showFormError('Could not save that link — try again.');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = restoreLabel;
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

    var favBtn = e.target.closest('[data-action="toggle-favorite"]');
    if (favBtn) {
      var idFav = favBtn.getAttribute('data-id');
      var linkFav = allLinks.find(function (l) { return l.id === idFav; });
      if (!linkFav) return;
      linkFav.favorite = !linkFav.favorite;
      linkFav.updatedAt = Date.now();
      render();
      try { await persist(); } catch (err) { setStatus('Could not save that change — try again.'); }
      return;
    }

    var editBtn = e.target.closest('[data-action="edit"]');
    if (editBtn) {
      var idEdit = editBtn.getAttribute('data-id');
      var linkEdit = allLinks.find(function (l) { return l.id === idEdit; });
      if (!linkEdit) return;
      openAddModal(linkEdit);
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
