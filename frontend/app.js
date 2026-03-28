/* ═══════════════════════════════════════════════════════════════
   Black Book — app.js
   ═══════════════════════════════════════════════════════════════ */

'use strict';

// ── State ─────────────────────────────────────────────────────────
const state = {
  people: [],
  selectedId: null,
  selectedPerson: null,
  activeTab: 'notes',
  searching: false,
};

// ── DOM refs ──────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const els = {
  searchInput:      $('searchInput'),
  clearSearch:      $('clearSearch'),
  addPersonBtn:     $('addPersonBtn'),
  emptyAddBtn:      $('emptyAddBtn'),
  peopleList:       $('peopleList'),
  listLabel:        $('listLabel'),
  emptyState:       $('emptyState'),
  personDetail:     $('personDetail'),
  personAvatar:     $('personAvatar'),
  personName:       $('personName'),
  personRelBadge:   $('personRelBadge'),
  personTags:       $('personTags'),
  editPersonBtn:    $('editPersonBtn'),
  deletePersonBtn:  $('deletePersonBtn'),
  notesList:        $('notesList'),
  noteContent:      $('noteContent'),
  noteType:         $('noteType'),
  micBtn:           $('micBtn'),
  submitNote:       $('submitNote'),
  tabBtns:          document.querySelectorAll('.tab-btn'),
  tabNotes:         $('tabNotes'),
  tabBriefing:      $('tabBriefing'),
  briefingContent:  $('briefingContent'),
  // Modals
  personModal:      $('personModal'),
  modalTitle:       $('modalTitle'),
  modalName:        $('modalName'),
  modalRelationship:$('modalRelationship'),
  modalTags:        $('modalTags'),
  closePersonModal: $('closePersonModal'),
  cancelPersonModal:$('cancelPersonModal'),
  savePersonBtn:    $('savePersonBtn'),
  confirmModal:     $('confirmModal'),
  confirmTitle:     $('confirmTitle'),
  confirmMessage:   $('confirmMessage'),
  confirmCancel:    $('confirmCancel'),
  confirmOk:        $('confirmOk'),
  toast:            $('toast'),
};

// ── Helpers ───────────────────────────────────────────────────────

function initials(name) {
  return (name || '?')
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() || '')
    .join('');
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + (iso.endsWith('Z') ? '' : 'Z'));
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

function relClass(rel) {
  const map = { friend:'rel-friend', colleague:'rel-colleague', family:'rel-family', contact:'rel-contact', other:'rel-other' };
  return map[rel] || 'rel-contact';
}

function ntClass(nt) {
  const map = { general:'nt-general', meeting:'nt-meeting', personal:'nt-personal', context:'nt-context' };
  return map[nt] || 'nt-general';
}

function ntLabel(nt) {
  const map = { general:'General', meeting:'Meeting', personal:'Personal', context:'Context' };
  return map[nt] || 'General';
}

function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

// ── Toast ─────────────────────────────────────────────────────────
let toastTimer = null;

function showToast(msg, type = 'success') {
  const t = els.toast;
  t.textContent = msg;
  t.className = `toast toast-${type}`;
  t.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3000);
}

// ── API ───────────────────────────────────────────────────────────

async function apiFetch(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Request failed');
  }
  if (res.status === 204) return null;
  return res.json();
}

const api = {
  listPeople:   ()        => apiFetch('/api/people'),
  createPerson: body      => apiFetch('/api/people', { method:'POST', body: JSON.stringify(body) }),
  getPerson:    id        => apiFetch(`/api/people/${id}`),
  updatePerson: (id,body) => apiFetch(`/api/people/${id}`, { method:'PUT', body: JSON.stringify(body) }),
  deletePerson: id        => apiFetch(`/api/people/${id}`, { method:'DELETE' }),
  addNote:      (id,body) => apiFetch(`/api/people/${id}/notes`, { method:'POST', body: JSON.stringify(body) }),
  deleteNote:   id        => apiFetch(`/api/notes/${id}`, { method:'DELETE' }),
  search:       q         => apiFetch(`/api/search?q=${encodeURIComponent(q)}`),
  briefing:     id        => apiFetch(`/api/people/${id}/briefing`),
};

// ── Render sidebar list ───────────────────────────────────────────

function renderPeopleList(people) {
  const el = els.peopleList;
  if (!people.length) {
    el.innerHTML = `<div class="list-empty">${
      state.searching ? 'No results found.' : 'No contacts yet.<br>Add someone to begin.'
    }</div>`;
    return;
  }

  el.innerHTML = people.map(p => {
    const active = p.id === state.selectedId ? ' active' : '';
    return `<div class="person-card${active}" data-id="${p.id}">
      <div class="card-avatar">${escHtml(initials(p.name))}</div>
      <div class="card-info">
        <div class="card-name">${escHtml(p.name)}</div>
        <div class="card-meta">
          <span class="rel-badge ${relClass(p.relationship)}">${escHtml(p.relationship)}</span>
          <span class="card-note-count">${p.note_count} note${p.note_count === 1 ? '' : 's'}</span>
        </div>
      </div>
    </div>`;
  }).join('');

  el.querySelectorAll('.person-card').forEach(card => {
    card.addEventListener('click', () => selectPerson(parseInt(card.dataset.id)));
  });
}

// ── Select / show person ──────────────────────────────────────────

async function selectPerson(id) {
  state.selectedId = id;

  // Update active card highlight
  els.peopleList.querySelectorAll('.person-card').forEach(c => {
    c.classList.toggle('active', parseInt(c.dataset.id) === id);
  });

  try {
    const person = await api.getPerson(id);
    state.selectedPerson = person;
    showPersonDetail(person);
  } catch (e) {
    showToast(e.message, 'error');
  }
}

function showPersonDetail(person) {
  els.emptyState.hidden = true;
  els.personDetail.hidden = false;

  // Avatar + header
  els.personAvatar.textContent = initials(person.name);
  els.personName.textContent = person.name;

  els.personRelBadge.textContent = person.relationship;
  els.personRelBadge.className = `rel-badge ${relClass(person.relationship)}`;

  // Tags
  const tags = (person.tags || '').split(',').map(t => t.trim()).filter(Boolean);
  els.personTags.innerHTML = tags.map(t => `<span class="tag-pill">${escHtml(t)}</span>`).join('');

  renderNotes(person.notes || []);

  // Reset to notes tab
  switchTab('notes');
}

// ── Notes rendering ───────────────────────────────────────────────

function renderNotes(notes) {
  if (!notes.length) {
    els.notesList.innerHTML = `<div class="notes-empty">No notes yet.<br>Add one below.</div>`;
    return;
  }

  els.notesList.innerHTML = notes.map(n => `
    <div class="note-card" data-note-id="${n.id}">
      <div class="note-card-header">
        <span class="note-type-badge ${ntClass(n.note_type)}">${ntLabel(n.note_type)}</span>
        <span class="note-timestamp">${formatDate(n.created_at)}</span>
      </div>
      <div class="note-content">${escHtml(n.content)}</div>
      <button class="note-delete-btn" data-note-id="${n.id}" title="Delete note">
        <svg viewBox="0 0 14 14" fill="none">
          <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        </svg>
      </button>
    </div>
  `).join('');

  els.notesList.querySelectorAll('.note-delete-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      confirmDelete(
        'Delete Note',
        'Are you sure you want to delete this note? This cannot be undone.',
        async () => {
          try {
            await api.deleteNote(parseInt(btn.dataset.noteId));
            await refreshSelectedPerson();
            showToast('Note deleted.');
          } catch (err) {
            showToast(err.message, 'error');
          }
        }
      );
    });
  });
}

// ── Tab switching ─────────────────────────────────────────────────

function switchTab(tab) {
  state.activeTab = tab;
  els.tabBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
  els.tabNotes.hidden     = (tab !== 'notes');
  els.tabBriefing.hidden  = (tab !== 'briefing');

  if (tab === 'briefing' && state.selectedId) {
    loadBriefing(state.selectedId);
  }
}

els.tabBtns.forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

// ── Briefing ──────────────────────────────────────────────────────

async function loadBriefing(personId) {
  els.briefingContent.innerHTML = '<div class="briefing-empty">Loading briefing…</div>';
  try {
    const data = await api.briefing(personId);
    renderBriefing(data);
  } catch (e) {
    els.briefingContent.innerHTML = `<div class="briefing-empty">Failed to load briefing.</div>`;
    showToast(e.message, 'error');
  }
}

function renderBriefing(data) {
  const { person, sections, total_notes } = data;
  const tags = person.tags || [];

  const tagsHtml = tags.map(t => `<span class="tag-pill">${escHtml(t)}</span>`).join('');
  const relHtml  = `<span class="rel-badge ${relClass(person.relationship)}">${escHtml(person.relationship)}</span>`;

  let html = `
    <div class="briefing-header">
      <div class="briefing-title">${escHtml(person.name)}</div>
      <div class="briefing-meta">
        ${relHtml}
        ${tagsHtml}
        <span>${total_notes} note${total_notes === 1 ? '' : 's'}</span>
        <span>Generated ${formatDate(new Date().toISOString())}</span>
      </div>
    </div>
  `;

  if (!sections.length) {
    html += `<div class="briefing-empty">No notes to display.<br>Add notes to generate a briefing.</div>`;
  } else {
    sections.forEach(section => {
      html += `<div class="briefing-section">
        <div class="briefing-section-title">${escHtml(section.label)}</div>`;
      section.notes.forEach(note => {
        html += `<div class="briefing-note ${ntClass(note.note_type)}">
          <div class="briefing-note-text">${escHtml(note.content)}</div>
          <div class="briefing-note-ts">${formatDate(note.created_at)}</div>
        </div>`;
      });
      html += `</div>`;
    });
  }

  els.briefingContent.innerHTML = html;
}

// ── Load / refresh all people ─────────────────────────────────────

async function loadPeople() {
  try {
    state.people = await api.listPeople();
    renderPeopleList(state.people);
    els.listLabel.textContent = 'All Contacts';
    state.searching = false;
  } catch (e) {
    showToast('Failed to load contacts.', 'error');
  }
}

async function refreshSelectedPerson() {
  if (!state.selectedId) return;
  const person = await api.getPerson(state.selectedId);
  state.selectedPerson = person;
  showPersonDetail(person);
  // Also refresh sidebar count
  await loadPeople();
  // Re-highlight selected card
  els.peopleList.querySelectorAll('.person-card').forEach(c => {
    c.classList.toggle('active', parseInt(c.dataset.id) === state.selectedId);
  });
}

// ── Search ────────────────────────────────────────────────────────

let searchDebounce = null;

els.searchInput.addEventListener('input', () => {
  const q = els.searchInput.value.trim();
  els.clearSearch.hidden = !q;

  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(async () => {
    if (!q) {
      state.searching = false;
      await loadPeople();
      return;
    }
    state.searching = true;
    try {
      const results = await api.search(q);
      renderPeopleList(results);
      els.listLabel.textContent = `Results (${results.length})`;
    } catch (e) {
      showToast(e.message, 'error');
    }
  }, 280);
});

els.clearSearch.addEventListener('click', () => {
  els.searchInput.value = '';
  els.clearSearch.hidden = true;
  state.searching = false;
  loadPeople();
});

// ── Add / Edit person modal ───────────────────────────────────────

let editingPersonId = null;

function openAddPersonModal() {
  editingPersonId = null;
  els.modalTitle.textContent = 'Add Person';
  els.modalName.value = '';
  els.modalRelationship.value = 'contact';
  els.modalTags.value = '';
  els.personModal.hidden = false;
  els.modalName.focus();
}

function openEditPersonModal(person) {
  editingPersonId = person.id;
  els.modalTitle.textContent = 'Edit Person';
  els.modalName.value = person.name;
  els.modalRelationship.value = person.relationship;
  els.modalTags.value = person.tags || '';
  els.personModal.hidden = false;
  els.modalName.focus();
}

function closePersonModal() {
  els.personModal.hidden = true;
}

els.addPersonBtn.addEventListener('click', openAddPersonModal);
els.emptyAddBtn.addEventListener('click', openAddPersonModal);
els.closePersonModal.addEventListener('click', closePersonModal);
els.cancelPersonModal.addEventListener('click', closePersonModal);

els.personModal.addEventListener('click', e => {
  if (e.target === els.personModal) closePersonModal();
});

els.savePersonBtn.addEventListener('click', async () => {
  const name = els.modalName.value.trim();
  if (!name) {
    els.modalName.focus();
    showToast('Name is required.', 'error');
    return;
  }
  const body = {
    name,
    relationship: els.modalRelationship.value,
    tags: els.modalTags.value.trim(),
  };
  try {
    if (editingPersonId) {
      await api.updatePerson(editingPersonId, body);
      showToast('Contact updated.');
      closePersonModal();
      await loadPeople();
      if (state.selectedId === editingPersonId) {
        await selectPerson(editingPersonId);
      }
    } else {
      const newPerson = await api.createPerson(body);
      showToast('Contact added.');
      closePersonModal();
      await loadPeople();
      selectPerson(newPerson.id);
    }
  } catch (e) {
    showToast(e.message, 'error');
  }
});

// Enter key in name field saves
els.modalName.addEventListener('keydown', e => {
  if (e.key === 'Enter') els.savePersonBtn.click();
});

// ── Edit / Delete person ──────────────────────────────────────────

els.editPersonBtn.addEventListener('click', () => {
  if (state.selectedPerson) openEditPersonModal(state.selectedPerson);
});

els.deletePersonBtn.addEventListener('click', () => {
  if (!state.selectedPerson) return;
  confirmDelete(
    'Delete Contact',
    `Delete "${state.selectedPerson.name}" and all their notes? This cannot be undone.`,
    async () => {
      try {
        await api.deletePerson(state.selectedId);
        state.selectedId = null;
        state.selectedPerson = null;
        els.personDetail.hidden = true;
        els.emptyState.hidden = false;
        await loadPeople();
        showToast('Contact deleted.');
      } catch (e) {
        showToast(e.message, 'error');
      }
    }
  );
});

// ── Add note ──────────────────────────────────────────────────────

els.submitNote.addEventListener('click', async () => {
  const content = els.noteContent.value.trim();
  if (!content) {
    els.noteContent.focus();
    return;
  }
  if (!state.selectedId) return;
  try {
    await api.addNote(state.selectedId, { content, note_type: els.noteType.value });
    els.noteContent.value = '';
    await refreshSelectedPerson();
    // Scroll notes to bottom
    els.notesList.scrollTop = els.notesList.scrollHeight;
    showToast('Note saved.');
  } catch (e) {
    showToast(e.message, 'error');
  }
});

// ── Confirm modal ─────────────────────────────────────────────────

let confirmCallback = null;

function confirmDelete(title, message, onConfirm) {
  els.confirmTitle.textContent = title;
  els.confirmMessage.textContent = message;
  confirmCallback = onConfirm;
  els.confirmModal.hidden = false;
}

els.confirmCancel.addEventListener('click', () => {
  els.confirmModal.hidden = true;
  confirmCallback = null;
});

els.confirmOk.addEventListener('click', async () => {
  els.confirmModal.hidden = true;
  if (confirmCallback) {
    await confirmCallback();
    confirmCallback = null;
  }
});

els.confirmModal.addEventListener('click', e => {
  if (e.target === els.confirmModal) {
    els.confirmModal.hidden = true;
    confirmCallback = null;
  }
});

// ── Voice dictation ───────────────────────────────────────────────

(function setupVoice() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    els.micBtn.title = 'Voice dictation not supported in this browser';
    els.micBtn.style.opacity = '0.4';
    els.micBtn.style.cursor = 'not-allowed';
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  let isRecording = false;
  let baseText = ''; // text before current recognition session
  let interimText = '';

  function startRecording() {
    baseText = els.noteContent.value;
    if (baseText && !baseText.endsWith(' ') && !baseText.endsWith('\n')) {
      baseText += ' ';
    }
    isRecording = true;
    els.micBtn.classList.add('recording');
    els.micBtn.title = 'Stop voice dictation';
    try {
      recognition.start();
    } catch (e) {
      // Already started
    }
  }

  function stopRecording() {
    isRecording = false;
    els.micBtn.classList.remove('recording');
    els.micBtn.title = 'Start voice dictation';
    recognition.stop();
    // Commit any remaining interim text
    if (interimText) {
      els.noteContent.value = baseText + interimText;
      interimText = '';
    }
  }

  recognition.onresult = (event) => {
    let finalText = '';
    interimText = '';

    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) {
        finalText += event.results[i][0].transcript;
      } else {
        interimText += event.results[i][0].transcript;
      }
    }

    if (finalText) {
      baseText += finalText;
      if (!baseText.endsWith(' ') && !baseText.endsWith('\n')) {
        baseText += ' ';
      }
      interimText = '';
    }

    els.noteContent.value = baseText + interimText;
  };

  recognition.onerror = (event) => {
    if (event.error !== 'aborted') {
      showToast(`Voice error: ${event.error}`, 'error');
    }
    stopRecording();
  };

  recognition.onend = () => {
    if (isRecording) {
      // Restart if we didn't intentionally stop
      try { recognition.start(); } catch (e) { stopRecording(); }
    }
  };

  els.micBtn.addEventListener('click', () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  });
})();

// ── Keyboard shortcuts ────────────────────────────────────────────

document.addEventListener('keydown', e => {
  // Escape closes modals
  if (e.key === 'Escape') {
    if (!els.personModal.hidden) closePersonModal();
    if (!els.confirmModal.hidden) {
      els.confirmModal.hidden = true;
      confirmCallback = null;
    }
  }
});

// ── Init ──────────────────────────────────────────────────────────

loadPeople();
