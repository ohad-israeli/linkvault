(function () {
  var urlInput = document.getElementById('url-input');
  var tagsInput = document.getElementById('tags-input');
  var noteInput = document.getElementById('note-input');
  var form = document.getElementById('save-form');
  var saveBtn = document.getElementById('save-btn');
  var status = document.getElementById('status');
  var recentSection = document.getElementById('recent-section');
  var recentList = document.getElementById('recent-list');
  var openDashboard = document.getElementById('open-dashboard');

  function setStatus(msg, cls) {
    status.textContent = msg || '';
    status.className = cls || '';
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    var tab = tabs && tabs[0];
    if (tab && tab.url && /^https?:\/\//.test(tab.url)) {
      urlInput.value = tab.url;
    }
  });

  chrome.runtime.sendMessage({ type: 'get-dashboard-url' }, function (res) {
    if (res && res.url) openDashboard.href = res.url;
  });

  function loadRecent() {
    chrome.runtime.sendMessage({ type: 'get-recent-links', limit: 5 }, function (res) {
      if (!res || !res.ok || !res.links || res.links.length === 0) return;
      recentSection.hidden = false;
      recentList.innerHTML = res.links.map(function (l) {
        var color = LinkVaultCore.colorForPlatform(l.platform);
        return '<div class="recent-item">' +
          '<span class="platform" style="color:' + color + '">' + escapeHtml(l.platform) + '</span>' +
          '<a href="' + escapeHtml(l.url) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(l.url) + '</a>' +
          '</div>';
      }).join('');
    });
  }
  loadRecent();

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    setStatus('');
    var url = urlInput.value.trim();
    if (!url) { setStatus('Enter a URL first.', 'error'); return; }
    var tags = tagsInput.value.split(',').map(function (t) { return t.trim(); }).filter(Boolean);
    var note = noteInput.value.trim();

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    chrome.runtime.sendMessage({ type: 'save-link', url: url, tags: tags, note: note }, function (res) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save to Link Vault';
      if (res && res.ok) {
        setStatus('Saved.', 'ok');
        tagsInput.value = '';
        noteInput.value = '';
        loadRecent();
      } else {
        setStatus((res && res.error) || 'Could not save.', 'error');
      }
    });
  });
})();
