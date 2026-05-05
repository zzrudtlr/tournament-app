// ============================================================
//  Tournament / Group Generator — app.js
//  Pure browser JS, no backend, no DB (localStorage only)
// ============================================================

'use strict';

// ── Constants ──────────────────────────────────────────────
const GRADE_SCORES = { S: 6, A: 5, B: 4, C: 3, D: 2, '초보': 1 };
const TEAM_CLASSES = ['team-block-1', 'team-block-2', 'team-block-3', 'team-block-4'];

const DOUBLES_META = {
  none:   { label: '자유',     icon: '',     color: '' },
  men:    { label: '남복',     icon: '🟦',   color: 'blue' },
  women:  { label: '여복',     icon: '🟥',   color: 'pink' },
  mixed:  { label: '혼복',     icon: '🟨',   color: 'amber' },
  both:   { label: '남복+여복', icon: '🟦🟥', color: 'purple' },
};

// ── State ──────────────────────────────────────────────────
let participants       = [];
let nextId             = 1;
let editingId          = null;
let results            = null;
let groupAddTargetIdx  = -1;
let previewDeletedIds  = new Set();
let selectedFluidCombos = {};
let groundSelections   = {}; // key: "groupIdx_roundIdx" → matchIdx (사용자가 직접 선택)
let roundSwaps         = {}; // key: "gIdx_rIdx" → { round, matches, soloBye } (교체 결과)
let roundEditMode      = null; // 현재 교체 편집 중인 라운드 key

// ── Init ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadFromLocalStorage();
  setupFormListener();
  renderParticipantList();
  updateStats();
  onDoublesTypeChange();
});

// ── LocalStorage ───────────────────────────────────────────
function loadFromLocalStorage() {
  try {
    const saved = localStorage.getItem('tg_participants');
    if (saved) {
      participants = JSON.parse(saved);
      nextId = participants.length
        ? Math.max(...participants.map(p => p.id)) + 1
        : 1;
    }
  } catch (_) { participants = []; }
}

function saveToLocalStorage() {
  localStorage.setItem('tg_participants', JSON.stringify(participants));
}

// ── Form setup ─────────────────────────────────────────────
function setupFormListener() {
  document.getElementById('addParticipantForm').addEventListener('submit', handleFormSubmit);
}

// ── Input Tabs ─────────────────────────────────────────────
function switchInputTab(tab) {
  [
    ['manual', 'manualInputSection', 'tabManual'],
    ['file',   'fileUploadSection',  'tabFile'  ],
    ['paste',  'pasteInputSection',  'tabPaste' ],
  ].forEach(([t, sectionId, btnId]) => {
    document.getElementById(sectionId)?.classList.toggle('hidden', t !== tab);
    const btn = document.getElementById(btnId);
    if (btn) {
      btn.classList.toggle('active-tab',   t === tab);
      btn.classList.toggle('text-gray-500', t !== tab);
    }
  });
}

// ── Result Tabs ────────────────────────────────────────────
function switchResultTab(tab) {
  ['groups', 'tournament', 'ground'].forEach(t => {
    const panel = document.getElementById(t + 'ResultsPanel');
    const btn   = document.getElementById('resultTab' + t.charAt(0).toUpperCase() + t.slice(1));
    if (panel) panel.classList.toggle('hidden', t !== tab);
    if (btn) {
      btn.classList.toggle('active-result-tab', t === tab);
      btn.classList.toggle('text-gray-400',     t !== tab);
    }
  });
}

// ── Doubles type info box ───────────────────────────────────
function onDoublesTypeChange() {
  const dt  = document.getElementById('doublesType').value;
  const box = document.getElementById('doublesInfoBox');

  const maleCount   = participants.filter(p => p.gender === '남').length;
  const femaleCount = participants.filter(p => p.gender === '여').length;

  const infoMap = {
    none: null,
    men: {
      cls: 'bg-blue-50 border-blue-200 text-blue-800',
      html: `🟦 <strong>남복</strong> — 성별이 <strong>남</strong>인 참가자만 대진에 포함됩니다.
             <br>현재 남자 참가자: <strong>${maleCount}명</strong>
             <br>팀 구성: 점수순 1위+최하위, 2위+차하위 (2인 1팀)`
    },
    women: {
      cls: 'bg-pink-50 border-pink-200 text-pink-800',
      html: `🟥 <strong>여복</strong> — 성별이 <strong>여</strong>인 참가자만 대진에 포함됩니다.
             <br>현재 여자 참가자: <strong>${femaleCount}명</strong>
             <br>팀 구성: 점수순 1위+최하위, 2위+차하위 (2인 1팀)`
    },
    mixed: {
      cls: 'bg-amber-50 border-amber-200 text-amber-800',
      html: `🟨 <strong>혼복</strong> — 남자 1명 + 여자 1명이 한 팀이 됩니다.
             <br>현재 남자: <strong>${maleCount}명</strong> / 여자: <strong>${femaleCount}명</strong>
             <br>조 구성: 조당 남녀 동수 배치 → 팀 페어링: 최강 남 + 최약 여, 차순위 남 + 차순위 여 (교차 균형)`
    },
    both: {
      cls: 'bg-purple-50 border-purple-200 text-purple-800',
      html: `🟦🟥 <strong>남복+여복 동시</strong> — 남복과 여복 대진표를 함께 생성합니다.
             <br>현재 남자: <strong>${maleCount}명</strong> (팀 ${Math.floor(maleCount / 2)}팀 예상) / 여자: <strong>${femaleCount}명</strong> (팀 ${Math.floor(femaleCount / 2)}팀 예상)
             <br>각 성별별로 점수순 페어링 후 전체 대진표 생성 · 조 내 모든 경우의 수 매치 표시`
    },
  };

  const info = infoMap[dt];
  if (!info) {
    box.classList.add('hidden');
    return;
  }
  box.className  = `mb-4 p-3 rounded-xl border text-sm ${info.cls}`;
  box.innerHTML  = info.html;
  box.classList.remove('hidden');

  updateStats();
}

// ── Participant CRUD ────────────────────────────────────────
function handleFormSubmit(e) {
  e.preventDefault();
  const form = e.target;

  const raw = {
    name:        form.name_input.value.trim(),
    grade:       form.grade.value,
    age:         form.age.value,
    career:      form.career.value,
    gender:      form.gender.value,
    affiliation: form.affiliation.value.trim(),
  };

  if (!raw.name) { showToast('이름을 입력해주세요.', 'error'); return; }
  if (!GRADE_SCORES[raw.grade]) { showToast('올바른 급수를 선택해주세요.', 'error'); return; }

  if (editingId !== null) {
    const idx = participants.findIndex(p => p.id === editingId);
    if (idx !== -1) participants[idx] = buildParticipant(raw, editingId);
    resetEditMode();
    showToast('참가자 정보가 수정되었습니다.', 'success');
  } else {
    participants.push(buildParticipant(raw, nextId++));
    showToast('참가자가 추가되었습니다.', 'success');
  }

  saveToLocalStorage();
  form.reset();
  renderParticipantList();
  updateStats();
  onDoublesTypeChange();
}

function buildParticipant(raw, id) {
  return {
    id,
    name:        raw.name,
    grade:       raw.grade,
    age:         parseInt(raw.age)    || 0,
    career:      parseFloat(raw.career) || 0,
    gender:      raw.gender      || '',
    affiliation: raw.affiliation || '',
    score:       GRADE_SCORES[raw.grade] || 1,
  };
}

function editParticipant(id) {
  const p = participants.find(p => p.id === id);
  if (!p) return;

  editingId = id;
  const form = document.getElementById('addParticipantForm');
  form.name_input.value  = p.name;
  form.grade.value        = p.grade;
  form.age.value          = p.age    || '';
  form.career.value       = p.career || '';
  form.gender.value       = p.gender || '';
  form.affiliation.value  = p.affiliation || '';

  document.getElementById('formTitle').textContent   = '참가자 수정';
  document.getElementById('submitBtn').textContent   = '수정 완료';
  document.getElementById('cancelEditBtn').classList.remove('hidden');

  switchInputTab('manual');
  document.getElementById('addParticipantForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function cancelEdit() {
  resetEditMode();
  document.getElementById('addParticipantForm').reset();
}

function resetEditMode() {
  editingId = null;
  document.getElementById('formTitle').textContent   = '참가자 추가';
  document.getElementById('submitBtn').textContent   = '추가';
  document.getElementById('cancelEditBtn').classList.add('hidden');
}

function deleteParticipant(id) {
  if (!confirm('이 참가자를 삭제하시겠습니까?')) return;
  participants = participants.filter(p => p.id !== id);
  saveToLocalStorage();
  renderParticipantList();
  updateStats();
  onDoublesTypeChange();
}

function clearAll() {
  if (participants.length === 0) { showToast('삭제할 참가자가 없습니다.', 'info'); return; }
  if (!confirm(`참가자 ${participants.length}명을 모두 삭제하시겠습니까?`)) return;
  participants = [];
  nextId       = 1;
  saveToLocalStorage();
  renderParticipantList();
  updateStats();
  onDoublesTypeChange();
  document.getElementById('resultsSection').classList.add('hidden');
}

// ── Render participant table ────────────────────────────────
function renderParticipantList() {
  const tbody    = document.getElementById('participantTbody');
  const emptyDiv = document.getElementById('emptyParticipants');

  if (participants.length === 0) {
    tbody.innerHTML = '';
    emptyDiv.classList.remove('hidden');
    return;
  }

  emptyDiv.classList.add('hidden');
  tbody.innerHTML = participants.map((p, i) => {
    const subParts = [];
    if (p.age)         subParts.push(p.age + '세');
    if (p.career)      subParts.push(p.career + '년');
    if (p.affiliation) subParts.push(esc(p.affiliation));
    const subLine = subParts.length
      ? `<span class="block sm:hidden text-xs text-gray-400 mt-0.5 leading-tight">${subParts.join(' · ')}</span>`
      : '';
    return `
    <tr class="hover:bg-gray-50 transition-colors">
      <td class="px-2 sm:px-3 py-2 text-center text-gray-400 text-xs">${i + 1}</td>
      <td class="px-2 sm:px-3 py-2 font-medium text-gray-800">
        ${esc(p.name)}${subLine}
      </td>
      <td class="px-2 sm:px-3 py-2 text-center">
        <span class="grade-badge grade-${p.grade}">${esc(p.grade)}</span>
      </td>
      <td class="hidden sm:table-cell px-3 py-2 text-center text-sm text-gray-600">${p.age || '-'}</td>
      <td class="hidden sm:table-cell px-3 py-2 text-center text-sm text-gray-600">${p.career ? p.career + '년' : '-'}</td>
      <td class="px-2 sm:px-3 py-2 text-center">
        ${p.gender ? `<span class="gender-badge gender-${p.gender}">${p.gender}</span>` : '<span class="text-gray-300">-</span>'}
      </td>
      <td class="hidden sm:table-cell px-3 py-2 text-sm text-gray-500">${esc(p.affiliation) || '-'}</td>
      <td class="px-2 sm:px-3 py-2 text-center text-sm font-bold text-indigo-600">${p.score}</td>
      <td class="px-2 sm:px-3 py-2 text-center whitespace-nowrap">
        <button class="btn-icon" onclick="editParticipant(${p.id})" title="수정">✏️</button>
        <button class="btn-icon" onclick="deleteParticipant(${p.id})" title="삭제">🗑️</button>
      </td>
    </tr>`;
  }).join('');
}

// ── Stats ───────────────────────────────────────────────────
function updateStats() {
  const count     = participants.length;
  const maleN     = participants.filter(p => p.gender === '남').length;
  const femaleN   = participants.filter(p => p.gender === '여').length;
  const groupSize = parseInt(document.getElementById('groupSize')?.value || 4);
  const groups    = count > 0 ? Math.ceil(count / groupSize) : 0;
  const avgScore  = count > 0
    ? (participants.reduce((s, p) => s + p.score, 0) / count).toFixed(1)
    : 0;

  document.getElementById('statCount').textContent    = count;
  document.getElementById('statMale').textContent     = maleN;
  document.getElementById('statFemale').textContent   = femaleN;
  document.getElementById('statGroups').textContent   = groups;
  document.getElementById('statAvgScore').textContent = avgScore;
}

// ── File Upload ─────────────────────────────────────────────
function handleFileUpload(e) {
  processFile(e.target.files[0]);
  e.target.value = '';
}

function handleDrop(e) {
  e.preventDefault();
  processFile(e.dataTransfer.files[0]);
}

function processFile(file) {
  if (!file) return;
  const ext = file.name.split('.').pop().toLowerCase();

  if (ext === 'csv')              readTextFile(file, parseCSVText);
  else if (ext === 'txt')         readTextFile(file, parseTXTText);
  else if (ext === 'xlsx' || ext === 'xls') parseExcelFile(file);
  else showToast('지원하지 않는 파일 형식입니다. (.xlsx, .csv, .txt)', 'error');
}

function readTextFile(file, parseFn) {
  const reader    = new FileReader();
  reader.onload   = e => parseFn(e.target.result);
  reader.onerror  = () => showToast('파일을 읽을 수 없습니다.', 'error');
  reader.readAsText(file, 'UTF-8');
}

function parseCSVText(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  let start   = 0;
  if (lines.length && /name|grade|이름|급수/i.test(lines[0])) start = 1;

  commitParsed(lines.slice(start).map(line => {
    const c = splitCSVLine(line);
    return { name: c[0]?.trim()||'', grade: normalizeGrade(c[1]), age: c[2]?.trim()||'0',
             career: c[3]?.trim()||'0', gender: normalizeGender(c[4]), affiliation: c[5]?.trim()||'' };
  }));
}

function parseTXTText(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  commitParsed(lines.map(line => {
    const c = line.split(',').map(s => s.trim());
    return { name: c[0]||'', grade: normalizeGrade(c[1]), age: c[2]||'0',
             career: c[3]||'0', gender: normalizeGender(c[4]), affiliation: c[5]||'' };
  }));
}

function parsePasteData(text) {
  return text.split(/\r?\n/)
    .map(l => l.trim()).filter(Boolean)
    .map(line => {
      const c = line.split(',').map(s => s.trim());
      return { name: c[0]||'', grade: normalizeGrade(c[1]), age: c[2]||'0',
               career: c[3]||'0', gender: normalizeGender(c[4]), affiliation: c[5]||'' };
    })
    .filter(d => d.name);
}

function onPasteInput() {
  const text    = document.getElementById('pasteTextarea').value;
  const parsed  = parsePasteData(text);
  const preview = document.getElementById('pastePreview');
  const addBtn  = document.getElementById('pasteAddBtn');

  if (!parsed.length) {
    preview.innerHTML = '';
    if (addBtn) addBtn.disabled = true;
    return;
  }

  if (addBtn) addBtn.disabled = false;
  preview.innerHTML = `
    <p class="text-xs text-green-600 font-semibold mb-2">✅ ${parsed.length}명 인식됨</p>
    <div class="overflow-x-auto max-h-52 overflow-y-auto rounded-lg border border-gray-100">
      <table class="w-full text-xs">
        <thead class="bg-gray-50 sticky top-0">
          <tr class="text-gray-400 uppercase tracking-wide">
            <th class="px-2 py-1.5 text-left">이름</th>
            <th class="px-2 py-1.5">급수</th>
            <th class="px-2 py-1.5">나이</th>
            <th class="px-2 py-1.5">경력</th>
            <th class="px-2 py-1.5">성별</th>
            <th class="px-2 py-1.5 text-left">소속</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-50">
          ${parsed.map(d => `
            <tr class="hover:bg-gray-50">
              <td class="px-2 py-1.5 font-medium">${esc(d.name)}</td>
              <td class="px-2 py-1.5 text-center"><span class="grade-badge grade-${d.grade}">${d.grade}</span></td>
              <td class="px-2 py-1.5 text-center text-gray-500">${parseInt(d.age)||'-'}</td>
              <td class="px-2 py-1.5 text-center text-gray-500">${parseFloat(d.career)||'-'}</td>
              <td class="px-2 py-1.5 text-center">
                ${d.gender ? `<span class="gender-badge gender-${d.gender}">${d.gender}</span>` : '<span class="text-gray-300">-</span>'}
              </td>
              <td class="px-2 py-1.5 text-gray-400">${esc(d.affiliation)||'-'}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function submitPasteInput() {
  const text   = document.getElementById('pasteTextarea').value;
  const parsed = parsePasteData(text);
  if (!parsed.length) { showToast('인식된 참가자가 없습니다.', 'error'); return; }
  commitParsed(parsed);
  document.getElementById('pasteTextarea').value = '';
  onPasteInput();
}

function parseExcelFile(file) {
  if (typeof XLSX === 'undefined') {
    showToast('SheetJS 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인해주세요.', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const wb   = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
      const ws   = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      let start  = 0;
      if (rows.length && rows[0].some(c => /name|grade|이름|급수/i.test(String(c)))) start = 1;

      commitParsed(rows.slice(start).map(r => ({
        name: String(r[0]??'').trim(), grade: normalizeGrade(String(r[1]??'')),
        age:  String(r[2]??'0'),       career: String(r[3]??'0'),
        gender: normalizeGender(String(r[4]??'')), affiliation: String(r[5]??''),
      })));
    } catch (err) { showToast('엑셀 파싱 오류: ' + err.message, 'error'); }
  };
  reader.readAsArrayBuffer(file);
}

function commitParsed(list) {
  let added = 0;
  for (const d of list) {
    if (!d.name) continue;
    participants.push(buildParticipant(d, nextId++));
    added++;
  }
  if (added === 0) { showToast('추가된 참가자가 없습니다. 파일 형식을 확인해주세요.', 'error'); return; }
  saveToLocalStorage();
  renderParticipantList();
  updateStats();
  onDoublesTypeChange();
  showToast(`${added}명이 추가되었습니다.`, 'success');
}

function splitCSVLine(line) {
  const result = []; let current = '', inQuote = false;
  for (const ch of line) {
    if (ch === '"')              inQuote = !inQuote;
    else if (ch === ',' && !inQuote) { result.push(current); current = ''; }
    else                         current += ch;
  }
  result.push(current);
  return result;
}

function normalizeGrade(raw) {
  if (!raw) return 'D';
  const g = String(raw).trim().toUpperCase();
  if (['S','A','B','C','D'].includes(g)) return g;
  if (/초보|beginner|novice/i.test(raw))  return '초보';
  return 'D';
}

function normalizeGender(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  if (s === '남' || /^m(ale)?$/i.test(s)) return '남';
  if (s === '여' || /^f(emale)?$/i.test(s)) return '여';
  return '';
}

// ── Generate Results ────────────────────────────────────────
function generateResults() {
  const mode        = document.getElementById('competitionMode').value;
  const doublesType = document.getElementById('doublesType').value;
  const groupSize   = parseInt(document.getElementById('groupSize').value) || 4;
  const groupMode   = document.querySelector('input[name="groupMode"]:checked')?.value || 'balanced';
  const teamMode    = document.querySelector('input[name="teamMode"]:checked')?.value  || 'fixed';

  if (doublesType === 'both') {
    const menPool   = participants.filter(p => p.gender === '남');
    const womenPool = participants.filter(p => p.gender === '여');
    if (menPool.length < 2)   { showToast('남복 생성을 위해 남자 참가자가 최소 2명 필요합니다. (현재 ' + menPool.length + '명)', 'error'); return; }
    if (womenPool.length < 2) { showToast('여복 생성을 위해 여자 참가자가 최소 2명 필요합니다. (현재 ' + womenPool.length + '명)', 'error'); return; }

    results = {
      mode, doublesType: 'both', groupSize, groupMode, teamMode,
      participantCount: menPool.length + womenPool.length,
      generatedAt: new Date().toLocaleString('ko-KR'),
      sections: [
        generateSection('men',   menPool,   mode, groupSize, groupMode, teamMode),
        generateSection('women', womenPool, mode, groupSize, groupMode, teamMode),
      ],
      groups: null, tournament: null,
    };
  } else {
    const pool = getPool(doublesType);
    if (typeof pool === 'string') { showToast(pool, 'error'); return; }

    results = {
      mode, doublesType, groupSize, groupMode, teamMode,
      participantCount: pool.length,
      generatedAt: new Date().toLocaleString('ko-KR'),
      groups: null, tournament: null,
    };

    if (mode === 'groups' || mode === 'groups-tournament') {
      let rawGroups;
      if (doublesType === 'mixed') {
        rawGroups = formMixedGroups(pool, groupSize);
      } else if (groupMode === 'level') {
        rawGroups = formHomogeneousGroups(pool, groupSize);
      } else {
        rawGroups = formBalancedGroups(pool, groupSize);
      }

      const isFluid    = teamMode === 'fluid' && mode === 'groups';
      const suffix     = groupMode === 'level' ? '그룹' : '조';
      results.groups = rawGroups.map((members, i) => {
        const name       = String.fromCharCode(65 + i) + suffix;
        const totalScore = members.reduce((s, p) => s + p.score, 0);
        const base = { name, members, totalScore, avgScore: +(totalScore / members.length).toFixed(2) };
        if (isFluid) {
          const roundsFn = doublesType === 'mixed' ? generateMixedFluidRounds : generateFluidRounds;
          return { ...base, rounds: roundsFn(members), teams: null };
        }
        const teams = doublesType === 'mixed' ? pairMixedTeams(members) : pairTeams(members);
        return { ...base, teams, rounds: null };
      });
    }

    if (mode === 'tournament' || mode === 'groups-tournament') {
      let teamList;
      if (mode === 'groups-tournament' && results.groups) {
        teamList = results.groups.flatMap(g => g.teams || []);
      } else {
        teamList = doublesType === 'mixed' ? pairMixedTeams(pool) : pairTeams(pool);
      }
      results.tournament = buildBracket(teamList);
    }
  }

  groundSelections = {};
  roundSwaps       = {};
  roundEditMode    = null;
  renderResults();
  document.getElementById('resultsSection').classList.remove('hidden');
  document.getElementById('resultsSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function generateSection(type, pool, mode, groupSize, groupMode, teamMode) {
  const section = {
    type,
    label:            type === 'men' ? '남복' : '여복',
    participantCount: pool.length,
    groups:           null,
    tournament:       null,
  };

  const isFluid = teamMode === 'fluid' && mode === 'groups';
  const suffix  = groupMode === 'level' ? '그룹' : '조';

  if (mode === 'groups' || mode === 'groups-tournament') {
    const rawGroups = groupMode === 'level'
      ? formHomogeneousGroups(pool, groupSize)
      : formBalancedGroups(pool, groupSize);
    section.groups = rawGroups.map((members, i) => {
      const name       = String.fromCharCode(65 + i) + suffix;
      const totalScore = members.reduce((s, p) => s + p.score, 0);
      const base = { name, members, totalScore, avgScore: +(totalScore / members.length).toFixed(2) };
      if (isFluid) return { ...base, rounds: generateFluidRounds(members), teams: null };
      return { ...base, teams: pairTeams(members), rounds: null };
    });
  }

  if (mode === 'tournament' || mode === 'groups-tournament') {
    const teamList = (mode === 'groups-tournament' && section.groups)
      ? section.groups.flatMap(g => g.teams || [])
      : pairTeams(pool);
    section.tournament = buildBracket(teamList);
  }

  return section;
}

// ── Pool filtering & validation ─────────────────────────────
function getPool(doublesType) {
  if (participants.length < 2) return '최소 2명의 참가자가 필요합니다.';

  if (doublesType === 'men') {
    const pool = participants.filter(p => p.gender === '남');
    if (pool.length < 2) return '남복 선택 시 성별이 "남"인 참가자가 최소 2명 필요합니다. (현재 ' + pool.length + '명)';
    return pool;
  }

  if (doublesType === 'women') {
    const pool = participants.filter(p => p.gender === '여');
    if (pool.length < 2) return '여복 선택 시 성별이 "여"인 참가자가 최소 2명 필요합니다. (현재 ' + pool.length + '명)';
    return pool;
  }

  if (doublesType === 'mixed') {
    const males   = participants.filter(p => p.gender === '남');
    const females = participants.filter(p => p.gender === '여');
    if (males.length < 1)   return '혼복 선택 시 남자 참가자가 최소 1명 필요합니다.';
    if (females.length < 1) return '혼복 선택 시 여자 참가자가 최소 1명 필요합니다.';
    if (males.length + females.length < 4)
      return '혼복 선택 시 남자+여자 합산 최소 4명(남 2명+여 2명)이 필요합니다.';
    return [...participants]; // keep all genders; mixed logic handles it
  }

  // none
  return [...participants];
}

// ══════════════════════════════════════════════════════════════
//  GROUP BALANCING
// ══════════════════════════════════════════════════════════════

function onTeamSizeChange() { updateStats(); }

/** Standard snake-draft balancing (남복/여복/none) */
function formBalancedGroups(pool, groupSize) {
  const sorted     = [...pool].sort((a, b) => b.score - a.score);
  const fullGroups = Math.floor(sorted.length / groupSize);
  const remainder  = sorted.length % groupSize;
  const numGroups  = fullGroups + (remainder > 0 ? 1 : 0);
  const groups     = Array.from({ length: numGroups }, () => []);

  // 앞 조부터 groupSize만큼 채우고(스네이크 드래프트), 나머지는 마지막 조로
  const fullCount = fullGroups * groupSize;
  let dir = 1, gi = 0;
  for (let i = 0; i < fullCount; i++) {
    groups[gi].push({ ...sorted[i] });
    gi += dir;
    if (gi >= fullGroups) { dir = -1; gi = fullGroups - 1; }
    else if (gi < 0)      { dir =  1; gi = 0; }
  }
  for (let i = fullCount; i < sorted.length; i++) {
    groups[numGroups - 1].push({ ...sorted[i] });
  }

  reduceAffiliationConflicts(groups);
  return groups;
}

/** 급수별 동급 그룹: 점수 내림차순 → 경력 내림차순 정렬 후 순차 배분 */
function formHomogeneousGroups(pool, groupSize) {
  const sorted    = [...pool].sort((a, b) =>
    b.score - a.score || (b.career || 0) - (a.career || 0)
  );
  const numGroups = Math.ceil(sorted.length / groupSize);
  const groups    = Array.from({ length: numGroups }, () => []);
  sorted.forEach((p, i) => groups[Math.floor(i / groupSize)].push({ ...p }));
  return groups;
}

/**
 * 혼복 group formation.
 * Snake-draft males and females separately so each group gets
 * equal (or near-equal) counts of each gender, then reduce
 * affiliation conflicts without breaking gender balance.
 */
function formMixedGroups(pool, groupSize) {
  const males   = pool.filter(p => p.gender === '남').sort((a, b) => b.score - a.score);
  const females = pool.filter(p => p.gender === '여').sort((a, b) => b.score - a.score);

  const pairs        = Math.min(males.length, females.length);
  if (pairs < 1) return [];

  const pairsPerGroup = Math.max(1, Math.floor(groupSize / 2));
  const fullGroups    = Math.floor(pairs / pairsPerGroup);
  const remainder     = pairs % pairsPerGroup;
  const numGroups     = fullGroups + (remainder > 0 ? 1 : 0);
  const groups        = Array.from({ length: numGroups }, () => []);

  // 앞 조부터 pairsPerGroup 씩 채우고 남는 인원은 마지막 조로 (남/여 각각)
  const fullCount = fullGroups * pairsPerGroup;

  let dir = 1, gi = 0;
  for (let i = 0; i < fullCount; i++) {
    groups[gi].push({ ...males[i] });
    gi += dir;
    if (gi >= fullGroups)    { dir = -1; gi = fullGroups - 1; }
    else if (gi < 0)         { dir =  1; gi = 0; }
  }
  for (let i = fullCount; i < pairs; i++) groups[numGroups - 1].push({ ...males[i] });

  dir = 1; gi = 0;
  for (let i = 0; i < fullCount; i++) {
    groups[gi].push({ ...females[i] });
    gi += dir;
    if (gi >= fullGroups)    { dir = -1; gi = fullGroups - 1; }
    else if (gi < 0)         { dir =  1; gi = 0; }
  }
  for (let i = fullCount; i < pairs; i++) groups[numGroups - 1].push({ ...females[i] });

  reduceMixedAffiliationConflicts(groups);
  return groups;
}

function snakeDraftInto(sorted, groups) {
  const n = groups.length;
  let dir = 1, gi = 0;
  for (const p of sorted) {
    groups[gi].push({ ...p });
    gi += dir;
    if (gi >= n)    { dir = -1; gi = n - 1; }
    else if (gi < 0){ dir =  1; gi = 0; }
  }
}

function reduceMixedAffiliationConflicts(groups) {
  const MAX = 80;
  for (let iter = 0; iter < MAX; iter++) {
    let improved = false;
    for (let gi = 0; gi < groups.length; gi++) {
      const conflict = findConflictMember(groups[gi]);
      if (conflict === -1) continue;

      const member = groups[gi][conflict];
      outer:
      for (let gj = 0; gj < groups.length; gj++) {
        if (gi === gj) continue;
        for (let mj = 0; mj < groups[gj].length; mj++) {
          const other = groups[gj][mj];
          // 혼복: only swap same gender to preserve M/F balance per group
          if (other.gender !== member.gender)      continue;
          if (other.affiliation === member.affiliation) continue;
          if (Math.abs(member.score - other.score) > 2) continue;

          const before = countGroupConflicts(groups[gi]) + countGroupConflicts(groups[gj]);
          groups[gi][conflict] = other;
          groups[gj][mj]       = member;
          const after = countGroupConflicts(groups[gi]) + countGroupConflicts(groups[gj]);

          if (after < before) { improved = true; break outer; }
          else { groups[gi][conflict] = member; groups[gj][mj] = other; }
        }
      }
    }
    if (!improved) break;
  }
}

function reduceAffiliationConflicts(groups) {
  const MAX = 80;
  for (let iter = 0; iter < MAX; iter++) {
    let improved = false;
    for (let gi = 0; gi < groups.length; gi++) {
      const conflict = findConflictMember(groups[gi]);
      if (conflict === -1) continue;

      const member = groups[gi][conflict];
      outer:
      for (let gj = 0; gj < groups.length; gj++) {
        if (gi === gj) continue;
        for (let mj = 0; mj < groups[gj].length; mj++) {
          const other = groups[gj][mj];
          if (other.affiliation === member.affiliation) continue;
          if (Math.abs(member.score - other.score) > 2) continue;

          const before = countGroupConflicts(groups[gi]) + countGroupConflicts(groups[gj]);
          groups[gi][conflict] = other;
          groups[gj][mj]       = member;
          const after = countGroupConflicts(groups[gi]) + countGroupConflicts(groups[gj]);

          if (after < before) { improved = true; break outer; }
          else { groups[gi][conflict] = member; groups[gj][mj] = other; }
        }
      }
    }
    if (!improved) break;
  }
}

function findConflictMember(group) {
  const affs = group.map(p => p.affiliation).filter(Boolean);
  for (let i = 0; i < group.length; i++) {
    const a = group[i].affiliation;
    if (!a) continue;
    if (affs.indexOf(a) !== affs.lastIndexOf(a)) return i;
  }
  return -1;
}

function countGroupConflicts(group) {
  const affs = group.map(p => p.affiliation).filter(Boolean);
  return affs.filter((a, i) => affs.indexOf(a) !== i).length;
}

// ══════════════════════════════════════════════════════════════
//  TEAM PAIRING
// ══════════════════════════════════════════════════════════════

/** 남복/여복/none: 점수순 1위+최하위, 2위+차하위 */
function pairTeams(members) {
  const sorted = [...members].sort((a, b) => b.score - a.score);
  const teams  = [];
  const n      = sorted.length;
  const half   = Math.floor(n / 2);

  for (let i = 0; i < half; i++) {
    teams.push([sorted[i], sorted[n - 1 - i]]);
  }
  if (n % 2 === 1) teams.push([sorted[half]]);
  return teams;
}

/**
 * 혼복: 교차 균형 페어링
 *   남자 점수순 M[0]≥M[1]≥…, 여자 점수순 F[0]≥F[1]≥…
 *   Team k = M[k] + F[pairs-1-k]  (최강 남 + 최약 여 → 점수 합이 균등)
 */
function pairMixedTeams(members) {
  const males   = [...members].filter(p => p.gender === '남').sort((a, b) => b.score - a.score);
  const females = [...members].filter(p => p.gender === '여').sort((a, b) => b.score - a.score);
  const pairs   = Math.min(males.length, females.length);
  const teams   = [];

  for (let i = 0; i < pairs; i++) {
    teams.push([males[i], females[pairs - 1 - i]]);
  }

  // Leftover single players (gender count mismatch) — add as solo entries
  for (let i = pairs; i < males.length;   i++) teams.push([males[i]]);
  for (let i = pairs; i < females.length; i++) teams.push([females[i]]);

  return teams;
}

/**
 * 혼복 유동 라운드: 매 라운드 남+여 페어만 생성.
 * n명 남 / n명 여 → n라운드, 라운드 r에서 M[i] + F[(i+r)%n].
 * 각 남자 선수가 모든 여자 선수와 한 번씩 파트너가 됨.
 */
function generateMixedFluidRounds(members) {
  const males   = [...members].filter(p => p.gender === '남').sort((a, b) => b.score - a.score);
  const females = [...members].filter(p => p.gender === '여').sort((a, b) => b.score - a.score);
  const n = Math.min(males.length, females.length);
  if (n === 0) return generateFluidRounds(members);

  const rounds = [];
  for (let r = 0; r < n; r++) {
    const pairs = [];
    for (let i = 0; i < n; i++) {
      pairs.push([males[i], females[(i + r) % n]]);
    }
    const matches = [];
    for (let i = 0; i + 1 < pairs.length; i += 2) {
      matches.push({ team1: pairs[i], team2: pairs[i + 1] });
    }
    if (pairs.length % 2 === 1) {
      matches.push({ team1: pairs[pairs.length - 1], team2: null });
    }
    rounds.push({ round: r + 1, pairs, matches });
  }
  return rounds;
}

/**
 * 유동(fluid) 라운드 생성: 원형(circle) 알고리즘으로 매 라운드마다 파트너 순환.
 * N명 → N-1 라운드(짝수) / N라운드(홀수), C(N,2) 모든 파트너 조합 커버.
 *
 * 버그 수정: null(대기 슬롯)이 쌍 중간에 위치할 때 완성된 팀이 누락되던 문제 해결.
 * null 파트너는 '개인 대기(soloBye)'로 분리하고, 나머지 완성 팀끼리 매칭.
 */
function generateFluidRounds(members) {
  const sorted  = [...members].sort((a, b) => b.score - a.score);
  const n       = sorted.length;
  const players = n % 2 === 0 ? [...sorted] : [null, ...sorted];
  const m       = players.length;
  const circle  = players.slice(1);
  const rounds  = [];

  for (let r = 0; r < m - 1; r++) {
    const arr           = [players[0], ...circle];
    const completePairs = [];
    let   soloBye       = null;

    for (let i = 0; i < m / 2; i++) {
      const p1 = arr[i], p2 = arr[m - 1 - i];
      if      (p1 === null) soloBye = p2;
      else if (p2 === null) soloBye = p1;
      else completePairs.push([p1, p2]);
    }

    // 완성 팀끼리 순서대로 매칭. 홀수이면 마지막 팀은 팀 대기.
    const matches = [];
    for (let i = 0; i + 1 < completePairs.length; i += 2) {
      matches.push({ team1: completePairs[i], team2: completePairs[i + 1] });
    }
    if (completePairs.length % 2 === 1) {
      matches.push({ team1: completePairs[completePairs.length - 1], team2: null });
    }

    rounds.push({ round: r + 1, pairs: completePairs, matches, soloBye });
    circle.push(circle.shift());
  }
  return rounds;
}

// ── Ground / Court Assignment ──────────────────────────────

// ── Round Swap (대기자 ↔ 경기자 교체) ─────────────────────────

function enterRoundEdit(key) {
  roundEditMode = (roundEditMode === key) ? null : key;
  refreshRoundPanels();
}

function cancelRoundEdit() {
  roundEditMode = null;
  refreshRoundPanels();
}

function resetRoundSwap(groupIdx, roundIdx) {
  delete roundSwaps[groupIdx + '_' + roundIdx];
  roundEditMode = null;
  refreshRoundPanels();
}

function swapWithBye(groupIdx, roundIdx, matchIdx, playerSlot, inTeam1) {
  const group = getFlatGroups()[groupIdx];
  if (!group?.rounds) return;

  const key       = groupIdx + '_' + roundIdx;
  const origRound = group.rounds[roundIdx];

  const cur = roundSwaps[key]
    ? JSON.parse(JSON.stringify(roundSwaps[key]))
    : {
        round:   origRound.round,
        matches: origRound.matches.map(m => ({
          team1: [...m.team1],
          team2: m.team2 ? [...m.team2] : null
        })),
        soloBye: origRound.soloBye
      };

  const byePlayer = cur.soloBye;
  if (!byePlayer) return;

  const team = inTeam1 ? cur.matches[matchIdx].team1 : cur.matches[matchIdx].team2;
  if (!team || playerSlot >= team.length) return;

  const swappedOut    = team[playerSlot];
  team[playerSlot]    = byePlayer;
  cur.soloBye         = swappedOut;

  roundSwaps[key] = cur;
  roundEditMode   = null;
  refreshRoundPanels();
}

function refreshRoundPanels() {
  renderGroupsPanel();
  renderGroundPanel();
}

function getRecommendedMatchIdx(validMatches) {
  // 두 팀의 점수 합 차이가 가장 적은 경기를 추천 (가장 균형 잡힌 경기)
  let bestIdx     = 0;
  let bestBalance = Infinity;
  validMatches.forEach((m, i) => {
    if (!m.team2) return;
    const s1   = m.team1.reduce((s, p) => s + p.score, 0);
    const s2   = m.team2.reduce((s, p) => s + p.score, 0);
    const diff = Math.abs(s1 - s2);
    if (diff < bestBalance) { bestBalance = diff; bestIdx = i; }
  });
  return bestIdx;
}

function selectGroundMatch(groupIdx, roundIdx, matchIdx) {
  const key = groupIdx + '_' + roundIdx;
  if (groundSelections[key] === matchIdx) {
    delete groundSelections[key]; // 같은 항목 재클릭 시 선택 해제
  } else {
    groundSelections[key] = matchIdx;
  }
  renderGroundPanel();
}

function renderGroundPanel() {
  const panel = document.getElementById('groundResultsPanel');
  if (!panel) return;

  const flatGroups  = getFlatGroups();
  const fluidGroups = flatGroups.filter(g => g.rounds && g.rounds.length);
  if (!fluidGroups.length) {
    panel.innerHTML = '<p class="text-gray-400 text-sm text-center py-8">유동 대진이 있는 조가 없습니다.</p>';
    return;
  }

  let html = '';
  flatGroups.forEach((g, groupIdx) => {
    if (!g.rounds || !g.rounds.length) return;
    html += renderGroundGroupHTML(g, groupIdx);
  });
  panel.innerHTML = html;
}

function renderGroundGroupHTML(group, groupIdx) {
  const roundsHTML = group.rounds.map((r, roundIdx) => {
    const key         = groupIdx + '_' + roundIdx;
    const hasSwap     = !!roundSwaps[key];
    const inEditMode  = roundEditMode === key;
    const curMatches  = hasSwap ? roundSwaps[key].matches : r.matches;
    const curSoloBye  = hasSwap ? roundSwaps[key].soloBye : r.soloBye;
    const validMatches = curMatches.filter(m => m.team2 !== null);
    if (!validMatches.length) return '';

    const hasUserSel     = groundSelections[key] !== undefined;
    const selectedIdx    = hasUserSel ? groundSelections[key] : -1;
    const recommendedIdx = getRecommendedMatchIdx(validMatches);

    const matchesHTML = validMatches.map((m, mi) => {
      if (inEditMode) {
        const t1 = m.team1.map((p, pi) =>
          `<button class="swap-player-btn" onclick="swapWithBye(${groupIdx},${roundIdx},${mi},${pi},true)">${esc(p.name)}<span>(${p.grade})</span></button>`
        ).join('+');
        const t2 = m.team2.map((p, pi) =>
          `<button class="swap-player-btn" onclick="swapWithBye(${groupIdx},${roundIdx},${mi},${pi},false)">${esc(p.name)}<span>(${p.grade})</span></button>`
        ).join('+');
        return `<div class="ground-match-card" style="cursor:default">
          <div class="text-sm">⚔️ 경기 ${mi + 1}: ${t1} &nbsp;vs&nbsp; ${t2}</div>
        </div>`;
      }

      const isSelected    = hasUserSel && mi === selectedIdx;
      const isRecommended = mi === recommendedIdx;

      const t1 = m.team1.map(p =>
        `<strong>${esc(p.name)}</strong><span class="text-gray-400 text-xs">(${p.grade})</span>`
      ).join('+');
      const t2 = m.team2.map(p =>
        `<strong>${esc(p.name)}</strong><span class="text-gray-400 text-xs">(${p.grade})</span>`
      ).join('+');

      let cardCls, badge;
      if (isSelected) {
        cardCls = 'ground-match-card ground-match-selected';
        badge   = '<span class="ground-badge ground-badge-selected">🏟️ 그라운드</span>';
      } else if (isRecommended && !hasUserSel) {
        cardCls = 'ground-match-card ground-match-recommended';
        badge   = '<span class="ground-badge ground-badge-recommended">⭐ 추천</span>';
      } else if (isRecommended) {
        cardCls = 'ground-match-card ground-match-recommended-dim';
        badge   = '<span class="ground-badge ground-badge-dim">⭐</span>';
      } else {
        cardCls = 'ground-match-card';
        badge   = '';
      }
      return `
        <div class="${cardCls}" onclick="selectGroundMatch(${groupIdx},${roundIdx},${mi})">
          <div class="flex items-center justify-between gap-2 flex-wrap">
            <div class="text-sm flex-1">⚔️ 경기 ${mi + 1}: ${t1} &nbsp;vs&nbsp; ${t2}</div>
            ${badge}
          </div>
        </div>`;
    }).join('');

    const editBtns = curSoloBye ? `
      <div class="flex gap-1 items-center">
        ${inEditMode
          ? `<button onclick="cancelRoundEdit()" class="swap-ctrl-btn swap-ctrl-cancel">취소</button>`
          : `<button onclick="enterRoundEdit('${key}')" class="swap-ctrl-btn swap-ctrl-edit">✏️ 교체</button>`}
        ${hasSwap ? `<button onclick="resetRoundSwap(${groupIdx},${roundIdx})" class="swap-ctrl-btn swap-ctrl-reset">↩ 원래대로</button>` : ''}
      </div>` : '';

    return `
      <div class="mb-3 bg-white border ${inEditMode ? 'border-amber-300 ring-2 ring-amber-200' : 'border-gray-200'} rounded-xl p-3 shadow-sm">
        <div class="flex items-center justify-between mb-2">
          <div class="text-xs font-bold text-indigo-600">라운드 ${r.round}</div>
          ${editBtns}
        </div>
        ${inEditMode && curSoloBye ? `
          <div class="swap-guide-banner mb-2">
            ↕️ <strong>${esc(curSoloBye.name)}</strong>(${curSoloBye.grade}) 대기 → 교체할 선수를 클릭
          </div>` : ''}
        <div class="space-y-2">${matchesHTML}</div>
        ${curSoloBye ? `
          <div class="text-xs ${inEditMode ? 'text-amber-600 font-semibold' : 'text-gray-400'} text-center bg-gray-50 rounded-lg py-1.5 mt-2">
            ⏸ 개인 대기: <strong>${esc(curSoloBye.name)}</strong>${inEditMode ? ' ← 이 선수와 교체' : ''}
          </div>` : ''}
      </div>`;
  }).join('');

  return `
    <div class="mb-6">
      <div class="text-sm font-bold text-gray-600 mb-2 pb-1 border-b border-gray-200">📋 ${esc(group.name)}</div>
      ${roundsHTML}
    </div>`;
}

// ── Tournament Bracket ──────────────────────────────────────
function buildBracket(teamList) {
  if (teamList.length < 2) return { rounds: [], teamCount: teamList.length };

  const n           = teamList.length;
  const bracketSize = Math.pow(2, Math.ceil(Math.log2(n)));
  const byeCount    = bracketSize - n;

  const seeded = [...teamList].sort((a, b) => teamAvgScore(b) - teamAvgScore(a));
  const seeds  = [...seeded, ...Array(byeCount).fill(null)];

  const rounds = [];
  let current  = seeds;

  while (current.length > 1) {
    const matches = [];
    for (let i = 0; i < current.length; i += 2) {
      matches.push({ team1: current[i], team2: current[i + 1] || null });
    }
    rounds.push(matches);
    current = matches.map(m => m.team2 === null ? m.team1 : { isTBD: true });
  }

  return { rounds, teamCount: n, bracketSize, byeCount };
}

function teamAvgScore(team) {
  if (!team || !Array.isArray(team)) return 0;
  return team.reduce((s, p) => s + p.score, 0) / team.length;
}

// ══════════════════════════════════════════════════════════════
//  RENDER RESULTS
// ══════════════════════════════════════════════════════════════
function renderResults() {
  const tag  = document.getElementById('resultDoublesTag');
  const dt   = results.doublesType;
  const meta = DOUBLES_META[dt] || DOUBLES_META.none;
  if (dt && dt !== 'none') {
    tag.textContent = `${meta.icon} ${meta.label}`.trim();
    tag.className   = `doubles-tag doubles-${dt} ml-2`;
    tag.classList.remove('hidden');
  } else {
    tag.classList.add('hidden');
  }

  const hasGroups     = results.groups || (results.sections && results.sections.some(s => s.groups));
  const hasTournament = results.tournament || (results.sections && results.sections.some(s => s.tournament));
  const hasGround     = (results.groups && results.groups.some(g => g.rounds && g.rounds.length)) ||
                        (results.sections && results.sections.some(s => s.groups && s.groups.some(g => g.rounds && g.rounds.length)));

  document.getElementById('resultTabGroups').classList.toggle('hidden', !hasGroups);
  document.getElementById('resultTabTournament').classList.toggle('hidden', !hasTournament);
  document.getElementById('resultTabGround').classList.toggle('hidden', !hasGround);

  renderGroupsPanel();
  renderTournamentPanel();
  renderGroundPanel();

  if (hasGroups)           switchResultTab('groups');
  else if (hasTournament)  switchResultTab('tournament');
  else if (hasGround)      switchResultTab('ground');
}

// ── Group results ───────────────────────────────────────────
function renderGroupsPanel() {
  const panel = document.getElementById('groupResultsPanel');

  if (results.doublesType === 'both') {
    const sections = (results.sections || []).filter(s => s.groups);
    if (!sections.length) { panel.innerHTML = '<p class="text-gray-400 text-sm">조편성이 없습니다.</p>'; return; }
    let flatOffset = 0;
    panel.innerHTML = sections.map(s => {
      const html = renderSectionGroupsHTML(s, flatOffset);
      flatOffset += s.groups.length;
      return html;
    }).join('');
    return;
  }

  if (!results.groups) { panel.innerHTML = '<p class="text-gray-400 text-sm">조편성이 없습니다.</p>'; return; }

  const scores = results.groups.map(g => g.totalScore);
  const maxS   = Math.max(...scores);
  const minS   = Math.min(...scores);
  const dev    = maxS - minS;
  const devCls = dev <= 2 ? 'deviation-good' : dev <= 4 ? 'deviation-ok' : 'deviation-bad';

  panel.innerHTML = `
    <div class="summary-box">
      <span>총 <strong>${results.groups.length}개 조</strong></span>
      <span>최고 조점수: <strong>${maxS}</strong></span>
      <span>최저 조점수: <strong>${minS}</strong></span>
      <span>점수 편차: <strong class="${devCls}">${dev}</strong></span>
      ${results.doublesType !== 'none'
        ? `<span>${DOUBLES_META[results.doublesType]?.icon} <strong>${DOUBLES_META[results.doublesType]?.label}</strong></span>`
        : ''}
    </div>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      ${results.groups.map((g, i) => renderGroupCard(g, i)).join('')}
    </div>
  `;
}

function renderSectionGroupsHTML(section, flatOffset = -1) {
  const scores    = section.groups.map(g => g.totalScore);
  const maxS      = Math.max(...scores);
  const minS      = Math.min(...scores);
  const dev       = maxS - minS;
  const devCls    = dev <= 2 ? 'deviation-good' : dev <= 4 ? 'deviation-ok' : 'deviation-bad';
  const icon      = section.type === 'men' ? '🟦' : '🟥';
  const headerCls = section.type === 'men'
    ? 'bg-blue-50 border-blue-200 text-blue-800'
    : 'bg-pink-50 border-pink-200 text-pink-800';
  return `
    <div class="mb-6">
      <div class="p-3 rounded-xl border mb-3 text-sm font-bold ${headerCls}">${icon} ${section.label} — ${section.participantCount}명</div>
      <div class="summary-box">
        <span>총 <strong>${section.groups.length}개 조</strong></span>
        <span>최고 조점수: <strong>${maxS}</strong></span>
        <span>최저 조점수: <strong>${minS}</strong></span>
        <span>점수 편차: <strong class="${devCls}">${dev}</strong></span>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        ${section.groups.map((g, i) => renderGroupCard(g, flatOffset >= 0 ? flatOffset + i : -1)).join('')}
      </div>
    </div>
  `;
}

function renderGroupCard(group, groupIdx = -1) {
  const maxPossible = group.members.length * 6;
  const barPct      = Math.round((group.totalScore / maxPossible) * 100);
  const isMixed     = results.doublesType === 'mixed';
  const isFluid     = !!group.rounds;
  const idAttr      = groupIdx >= 0 ? `id="group-card-${groupIdx}"` : '';

  return `
    <div class="group-card" ${idAttr}>
      <div class="group-card-header">
        <h3 class="font-bold text-lg">${esc(group.name)}</h3>
        <div class="text-xs opacity-80">총점 ${group.totalScore} / 평균 ${group.avgScore}</div>
      </div>
      <div class="p-4">
        <div class="balance-bar-wrap mb-3">
          <div class="balance-bar" style="width:${barPct}%"></div>
        </div>

        <!-- Members -->
        <div class="mb-4">
          <p class="text-xs font-semibold text-gray-400 uppercase mb-2">참가자 (${group.members.length}명)</p>
          <table class="w-full text-sm">
            <tbody>
              ${group.members.map((m, i) => `
                <tr class="border-b border-gray-50 last:border-0">
                  <td class="py-1.5 pr-2 text-gray-400 text-xs w-5">${i + 1}</td>
                  <td class="py-1.5 pr-2 font-medium">${esc(m.name)}</td>
                  <td class="py-1.5 pr-2"><span class="grade-badge grade-${m.grade}">${m.grade}</span></td>
                  ${isMixed || m.gender
                    ? `<td class="py-1.5 pr-2">
                        ${m.gender ? `<span class="gender-badge gender-${m.gender}">${m.gender}</span>` : ''}
                       </td>`
                    : ''}
                  <td class="py-1.5 text-xs text-gray-400 truncate max-w-[80px]">${esc(m.affiliation) || '-'}</td>
                  <td class="py-1.5 text-right font-bold text-indigo-600 text-xs">${m.score}pt</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        <!-- Teams / Rounds -->
        <div>
          ${isFluid
            ? renderFluidRoundsHTML(group.rounds, group.name, groupIdx)
            : renderFixedTeamsHTML(group.teams, group.name, isMixed)}
        </div>
      </div>
      ${groupIdx >= 0 ? `
      <div class="group-card-footer">
        <button onclick="openGroupAddModal(${groupIdx})"
          class="flex-1 text-xs py-1.5 px-3 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg font-medium transition-colors">
          ＋ 참가자 추가
        </button>
        <button onclick="regenerateGroupAt(${groupIdx})"
          class="flex-1 text-xs py-1.5 px-3 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg font-medium transition-colors">
          ↻ 이 조만 재생성
        </button>
      </div>` : ''}
    </div>
  `;
}

function renderFixedTeamsHTML(teams, groupName, isMixed) {
  if (!teams || !teams.length) return '';
  return `
    <p class="text-xs font-semibold text-gray-400 uppercase mb-2">팀 구성</p>
    ${teams.map((team, ti) => renderTeamBlock(team, ti, groupName, isMixed)).join('')}
    ${teams.length >= 2 ? buildRoundRobinMatchesHTML(teams) : ''}
  `;
}

function renderFluidRoundsHTML(rounds, groupName, groupIdx = -1) {
  if (!rounds || !rounds.length) return '';
  return `
    <p class="text-xs font-semibold text-gray-400 uppercase mb-2">🔄 유동 대진 (${rounds.length}라운드)</p>
    ${rounds.map((r, roundIdx) => {
      const key        = groupIdx + '_' + roundIdx;
      const hasSwap    = groupIdx >= 0 && !!roundSwaps[key];
      const inEditMode = groupIdx >= 0 && roundEditMode === key;
      const curMatches = hasSwap ? roundSwaps[key].matches : r.matches;
      const curSoloBye = hasSwap ? roundSwaps[key].soloBye : r.soloBye;

      const matchesHTML = curMatches.filter(m => m.team2 !== null).map((m, mi) => {
        const t1 = m.team1.map((p, pi) => inEditMode
          ? `<button class="swap-player-btn" onclick="swapWithBye(${groupIdx},${roundIdx},${mi},${pi},true)">${esc(p.name)}<span>(${p.grade})</span></button>`
          : `<strong>${esc(p.name)}</strong><span class="text-gray-400">(${p.grade})</span>`
        ).join('+');
        const t2 = m.team2.map((p, pi) => inEditMode
          ? `<button class="swap-player-btn" onclick="swapWithBye(${groupIdx},${roundIdx},${mi},${pi},false)">${esc(p.name)}<span>(${p.grade})</span></button>`
          : `<strong>${esc(p.name)}</strong><span class="text-gray-400">(${p.grade})</span>`
        ).join('+');
        return `<div class="match-block text-xs">⚔️ 경기 ${mi + 1}: ${t1} &nbsp;vs&nbsp; ${t2}</div>`;
      }).join('');

      return `
        <div class="mb-3 bg-gray-50 rounded-lg p-2${inEditMode ? ' ring-2 ring-amber-300' : ''}">
          <div class="flex items-center justify-between mb-1">
            <div class="text-xs font-bold text-indigo-600">라운드 ${r.round}</div>
            ${groupIdx >= 0 && curSoloBye ? `
              <div class="flex gap-1 items-center">
                ${inEditMode
                  ? `<button onclick="cancelRoundEdit()" class="swap-ctrl-btn swap-ctrl-cancel">취소</button>`
                  : `<button onclick="enterRoundEdit('${key}')" class="swap-ctrl-btn swap-ctrl-edit">✏️ 교체</button>`}
                ${hasSwap ? `<button onclick="resetRoundSwap(${groupIdx},${roundIdx})" class="swap-ctrl-btn swap-ctrl-reset">↩ 원래대로</button>` : ''}
              </div>` : ''}
          </div>
          ${inEditMode && curSoloBye ? `
            <div class="swap-guide-banner">
              ↕️ <strong>${esc(curSoloBye.name)}</strong>(${curSoloBye.grade}) 대기 → 교체할 선수를 클릭
            </div>` : ''}
          ${matchesHTML}
          ${curSoloBye ? `
            <div class="text-xs ${inEditMode ? 'text-amber-600 font-semibold' : 'text-gray-400'} text-center mt-1">
              ⏸ 개인 대기: <strong>${esc(curSoloBye.name)}</strong>
            </div>` : ''}
        </div>
      `;
    }).join('')}
  `;
}

function renderTeamBlock(team, ti, groupName, isMixed) {
  const members = team.map(p => {
    const genderTag = isMixed && p.gender
      ? `<span class="gender-badge gender-${p.gender} text-xs ml-1">${p.gender}</span>`
      : '';
    return `${esc(p.name)}<span class="text-gray-400 text-xs">(${p.grade})</span>${genderTag}`;
  }).join(' <span class="text-gray-300 mx-0.5">+</span> ');

  return `
    <div class="${TEAM_CLASSES[ti % TEAM_CLASSES.length]} team-block">
      <div class="text-xs font-semibold text-gray-500 mb-1">${esc(groupName)} ${ti + 1}팀</div>
      <div class="font-medium text-gray-800 text-sm flex items-center flex-wrap gap-1">${members}</div>
    </div>
  `;
}

/**
 * 원형(circle) 알고리즘 라운드로빈 스케줄.
 * N팀 → N-1라운드(짝수) / N라운드(홀수), 각 라운드에서 모든 팀이 한 경기씩.
 * 반환: [{ round, matches:[{ti,tj,team1,team2}], bye:team|null }]
 */
function buildRoundRobinSchedule(teams) {
  const n = teams.length;
  if (n < 2) return [];

  const hasBye = n % 2 === 1;
  // 인덱스 배열. 홀수면 앞에 null(대기 슬롯) 추가
  const arr    = hasBye ? [null, ...teams.map((_, i) => i)] : teams.map((_, i) => i);
  const m      = arr.length;           // 항상 짝수
  const circle = arr.slice(1);         // arr[0] 고정, 나머지 순환
  const rounds = [];

  for (let r = 0; r < m - 1; r++) {
    const cur     = [arr[0], ...circle];
    const matches = [];
    let   byeTeam = null;

    for (let k = 0; k < m / 2; k++) {
      const a = cur[k], b = cur[m - 1 - k];
      if (a === null) { byeTeam = teams[b]; continue; }
      if (b === null) { byeTeam = teams[a]; continue; }
      const ti = Math.min(a, b), tj = Math.max(a, b);
      matches.push({ ti, tj, team1: teams[a], team2: teams[b] });
    }
    rounds.push({ round: r + 1, matches, bye: byeTeam });
    circle.push(circle.shift());
  }
  return rounds;
}

function buildRoundRobinMatchesHTML(teams) {
  const rounds = buildRoundRobinSchedule(teams);
  if (!rounds.length) return '';
  return `
    <p class="text-xs font-semibold text-gray-400 uppercase mb-2">🔄 대진 일정 (${rounds.length}라운드)</p>
    ${rounds.map(r => `
      <div class="mb-3 bg-gray-50 rounded-lg p-2">
        <div class="text-xs font-bold text-indigo-600 mb-1">라운드 ${r.round}</div>
        ${r.matches.map(m => {
          const t1 = m.team1.map(p => esc(p.name)).join(' + ');
          const t2 = m.team2.map(p => esc(p.name)).join(' + ');
          return `<div class="match-block">⚔️ ${t1} &nbsp;vs&nbsp; ${t2}</div>`;
        }).join('')}
        ${r.bye ? `<div class="text-xs text-gray-400 text-center mt-1">⏸ 대기: ${r.bye.map(p => esc(p.name)).join(' + ')}</div>` : ''}
      </div>
    `).join('')}
  `;
}

// ── Tournament results ──────────────────────────────────────
function renderTournamentPanel() {
  const panel = document.getElementById('tournamentResultsPanel');

  if (results.doublesType === 'both') {
    const sections = (results.sections || []).filter(s => s.tournament);
    if (!sections.length) { panel.innerHTML = '<p class="text-gray-400 text-sm">토너먼트 대진이 없습니다.</p>'; return; }
    panel.innerHTML = sections.map(s => {
      const icon      = s.type === 'men' ? '🟦' : '🟥';
      const headerCls = s.type === 'men'
        ? 'bg-blue-50 border-blue-200 text-blue-800'
        : 'bg-pink-50 border-pink-200 text-pink-800';
      return `
        <div class="mb-8">
          <div class="p-3 rounded-xl border mb-3 text-sm font-bold ${headerCls}">${icon} ${s.label} — ${s.participantCount}명</div>
          ${buildTournamentHTML(s.tournament)}
        </div>
      `;
    }).join('');
    return;
  }

  if (!results.tournament) { panel.innerHTML = '<p class="text-gray-400 text-sm">토너먼트 대진이 없습니다.</p>'; return; }
  panel.innerHTML = buildTournamentHTML(results.tournament);
}

function buildTournamentHTML(tournament) {
  const { rounds, teamCount, byeCount } = tournament;
  const ROUND_NAMES = { 1: '결승', 2: '준결승', 4: '8강', 8: '16강', 16: '32강' };
  return `
    <div class="summary-box">
      <span>참가팀: <strong>${teamCount}팀</strong></span>
      ${byeCount ? `<span>부전승: <strong>${byeCount}개</strong></span>` : ''}
    </div>
    <div class="bracket-scroll">
      <div class="bracket-wrap">
        ${rounds.map(matches => {
          const label = ROUND_NAMES[matches.length] || `${matches.length * 2}강`;
          return `
            <div class="bracket-round-col">
              <div class="bracket-round-label">${label}</div>
              <div class="bracket-matches-col">
                ${matches.map(m => renderMatchCard(m)).join('')}
              </div>
            </div>
          `;
        }).join('')}
        <div class="bracket-round-col">
          <div class="bracket-round-label">우승</div>
          <div class="bracket-matches-col">
            <div class="bracket-match-card champion-card" style="margin:auto 0">
              <div class="bracket-team-row champion">🏆 우승</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderMatchCard(match) {
  const isBye  = !match.team2;
  const t1Name = teamLabel(match.team1);
  const t2Name = match.team2 ? teamLabel(match.team2) : 'BYE';
  const t1Cls  = match.team1?.isTBD ? 'is-tbd' : '';
  const t2Cls  = !match.team2 ? 'is-bye' : match.team2.isTBD ? 'is-tbd' : '';

  return `
    <div class="bracket-match-card ${isBye ? 'bye-card' : ''}">
      <div class="bracket-team-row ${t1Cls}" title="${esc(t1Name)}">${esc(t1Name)}</div>
      <div class="bracket-vs-row">VS</div>
      <div class="bracket-team-row ${t2Cls}" title="${esc(t2Name)}">${esc(t2Name)}</div>
    </div>
  `;
}

function teamLabel(team) {
  if (!team) return 'BYE';
  if (team.isTBD) return 'TBD';
  if (!Array.isArray(team)) return '?';
  return team.map(p => p.name).join(' / ');
}

// ── JSON Toggle ─────────────────────────────────────────────
function toggleJsonView() {
  const sec    = document.getElementById('jsonSection');
  const btn    = document.getElementById('jsonToggleBtn');
  const hidden = sec.classList.contains('hidden');
  sec.classList.toggle('hidden', !hidden);
  btn.textContent = hidden ? '🔧 JSON 숨기기' : '🔧 JSON 결과 보기';
  if (hidden) document.getElementById('jsonContent').textContent = JSON.stringify(results, null, 2);
}

// ── Group Add Modal ─────────────────────────────────────────
function openGroupAddModal(groupIdx) {
  const flatGroups = getFlatGroups();
  const g = flatGroups[groupIdx];
  if (!g) return;
  groupAddTargetIdx = groupIdx;
  document.getElementById('groupAddTitle').textContent = g.name + '에 참가자 추가';
  document.getElementById('gaSearch').value = '';
  renderGaList();
  document.getElementById('groupAddModal').classList.remove('hidden');
  setTimeout(() => document.getElementById('gaSearch').focus(), 50);
}

function renderGaList() {
  const g          = getFlatGroups()[groupAddTargetIdx];
  const memberIds  = new Set((g?.members || []).map(m => m.id));
  const query      = document.getElementById('gaSearch').value.trim().toLowerCase();
  const list       = document.getElementById('gaList');
  const empty      = document.getElementById('gaEmpty');

  const filtered = participants.filter(p =>
    !query || p.name.toLowerCase().includes(query)
  );

  if (!filtered.length) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  list.innerHTML = filtered.map(p => {
    const alreadyHere = memberIds.has(p.id);
    const genderBadge = p.gender
      ? `<span class="gender-badge gender-${p.gender}">${p.gender}</span>` : '';
    const alreadyTag  = alreadyHere
      ? '<span class="ga-item-already">이미 포함</span>' : '';
    return `
      <label class="ga-item${alreadyHere ? ' opacity-50' : ''}" onclick="toggleGaItem(this)">
        <input type="checkbox" value="${p.id}" ${alreadyHere ? 'disabled' : ''}>
        <div class="flex-1 min-w-0">
          <div class="ga-item-name">${esc(p.name)}</div>
          <div class="ga-item-meta">
            <span class="grade-badge grade-${p.grade}">${p.grade}</span>
            ${genderBadge}
            <span class="text-xs text-gray-400">${p.score}점</span>
            ${p.affiliation ? `<span class="text-xs text-gray-400">${esc(p.affiliation)}</span>` : ''}
          </div>
        </div>
        ${alreadyTag}
      </label>`;
  }).join('');
}

function toggleGaItem(label) {
  const cb = label.querySelector('input[type="checkbox"]');
  if (cb.disabled) return;
  cb.checked = !cb.checked;
  label.classList.toggle('selected', cb.checked);
}

function filterGaList() {
  renderGaList();
}

function closeGroupAddModal() {
  document.getElementById('groupAddModal').classList.add('hidden');
  groupAddTargetIdx = -1;
}

function submitGroupAdd() {
  if (groupAddTargetIdx < 0) return;
  const checked = Array.from(document.querySelectorAll('#gaList input[type="checkbox"]:checked'));
  if (!checked.length) { showToast('추가할 참가자를 선택해주세요.', 'error'); return; }

  const checkedIds = new Set(checked.map(cb => parseInt(cb.value)));
  const toAdd      = participants.filter(p => checkedIds.has(p.id));

  const flatGroups = getFlatGroups();
  toAdd.forEach(p => flatGroups[groupAddTargetIdx].members.push({ ...p }));
  regenerateGroupAt(groupAddTargetIdx);
  closeGroupAddModal();
  const names = toAdd.map(p => p.name).join(', ');
  showToast(names + ' 님이 추가되고 조가 재생성되었습니다.', 'success');
}

// ── Group Regenerate ────────────────────────────────────────
function getFlatGroups() {
  if (results.doublesType === 'both' && results.sections) {
    return results.sections.flatMap(s => s.groups || []);
  }
  return results.groups || [];
}

function regenerateGroupAt(groupIdx) {
  const flatGroups = getFlatGroups();
  const g = flatGroups[groupIdx];
  if (!g) return;
  const members    = g.members;
  const isFluid    = results.teamMode === 'fluid' && results.mode === 'groups';
  const isMixed    = results.doublesType === 'mixed';
  const totalScore = members.reduce((s, p) => s + p.score, 0);
  g.totalScore = totalScore;
  g.avgScore   = +(totalScore / members.length).toFixed(2);
  if (isFluid) {
    g.rounds = isMixed ? generateMixedFluidRounds(members) : generateFluidRounds(members);
    g.teams  = null;
  } else {
    g.teams  = isMixed ? pairMixedTeams(members) : pairTeams(members);
    g.rounds = null;
  }
  const oldCard = document.getElementById('group-card-' + groupIdx);
  if (oldCard) {
    const tmp = document.createElement('div');
    tmp.innerHTML = renderGroupCard(g, groupIdx);
    oldCard.replaceWith(tmp.firstElementChild);
  } else {
    renderGroupsPanel();
  }
}

// ── Download Preview ────────────────────────────────────────
function openDownloadPreview() {
  if (!results) { showToast('먼저 결과를 생성해주세요.', 'error'); return; }
  previewDeletedIds.clear();
  renderPreviewBody();
  document.getElementById('downloadPreviewModal').classList.remove('hidden');
}

function closeDownloadPreview() {
  document.getElementById('downloadPreviewModal').classList.add('hidden');
}

function togglePreviewItem(id) {
  if (previewDeletedIds.has(id)) previewDeletedIds.delete(id);
  else previewDeletedIds.add(id);
  const row = document.getElementById('pvr-' + id);
  if (!row) return;
  row.classList.toggle('is-deleted', previewDeletedIds.has(id));
  row.querySelector('.preview-toggle-btn').textContent = previewDeletedIds.has(id) ? '↩' : '✕';
}

function previewMatchRow(id, label) {
  return '<div class="preview-match-row" id="pvr-' + id + '">' +
    '<span class="preview-match-text">' + esc(label) + '</span>' +
    '<button class="preview-toggle-btn" onclick="togglePreviewItem(\'' + id + '\')">✕</button>' +
    '</div>';
}

function renderPreviewBody() {
  const body       = document.getElementById('downloadPreviewBody');
  const flatGroups = getFlatGroups();
  let html = '';

  flatGroups.forEach(function(g, gi) {
    html += '<div class="preview-section-title">' + esc(g.name) + ' (' + g.members.length + '명)</div>';
    if (g.rounds) {
      g.rounds.forEach(function(r) {
        html += '<div class="preview-round-title">라운드 ' + r.round + '</div>';
        r.matches.forEach(function(m, mi) {
          if (!m.team2) return;
          const id = 'g' + gi + '-r' + r.round + '-m' + mi;
          const t1 = m.team1.map(function(p) { return p.name; }).join('+');
          const t2 = m.team2.map(function(p) { return p.name; }).join('+');
          html += previewMatchRow(id, '경기 ' + (mi + 1) + ': ' + t1 + ' vs ' + t2);
        });
      });
    } else if (g.teams) {
      var schedule = buildRoundRobinSchedule(g.teams);
      schedule.forEach(function(r) {
        html += '<div class="preview-round-title">라운드 ' + r.round + '</div>';
        r.matches.forEach(function(m) {
          const id = 'g' + gi + '-t' + m.ti + '-t' + m.tj;
          const t1 = m.team1.map(function(p) { return p.name; }).join('+');
          const t2 = m.team2.map(function(p) { return p.name; }).join('+');
          html += previewMatchRow(id, t1 + ' vs ' + t2);
        });
      });
    }
  });

  const tour = results.tournament || (results.sections && results.sections.reduce(function(acc, s) { return acc || s.tournament; }, null));
  if (tour) {
    const RN = { 1: '결승', 2: '준결승', 4: '8강', 8: '16강' };
    html += '<div class="preview-section-title">🏅 토너먼트</div>';
    tour.rounds.forEach(function(matches) {
      const lbl = RN[matches.length] || (matches.length * 2 + '강');
      html += '<div class="preview-round-title">[' + lbl + ']</div>';
      matches.forEach(function(m, mi) {
        const id = 'tour-' + matches.length + '-m' + mi;
        html += previewMatchRow(id, teamLabel(m.team1) + ' vs ' + teamLabel(m.team2));
      });
    });
  }

  body.innerHTML = html || '<p class="text-gray-400 text-sm text-center py-6">미리볼 대진이 없습니다.</p>';
}

function executeDownload(fmt) {
  if (!results) return;
  const date = new Date().toISOString().slice(0, 10);
  const base = 'tournament_' + date;
  if (fmt === 'json') triggerDownload(JSON.stringify(results, null, 2), base + '.json', 'application/json');
  else if (fmt === 'txt') triggerDownload(buildTXTFiltered(), base + '.txt', 'text/plain;charset=utf-8');
  else if (fmt === 'csv') triggerDownload('﻿' + buildCSVFiltered(), base + '.csv', 'text/csv;charset=utf-8');
  closeDownloadPreview();
  showToast('다운로드가 완료되었습니다.', 'success');
}

// ── Download ────────────────────────────────────────────────
function downloadResults(fmt) {
  openDownloadPreview();
}

function buildTXT() {
  const L     = [];
  const hr    = '='.repeat(52);
  const dMeta = DOUBLES_META[results.doublesType] || DOUBLES_META.none;

  L.push(hr);
  L.push('  토너먼트 / 조편성 결과');
  L.push(`  생성일시: ${results.generatedAt}`);
  L.push(`  대회방식: ${modeLabel(results.mode)}`);
  if (results.doublesType !== 'none') L.push(`  복식종목: ${dMeta.label}`);
  L.push(`  참가자수: ${results.participantCount}명`);
  L.push(hr);

  if (results.doublesType === 'both' && results.sections) {
    for (const section of results.sections) {
      const sIcon = section.type === 'men' ? '🟦' : '🟥';
      L.push(`\n${'─'.repeat(52)}`);
      L.push(`  ${sIcon} ${section.label} (${section.participantCount}명)`);
      L.push('─'.repeat(52));
      appendGroupsTXT(L, section.groups);
      appendTournamentTXT(L, section.tournament);
    }
  } else {
    appendGroupsTXT(L, results.groups);
    appendTournamentTXT(L, results.tournament);
  }

  return L.join('\n');
}

function appendGroupsTXT(L, groups) {
  if (!groups) return;
  L.push('\n[조편성 결과]');
  for (const g of groups) {
    L.push(`\n─ ${g.name}  (총점: ${g.totalScore}, 평균: ${g.avgScore}) ─`);
    g.members.forEach((m, i) => {
      const gStr = m.gender ? ` [${m.gender}]` : '';
      L.push(`  ${i + 1}. ${m.name}(${m.grade})${gStr} | 나이:${m.age||'-'} 경력:${m.career||'-'}년 소속:${m.affiliation||'-'} [${m.score}점]`);
    });

    if (g.rounds) {
      // 유동 모드
      L.push('  [유동 라운드 대진]');
      g.rounds.forEach(r => {
        L.push(`    라운드 ${r.round}:`);
        r.matches.forEach((m, mi) => {
          if (!m.team2) return;
          const t1 = m.team1.map(p => `${p.name}(${p.grade})`).join('+');
          const t2 = m.team2.map(p => `${p.name}(${p.grade})`).join('+');
          L.push(`      경기 ${mi + 1}: ${t1}  vs  ${t2}`);
        });
      });
    } else if (g.teams) {
      // 고정 모드
      L.push('  [팀 구성]');
      g.teams.forEach((team, ti) => {
        L.push(`    ${g.name} ${ti + 1}팀: ${team.map(p => p.name + '(' + p.grade + (p.gender ? '/' + p.gender : '') + ')').join(' + ')}`);
      });
      if (g.teams.length >= 2) {
        L.push('  [대진]');
        for (let i = 0; i < g.teams.length; i++) {
          for (let j = i + 1; j < g.teams.length; j++) {
            L.push(`    ${g.name} ${i + 1}팀  vs  ${g.name} ${j + 1}팀`);
          }
        }
      }
    }
  }
}

function appendTournamentTXT(L, tournament) {
  if (!tournament) return;
  L.push('\n[토너먼트 대진표]');
  const RN = { 1: '결승', 2: '준결승', 4: '8강', 8: '16강' };
  tournament.rounds.forEach(matches => {
    const lbl = RN[matches.length] || `${matches.length * 2}강`;
    L.push(`\n[${lbl}]`);
    matches.forEach((m, i) => {
      L.push(`  경기 ${i + 1}: ${teamLabel(m.team1)}  vs  ${teamLabel(m.team2)}`);
    });
  });
}

function buildCSV() {
  const rows = [['복식종목', '조', '팀', '이름', '급수', '성별', '나이', '경력', '소속', '점수']];

  if (results.doublesType === 'both' && results.sections) {
    for (const section of results.sections) {
      if (section.groups) {
        for (const g of section.groups) {
          g.teams.forEach((team, ti) => {
            for (const m of team) {
              rows.push([section.label, g.name, `${g.name} ${ti + 1}팀`, m.name, m.grade, m.gender||'', m.age, m.career, m.affiliation||'', m.score]);
            }
          });
        }
      }
    }
  } else if (results.groups) {
    const label = DOUBLES_META[results.doublesType]?.label || '';
    for (const g of results.groups) {
      g.teams.forEach((team, ti) => {
        for (const m of team) {
          rows.push([label, g.name, `${g.name} ${ti + 1}팀`, m.name, m.grade, m.gender||'', m.age, m.career, m.affiliation||'', m.score]);
        }
      });
    }
  } else {
    for (const p of participants) {
      rows.push(['', '', '', p.name, p.grade, p.gender||'', p.age, p.career, p.affiliation||'', p.score]);
    }
  }

  return rows.map(r => r.map(c => `"${String(c??'').replace(/"/g, '""')}"`).join(',')).join('\n');
}


// ── Filtered TXT (respects preview deletions) ───────────────
function buildTXTFiltered() {
  const L = [];

  const flatGroups = getFlatGroups();
  flatGroups.forEach(function(g, gi) {
    L.push('\n─ ' + g.name);
    if (g.rounds) {
      L.push('  [유동 라운드 대진]');
      g.rounds.forEach(function(r) {
        var hasVisible = r.matches.some(function(m, mi) {
          return m.team2 && !previewDeletedIds.has('g' + gi + '-r' + r.round + '-m' + mi);
        });
        if (!hasVisible) return;
        L.push('    라운드 ' + r.round + ':');
        r.matches.forEach(function(m, mi) {
          if (!m.team2) return;
          if (previewDeletedIds.has('g' + gi + '-r' + r.round + '-m' + mi)) return;
          var t1 = m.team1.map(function(p) { return p.name + '(' + p.grade + ')'; }).join('+');
          var t2 = m.team2.map(function(p) { return p.name + '(' + p.grade + ')'; }).join('+');
          L.push('      경기 ' + (mi + 1) + ': ' + t1 + '  vs  ' + t2);
        });
      });
    } else if (g.teams) {
      L.push('  [대진]');
      var schedule = buildRoundRobinSchedule(g.teams);
      schedule.forEach(function(r) {
        var rMatches = r.matches.filter(function(m) {
          return !previewDeletedIds.has('g' + gi + '-t' + m.ti + '-t' + m.tj);
        });
        if (!rMatches.length) return;
        L.push('    라운드 ' + r.round + ':');
        rMatches.forEach(function(m) {
          var t1 = m.team1.map(function(p) { return p.name + '(' + p.grade + ')'; }).join('+');
          var t2 = m.team2.map(function(p) { return p.name + '(' + p.grade + ')'; }).join('+');
          L.push('      ' + t1 + '  vs  ' + t2);
        });
      });
    }
  });

  var tour = results.tournament || (results.sections && results.sections.reduce(function(a, s) { return a || s.tournament; }, null));
  if (tour) {
    var RN = { 1: '결승', 2: '준결승', 4: '8강', 8: '16강' };
    L.push('\n[토너먼트 대진표]');
    tour.rounds.forEach(function(matches) {
      var lbl = RN[matches.length] || (matches.length * 2 + '강');
      L.push('\n[' + lbl + ']');
      matches.forEach(function(m, mi) {
        if (!previewDeletedIds.has('tour-' + matches.length + '-m' + mi)) {
          L.push('  경기 ' + (mi + 1) + ': ' + teamLabel(m.team1) + '  vs  ' + teamLabel(m.team2));
        }
      });
    });
  }
  return L.join('\n').trim();
}

function buildCSVFiltered() {
  var csvRow = function(r) { return r.map(function(c) { return '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"'; }).join(','); };
  var rows = [csvRow(['복식종목', '조', '팀', '이름', '급수', '성별', '나이', '경력', '소속', '점수'])];

  var flatGroups = getFlatGroups();
  flatGroups.forEach(function(g, gi) {
    if (!g.teams) return;
    var label = (results.doublesType === 'both')
      ? (DOUBLES_META[results.doublesType] ? DOUBLES_META[results.doublesType].label : '')
      : (DOUBLES_META[results.doublesType] ? DOUBLES_META[results.doublesType].label : '');
    for (var i = 0; i < g.teams.length; i++) {
      for (var j = i + 1; j < g.teams.length; j++) {
        if (previewDeletedIds.has('g' + gi + '-t' + i + '-t' + j)) continue;
        var t1 = g.teams[i], t2 = g.teams[j];
        [t1, t2].forEach(function(team, ti) {
          team.forEach(function(m) {
            rows.push(csvRow([label, g.name, g.name + ' ' + (ti === 0 ? i + 1 : j + 1) + '팀', m.name, m.grade, m.gender || '', m.age, m.career, m.affiliation || '', m.score]));
          });
        });
      }
    }
  });

  if (rows.length === 1) {
    // fallback: all members
    flatGroups.forEach(function(g) {
      g.members.forEach(function(m) {
        var label = DOUBLES_META[results.doublesType] ? DOUBLES_META[results.doublesType].label : '';
        rows.push(csvRow([label, g.name, '', m.name, m.grade, m.gender || '', m.age, m.career, m.affiliation || '', m.score]));
      });
    });
  }
  return rows.join('\n');
}
function triggerDownload(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function modeLabel(mode) {
  return { groups: '조편성', tournament: '토너먼트', 'groups-tournament': '조편성 후 토너먼트' }[mode] || mode;
}

// ── Utility ─────────────────────────────────────────────────
function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

let _toastTimer = null;
function showToast(msg, type = 'info') {
  const el    = document.getElementById('toast');
  el.textContent = msg;
  el.className   = `toast ${type} show`;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { el.className = 'toast'; }, 3200);
}
