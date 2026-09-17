'use strict';
const $ = s => document.querySelector(s);
const icon = (name, cls = '') => `<svg class="icon ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tag = (text, kind = 'gray') => `<span class="tag ${kind}">${text}</span>`;
const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};
const PRESETS = [
  { title: '공대 캡스톤형', tag: 'SW 개발', categories: ['기획', '제작', 'QA', '발표자료', '조율'], weights: [20, 40, 15, 15, 10] },
  { title: '교양·전공 발표형', tag: '문서 협업', categories: ['자료조사', '보고서 작성', 'PPT 제작', '발표 준비'], weights: [25, 30, 25, 20] },
  { title: '상경계 기획형', tag: '분석·모델링', categories: ['시장·환경 분석', '전략·BM 기획', '재무 모델링', '제안서·IR'], weights: [25, 30, 25, 20] },
  { title: '이공계 실험형', tag: 'Lab 실험', categories: ['예비조사·세팅', '실험·계측', '데이터·오차', '고찰·보고서'], weights: [20, 30, 30, 20] },
];
const COLORS = ['a1', 'a2', 'a3', 'a4'];

const state = {
  role: store.get('role') || 'professor',
  teams: [], team: null, records: null, report: null,
  view: 'groups', tool: 'all', member: 'all',
  draftWeights: null, draftText: '', draftFiles: [], busy: false,
};

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    method: options.method || 'GET',
    headers: options.body ? { 'Content-Type': 'application/json' } : {},
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || '요청에 실패했습니다.'), { status: res.status });
  return data;
}

// ---------- helpers ----------
const me = () => state.team?.members.find(m => String(m.id) === store.get(`me:${state.team.id}`));
const memberBy = id => state.team.members.find(m => m.id === id);
const colorOf = m => COLORS[state.team.members.indexOf(m) % COLORS.length];
const avatar = m => m ? `<span class="avatar ${colorOf(m)}">${esc(m.name.slice(-2))}</span>` : `<span class="avatar">?</span>`;
const fmtDate = d => d ? new Date(d.includes('T') || d.includes('Z') ? d : d.replace(' ', 'T') + 'Z').toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' }) : '';
const fmtFull = d => d ? new Date(d.includes('T') || d.includes('Z') ? d : d.replace(' ', 'T') + 'Z').toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }) : '';
const toolLogo = tool => `<span class="tool-logo ${esc(tool.toLowerCase())}">${tool === 'GitHub' ? icon('github') : tool === 'Notion' ? 'N' : icon('file', 'sm')}</span>`;
const weightBar = (cats = state.team.categories, ws = state.team.weights) =>
  `<div class="weight-bar" aria-label="${cats.map((c, i) => `${esc(c)} ${ws[i]}%`).join(', ')}">${ws.map((w, i) => w ? `<div class="weight-segment" style="width:${w}%">${esc(cats[i])} <span>${w}</span></div>` : '').join('')}</div>`;

function notify(message) {
  clearTimeout(notify.t);
  const t = $('#toast');
  t.textContent = message; t.hidden = false;
  notify.t = setTimeout(() => (t.hidden = true), 3600);
}

async function run(fn) {
  if (state.busy) return;
  state.busy = true; document.body.style.cursor = 'progress';
  try { await fn(); } catch (e) { notify(e.message); } finally { state.busy = false; document.body.style.cursor = ''; }
}

// ---------- routing ----------
async function route() {
  const [, , teamId, view] = location.hash.split('/');
  closeModal();
  $('.sidebar').classList.remove('mobile-open');
  state.report = null; state.records = null;
  try {
    if (!teamId) {
      state.team = null; state.view = 'groups';
      state.teams = await api('/teams');
    } else {
      state.team = await api(`/teams/${teamId}`);
      state.draftWeights = null;
      const allowed = state.role === 'professor' ? ['report', 'evidence', 'setup'] : ['setup', 'evidence', 'statement'];
      state.view = allowed.includes(view) ? view : allowed[0];
      await loadViewData();
    }
  } catch (e) {
    notify(e.message);
    if (e.status === 404) return (location.hash = '#/');
  }
  render();
  window.scrollTo({ top: 0 });
}

async function loadViewData() {
  const t = state.team;
  if (state.view === 'report' && t.closed) state.report = await api(`/teams/${t.id}/report`);
  if (state.view === 'evidence' && (state.role === 'professor' || t.closed)) state.records = await api(`/teams/${t.id}/records`);
}

async function refreshTeam(team) {
  state.team = team || await api(`/teams/${state.team.id}`);
  await loadViewData();
  render();
}

// ---------- chrome ----------
function renderChrome() {
  const t = state.team;
  $('#header-course').innerHTML = t ? `${icon('board', 'course-icon')}<span>${esc(t.course)} · ${esc(t.name)}</span>` : '';
  const who = state.role === 'professor' ? '교수' : (me()?.name.slice(-2) || '학생');
  $('#header-right').innerHTML = `<span class="prototype-label">${state.role === 'professor' ? '교수 화면' : '학생 화면'}</span><span class="avatar current">${esc(who)}</span>`;
  const nav = [['#/', 'users', '팀 목록', !t]];
  if (t) {
    const tabs = state.role === 'professor'
      ? [['report', 'chart', '기여도 리포트'], ['evidence', 'folder', '활동 근거'], ['setup', 'lock', '착수 설정']]
      : [['setup', 'lock', '착수 설정'], ['evidence', 'folder', '활동 기록'], ['statement', 'pencil', '오프라인 서술']];
    for (const [v, ic, label] of tabs) nav.push([`#/team/${t.id}/${v}`, ic, label, state.view === v]);
  }
  $('#side-nav').innerHTML = nav.map(([href, ic, label, active]) => `<a class="nav-item ${active ? 'active' : ''}" href="${href}" ${active ? 'aria-current="page"' : ''}>${icon(ic)}${label}</a>`).join('');
  $('#bottom-nav').innerHTML = nav.map(([href, ic, label, active]) => `<a class="${active ? 'active' : ''}" href="${href}" aria-label="${label}" style="display:grid;place-items:center">${icon(ic)}<span>${label}</span></a>`).join('');
}

const roleSwitch = () => `<div class="role-switch" role="group" aria-label="화면 역할"><button data-action="role" data-role="professor" class="${state.role === 'professor' ? 'selected' : ''}" aria-pressed="${state.role === 'professor'}">교수 화면</button><button data-action="role" data-role="student" class="${state.role === 'student' ? 'selected' : ''}" aria-pressed="${state.role === 'student'}">학생 화면</button></div>`;

function projectStrip() {
  const t = state.team;
  const status = t.closed ? tag(`${icon('check', 'sm')} 마감 · 산출 가능`, 'green') : t.locked_at ? tag(`${icon('lock', 'sm')} 착수 설정 완료`, 'green') : tag('착수 설정 중', 'amber');
  return `<div class="project-strip"><div class="flex gap12"><span class="project-icon">${icon('folder')}</span><div><div class="project-title">${esc(t.project)}</div><div class="project-meta"><span>${esc(t.course)}</span><span class="sep"></span><span>${esc(t.name)} · ${t.members.length}명</span>${t.repo ? `<span class="sep"></span><span>${esc(t.repo)}</span>` : ''}</div></div></div><div class="flex gap16"><span class="deadline">마감<strong>${esc(t.deadline)}</strong></span>${status}</div></div>`;
}

function render() {
  renderChrome();
  const t = state.team;
  const titles = { groups: '팀 목록', report: '기여도 리포트', evidence: state.role === 'professor' ? '기여도 활동 근거' : '우리 팀 활동 기록', setup: '착수 설정', statement: '오프라인 기여 서술' };
  const subtitle = !t ? '팀 프로젝트를 만들고, 과정의 근거를 한곳에 모으세요.'
    : state.view === 'setup' ? '활동 시작 전에 팀이 합의하고 잠그는 기준입니다.'
    : state.view === 'statement' ? '온라인에 남지 않은 기여를 마감 후 1회 남깁니다.'
    : '온라인 작업 기록에 담긴 팀의 기여를 확인하세요.';
  const studentPicker = t && state.role === 'student'
    ? `<select class="select-control" id="me-select" aria-label="나는 누구인가요"><option value="">내 이름 선택</option>${t.members.map(m => `<option value="${m.id}" ${me()?.id === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select>` : '';
  const exportBtn = t && state.role === 'professor' && state.view === 'report' && state.report ? `<button class="button" data-action="export">${icon('download', 'sm')} PDF 내보내기</button>` : '';
  const view = !t ? groupsView() : { report: reportView, evidence: evidenceView, setup: setupView, statement: statementView }[state.view]();
  $('#content').innerHTML = `<div class="page-heading"><div class="heading-main"><span class="heading-icon">${icon('users')}</span><div><h1>${titles[state.view]}</h1><p class="page-subtitle">${subtitle}</p></div></div><div class="page-actions">${studentPicker}${roleSwitch()}${exportBtn}</div></div>${t ? projectStrip() : ''}<section id="view-panel">${view}</section><footer class="page-foot"><span>한만큼은 평가를 위한 참고 자료를 제공합니다. 최종 판단은 교수님께 있습니다.</span><span>Team HMK</span></footer>`;
  document.title = `한만큼 · ${t ? `${t.name} ${titles[state.view]}` : '팀 목록'}`;
}

// ---------- views ----------
function groupsView() {
  const tiles = state.teams.map(t => `<div class="card project-tile"><a class="flex gap16" style="flex:1;min-width:0" href="#/team/${t.id}"><span class="project-icon">${icon('users', 'lg')}</span><div><h2>${esc(t.project)}</h2><div class="project-meta"><span>${esc(t.course)}</span><span class="sep"></span><span>${esc(t.name)} · ${t.member_count}명</span><span class="sep"></span><span>마감 ${esc(t.deadline)}</span></div></div><div class="right flex gap16">${t.closed ? tag('마감', 'green') : t.locked_at ? tag('진행 중', 'blue') : tag('착수 설정 중', 'amber')}${icon('chevron')}</div></a>${state.role === 'professor' ? `<button class="icon-button" data-action="delete-team" data-id="${t.id}" data-name="${esc(t.project)} · ${esc(t.name)}" aria-label="팀 삭제" title="팀 삭제">${icon('close')}</button>` : ''}</div>`).join('');
  return `<div class="list-projects"><div class="flex gap8"><button class="button primary" data-action="new-team">${icon('users', 'sm')} 새 팀 프로젝트 만들기</button><button class="button soft" data-action="demo">시연용 예시 팀 불러오기</button></div>${tiles || `<div class="card empty">${icon('folder', 'lg')}<p class="mt16">아직 팀이 없습니다. 새 팀을 만들거나 예시 팀을 불러오세요.</p></div>`}</div>`;
}

function scopeCard() {
  const t = state.team;
  return `<section class="card scope-card"><h2>어디까지 측정하나요?</h2><div class="scope-line">${icon('link')}<div><strong>연결된 온라인 작업 기록</strong><p>${esc(t.tools.join(' · '))}</p></div></div><div class="scope-line">${icon('user')}<div><strong>발표 수행·시연은 교수님 관찰</strong><p>온라인 기여도 산출에서 제외</p></div></div><div class="scope-line">${icon('message')}<div><strong>오프라인 활동은 학생 서술로</strong><p>회의·카카오톡 대화 내용은 수집하지 않음</p></div></div></section>`;
}

function teamCard() {
  return `<section class="card team-card"><div class="card-top"><h2>함께하는 팀원</h2><span class="team-count">${icon('user')} ${state.team.members.length}</span></div>${state.team.members.map(m => `<div class="team-person">${avatar(m)}<div><p class="student-name">${esc(m.name)}</p><p class="student-role">${esc(m.role || '')}${m.github ? ` · @${esc(m.github)}` : ''}</p></div></div>`).join('')}</section>`;
}

function collectCard() {
  const t = state.team;
  return `<section class="card card-pad"><div class="between"><h2>기록 수집 현황</h2>${t.collected_at ? tag(`최근 수집 ${fmtFull(t.collected_at)}`, 'gray') : tag('아직 수집 전', 'amber')}</div><div class="status-grid"><div><strong>${t.record_count}</strong><span>수집된 작업 기록</span></div><div><strong>${t.record_count - t.unmatched}</strong><span>팀원과 연결됨</span></div><div><strong class="${t.unmatched ? 'sum-bad' : ''}">${t.unmatched}</strong><span>계정 미매칭</span></div></div><div class="flex gap8 mt16">${t.repo ? `<button class="button primary small" data-action="collect" ${t.locked_at ? '' : 'disabled'}>${icon('github', 'sm')} GitHub 기록 수집</button>` : ''}<button class="button small" data-action="add-record" ${t.locked_at ? '' : 'disabled'}>${icon('link', 'sm')} Notion·Docs 기록 추가</button></div>${t.locked_at ? '' : '<p class="caption-note">착수 기준을 잠근 뒤 수집할 수 있습니다.</p>'}</section>`;
}

function reportView() {
  const t = state.team;
  if (!t.closed) {
    return `<div class="report-grid"><div class="stack"><div class="setup-banner"><div class="lock-symbol">${icon('clock', 'lg')}</div><div><h2>학기 중에는 기여도를 산출하지 않습니다</h2><p>${esc(t.deadline)} 마감 후 1회 산출합니다. 그 전까지는 기록만 조용히 모읍니다.</p></div></div>${collectCard()}<section class="card card-pad"><h2>시연용 마감 처리</h2><p class="card-desc">본선 시연처럼 마감일 전에 결과를 보여줘야 할 때 사용합니다. 마감 후에는 학생이 오프라인 서술을 남길 수 있습니다.</p><button class="button soft small mt16" data-action="close" ${t.locked_at ? '' : 'disabled'}>${icon('lock', 'sm')} 지금 마감 처리</button></section></div><aside class="stack aside-stack">${teamCard()}${scopeCard()}</aside></div>`;
  }
  const { scores, records } = state.report;
  const byTool = id => Object.entries(records.filter(r => r.member_id === id).reduce((a, r) => ((a[`${r.tool} ${r.kind}`] = (a[`${r.tool} ${r.kind}`] || 0) + 1), a), {})).map(([k, n]) => `${k} ${n}`).join(' · ');
  const rows = t.members.map((m, i) => {
    const s = scores.find(x => x.member_id === m.id);
    return `<button class="contribution-row" data-action="member" data-id="${m.id}" aria-label="${esc(m.name)}, 기여도 ${s.score}%, 산출 근거 보기">${avatar(m)}<div><div class="student-name">${esc(m.name)}</div><div class="student-role">${esc(m.role || '')}</div></div><div><div class="progress-track" role="img" aria-label="전체 기여도 중 ${s.score}%"><div class="progress-fill p${(i % 4) + 1}" style="width:${s.score}%"></div></div><div class="progress-caption">${s.score === 0 ? '<span style="color:#b29662">오프라인 역할 확인 필요</span>' : esc(byTool(m.id))}</div></div><div class="score ${s.score === 0 ? 'zero' : ''}">${s.score}<span class="unit">%</span></div><span class="row-arrow">${icon('chevron', 'sm')}</span></button>`;
  }).join('');
  const zero = scores.some(s => s.score === 0);
  const statements = t.statements.map(st => {
    const m = memberBy(st.member_id);
    return `<div class="offline-head mt16">${avatar(m)}<div><p class="student-name">${esc(m?.name)}</p><p class="student-role">${fmtFull(st.created_at)} 제출</p></div></div><p class="offline-story">${esc(st.text).replace(/\n/g, '<br>')}</p>${fileChips(st)}`;
  }).join('');
  return `<div class="report-grid"><div class="stack"><section class="card chart-card"><div class="card-top"><div><h2>학생별 기여도</h2><p class="card-desc">합의한 가중치로 계산한 온라인 활동 비중입니다.</p></div>${tag('평가 참고 자료', 'blue')}</div><div class="chart-legend"><span><i class="legend-dot"></i> 온라인 활동 기반</span><span>학생을 선택해 근거 보기 ${icon('chevron', 'sm')}</span></div><div>${rows}</div><div class="chart-note">${icon('clock')}마감 후 산출 · 학기 중 학생에게 기여도를 표시하지 않습니다.</div>${zero ? `<div class="reference-banner">${icon('info')}<span><strong>0%는 연결된 도구에 온라인 기록이 없다는 뜻입니다.</strong><br>오프라인 기여와 발표·시연은 학생 서술 및 교수님의 관찰로 함께 확인해 주세요.</span></div>` : ''}${t.unmatched ? `<div class="reference-banner">${icon('info')}<span>팀원 계정과 연결되지 않은 기록 <strong>${t.unmatched}건</strong>이 산출에서 빠져 있습니다. 활동 근거 탭에서 작성자를 지정할 수 있습니다.</span></div>` : ''}</section><section class="card weight-card"><div class="card-top"><div class="flex gap8"><h2>팀이 합의한 가중치</h2>${icon('lock', 'sm')}</div><button class="button text small" data-action="method">산출 기준 보기 ${icon('chevron', 'sm')}</button></div>${weightBar()}<div class="weight-foot"><span class="flex gap8">${icon('check', 'sm')} ${fmtFull(t.locked_at)} 잠금 · 팀원 ${t.members.length}명 확인</span><span>결과를 알기 전 합의한 기준</span></div></section><section class="card offline-card"><div class="card-top"><h2>온라인에 남지 않은 기여 <span class="offline-count">${t.statements.length}</span></h2>${tag('학생 서술', 'amber')}</div>${statements || '<p class="card-desc">아직 제출된 서술이 없습니다.</p>'}<p class="caption-note">서술은 기여율에 자동 반영되지 않습니다.</p></section><section class="print-only print-table"><h2>학생별 산출 근거</h2><table><thead><tr><th>학생</th>${t.categories.map(c => `<th>${esc(c)}</th>`).join('')}<th>합산</th></tr></thead><tbody>${t.members.map(m => { const s = scores.find(x => x.member_id === m.id); return `<tr><td>${esc(m.name)}</td>${s.shares.map(v => `<td>${v.toFixed(1)}%</td>`).join('')}<td>${s.score}%</td></tr>`; }).join('')}</tbody></table><p class="print-note">산식: Σ(유형 가중치 × 유형 내 활동 비중). 유형 내 활동 비중은 해당 유형 기록 건수 비율입니다. 성적에 자동 반영되지 않습니다.</p></section></div><aside class="stack aside-stack">${teamCard()}${scopeCard()}<div class="explain-card"><div class="flex gap8" style="margin-bottom:6px">${icon('shield', 'sm')}<h3 style="margin:0;font-size:12px">과정의 근거를, 평가의 참고로</h3></div><p>기여도는 성적이 아닙니다.<br>기록과 맥락을 함께 확인해 주세요.</p></div></aside></div>`;
}

const fileChips = st => st.files.length ? `<div class="flex gap8 mt16" style="flex-wrap:wrap">${st.files.map(f => `<a class="attachment-chip" href="/api/files/${f.id}" target="_blank" rel="noopener">${icon(f.mime.startsWith('image/') ? 'image' : 'paperclip')}${esc(f.name)}</a>`).join('')}</div>` : '';

function recordItem(r) {
  const m = memberBy(r.member_id);
  return `<button class="evidence-item" data-action="record" data-id="${r.id}" aria-label="${esc(r.title)} 근거 상세 보기">${toolLogo(r.tool)}<div><div class="evidence-title">${esc(r.title)}</div><div class="evidence-meta">${m ? esc(m.name) : `<span class="sum-bad">미매칭${r.login ? ` ${r.tool === 'GitHub' ? '@' : ''}${esc(r.login)}` : ''}</span>`} · ${esc(r.tool)} · ${esc(r.kind)}${r.classified_by === 'ai' ? ' · AI 분류' : ''}</div></div><div class="evidence-end">${tag(esc(state.team.categories[r.type] ?? '미분류'), r.type === 1 ? 'blue' : 'gray')}<p>${fmtDate(r.date)}</p></div>${icon('chevron', 'sm')}</button>`;
}

function evidenceView() {
  const t = state.team;
  if (!state.records) {
    return `<div class="setup-grid"><div class="stack"><div class="hero-dark"><div class="check">${icon('check')}</div><h2>지금은 조용한 상태</h2><p>학기 중에는 알림도 점수도 없어요. 평소처럼 작업하면 됩니다.</p></div>${t.locked_at ? `<section class="card card-pad"><h2>GitHub에 남지 않는 작업이 있나요?</h2><p class="card-desc">Notion·Google Docs 등에서 작업한 문서 링크를 남겨 두면 마감 후 근거로 함께 확인됩니다.</p><button class="button soft small mt16" data-action="add-record">${icon('link', 'sm')} 작업 기록 링크 추가</button></section>` : ''}</div><aside class="stack aside-stack">${scopeCard()}</aside></div>`;
  }
  const list = state.records.filter(r => (state.tool === 'all' || r.tool === state.tool) && (state.member === 'all' || String(r.member_id) === state.member));
  const tools = ['all', ...new Set(state.records.map(r => r.tool))];
  return `<div class="report-grid"><section class="card card-pad"><div class="evidence-summary"><div><h2>기여도에 연결된 작업 기록</h2><p>어떤 작업이 어떤 기여 유형에 연결됐는지 확인하세요.</p></div>${tag(`전체 ${state.records.length}건`, 'gray')}</div><div class="filter-bar"><div class="filter-group" role="group" aria-label="도구 필터">${tools.map(x => `<button class="filter ${state.tool === x ? 'active' : ''}" data-action="filter" data-tool="${esc(x)}" aria-pressed="${state.tool === x}">${x === 'all' ? '전체 도구' : esc(x)}</button>`).join('')}</div><select class="select-control" id="member-filter" aria-label="학생 선택"><option value="all">전체 팀원</option>${t.members.map(m => `<option value="${m.id}" ${state.member === String(m.id) ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}<option value="null" ${state.member === 'null' ? 'selected' : ''}>계정 미매칭</option></select></div><div class="between" style="font-size:10px;color:#929bac;margin-bottom:11px"><span>선택한 기록 <strong class="blue">${list.length}</strong>건</span><span>최신 활동순</span></div><div class="evidence-list">${list.length ? list.map(recordItem).join('') : `<div class="empty">${icon('folder', 'lg')}<p class="mt16">선택한 조건에 해당하는 온라인 기록이 없습니다.</p><button class="button text mt16" data-action="reset-filters">필터 초기화</button></div>`}</div></section><aside class="stack aside-stack">${state.role === 'professor' ? collectCard() : ''}<div class="explain-card"><h3>근거는 이렇게 읽어요</h3><p>활동 선택 → 변경 내용 확인 → 기여 유형 확인 → 가중치 산식과 비교</p><button class="button text small mt16" data-action="method">산출 기준 확인 ${icon('chevron', 'sm')}</button></div>${scopeCard()}</aside></div>`;
}

function weightEditor() {
  const d = state.draftWeights || { categories: [...state.team.categories], weights: [...state.team.weights] };
  state.draftWeights = d;
  const sum = d.weights.reduce((a, b) => a + (Number(b) || 0), 0);
  return `<div class="mt16" id="weight-editor">${d.categories.map((c, i) => `<div class="weight-row"><input class="input" data-w="cat" data-i="${i}" value="${esc(c)}" maxlength="20" aria-label="유형 이름"><input class="input" type="number" min="0" max="100" data-w="val" data-i="${i}" value="${d.weights[i]}" aria-label="가중치"><button class="icon-button" data-action="w-remove" data-i="${i}" aria-label="유형 삭제" ${d.categories.length <= 1 ? 'disabled' : ''}>${icon('close', 'sm')}</button></div>`).join('')}<div class="between mt16"><div class="flex gap8"><button class="button small" data-action="w-add" ${d.categories.length >= 8 ? 'disabled' : ''}>유형 추가</button><select class="select-control" id="preset-select" aria-label="전공별 템플릿"><option value="">템플릿 불러오기</option>${PRESETS.map((p, i) => `<option value="${i}">${p.title}</option>`).join('')}</select></div><span id="w-sum" class="${sum === 100 ? 'green' : 'sum-bad'}">합계 ${sum}%</span></div><button class="button primary small mt16" data-action="w-save">가중치 저장</button><p class="caption-note">저장하면 팀원 확인이 초기화되고, 모두 다시 확인해야 잠글 수 있습니다.</p></div>`;
}

function notionSetup() {
  const t = state.team;
  if (t.closed) return '';
  const mine = me();
  const editable = m => state.role === 'professor' || mine?.id === m.id;
  return `<div class="mt16"><div class="field" style="margin-bottom:6px">Notion 팀 페이지 링크</div><div class="flex gap8"><input class="input" id="notion-url" type="url" placeholder="https://www.notion.so/..." value="${t.notion_page ? 'https://www.notion.so/' + t.notion_page.replace(/-/g, '') : ''}"><button class="button small" data-action="save-notion">저장</button></div><p class="caption-note">이 페이지와 하위 페이지를 <strong>한만큼</strong> 연결에 공유해 주세요(페이지 ··· → 연결 추가). 같은 날 같은 페이지 편집은 1건으로 합칩니다.</p><div class="field mt16" style="margin-bottom:6px">팀원 Notion 계정 이메일</div>${t.members.map(m => `<div class="weight-row" style="grid-template-columns:90px 1fr 60px"><span class="student-name">${esc(m.name)}</span><input class="input" type="email" data-notion-email="${m.id}" value="${esc(m.notion_email || '')}" placeholder="notion 로그인 이메일" ${editable(m) ? '' : 'disabled'}><button class="button small" data-action="save-notion-email" data-id="${m.id}" ${editable(m) ? '' : 'disabled'}>저장</button></div>`).join('')}</div>`;
}

function setupView() {
  const t = state.team;
  const mine = me();
  const allConfirmed = t.members.every(m => m.confirmed_at);
  const confirmed = t.members.filter(m => m.confirmed_at).length;
  const studentQuiet = state.role === 'student' && t.locked_at && !t.closed;
  return `${studentQuiet ? `<div class="hero-dark" style="margin-bottom:20px"><div class="check">${icon('check')}</div><h2>착수 준비 완료</h2><p>학기 중에는 알림도 점수도 없어요.<br>평소처럼 작업하면 됩니다.</p></div>` : `<div class="setup-banner"><div class="lock-symbol">${icon('lock', 'lg')}</div><div><h2>${t.locked_at ? '착수 설정이 완료되었습니다' : '착수 설정을 진행해 주세요'}</h2><p>${t.locked_at ? '팀원 모두가 확인한 기준으로, 마감 후 한 번만 산출합니다.' : '도구 연결 → 가중치 합의 → 팀원 확인 후 잠금. 결과를 모르는 지금 기준을 정합니다.'}</p></div></div>`}<div class="setup-grid"><div class="stack"><section class="card setup-step"><div class="between"><h2><span class="count-circle">1</span>작업 도구 연결</h2>${tag(t.repo ? 'GitHub 연결됨' : 'GitHub 미연결', t.repo ? 'green' : 'gray')}</div><p class="card-desc">팀이 실제 사용하는 작업 도구의 활동 기록만 수집합니다.</p><div class="tool-connections"><div class="connection">${toolLogo('GitHub')}<span class="name">${t.repo ? esc(t.repo) : 'GitHub'}</span>${tag(t.repo ? '자동 수집' : '미연결', t.repo ? 'green' : 'gray')}</div><div class="connection">${toolLogo('Notion')}<span class="name">${t.notion_page ? 'Notion 팀 페이지' : 'Notion'}</span>${tag(t.notion_page ? '웹훅 수집' : '미연결', t.notion_page ? 'green' : 'gray')}</div><div class="connection">${toolLogo('Docs')}<span class="name">Google Docs 등</span>${tag('링크 기록', 'blue')}</div></div>${notionSetup()}<p class="caption-note">회의·메신저 대화는 읽지 않습니다. GitHub 계정은 팀원별 아이디로 연결됩니다: ${t.members.map(m => `${esc(m.name)} ${m.github ? '@' + esc(m.github) : '(미입력)'}`).join(', ')}</p></section><section class="card setup-step"><div class="between"><h2><span class="count-circle">2</span>기여 유형과 가중치 합의</h2>${t.locked_at ? tag(`${icon('lock', 'sm')} 잠금 완료`, 'green') : ''}</div><p class="card-desc">템플릿을 선택한 뒤 우리 팀에 맞게 조정합니다. 한 사람이 여러 유형에 참여할 수 있습니다.</p>${t.locked_at ? `<div class="mt24">${weightBar()}</div>` : weightEditor()}</section><section class="card setup-step"><div class="between"><h2><span class="count-circle">3</span>팀원 확인 및 잠금</h2>${t.locked_at ? tag(`${icon('lock', 'sm')} ${fmtFull(t.locked_at)} 잠금`, 'green') : tag(`${confirmed} / ${t.members.length} 확인`, allConfirmed ? 'green' : 'gray')}</div><p class="card-desc">${t.locked_at ? '팀원 모두 확인했습니다. 마감 전까지 변경할 수 없습니다.' : '모든 팀원이 기준을 확인하면 잠글 수 있습니다.'}</p><div class="consent-list">${t.members.map(m => `<span class="consent-person" style="${m.confirmed_at ? '' : 'opacity:.55'}">${icon(m.confirmed_at ? 'check' : 'clock')} ${esc(m.name)} ${m.confirmed_at ? '확인' : '대기'}</span>`).join('')}</div>${t.locked_at ? '' : `<div class="flex gap8 mt16">${state.role === 'student' ? (mine ? `<button class="button soft small" data-action="confirm" ${mine.confirmed_at ? 'disabled' : ''}>${mine.confirmed_at ? '확인 완료' : `${esc(mine.name)}으로 기준 확인`}</button>` : '<span class="caption-note" style="margin:0">상단에서 내 이름을 선택하면 확인할 수 있어요.</span>') : ''}<button class="button primary small" data-action="lock" ${allConfirmed ? '' : 'disabled'}>${icon('lock', 'sm')} 기준 잠그기</button></div>`}</section></div><aside class="stack aside-stack"><section class="card card-pad"><h2 style="font-size:14px;margin-bottom:22px">우리 팀의 활동 일정</h2><div class="timeline"><div class="timeline-item ${!t.locked_at ? 'current' : ''}"><strong>착수 설정</strong><p>도구 연결 · 가중치 합의 · 잠금</p></div><div class="timeline-item ${t.locked_at && !t.closed ? 'current' : ''}"><strong>학기 중 · 평소처럼 팀 활동</strong><p>추가 입력·알림·점수 확인 없음</p></div><div class="timeline-item ${t.closed ? 'current' : ''}"><strong>${esc(t.deadline)} · 프로젝트 마감</strong><p>온라인 기여도 1회 산출</p></div><div class="timeline-item"><strong>마감 후 · 오프라인 기여 서술</strong><p>학생 서술을 교수 리포트에 첨부</p></div></div></section>${state.role === 'professor' ? `<section class="card student-note"><h3>학생에게 이 링크를 공유하세요</h3><p style="word-break:break-all">${esc(location.origin)}/#/team/${t.id}</p><button class="button text small mt16" data-action="copy-link">링크 복사 ${icon('link', 'sm')}</button></section>` : ''}</aside></div>`;
}

function statementView() {
  const t = state.team;
  const mine = me();
  const sent = mine && t.statements.find(s => s.member_id === mine.id);
  const locked = !t.closed;
  const disabled = locked || sent || !mine;
  return `<div class="setup-grid"><div class="stack"><div class="setup-banner"><div class="lock-symbol">${icon(locked ? 'clock' : sent ? 'check' : 'pencil', 'lg')}</div><div><h2>${locked ? '마감 후, 기록 밖의 기여를 남겨 주세요' : sent ? '서술이 제출되었습니다' : '온라인에 남지 않은 기여가 있나요?'}</h2><p>${locked ? `${esc(t.deadline)} 마감 후 작성할 수 있습니다.` : sent ? '작성한 내용과 첨부는 교수님 리포트에 함께 전달됩니다.' : '한 번 작성한 서술을 교수님이 참고할 수 있도록 전달합니다.'}</p></div></div><section class="card student-form"><div class="between"><h2>나의 오프라인 기여 서술</h2>${tag(locked ? '마감 후 제출 가능' : sent ? '제출 완료' : '1회 제출', 'gray')}</div><p class="card-desc">${mine ? esc(mine.name) : '상단에서 내 이름을 선택해 주세요'} · ${esc(t.name)} · ${esc(t.project)}</p><label for="statement-text">어떤 활동을 맡았나요?</label><textarea id="statement-text" class="textarea" maxlength="1000" ${disabled ? 'disabled' : ''} placeholder="예: 시연용 하드웨어 조립과 현장 세팅을 맡았고, 11/28과 12/5 오프라인 리허설을 진행했습니다.">${esc(sent ? sent.text : state.draftText)}</textarea><div class="form-status"><span id="char-count">${(sent ? sent.text : state.draftText).length}</span> / 1,000자</div><p class="caption-note">맡은 역할, 작업 날짜, 온라인 기록에 남지 않은 이유를 적어 주세요.</p><input type="file" id="file-input" accept="image/*,.pdf" multiple hidden>${sent ? fileChips(sent) : `<div class="file-list">${state.draftFiles.map(f => `<span class="attachment-chip">${icon('paperclip')}${esc(f.name)}</span>`).join('')}</div>`}<div class="form-foot"><button class="button" data-action="attach" ${disabled ? 'disabled' : ''}>${icon('paperclip', 'sm')} 사진·캡처 첨부</button><button class="button primary" data-action="submit-statement" ${disabled ? 'disabled' : ''}>${sent ? '제출 완료' : locked ? '마감 후 제출 가능' : '서술 제출하기'}</button></div><div class="reference-banner">${icon('info')}<span>서술은 점수로 변환되지 않습니다. 작성한 그대로 교수님께 전달되며 최종 판단은 교수님께 있습니다.</span></div></section></div><aside class="stack aside-stack">${teamCard()}<section class="card student-note"><h3>이런 기여를 남길 수 있어요</h3><p>오프라인 회의 준비, 시연 장비 조립, 현장 세팅, 공동 작업 등 연결한 도구에 기록이 남지 않은 활동을 적어 주세요.</p><p class="mt16">사진·캡처(각 5MB, 최대 5개)는 참고 첨부입니다. 대화 내용은 분석하거나 점수화하지 않습니다.</p></section></aside></div>`;
}

// ---------- modals ----------
let lastFocus = null;
function openModal(title, eyebrow, body, subtitle = '', wide = false, footerHtml = '') {
  const d = $('#modal');
  if (!d.open) lastFocus = document.activeElement;
  d.className = 'modal' + (wide ? ' wide' : '');
  d.innerHTML = `<header class="modal-header"><div><div class="modal-eyebrow">${eyebrow}</div><h2 id="modal-title">${title}</h2>${subtitle ? `<p>${subtitle}</p>` : ''}</div><button class="icon-button" data-action="close-modal" aria-label="닫기">${icon('close')}</button></header><div class="modal-body">${body}</div><footer class="modal-footer"><p>한만큼 · 평가 참고 자료</p>${footerHtml || '<button class="button small" data-action="close-modal">닫기</button>'}</footer>`;
  if (!d.open) d.showModal();
  d.scrollTop = 0;
}
function closeModal() {
  const d = $('#modal');
  if (d.open) d.close();
  if (lastFocus?.isConnected) lastFocus.focus();
}

function newTeamModal() {
  const memberRow = () => `<div class="member-row"><input class="input" name="m-name" placeholder="이름" maxlength="20"><input class="input" name="m-role" placeholder="역할 (예: 개발)" maxlength="30"><input class="input gh" name="m-github" placeholder="GitHub 아이디" maxlength="40"><input class="input gh" type="email" name="m-notion" placeholder="Notion 이메일" maxlength="100"><button type="button" class="icon-button" data-action="row-remove" aria-label="팀원 삭제">${icon('close', 'sm')}</button></div>`;
  newTeamModal.row = memberRow;
  openModal('새 팀 프로젝트', 'NEW TEAM / 착수 설정', `<form id="team-form" class="form-grid"><label class="field">과목명<input class="input" name="course" required maxlength="60" placeholder="캡스톤디자인(2)"></label><label class="field">팀 이름<input class="input" name="name" required maxlength="30" placeholder="팀 3"></label><label class="field full">프로젝트명<input class="input" name="project" required maxlength="60" placeholder="캠퍼스 분실물 매칭 앱"></label><label class="field">시작일<input class="input" type="date" name="start_date"></label><label class="field">마감일<input class="input" type="date" name="deadline" required></label><label class="field full">GitHub 저장소 (선택)<input class="input" name="repo" placeholder="owner/repository" pattern="[\\w.\\-]+/[\\w.\\-]+"></label><label class="field full">Notion 팀 페이지 링크 (선택 · 하위 페이지 편집까지 수집)<input class="input" type="url" name="notion" placeholder="https://www.notion.so/..."></label><label class="field full">기여 유형 템플릿<select class="select-control" name="preset">${PRESETS.map((p, i) => `<option value="${i}">${p.title} — ${p.categories.map((c, j) => `${c} ${p.weights[j]}`).join(' · ')}</option>`).join('')}</select></label><div class="full"><div class="field" style="margin-bottom:8px">팀원 (GitHub 아이디 · Notion 계정 이메일로 기록을 연결합니다)</div><div id="member-rows">${memberRow() + memberRow() + memberRow()}</div><button type="button" class="button small" data-action="row-add">팀원 추가</button></div></form>`, '가중치는 만든 뒤 착수 설정에서 팀과 함께 조정할 수 있습니다.', true, `<div class="flex gap8"><button class="button small" data-action="close-modal">취소</button><button class="button primary small" data-action="create-team">팀 만들기</button></div>`);
}

function recordModal(id) {
  const list = state.records || state.report?.records || [];
  const r = list.find(x => x.id === id);
  if (!r) return;
  const t = state.team;
  const m = memberBy(r.member_id);
  const prof = state.role === 'professor';
  const by = { ai: 'AI 분류 (Claude)', rule: '키워드 규칙 분류', manual: '작성자 선택', professor: '교수 조정', demo: '예시 데이터' }[r.classified_by] || '';
  const isCode = r.tool === 'GitHub' && /^[+-] /m.test(r.body || '');
  const body = `<div class="between"><div class="flex gap12">${toolLogo(r.tool)}<div><h3>${esc(r.ref || r.kind)}</h3><p class="card-desc">${esc(r.kind)} · ${fmtFull(r.date)}</p></div></div>${tag(esc(t.categories[r.type] ?? '미분류'), 'blue')}</div><dl class="record-metadata"><dt>기여자</dt><dd>${m ? `${esc(m.name)}${r.login ? ` · @${esc(r.login)}` : ''}` : `미매칭${r.login ? ` · ${r.tool === 'GitHub' ? '@' : ''}${esc(r.login)}` : ''}`}</dd><dt>원본</dt><dd>${r.url ? `<a class="blue" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">원본 도구에서 열기 ${icon('external', 'sm')}</a>` : '링크 없음'}</dd><dt>기여 유형</dt><dd>${esc(t.categories[r.type] ?? '미분류')} · 팀 합의 가중치 ${t.weights[r.type] ?? 0}%</dd><dt>분류 방식</dt><dd>${by}</dd></dl><div class="explain-card"><h3 style="font-size:12px">이 기록이 근거가 된 이유</h3><p>${esc(r.reason)}</p></div>${r.body ? `<div class="record-preview"><div class="record-preview-top">${icon('file', 'sm')}<strong>내용 미리보기</strong></div><div class="record-content">${isCode ? `<pre>${esc(r.body).split('\n').map(l => `<div class="${l.startsWith('+') ? 'added' : ''}">${l}</div>`).join('')}</pre>` : `<p style="white-space:pre-wrap">${esc(r.body.slice(0, 1500))}</p>`}</div></div>` : ''}${prof ? `<div class="form-grid mt24"><label class="field">기여 유형 조정<select class="select-control" id="record-type">${t.categories.map((c, i) => `<option value="${i}" ${r.type === i ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label><label class="field">작성자 지정<select class="select-control" id="record-member"><option value="">미매칭</option>${t.members.map(x => `<option value="${x.id}" ${r.member_id === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label></div>` : ''}`;
  openModal(esc(r.title), 'ACTIVITY RECORD / 근거 상세', body, '원본 도구의 작업 기록과 기여 유형을 함께 확인합니다.', false,
    prof ? `<div class="flex gap8">${m ? `<button class="button small" data-action="member" data-id="${m.id}">${esc(m.name)} 상세</button>` : ''}<button class="button primary small" data-action="save-record" data-id="${r.id}">조정 저장</button></div>` : '');
}

function memberModal(id) {
  const t = state.team;
  const m = memberBy(id);
  const s = state.report.scores.find(x => x.member_id === id);
  const list = state.report.records.filter(r => r.member_id === id);
  const st = t.statements.find(x => x.member_id === id);
  const hero = `<div class="detail-hero"><div class="flex gap12">${avatar(m)}<div><div class="name">${esc(m.name)}</div><div class="role">${esc(m.role || '')} · 기록 ${list.length}건</div></div></div><div><div class="big-score">${s.score.toFixed(1)}<small>%</small></div><div class="big-score-label">전체 온라인 활동 비중</div></div></div>`;
  const offline = st ? `<div class="detail-section-title"><h3>학생이 남긴 오프라인 기여</h3>${tag('점수 반영 없음', 'amber')}</div><p class="offline-story">${esc(st.text).replace(/\n/g, '<br>')}</p>${fileChips(st)}` : '<p class="caption-note">이 학생은 오프라인 기여 서술을 남기지 않았습니다.</p>';
  const body = s.score === 0
    ? `${hero}<div class="notice-amber"><strong>온라인 기록이 없는 것과 기여가 없는 것은 다릅니다.</strong><br>연결된 도구에 ${esc(m.name)} 학생의 온라인 작업 기록이 없습니다. 발표·시연과 오프라인 활동은 교수님의 관찰 및 학생 서술로 확인해 주세요.</div>${offline}`
    : `${hero}<div class="formula-box"><div class="formula-label">계산 방법 · 유형 가중치 × 유형 내 활동 비중</div><div class="formula-text">${s.shares.map((v, i) => `(${s.applied[i].toFixed(1)}% × ${v.toFixed(1)}%)`).join(' + ')}<br>= ${s.parts.map(v => v.toFixed(1) + '%p').join(' + ')} = <strong>${s.score.toFixed(1)}%</strong></div></div><div class="table-wrap"><table><thead><tr><th>기여 유형</th><th>합의 가중치</th><th>적용 가중치</th><th>기록 수</th><th>유형 내 비중</th><th>반영</th><th>대표 근거</th></tr></thead><tbody>${t.categories.map((c, i) => { const r = list.find(x => x.type === i); return `<tr><td>${esc(c)}</td><td>${t.weights[i]}%</td><td>${s.applied[i].toFixed(1)}%</td><td>${s.counts[i]}</td><td>${s.shares[i].toFixed(1)}%</td><td>${s.parts[i].toFixed(1)}%p</td><td>${r ? `<button class="table-link" data-action="record" data-id="${r.id}">기록 확인 ${icon('external', 'sm')}</button>` : '<span class="muted" style="font-size:10px">—</span>'}</td></tr>`; }).join('')}</tbody></table></div><p class="caption-note">유형 내 비중 = 해당 유형에서 이 학생의 기록 수 ÷ 팀 전체 기록 수. 팀 전체에 기록이 없는 유형의 가중치는 나머지 유형에 비례해 나눕니다. 활동량만으로 작업의 질을 판단할 수 없습니다.</p><div class="detail-section-title"><h3>근거가 된 활동 <span class="muted">${list.length}</span></h3></div><div class="evidence-list">${list.slice(0, 20).map(recordItem).join('')}</div>${offline}`;
  openModal('개인 기여도 상세', 'CONTRIBUTION EVIDENCE', body, '활동 기록에서 산출 비율까지, 근거를 따라 확인하세요.', true);
}

function methodModal() {
  const t = state.team;
  openModal('기여도 산출 기준', 'METHOD / 합의와 계산', `<div class="explain-card"><h3>팀의 합의가 기준이 됩니다.</h3><p>착수 시 팀이 정한 가중치 안에서 유형별 기여를 합산합니다. 마감 후 한 번만 계산하며, 성적을 자동으로 결정하지 않습니다.</p></div><h3 class="mt24" style="margin-bottom:14px">${esc(t.name)}의 가중치</h3>${weightBar()}<div class="formula-box mt24"><p class="formula-label">합산 산식</p><div class="formula-text">개인 산출 비중 = Σ (유형 가중치 × 유형 내 활동 비중)<br>유형 내 활동 비중 = 해당 유형 내 개인 기록 수 ÷ 팀 전체 기록 수<br>팀 전체에 기록이 없는 유형의 가중치는 나머지 유형에 비례 배분</div></div><div class="notice-amber mt24"><strong>해석 시 유의사항</strong><br>온라인 기록 0% ≠ 전체 기여 0%. 활동량만으로 작업의 질이나 실제 기여 전체를 판단할 수 없으며, 반복 편집 등 기록 부풀리기를 자동으로 판별하지 않습니다. 교수님이 원자료·학생 서술·현장 관측을 함께 확인해 주세요.</div><div class="detail-section-title"><h3>측정 범위</h3></div><ul class="bullet-copy"><li>자동 수집: GitHub 커밋·PR·코드 리뷰·이슈 (머지 커밋 제외)</li><li>링크 기록: Notion·Google Docs 등 학생이 남긴 작업 링크</li><li>분류: Claude AI 분류 (API 키 없으면 키워드 규칙) · 교수 조정 가능</li><li>제외: 발표 수행·시연(교수 관찰), 메신저·회의 대화</li></ul>`, '가중치와 유형별 비중이 전체 기여도로 연결되는 방식입니다.', true);
}

function addRecordModal() {
  const t = state.team;
  const mine = me();
  openModal('작업 기록 링크 추가', 'MANUAL RECORD', `<form id="record-form" class="form-grid"><label class="field">팀원<select class="select-control" name="member_id" required>${t.members.map(m => `<option value="${m.id}" ${mine?.id === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></label><label class="field">도구<select class="select-control" name="tool">${['Notion', 'Docs', 'Slides', 'Sheets', 'Figma', '기타'].map(x => `<option>${x}</option>`).join('')}</select></label><label class="field full">작업 제목<input class="input" name="title" required maxlength="200" placeholder="예: 요구사항 정의서 v3 작성"></label><label class="field full">링크<input class="input" type="url" name="url" placeholder="https://www.notion.so/..."></label><label class="field full">내용 요약 (선택)<textarea class="textarea" name="body" maxlength="4000" style="min-height:80px"></textarea></label><label class="field full">기여 유형<select class="select-control" name="type"><option value="">자동 분류</option>${t.categories.map((c, i) => `<option value="${i}">${esc(c)}</option>`).join('')}</select></label></form>`, 'API 연동 전인 도구의 작업을 근거로 남깁니다.', false, `<div class="flex gap8"><button class="button small" data-action="close-modal">취소</button><button class="button primary small" data-action="save-manual">추가</button></div>`);
}

// ---------- events ----------
const readFileB64 = f => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result.split(',')[1]); r.onerror = no; r.readAsDataURL(f); });

document.addEventListener('click', e => {
  const b = e.target.closest('[data-action]');
  if (!b || b.disabled) return;
  const t = state.team;
  const id = Number(b.dataset.id);
  switch (b.dataset.action) {
    case 'role':
      state.role = b.dataset.role; store.set('role', state.role);
      if (t) route(); else render();
      break;
    case 'menu': b.setAttribute('aria-expanded', String($('.sidebar').classList.toggle('mobile-open'))); break;
    case 'close-modal': closeModal(); break;
    case 'new-team': newTeamModal(); break;
    case 'row-add': $('#member-rows').insertAdjacentHTML('beforeend', newTeamModal.row()); break;
    case 'row-remove': if ($('#member-rows').children.length > 2) b.parentElement.remove(); break;
    case 'create-team': run(async () => {
      const f = $('#team-form');
      if (!f.reportValidity()) return;
      const fd = new FormData(f);
      const p = PRESETS[fd.get('preset')];
      const names = fd.getAll('m-name'), roles = fd.getAll('m-role'), ghs = fd.getAll('m-github'), notions = fd.getAll('m-notion');
      const team = await api('/teams', { method: 'POST', body: {
        course: fd.get('course'), name: fd.get('name'), project: fd.get('project'), start_date: fd.get('start_date'), deadline: fd.get('deadline'),
        repo: fd.get('repo').trim(), notion: fd.get('notion').trim(), categories: p.categories, weights: p.weights,
        members: names.map((n, i) => ({ name: n, role: roles[i], github: ghs[i], notion_email: notions[i] })).filter(m => m.name.trim()),
      } });
      state.role = 'professor'; store.set('role', 'professor');
      location.hash = `#/team/${team.id}/setup`;
      notify('팀을 만들었습니다. 학생에게 링크를 공유해 착수 설정을 진행하세요.');
    }); break;
    case 'delete-team':
      openModal('팀 프로젝트를 삭제할까요?', 'DELETE / 삭제', `<p class="offline-story"><strong>${esc(b.dataset.name)}</strong></p><div class="notice-amber mt16">팀원·수집된 기록·학생 서술·첨부 파일이 모두 삭제되며 되돌릴 수 없습니다.</div>`, '', false, `<div class="flex gap8"><button class="button small" data-action="close-modal">취소</button><button class="button primary small" style="background:#c2410c;border-color:#c2410c" data-action="confirm-delete" data-id="${esc(b.dataset.id)}">삭제</button></div>`);
      break;
    case 'confirm-delete': run(async () => {
      await api(`/teams/${b.dataset.id}`, { method: 'DELETE' });
      closeModal(); state.teams = await api('/teams'); render(); notify('팀 프로젝트를 삭제했습니다.');
    }); break;
    case 'demo': run(async () => {
      const team = await api('/demo', { method: 'POST' });
      state.role = 'professor'; store.set('role', 'professor');
      location.hash = `#/team/${team.id}/report`;
    }); break;
    case 'member': memberModal(id); break;
    case 'record': recordModal(id); break;
    case 'method': methodModal(); break;
    case 'export': window.print(); break;
    case 'filter': state.tool = b.dataset.tool; render(); break;
    case 'reset-filters': state.tool = 'all'; state.member = 'all'; render(); break;
    case 'copy-link': navigator.clipboard?.writeText(`${location.origin}/#/team/${t.id}`).then(() => notify('링크를 복사했습니다.'), () => notify('복사에 실패했습니다.')); break;
    case 'w-add': state.draftWeights.categories.push('새 유형'); state.draftWeights.weights.push(0); render(); break;
    case 'w-remove': state.draftWeights.categories.splice(b.dataset.i, 1); state.draftWeights.weights.splice(b.dataset.i, 1); render(); break;
    case 'w-save': run(async () => {
      const d = state.draftWeights;
      const team = await api(`/teams/${t.id}/weights`, { method: 'PUT', body: { categories: d.categories, weights: d.weights.map(Number) } });
      state.draftWeights = null; await refreshTeam(team); notify('가중치를 저장했습니다. 팀원 확인을 다시 받아 주세요.');
    }); break;
    case 'confirm': run(async () => { await refreshTeam(await api(`/teams/${t.id}/members/${me().id}/confirm`, { method: 'POST' })); notify('기준을 확인했습니다.'); }); break;
    case 'lock': run(async () => { await refreshTeam(await api(`/teams/${t.id}/lock`, { method: 'POST' })); notify('기준을 잠갔습니다. 이제 평소처럼 작업하면 됩니다.'); }); break;
    case 'close':
      openModal('지금 마감 처리할까요?', 'CLOSE / 마감', '<p class="offline-story">마감 처리하면 기여도가 산출되고 학생이 오프라인 서술을 제출할 수 있습니다. 되돌릴 수 없습니다.</p>', '', false, '<div class="flex gap8"><button class="button small" data-action="close-modal">취소</button><button class="button primary small" data-action="confirm-close">마감 처리</button></div>');
      break;
    case 'confirm-close': run(async () => { closeModal(); await refreshTeam(await api(`/teams/${t.id}/close`, { method: 'POST' })); notify('마감 처리했습니다.'); }); break;
    case 'collect': run(async () => {
      notify('GitHub 기록을 수집하고 분류하는 중입니다…');
      const r = await api(`/teams/${t.id}/collect`, { method: 'POST' });
      await refreshTeam(r.team);
      notify(`새 기록 ${r.added}건 수집${r.added ? ` · AI 분류 ${r.ai}건 / 규칙 분류 ${r.added - r.ai}건` : ''}`);
    }); break;
    case 'add-record': addRecordModal(); break;
    case 'save-notion': run(async () => { await refreshTeam(await api(`/teams/${t.id}/notion`, { method: 'PUT', body: { url: $('#notion-url').value.trim() } })); notify('Notion 페이지를 저장했습니다.'); }); break;
    case 'save-notion-email': run(async () => { await refreshTeam(await api(`/teams/${t.id}/members/${id}/notion`, { method: 'PUT', body: { email: document.querySelector(`[data-notion-email="${id}"]`).value } })); notify('Notion 이메일을 저장했습니다.'); }); break;
    case 'save-manual': run(async () => {
      const f = $('#record-form');
      if (!f.reportValidity()) return;
      const fd = new FormData(f);
      const team = await api(`/teams/${t.id}/records`, { method: 'POST', body: {
        member_id: Number(fd.get('member_id')), tool: fd.get('tool'), kind: '문서 편집', title: fd.get('title'), url: fd.get('url'), body: fd.get('body'),
        type: fd.get('type') === '' ? undefined : Number(fd.get('type')),
      } });
      closeModal(); await refreshTeam(team); notify('작업 기록을 추가했습니다.');
    }); break;
    case 'save-record': run(async () => {
      const mv = $('#record-member').value;
      await api(`/records/${id}`, { method: 'PATCH', body: { type: Number($('#record-type').value), member_id: mv ? Number(mv) : null } });
      closeModal(); await refreshTeam(); notify('분류를 조정했습니다.');
    }); break;
    case 'attach': $('#file-input').click(); break;
    case 'submit-statement':
      if (!state.draftText.trim()) { notify('맡은 활동을 먼저 작성해 주세요.'); $('#statement-text').focus(); break; }
      openModal('이 내용으로 서술을 제출할까요?', 'SUBMISSION / 1회 제출 확인', `<p class="offline-story" style="white-space:pre-wrap">${esc(state.draftText)}</p><p class="caption-note">첨부 파일 ${state.draftFiles.length}개</p><div class="notice-amber mt24">제출 후에는 수정할 수 없습니다.</div>`, '작성한 내용은 기여율에 자동 반영되지 않습니다.', false, '<div class="flex gap8"><button class="button small" data-action="close-modal">계속 작성</button><button class="button primary small" data-action="confirm-submit">제출하기</button></div>');
      break;
    case 'confirm-submit': run(async () => {
      const files = await Promise.all(state.draftFiles.map(async f => ({ name: f.name, mime: f.type, data: await readFileB64(f) })));
      const team = await api(`/teams/${t.id}/statements`, { method: 'POST', body: { member_id: me().id, text: state.draftText, files } });
      state.draftText = ''; state.draftFiles = [];
      closeModal(); await refreshTeam(team); notify('서술을 제출했습니다.');
    }); break;
  }
});

document.addEventListener('change', e => {
  const el = e.target;
  if (el.id === 'member-filter') { state.member = el.value; render(); }
  if (el.id === 'me-select') { store.set(`me:${state.team.id}`, el.value); render(); }
  if (el.id === 'preset-select' && el.value !== '') { const p = PRESETS[el.value]; state.draftWeights = { categories: [...p.categories], weights: [...p.weights] }; render(); }
  if (el.id === 'file-input') {
    const files = [...el.files].slice(0, 5);
    if (files.some(f => f.size > 5 * 1024 * 1024)) return notify('파일은 5MB 이하여야 합니다.');
    state.draftFiles = files; render();
  }
});

document.addEventListener('input', e => {
  const el = e.target;
  if (el.id === 'statement-text') { state.draftText = el.value; $('#char-count').textContent = el.value.length; }
  if (el.dataset.w) {
    const d = state.draftWeights;
    if (el.dataset.w === 'cat') d.categories[el.dataset.i] = el.value;
    else d.weights[el.dataset.i] = Number(el.value);
    const sum = d.weights.reduce((a, b) => a + (Number(b) || 0), 0);
    $('#w-sum').textContent = `합계 ${sum}%`;
    $('#w-sum').className = sum === 100 ? 'green' : 'sum-bad';
  }
});

$('#modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal(); });
window.addEventListener('hashchange', route);
route();
