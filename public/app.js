'use strict';
const $ = s => document.querySelector(s);
const icon = (name, cls = '') => `<svg class="icon ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tag = (text, kind = 'gray') => `<span class="tag ${kind}">${text}</span>`;
const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};

const AXES = ['산출물 생성', '산출물 개선', '조율/관리', '의사소통'];
const AXIS_SHORT = ['생성', '개선', '조율', '소통'];
const AXIS_DESC = ['새 결과물을 만듦 · 문서 작성, 커밋, 슬라이드 추가', '남의 결과물을 수정·보완 · 문서 편집, PR 리뷰, 오탈자 수정', '팀 진행을 움직임 · 일정 등록, 태스크 배분, 회의 소집', '논의 참여 · 댓글, 메시지, 피드백'];
const PRESETS = [
  { title: '균형 (기본값)', weights: [30, 25, 25, 20] },
  { title: '개발 프로젝트', weights: [40, 30, 15, 15] },
  { title: '기획·조사', weights: [35, 20, 25, 20] },
];
const BASIS = ['직접 관찰', '함께 수행', '산출물 확인', '전해 들음', '관찰 못 함'];
const COLORS = ['a1', 'a2', 'a3', 'a4'];
const DISCLAIMER = '본 리포트는 성적을 산출하지 않습니다. 최종 평가는 교수님의 판단에 따릅니다.';

// 팀별 초대 키 { teamId: { prof?, member?, name? } } — 이 브라우저에만 저장
const keys = (() => { try { return JSON.parse(store.get('hmk-keys') || '{}'); } catch { return {}; } })();
const saveKeys = () => store.set('hmk-keys', JSON.stringify(keys));

const state = {
  teams: [], team: null, records: null, report: null,
  view: 'home', tool: 'all', member: 'all',
  draftWeights: null, draftText: '', draftFiles: [], busy: false,
};

const asOf = id => {
  const k = keys[id] || {};
  const pref = store.get(`hmk-as:${id}`);
  return pref === 'student' && k.member ? 'student' : k.prof ? 'professor' : k.member ? 'student' : null;
};
const keyOf = id => { const k = keys[id] || {}; return asOf(id) === 'professor' ? k.prof : k.member; };

async function api(path, options = {}, teamId = state.team?.id) {
  const headers = options.body ? { 'Content-Type': 'application/json' } : {};
  const key = options.key || (teamId && keyOf(teamId));
  if (key) headers['X-Key'] = key;
  const res = await fetch(`/api${path}`, { method: options.method || 'GET', headers, body: options.body ? JSON.stringify(options.body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || '요청에 실패했습니다.'), { status: res.status });
  return data;
}

// ---------- helpers ----------
const isProf = () => state.team?.role === 'professor';
const me = () => state.team?.members.find(m => m.id === state.team.me_id);
const memberBy = id => state.team.members.find(m => m.id === id);
const colorOf = m => COLORS[state.team.members.indexOf(m) % COLORS.length];
const avatar = m => m ? `<span class="avatar ${colorOf(m)}">${esc(m.name.slice(-2))}</span>` : `<span class="avatar">?</span>`;
const toDate = d => new Date(d.includes('T') || d.includes('Z') ? d : d.replace(' ', 'T') + 'Z');
const fmtDate = d => d ? toDate(d).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' }) : '';
const fmtDay = d => d ? toDate(d).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\s/g, '').replace(/\.$/, '') : '';
const fmtFull = d => d ? toDate(d).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }) : '';
const toolLogo = tool => `<span class="tool-logo ${esc(tool.toLowerCase())}">${tool === 'GitHub' ? icon('github') : tool === 'Notion' ? 'N' : icon('file', 'sm')}</span>`;
const weightBar = (ws = state.team.weights) =>
  `<div class="weight-bar" aria-label="${AXES.map((c, i) => `${c} ${ws[i]}%`).join(', ')}">${ws.map((w, i) => w ? `<div class="weight-segment" style="width:${w}%">${AXIS_SHORT[i]} <span>${w}</span></div>` : '').join('')}</div>`;
const lockLabel = t => `교수 설정 · 학생 의견 ${t.accepted_opinions}건 반영 · ${fmtDay(t.locked_at)} 잠금`;
const inviteUrl = key => `${location.origin}/#/join/${key}`;

function weeks(t) {
  const start = new Date(`${t.start_date || t.created_at.slice(0, 10)}T00:00:00+09:00`);
  const end = new Date(`${t.deadline}T00:00:00+09:00`);
  const out = ['전체 기간'];
  for (let d = new Date(start), n = 1; d <= end && n <= 20; d.setDate(d.getDate() + 7), n++) out.push(`${n}주차 (${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}~)`);
  return out;
}

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
  const [, kind, id, view] = location.hash.split('/');
  closeModal();
  $('.sidebar').classList.remove('mobile-open');
  state.report = null; state.records = null;
  try {
    if (kind === 'join' && id) {
      const j = await api(`/join/${id}`, {}, null);
      keys[j.team_id] = { ...keys[j.team_id], ...(j.role === 'professor' ? { prof: id } : { member: id, name: j.name }) };
      saveKeys();
      store.set(`hmk-as:${j.team_id}`, j.role);
      history.replaceState(null, '', `#/team/${j.team_id}`); // 키가 주소창·기록에 남지 않게
      return route();
    }
    if (kind !== 'team' || !id) {
      state.team = null; state.view = 'home';
      state.teams = (await Promise.all(Object.keys(keys).map(tid => api(`/teams/${tid}`, {}, tid).catch(e => (e.status === 403 || e.status === 404 ? (delete keys[tid], null) : null))))).filter(Boolean);
      saveKeys();
    } else {
      if (!keyOf(id)) { notify('초대 링크로 들어와야 볼 수 있는 팀입니다.'); return (location.hash = '#/'); }
      state.team = await api(`/teams/${id}`, {}, id);
      state.draftWeights = null;
      const t = state.team;
      const allowed = isProf() ? ['report', 'evidence', 'setup'] : ['setup', 'evidence', 'statement', 'peer'];
      state.view = !isProf() && !me().consented_at ? 'consent' : allowed.includes(view) ? view : allowed[0];
      if (!isProf() && t.closed && !view && me().consented_at) state.view = t.reviewed ? 'statement' : 'peer';
      await loadViewData();
    }
  } catch (e) {
    notify(e.message);
    if (e.status === 404 || e.status === 403) return (location.hash = '#/');
  }
  render();
  window.scrollTo({ top: 0 });
}

async function loadViewData() {
  const t = state.team;
  if (state.view === 'report' && t.closed) state.report = await api(`/teams/${t.id}/report`);
  if ((state.view === 'evidence' || state.view === 'peer') && (isProf() || t.closed)) state.records = await api(`/teams/${t.id}/records`);
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
  const who = !t ? '' : isProf() ? '교수' : me()?.name.slice(-2);
  $('#header-right').innerHTML = t ? `<span class="prototype-label">${isProf() ? '교수 화면' : `${esc(me()?.name)} · 학생 화면`}</span><span class="avatar current">${esc(who)}</span>` : '';
  const nav = [['#/', 'users', '내 팀 목록', !t]];
  if (t) {
    const tabs = isProf()
      ? [['report', 'chart', '기여도 리포트'], ['evidence', 'folder', '활동 근거'], ['setup', 'lock', '착수 설정']]
      : me().consented_at
        ? [['setup', 'lock', '착수 설정'], ['evidence', 'folder', '활동 기록'], ['statement', 'pencil', '자기 기술'], ['peer', 'message', '동료평가']]
        : [['consent', 'shield', '개인정보 동의']];
    for (const [v, ic, label] of tabs) nav.push([`#/team/${t.id}/${v}`, ic, label, state.view === v]);
  }
  const [statusText, dot] = !t ? [] : t.closed ? ['마감 · 산출 완료', '#358976'] : t.locked_at ? ['진행 중 · 기록 수집', '#4b7cf3'] : ['착수 설정 중', '#d39b3a'];
  $('#side-team').innerHTML = t ? `<a class="side-team" href="#/team/${t.id}"><small>${esc(t.course)} · ${esc(t.name)}</small><strong>${esc(t.project)}</strong><span class="status" style="--dot:${dot}"><i></i>${statusText}</span></a>` : '';
  $('#side-nav').innerHTML = nav.map(([href, ic, label, active]) => `<a class="nav-item ${active ? 'active' : ''}" href="${href}" ${active ? 'aria-current="page"' : ''}>${icon(ic)}${label}</a>`).join('');
  $('#bottom-nav').innerHTML = nav.map(([href, ic, label, active]) => `<a class="${active ? 'active' : ''}" href="${href}" aria-label="${label}" style="display:grid;place-items:center">${icon(ic)}<span>${label}</span></a>`).join('');
}

// 같은 브라우저에 교수·학생 키가 모두 있을 때만 (시연용) 화면 전환
function roleSwitch() {
  const t = state.team;
  const k = keys[t.id] || {};
  if (!(k.prof && k.member)) return '';
  const prof = isProf();
  return `<div class="role-switch" role="group" aria-label="화면 전환"><button data-action="as" data-as="professor" class="${prof ? 'selected' : ''}" aria-pressed="${prof}">교수 화면</button><button data-action="as" data-as="student" class="${prof ? '' : 'selected'}" aria-pressed="${!prof}">${esc(k.name || '학생')} 화면</button></div>`;
}

function projectStrip() {
  const t = state.team;
  const status = t.closed ? tag(`${icon('check', 'sm')} 마감 · 산출 가능`, 'green') : t.locked_at ? tag(`${icon('lock', 'sm')} 착수 설정 완료`, 'green') : tag('착수 설정 중', 'amber');
  return `<div class="project-strip"><div class="flex gap12"><span class="project-icon">${icon('folder')}</span><div><div class="project-title">${esc(t.project)}</div><div class="project-meta"><span>${esc(t.course)}</span><span class="sep"></span><span>${esc(t.name)} · ${t.members.length}명</span>${t.repo ? `<span class="sep"></span><span>${esc(t.repo)}</span>` : ''}</div></div></div><div class="flex gap16"><span class="deadline">마감<strong>${esc(t.deadline)}</strong></span>${status}</div></div>`;
}

const TITLES = { home: ['내 팀 목록', '초대 링크로 들어온 팀이 이 브라우저에 표시됩니다.'], consent: ['개인정보 수집·이용 동의', '착수 설정 전에 먼저 확인해 주세요.'], report: ['기여도 리포트', '연결된 도구의 기록과 교수가 잠근 가중치로 산출한 참고 자료입니다.'], evidence: ['활동 근거', '어떤 작업이 어느 축에 연결됐는지 확인하세요.'], setup: ['착수 설정', '동의 → 도구 연결 → 교수 가중치 설정 → 학생 확인·의견 → 교수 잠금'], statement: ['자기 기술', '온라인에 남지 않은 나의 기여를 마감 후 1회 남깁니다.'], peer: ['익명 동료평가', '"누가 몇 점"이 아니라 "누가 무엇을 했는가"를 적습니다.'] };

function render() {
  renderChrome();
  const t = state.team;
  const [title, subtitle] = TITLES[state.view];
  const exportBtn = t && isProf() && state.view === 'report' && state.report ? `<button class="button" data-action="export">${icon('download', 'sm')} PDF 내보내기</button>` : '';
  const view = { home: homeView, consent: consentView, report: reportView, evidence: evidenceView, setup: setupView, statement: statementView, peer: peerView }[state.view]();
  $('#content').innerHTML = `<div class="page-heading"><div class="heading-main"><span class="heading-icon">${icon('users')}</span><div><h1>${title}</h1><p class="page-subtitle">${subtitle}</p></div></div><div class="page-actions">${t ? roleSwitch() : ''}${exportBtn}</div></div>${t ? projectStrip() : ''}<section id="view-panel">${view}</section><footer class="page-foot"><span>${DISCLAIMER}</span><span>Team HMK</span></footer>`;
  document.title = `한만큼 · ${t ? `${t.name} ${title}` : title}`;
}

// ---------- views ----------
function homeView() {
  const tiles = state.teams.map(t => `<div class="card project-tile"><a class="flex gap16" style="flex:1;min-width:0" href="#/team/${t.id}"><span class="project-icon">${icon('users', 'lg')}</span><div><h2>${esc(t.project)}</h2><div class="project-meta"><span>${esc(t.course)}</span><span class="sep"></span><span>${esc(t.name)} · ${t.members.length}명</span><span class="sep"></span><span>${t.role === 'professor' ? '교수' : `학생 · ${esc(t.members.find(m => m.id === t.me_id)?.name)}`}</span></div></div><div class="right flex gap16">${t.closed ? tag('마감', 'green') : t.locked_at ? tag('진행 중', 'blue') : tag('착수 설정 중', 'amber')}${icon('chevron')}</div></a>${t.role === 'professor' ? `<button class="icon-button" data-action="delete-team" data-id="${t.id}" data-name="${esc(t.project)} · ${esc(t.name)}" aria-label="팀 삭제" title="팀 삭제">${icon('close')}</button>` : ''}</div>`).join('');
  return `<div class="list-projects"><div class="flex gap8"><button class="button primary" data-action="new-team">${icon('users', 'sm')} 새 팀 프로젝트 만들기 (교수)</button><button class="button soft" data-action="demo">시연용 예시 팀 불러오기</button></div>${tiles || `<div class="card empty">${icon('folder', 'lg')}<p class="mt16">아직 이 브라우저에 연결된 팀이 없습니다.<br>교수님은 새 팀을 만들고, 학생은 받은 초대 링크로 들어오세요.</p></div>`}</div>`;
}

// 작업 1: 개인정보 수집·이용 동의 (학생 첫 화면, 미동의 시 다른 화면 차단)
function consentView() {
  return `<div class="setup-grid"><div class="stack"><section class="card student-form"><h2>개인정보 수집·이용 동의</h2><p class="card-desc" style="margin-top:10px">한만큼은 팀 프로젝트 기간 동안 아래 정보를 수집합니다.</p><ul class="bullet-copy mt16"><li><strong>수집 항목:</strong> 연결된 협업 도구(Notion 등)의 편집 이벤트(편집한 사람·시각·페이지), 팀원 식별용 이메일, 동료평가 폼 응답</li><li><strong>수집하지 않는 것:</strong> 편집한 문서의 본문 내용, 카카오톡 등 대화 내용</li><li><strong>수집 목적:</strong> 팀 기여도 근거 자료 생성 (성적은 교수가 결정하며 자동 반영되지 않습니다)</li><li><strong>수집 기간:</strong> 착수(기준 잠금) ~ 프로젝트 마감. 마감 후 종료</li><li><strong>동의를 거부할 권리가 있으며,</strong> 거부 시 서비스 이용이 제한될 수 있습니다.</li></ul><label class="flex gap8 mt24" style="font-size:13px;font-weight:600;cursor:pointer"><input type="checkbox" id="consent-check" style="width:18px;height:18px"> 위 내용을 확인했으며, 개인정보 수집·이용에 동의합니다. (필수)</label><div class="form-foot"><span></span><button class="button primary" data-action="consent" id="consent-next" disabled>다음</button></div></section></div><aside class="stack aside-stack">${teamCard()}</aside></div>`;
}

function scopeCard() {
  const t = state.team;
  return `<section class="card scope-card"><h2>어디까지 측정하나요?</h2><div class="scope-line">${icon('link')}<div><strong>연결된 온라인 작업 기록</strong><p>${esc(t.tools.join(' · '))}</p></div></div><div class="scope-line">${icon('user')}<div><strong>발표 수행·시연은 교수님 관찰</strong><p>온라인 기여율 산출에서 제외</p></div></div><div class="scope-line">${icon('message')}<div><strong>오프라인 기여는 자기 기술·동료평가로</strong><p>기여율에 자동 반영하지 않음 · 대화 내용 미수집</p></div></div></section>`;
}

function teamCard() {
  return `<section class="card team-card"><div class="card-top"><h2>함께하는 팀원</h2><span class="team-count">${icon('user')} ${state.team.members.length}</span></div>${state.team.members.map(m => `<div class="team-person">${avatar(m)}<div><p class="student-name">${esc(m.name)}</p><p class="student-role">${esc(m.role || '')}${m.github ? ` · @${esc(m.github)}` : ''}</p></div></div>`).join('')}</section>`;
}

function axisCard() {
  return `<section class="card scope-card"><h2>기여 4축</h2>${AXES.map((a, i) => `<div class="scope-line"><span class="count-circle">${i + 1}</span><div><strong>${a}</strong><p>${AXIS_DESC[i]}</p></div></div>`).join('')}</section>`;
}

function collectCard() {
  const t = state.team;
  return `<section class="card card-pad"><div class="between"><h2>기록 수집 현황</h2>${t.collected_at ? tag(`최근 수집 ${fmtFull(t.collected_at)}`, 'gray') : tag('아직 수집 전', 'amber')}</div><div class="status-grid"><div><strong>${t.record_count}</strong><span>수집된 작업 기록</span></div><div><strong>${t.record_count - t.unmatched}</strong><span>팀원과 연결됨</span></div><div><strong class="${t.unmatched ? 'sum-bad' : ''}">${t.unmatched}</strong><span>계정 미매칭</span></div></div><div class="flex gap8 mt16">${t.repo ? `<button class="button primary small" data-action="collect" ${t.locked_at ? '' : 'disabled'}>${icon('github', 'sm')} GitHub 기록 수집</button>` : ''}<button class="button small" data-action="add-record" ${t.locked_at ? '' : 'disabled'}>${icon('link', 'sm')} 작업 링크 추가</button></div>${t.locked_at ? '' : '<p class="caption-note">착수 기준을 잠근 뒤 수집할 수 있습니다.</p>'}</section>`;
}

const axisCaption = counts => counts.map((n, i) => `${AXIS_SHORT[i]} ${n}`).join(' · ');

// 작업 4: 리포트
function reportView() {
  const t = state.team;
  if (!t.closed) {
    return `<div class="report-grid"><div class="stack"><div class="setup-banner"><div class="lock-symbol">${icon('clock', 'lg')}</div><div><h2>학기 중에는 기여율을 산출하지 않습니다</h2><p>${esc(t.deadline)} 마감 후 1회 산출합니다. 그 전까지는 기록만 조용히 모읍니다. 학생에게 알림·점수·순위를 보여주지 않습니다.</p></div></div>${collectCard()}<section class="card card-pad"><h2>시연용 마감 처리</h2><p class="card-desc">마감일 전에 결과를 보여줘야 할 때 사용합니다. 마감 후 학생의 자기 기술과 익명 동료평가가 열립니다.</p><button class="button soft small mt16" data-action="close" ${t.locked_at ? '' : 'disabled'}>${icon('lock', 'sm')} 지금 마감 처리</button></section></div><aside class="stack aside-stack">${teamCard()}${scopeCard()}</aside></div>`;
  }
  const { scores, reviews } = state.report;
  const rows = t.members.map((m, i) => {
    const s = scores.find(x => x.member_id === m.id);
    return `<button class="contribution-row" data-action="member" data-id="${m.id}" aria-label="${esc(m.name)}, 기여율 ${s.score}%, 상세 보기">${avatar(m)}<div><div class="student-name">${esc(m.name)}</div><div class="student-role">${esc(m.role || '')}</div></div><div><div class="progress-track" role="img" aria-label="기여율 ${s.score}%"><div class="progress-fill p${(i % 4) + 1}" style="width:${s.score}%"></div></div><div class="progress-caption">${s.score === 0 ? '<span style="color:#b29662">연결된 도구에 기록 없음 · 자기 기술·동료평가 확인</span>' : axisCaption(s.counts)}</div></div><div class="score ${s.score === 0 ? 'zero' : ''}">${s.score}<span class="unit">%</span></div><span class="row-arrow">${icon('chevron', 'sm')}</span></button>`;
  }).join('');
  const end = t.closed_at && t.closed_at < `${t.deadline} 23:59:59` ? fmtDay(t.closed_at) : t.deadline.replace(/-/g, '.');
  const statements = t.statements.map(st => {
    const m = memberBy(st.member_id);
    return `<div class="offline-head mt16">${avatar(m)}<div><p class="student-name">${esc(m?.name)}</p><p class="student-role">${fmtFull(st.created_at)} 제출</p></div></div><p class="offline-story">${esc(st.text).replace(/\n/g, '<br>')}</p>${fileChips(st)}`;
  }).join('');
  const testimonyTargets = t.members.filter(m => reviews.some(r => r.target_id === m.id && r.basis !== '관찰 못 함'));
  return `<div class="report-grid"><div class="stack"><div class="notice-strong">${icon('info')}<strong>${DISCLAIMER}</strong></div><section class="card card-pad"><h2>팀 요약</h2><dl class="record-metadata"><dt>분석 기간</dt><dd>${esc((t.start_date || '').replace(/-/g, '.'))} ~ ${end}</dd><dt>연동 도구</dt><dd>${esc(t.tools.join(' · '))}</dd><dt>적용 가중치</dt><dd>${AXES.map((a, i) => `${a} ${t.weights[i]}%`).join(' · ')}</dd><dt>기준</dt><dd>${lockLabel(t)}</dd></dl></section><section class="card chart-card"><div class="card-top"><div><h2>팀원별 기여율</h2><p class="card-desc">4축별 팀 내 상대비율 × 교수가 잠근 가중치 · 팀 합계 100%</p></div>${tag('로그 기반 · 검증된 수치', 'blue')}</div><div class="chart-legend"><span><i class="legend-dot"></i> 연결된 도구의 기록만 반영</span><span>팀원을 선택해 상세 보기 ${icon('chevron', 'sm')}</span></div><div>${rows}</div>${scores.some(s => s.score === 0) ? `<div class="reference-banner">${icon('info')}<span><strong>0%는 연결된 도구에 기록이 없다는 뜻입니다.</strong><br>오프라인 기여는 아래 자기 기술·동료 증언과 교수님의 관찰로 확인해 주세요.</span></div>` : ''}${t.unmatched ? `<div class="reference-banner">${icon('info')}<span>팀원 계정과 연결되지 않은 기록 <strong>${t.unmatched}건</strong>이 산출에서 빠져 있습니다. 활동 근거 탭에서 작성자를 지정할 수 있습니다.</span></div>` : ''}</section><section class="card weight-card"><div class="card-top"><div class="flex gap8"><h2>적용 가중치</h2>${icon('lock', 'sm')}</div><button class="button text small" data-action="method">산출 기준 보기 ${icon('chevron', 'sm')}</button></div>${weightBar()}<div class="weight-foot"><span class="flex gap8">${icon('check', 'sm')} ${lockLabel(t)}</span></div></section><section class="card unverified"><div class="card-top"><h2>동료 증언 <span class="offline-count">${reviews.filter(r => r.basis !== '관찰 못 함').length}</span></h2>${tag('검증되지 않은 참고 자료', 'amber')}</div><p class="card-desc">익명 동료평가 응답입니다. 기여율에 자동 반영하지 않으며, 로그와 중복 가산하지 않습니다. 응답 ${t.review_count}/${t.members.length}명.</p>${testimonyTargets.map(m => `<button class="testimony-row" data-action="member" data-id="${m.id}">${avatar(m)}<span><strong>${esc(m.name)}</strong> · 증언 ${reviews.filter(r => r.target_id === m.id && r.basis !== '관찰 못 함').length}건 · ${[...new Set(reviews.filter(r => r.target_id === m.id && r.basis !== '관찰 못 함').map(r => AXIS_SHORT[r.axis]))].join('·')}</span>${icon('chevron', 'sm')}</button>`).join('') || '<p class="caption-note">아직 제출된 동료 증언이 없습니다.</p>'}</section><section class="card offline-card"><div class="card-top"><h2>자기 기술 <span class="offline-count">${t.statements.length}</span></h2>${tag('학생 본인 서술', 'amber')}</div>${statements || '<p class="card-desc">아직 제출된 자기 기술이 없습니다.</p>'}<p class="caption-note">자기 기술은 기여율에 자동 반영되지 않습니다.</p></section><section class="print-only print-table"><h2>팀원별 산출 근거</h2><table><thead><tr><th>팀원</th>${AXES.map(c => `<th>${c}</th>`).join('')}<th>기여율</th></tr></thead><tbody>${t.members.map(m => { const s = scores.find(x => x.member_id === m.id); return `<tr><td>${esc(m.name)}</td>${s.shares.map((v, i) => `<td>${s.counts[i]}건 · ${v.toFixed(1)}%</td>`).join('')}<td>${s.score}%</td></tr>`; }).join('')}</tbody></table><p class="print-note">기여율(i) = Σ_k [ r(i,k) × w(k) ], r(i,k) = 개인 i의 축 k 활동량 ÷ 팀 전체 축 k 활동량. ${DISCLAIMER}</p></section></div><aside class="stack aside-stack">${teamCard()}${axisCard()}${scopeCard()}</aside></div>`;
}

const fileChips = st => st.files.length ? `<div class="flex gap8 mt16" style="flex-wrap:wrap">${st.files.map(f => `<a class="attachment-chip" href="/api/files/${f.id}?k=${encodeURIComponent(keyOf(state.team.id))}" target="_blank" rel="noopener noreferrer">${icon(f.mime.startsWith('image/') ? 'image' : 'paperclip')}${esc(f.name)}</a>`).join('')}</div>` : '';

function recordItem(r) {
  const m = memberBy(r.member_id);
  return `<button class="evidence-item" data-action="record" data-id="${r.id}" aria-label="${esc(r.title)} 근거 상세 보기">${toolLogo(r.tool)}<div><div class="evidence-title">${esc(r.title)}</div><div class="evidence-meta">${m ? esc(m.name) : `<span class="sum-bad">미매칭${r.login ? ` ${r.tool === 'GitHub' ? '@' : ''}${esc(r.login)}` : ''}</span>`} · ${esc(r.tool)} · ${esc(r.kind)}${r.classified_by === 'ai' ? ' · AI 분류' : ''}</div></div><div class="evidence-end">${tag(esc(AXES[r.type] ?? '미분류'), r.type === 0 ? 'blue' : 'gray')}<p>${fmtDate(r.date)}</p></div>${icon('chevron', 'sm')}</button>`;
}

function evidenceView() {
  const t = state.team;
  if (!state.records) {
    return `<div class="setup-grid"><div class="stack"><div class="hero-dark"><div class="check">${icon('check')}</div><h2>지금은 조용한 상태</h2><p>학기 중에는 알림도 점수도 없어요. 평소처럼 작업하면 됩니다.</p></div>${t.locked_at ? `<section class="card card-pad"><h2>연결된 도구에 남지 않는 작업이 있나요?</h2><p class="card-desc">Google Docs 등에서 작업한 문서 링크를 남겨 두면 마감 후 근거로 함께 확인됩니다.</p><button class="button soft small mt16" data-action="add-record">${icon('link', 'sm')} 작업 링크 추가</button></section>` : ''}</div><aside class="stack aside-stack">${axisCard()}${scopeCard()}</aside></div>`;
  }
  const base = isProf() ? state.records : state.records.filter(r => r.member_id === t.me_id);
  const list = base.filter(r => (state.tool === 'all' || r.tool === state.tool) && (state.member === 'all' || String(r.member_id) === state.member));
  const tools = ['all', ...new Set(base.map(r => r.tool))];
  return `<div class="report-grid"><section class="card card-pad"><div class="evidence-summary"><div><h2>${isProf() ? '기여율에 연결된 작업 기록' : '나의 작업 기록'}</h2><p>어떤 작업이 어느 축에 연결됐는지 확인하세요.</p></div>${tag(`전체 ${base.length}건`, 'gray')}</div><div class="filter-bar"><div class="filter-group" role="group" aria-label="도구 필터">${tools.map(x => `<button class="filter ${state.tool === x ? 'active' : ''}" data-action="filter" data-tool="${esc(x)}" aria-pressed="${state.tool === x}">${x === 'all' ? '전체 도구' : esc(x)}</button>`).join('')}</div>${isProf() ? `<select class="select-control" id="member-filter" aria-label="팀원 선택"><option value="all">전체 팀원</option>${t.members.map(m => `<option value="${m.id}" ${state.member === String(m.id) ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}<option value="null" ${state.member === 'null' ? 'selected' : ''}>계정 미매칭</option></select>` : ''}</div><div class="between" style="font-size:10px;color:#929bac;margin-bottom:11px"><span>선택한 기록 <strong class="blue">${list.length}</strong>건</span><span>최신 활동순</span></div><div class="evidence-list">${list.length ? list.map(recordItem).join('') : `<div class="empty">${icon('folder', 'lg')}<p class="mt16">선택한 조건에 해당하는 기록이 없습니다.</p><button class="button text mt16" data-action="reset-filters">필터 초기화</button></div>`}</div></section><aside class="stack aside-stack">${isProf() ? collectCard() : ''}${axisCard()}</aside></div>`;
}

function weightEditor() {
  const d = state.draftWeights || [...state.team.weights];
  state.draftWeights = d;
  const sum = d.reduce((a, b) => a + (Number(b) || 0), 0);
  return `<div class="mt16" id="weight-editor"><div class="flex gap8" style="flex-wrap:wrap;margin-bottom:12px">${PRESETS.map((p, i) => `<button class="button small ${p.weights.every((w, j) => w === Number(d[j])) ? 'soft' : ''}" data-action="preset" data-i="${i}">${p.title} · ${p.weights.join('/')}</button>`).join('')}</div>${AXES.map((a, i) => `<div class="weight-row" style="grid-template-columns:1fr 90px"><span><strong style="font-size:13px">${a}</strong><br><small class="muted">${AXIS_DESC[i]}</small></span><input class="input" type="number" min="0" max="100" data-w="${i}" value="${d[i]}" aria-label="${a} 가중치"></div>`).join('')}<div class="between mt16"><span id="w-sum" class="${sum === 100 ? 'green' : 'sum-bad'}">합계 ${sum}%</span><button class="button primary small" data-action="w-save">가중치 저장</button></div><p class="caption-note">저장하면 학생 확인이 초기화되어 다시 확인받아야 합니다.</p></div>`;
}

function notionSetup() {
  const t = state.team;
  if (t.closed) return '';
  const editable = m => isProf() || t.me_id === m.id;
  return `<div class="mt16">${isProf() ? `<div class="field" style="margin-bottom:6px">Notion 팀 페이지 링크</div><div class="flex gap8"><input class="input" id="notion-url" type="url" placeholder="https://www.notion.so/..." value="${t.notion_page ? 'https://www.notion.so/' + t.notion_page.replace(/-/g, '') : ''}"><button class="button small" data-action="save-notion">저장</button></div><p class="caption-note">이 페이지와 하위 페이지를 <strong>한만큼</strong> 연결에 공유해 주세요(페이지 ··· → 연결 추가). 같은 날 같은 페이지 편집은 1건으로 합칩니다.</p>` : ''}<div class="field mt16" style="margin-bottom:6px">Notion 계정 이메일 (편집자 식별용)</div>${t.members.filter(editable).map(m => `<div class="weight-row" style="grid-template-columns:90px 1fr 60px"><span class="student-name">${esc(m.name)}</span><input class="input" type="email" data-notion-email="${m.id}" value="${esc(m.notion_email || '')}" placeholder="notion 로그인 이메일"><button class="button small" data-action="save-notion-email" data-id="${m.id}">저장</button></div>`).join('')}</div>`;
}

const statusIcon = (ok, label) => `<span class="consent-person" style="${ok ? '' : 'opacity:.55'}">${icon(ok ? 'check' : 'clock')} ${label}</span>`;

function opinionItem(o, prof) {
  const m = memberBy(o.member_id);
  const st = { pending: tag('검토 대기', 'gray'), accepted: tag('반영', 'green'), rejected: tag('기각', 'amber') }[o.status];
  return `<div class="opinion"><div class="between"><span class="student-name">${prof ? esc(m?.name) : '내 의견'} · <span class="muted" style="font-weight:400">${fmtFull(o.created_at)}</span></span>${st}</div><p class="offline-story" style="margin-top:6px">${esc(o.text)}</p>${o.reply ? `<p class="caption-note" style="margin-top:4px">교수 답변: ${esc(o.reply)}</p>` : ''}${prof && !state.team.locked_at ? `<div class="flex gap8 mt16"><input class="input" data-reply="${o.id}" placeholder="답변 (선택)" maxlength="300" value="${esc(o.reply || '')}"><button class="button small soft" data-action="opinion" data-id="${o.id}" data-status="accepted">반영</button><button class="button small" data-action="opinion" data-id="${o.id}" data-status="rejected">기각</button></div>` : ''}</div>`;
}

function setupView() {
  const t = state.team;
  const prof = isProf();
  const nConsent = t.members.filter(m => m.consented_at).length;
  const nConfirm = t.members.filter(m => m.confirmed_at).length;
  const all = n => n === t.members.length;
  const stepTools = `<section class="card setup-step"><div class="between"><h2><span class="count-circle">2</span>작업 도구 연결</h2>${tag(t.tools.filter(x => x !== '수동 기록').join(' · ') || '미연결', t.repo || t.notion_page ? 'green' : 'gray')}</div><p class="card-desc">팀이 실제 사용하는 도구의 편집 이벤트만 수집합니다. 문서 본문과 대화 내용은 수집하지 않습니다.</p><div class="tool-connections"><div class="connection">${toolLogo('GitHub')}<span class="name">${t.repo ? esc(t.repo) : 'GitHub'}</span>${tag(t.repo ? '자동 수집' : '미연결', t.repo ? 'green' : 'gray')}</div><div class="connection">${toolLogo('Notion')}<span class="name">${t.notion_page ? 'Notion 팀 페이지' : 'Notion'}</span>${tag(t.notion_page ? '웹훅 수집' : '미연결', t.notion_page ? 'green' : 'gray')}</div><div class="connection">${toolLogo('Docs')}<span class="name">Google Docs 등</span>${tag('링크 기록', 'blue')}</div></div>${notionSetup()}</section>`;
  const stepWeights = `<section class="card setup-step"><div class="between"><h2><span class="count-circle">3</span>4축 가중치 ${prof ? '설정' : '확인'}</h2>${t.locked_at ? tag(`${icon('lock', 'sm')} 잠금 완료`, 'green') : tag('교수 설정', 'blue')}</div><p class="card-desc">${prof ? '프리셋을 고르거나 직접 입력하세요. 4축 합계는 100%여야 합니다.' : '가중치는 교수님이 설정합니다. 확인 후 의견이 있으면 남겨 주세요.'}</p>${prof && !t.locked_at ? weightEditor() : `<div class="mt24">${weightBar()}</div><div class="axis-legend">${AXES.map((a, i) => `<span><strong>${a} ${t.weights[i]}%</strong> · ${AXIS_DESC[i]}</span>`).join('')}</div>`}</section>`;
  const mine = me();
  const myOps = t.opinions;
  const stepConfirm = prof
    ? `<section class="card setup-step"><div class="between"><h2><span class="count-circle">4</span>학생 확인 · 의견</h2>${tag(`확인 ${nConfirm} / ${t.members.length}`, all(nConfirm) ? 'green' : 'gray')}</div><div class="consent-list">${t.members.map(m => statusIcon(m.confirmed_at, `${esc(m.name)} ${m.confirmed_at ? '확인' : '대기'}`)).join('')}</div><div class="detail-section-title"><h3>학생 의견 <span class="muted">${myOps.length}</span></h3></div>${myOps.map(o => opinionItem(o, true)).join('') || '<p class="caption-note">아직 제출된 의견이 없습니다.</p>'}</section>`
    : `<section class="card setup-step"><div class="between"><h2><span class="count-circle">4</span>확인 · 의견 제출</h2>${mine.confirmed_at ? tag('확인 완료', 'green') : tag('확인 필요', 'amber')}</div>${t.locked_at ? '<p class="card-desc">기준이 잠겼습니다. 마감 전까지 변경되지 않습니다.</p>' : `<div class="flex gap8 mt16"><button class="button primary small" data-action="confirm" ${mine.confirmed_at ? 'disabled' : ''}>${mine.confirmed_at ? '확인 완료' : '가중치를 확인했습니다'}</button></div><label class="field mt24" for="opinion-text">가중치에 대한 의견 (선택)</label><textarea id="opinion-text" class="textarea" maxlength="500" style="min-height:80px" placeholder="예: 우리 팀은 문서 작업이 많아 산출물 개선 비중이 더 높았으면 합니다."></textarea><div class="form-foot"><span class="caption-note" style="margin:0">의견은 교수님께만 전달됩니다.</span><button class="button small" data-action="opinion-submit">의견 제출</button></div>`}${myOps.map(o => opinionItem(o, false)).join('')}</section>`;
  const stepLock = prof ? `<section class="card setup-step"><div class="between"><h2><span class="count-circle">5</span>교수 잠금</h2>${t.locked_at ? tag(`${icon('lock', 'sm')} 잠금`, 'green') : ''}</div>${t.locked_at ? `<p class="card-desc">${lockLabel(t)}. 학기 중 변경할 수 없습니다.</p>` : `<p class="card-desc">팀원 전원의 동의와 가중치 확인이 끝나면 잠글 수 있습니다. 잠근 뒤부터 기록을 수집합니다.</p><button class="button primary small mt16" data-action="lock" ${all(nConsent) && all(nConfirm) ? '' : 'disabled'}>${icon('lock', 'sm')} 기준 잠그기</button>${all(nConsent) ? '' : '<p class="caption-note">개인정보 동의를 마치지 않은 팀원이 있습니다.</p>'}`}</section>` : '';
  const stepConsent = prof
    ? `<section class="card setup-step"><div class="between"><h2><span class="count-circle">1</span>팀원 동의 · 초대 링크</h2>${tag(`팀원 동의 ${nConsent} / ${t.members.length}`, all(nConsent) ? 'green' : 'amber')}</div><p class="card-desc">팀원마다 개인 초대 링크를 보내 주세요. 링크로 들어온 학생은 개인정보 수집·이용에 먼저 동의해야 다음으로 진행할 수 있습니다.</p>${t.members.map(m => `<div class="invite-row">${avatar(m)}<span class="student-name">${esc(m.name)}</span>${m.consented_at ? tag('동의', 'green') : tag('미동의', 'gray')}<span class="spacer"></span><button class="button small" data-action="copy" data-text="${esc(inviteUrl(m.key))}">초대 링크 복사</button><button class="button small text" data-action="view-as" data-key="${esc(m.key)}" data-name="${esc(m.name)}">이 학생으로 보기</button></div>`).join('')}</section>`
    : `<section class="card setup-step"><div class="between"><h2><span class="count-circle">1</span>개인정보 동의</h2>${tag(`${icon('check', 'sm')} ${fmtDay(mine.consented_at)} 동의`, 'green')}</div><p class="card-desc">팀원 동의 ${nConsent} / ${t.members.length}</p></section>`;
  const quiet = !prof && t.locked_at && !t.closed ? `<div class="hero-dark" style="margin-bottom:20px"><div class="check">${icon('check')}</div><h2>착수 준비 완료</h2><p>학기 중에는 알림도 점수도 없어요.<br>평소처럼 작업하면 됩니다.</p></div>` : `<div class="setup-banner"><div class="lock-symbol">${icon('lock', 'lg')}</div><div><h2>${t.locked_at ? '착수 설정이 완료되었습니다' : '착수 설정을 진행해 주세요'}</h2><p>${t.locked_at ? `${lockLabel(t)}. 마감 후 한 번만 산출합니다.` : '동의 → 도구 연결 → 교수 가중치 설정 → 학생 확인·의견 → 교수 잠금'}</p></div></div>`;
  const aside = `<section class="card card-pad"><h2 style="font-size:14px;margin-bottom:22px">진행 순서</h2><div class="timeline"><div class="timeline-item ${!all(nConsent) ? 'current' : ''}"><strong>팀원 동의</strong><p>동의 ${nConsent}/${t.members.length}</p></div><div class="timeline-item ${all(nConsent) && !t.locked_at ? 'current' : ''}"><strong>가중치 설정 · 확인 · 잠금</strong><p>교수 설정 → 학생 확인·의견 → 교수 잠금</p></div><div class="timeline-item ${t.locked_at && !t.closed ? 'current' : ''}"><strong>학기 중 · 평소처럼 작업</strong><p>알림·점수·순위 없음</p></div><div class="timeline-item ${t.closed ? 'current' : ''}"><strong>마감 후</strong><p>기여율 1회 산출 · 자기 기술 · 익명 동료평가</p></div></div></section>${prof ? `<section class="card student-note"><h3>교수용 링크</h3><p>다른 기기에서 교수 화면을 열 때 사용하세요. 학생에게 공유하지 마세요.</p><button class="button text small mt16" data-action="copy" data-text="${esc(inviteUrl(t.prof_key))}">교수 링크 복사 ${icon('link', 'sm')}</button></section>` : axisCard()}`;
  return `${quiet}<div class="setup-grid"><div class="stack">${stepConsent}${stepTools}${stepWeights}${stepConfirm}${stepLock}</div><aside class="stack aside-stack">${aside}</aside></div>`;
}

function statementView() {
  const t = state.team;
  const mine = me();
  const sent = t.statements.find(s => s.member_id === mine.id);
  const locked = !t.closed;
  const disabled = locked || sent;
  return `<div class="setup-grid"><div class="stack"><div class="setup-banner"><div class="lock-symbol">${icon(locked ? 'clock' : sent ? 'check' : 'pencil', 'lg')}</div><div><h2>${locked ? '마감 후 작성할 수 있어요' : sent ? '자기 기술이 제출되었습니다' : '기록에 남지 않은 나의 기여가 있나요?'}</h2><p>${locked ? `${esc(t.deadline)} 마감 후 열립니다.` : sent ? '교수님 리포트에 그대로 전달됩니다.' : '한 번 작성한 내용을 교수님이 참고합니다.'}</p></div></div><section class="card student-form"><div class="between"><h2>나의 자기 기술</h2>${tag(locked ? '마감 후 제출 가능' : sent ? '제출 완료' : '1회 제출', 'gray')}</div><p class="card-desc">${esc(mine.name)} · ${esc(t.name)} · ${esc(t.project)}</p><label for="statement-text">어떤 활동을 맡았나요?</label><textarea id="statement-text" class="textarea" maxlength="1000" ${disabled ? 'disabled' : ''} placeholder="예: 시연용 하드웨어 조립과 현장 세팅을 맡았고, 11/28과 12/5 오프라인 리허설을 진행했습니다.">${esc(sent ? sent.text : state.draftText)}</textarea><div class="form-status"><span id="char-count">${(sent ? sent.text : state.draftText).length}</span> / 1,000자</div><p class="caption-note">맡은 역할, 작업 날짜, 온라인 기록에 남지 않은 이유를 적어 주세요.</p><input type="file" id="file-input" accept="image/*,.pdf" multiple hidden>${sent ? fileChips(sent) : `<div class="file-list">${state.draftFiles.map(f => `<span class="attachment-chip">${icon('paperclip')}${esc(f.name)}</span>`).join('')}</div>`}<div class="form-foot"><button class="button" data-action="attach" ${disabled ? 'disabled' : ''}>${icon('paperclip', 'sm')} 사진·캡처 첨부</button><button class="button primary" data-action="submit-statement" ${disabled ? 'disabled' : ''}>${sent ? '제출 완료' : locked ? '마감 후 제출 가능' : '제출하기'}</button></div><div class="reference-banner">${icon('info')}<span>자기 기술은 기여율에 반영되지 않습니다. 작성한 그대로 교수님께 전달되며 최종 판단은 교수님께 있습니다.</span></div></section></div><aside class="stack aside-stack">${teamCard()}</aside></div>`;
}

// 작업 3: 익명 동료평가 (마감 후 1회)
function peerView() {
  const t = state.team;
  const mine = me();
  if (!t.closed) return `<div class="hero-dark"><div class="check">${icon('clock')}</div><h2>동료평가는 마감 후 열립니다</h2><p>학기 중에는 알림도 평가도 없어요. ${esc(t.deadline)} 마감 후 1회 작성합니다.</p></div>`;
  if (t.reviewed) return `<div class="setup-banner"><div class="lock-symbol">${icon('check', 'lg')}</div><div><h2>동료평가를 제출했습니다</h2><p>응답은 팀원에게 공개되지 않으며 교수님 리포트에만 참고 자료로 전달됩니다.</p></div></div>`;
  const others = t.members.filter(m => m.id !== mine.id);
  const recs = state.records || [];
  const periods = weeks(t);
  const card = m => `<section class="card student-form peer-card" data-target="${m.id}"><div class="flex gap12">${avatar(m)}<div><h2>${esc(m.name)}</h2><p class="card-desc">${esc(m.role || '')}</p></div></div><div class="form-grid mt16"><label class="field">1. 평가 기간<select class="select-control" data-f="period">${periods.map(p => `<option>${p}</option>`).join('')}</select></label><label class="field">2. 기여 유형 (4축)<select class="select-control" data-f="axis"><option value="">선택</option>${AXES.map((a, i) => `<option value="${i}">${a}</option>`).join('')}</select></label><label class="field full">3. 구체적으로 한 일 <small class="muted">성격·호감보다 행동을 적으세요</small><textarea class="textarea" data-f="did" maxlength="800" style="min-height:80px" placeholder="예: 11/28 리허설 장소를 섭외하고 장비를 점검했습니다."></textarea></label><label class="field full">4. 팀 결과에 준 도움<input class="input" data-f="impact" maxlength="400" placeholder="어떤 문제 해결·산출물·진행에 영향을 줬나요?"></label><label class="field">5. 내가 아는 근거<select class="select-control" data-f="basis"><option value="">선택</option>${BASIS.map(b => `<option>${b}</option>`).join('')}</select></label><label class="field">6. 이미 기록된 작업과 동일하면 연결<select class="select-control" data-f="record_id"><option value="">연결 안 함</option>${recs.map(r => `<option value="${r.id}">${esc(memberBy(r.member_id)?.name || '미매칭')} · ${esc(r.title.slice(0, 40))}</option>`).join('')}</select></label><label class="field full">6-1. 연결할 자료 링크 (선택)<input class="input" type="url" data-f="link" maxlength="300" placeholder="회의록·자료·로그 링크"></label><label class="field full">7. 추가 확인 필요 사항 (교수에게만 전달) <small class="muted">기록 누락·역할 변경·상충 진술 등. 모욕·추측·사생활 금지</small><textarea class="textarea" data-f="note" maxlength="500" style="min-height:60px"></textarea></label></div></section>`;
  return `<div class="setup-grid"><div class="stack"><div class="notice-strong">${icon('shield')}<span><strong>익명성 안내 (제출 전 확인)</strong><br>응답자 이름은 팀원에게 공개되지 않습니다. 중복 제출 방지와 소명 처리를 위해 계정과 연결되며, <strong>교수님은 응답자를 확인할 수 있습니다.</strong> 응답은 개인별로 제출되고 다른 팀원의 응답은 볼 수 없습니다. 제출 후에는 수정할 수 없습니다.</span></div>${others.map(card).join('')}<div class="form-foot"><span class="caption-note" style="margin:0">응답은 기여율(%)에 반영되지 않는 교수님 참고 자료입니다.</span><button class="button primary" data-action="peer-submit">동료평가 제출</button></div></div><aside class="stack aside-stack"><section class="card student-note"><h3>이렇게 적어 주세요</h3><p>점수를 매기지 않습니다. "누가 무엇을 했는가"를 적습니다.</p><p class="mt16">직접 보지 못했다면 근거를 <strong>관찰 못 함</strong>으로 선택하세요. 이 경우 3번은 비워도 됩니다.</p><p class="mt16">이미 GitHub·Notion 기록에 잡힌 일은 6번에서 연결하면 중복으로 세지 않습니다.</p></section>${axisCard()}</aside></div>`;
}

// ---------- modals ----------
let lastFocus = null;
function openModal(title, eyebrow, body, subtitle = '', wide = false, footerHtml = '') {
  const d = $('#modal');
  if (!d.open) lastFocus = document.activeElement;
  d.className = 'modal' + (wide ? ' wide' : '');
  d.innerHTML = `<header class="modal-header"><div><div class="modal-eyebrow">${eyebrow}</div><h2 id="modal-title">${title}</h2>${subtitle ? `<p>${subtitle}</p>` : ''}</div><button class="icon-button" data-action="close-modal" aria-label="닫기">${icon('close')}</button></header><div class="modal-body">${body}</div><footer class="modal-footer"><p>${DISCLAIMER}</p>${footerHtml || '<button class="button small" data-action="close-modal">닫기</button>'}</footer>`;
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
  openModal('새 팀 프로젝트', 'NEW TEAM / 교수 착수 설정', `<form id="team-form" class="form-grid"><label class="field">과목명<input class="input" name="course" required maxlength="60" placeholder="캡스톤디자인(2)"></label><label class="field">팀 이름<input class="input" name="name" required maxlength="30" placeholder="팀 3"></label><label class="field full">프로젝트명<input class="input" name="project" required maxlength="60" placeholder="캠퍼스 분실물 매칭 앱"></label><label class="field">시작일<input class="input" type="date" name="start_date"></label><label class="field">마감일<input class="input" type="date" name="deadline" required></label><label class="field full">GitHub 저장소 (선택)<input class="input" name="repo" placeholder="owner/repository" pattern="[\\w.\\-]+/[\\w.\\-]+"></label><label class="field full">Notion 팀 페이지 링크 (선택 · 하위 페이지 편집까지 수집)<input class="input" type="url" name="notion" placeholder="https://www.notion.so/..."></label><label class="field full">4축 가중치 프리셋 (만든 뒤 착수 설정에서 조정 가능)<select class="select-control" name="preset">${PRESETS.map((p, i) => `<option value="${i}">${p.title} — 생성 ${p.weights[0]} · 개선 ${p.weights[1]} · 조율 ${p.weights[2]} · 소통 ${p.weights[3]}</option>`).join('')}</select></label><div class="full"><div class="field" style="margin-bottom:8px">팀원 (GitHub 아이디 · Notion 계정 이메일로 기록을 연결합니다)</div><div id="member-rows">${memberRow() + memberRow() + memberRow()}</div><button type="button" class="button small" data-action="row-add">팀원 추가</button></div></form>`, '만들면 팀원별 초대 링크가 생성됩니다.', true, `<div class="flex gap8"><button class="button small" data-action="close-modal">취소</button><button class="button primary small" data-action="create-team">팀 만들기</button></div>`);
}

function allRecords() { return state.records || state.report?.records || []; }

function recordModal(id) {
  const r = allRecords().find(x => x.id === id);
  if (!r) return;
  const t = state.team;
  const m = memberBy(r.member_id);
  const prof = isProf();
  const by = { ai: 'AI 분류 (Claude)', rule: '규칙 분류', manual: '작성자 선택', professor: '교수 조정', demo: '예시 데이터' }[r.classified_by] || '';
  const isCode = r.tool === 'GitHub' && /^[+-] /m.test(r.body || '');
  const body = `<div class="between"><div class="flex gap12">${toolLogo(r.tool)}<div><h3>${esc(r.ref || r.kind)}</h3><p class="card-desc">${esc(r.kind)} · ${fmtFull(r.date)}</p></div></div>${tag(esc(AXES[r.type] ?? '미분류'), 'blue')}</div><dl class="record-metadata"><dt>기여자</dt><dd>${m ? `${esc(m.name)}${r.login ? ` · ${r.tool === 'GitHub' ? '@' : ''}${esc(r.login)}` : ''}` : `미매칭${r.login ? ` · ${esc(r.login)}` : ''}`}</dd><dt>원본</dt><dd>${r.url ? `<a class="blue" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">원본 도구에서 열기 ${icon('external', 'sm')}</a>` : '링크 없음'}</dd><dt>기여 축</dt><dd>${esc(AXES[r.type] ?? '미분류')} · 가중치 ${t.weights[r.type] ?? 0}%</dd><dt>분류 방식</dt><dd>${by}</dd></dl><div class="explain-card"><h3 style="font-size:12px">이 기록이 근거가 된 이유</h3><p>${esc(r.reason)}</p></div>${r.body ? `<div class="record-preview"><div class="record-preview-top">${icon('file', 'sm')}<strong>내용 미리보기</strong></div><div class="record-content">${isCode ? `<pre>${esc(r.body).split('\n').map(l => `<div class="${l.startsWith('+') ? 'added' : ''}">${l}</div>`).join('')}</pre>` : `<p style="white-space:pre-wrap">${esc(r.body.slice(0, 1500))}</p>`}</div></div>` : ''}${prof ? `<div class="form-grid mt24"><label class="field">기여 축 조정<select class="select-control" id="record-type">${AXES.map((c, i) => `<option value="${i}" ${r.type === i ? 'selected' : ''}>${c}</option>`).join('')}</select></label><label class="field">작성자 지정<select class="select-control" id="record-member"><option value="">미매칭</option>${t.members.map(x => `<option value="${x.id}" ${r.member_id === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label></div>` : ''}`;
  openModal(esc(r.title), 'ACTIVITY RECORD / 근거 상세', body, '원본 도구의 작업 기록과 기여 축을 함께 확인합니다.', false,
    prof ? `<div class="flex gap8">${m && state.report ? `<button class="button small" data-action="member" data-id="${m.id}">${esc(m.name)} 상세</button>` : ''}<button class="button primary small" data-action="save-record" data-id="${r.id}">조정 저장</button></div>` : '');
}

function testimony(r) {
  const from = memberBy(r.reviewer_id);
  const rec = r.record_id && allRecords().find(x => x.id === r.record_id);
  return `<div class="testimony"><div class="between"><span class="student-name">${tag(AXES[r.axis], 'amber')} ${esc(r.period)}</span><span class="muted" style="font-size:11px">근거: ${esc(r.basis)} · 응답자 ${esc(from?.name)}</span></div>${r.did ? `<p class="offline-story mt16">${esc(r.did)}</p>` : '<p class="caption-note">관찰하지 못했다고 응답했습니다.</p>'}${r.impact ? `<p class="caption-note">팀 결과에 준 도움: ${esc(r.impact)}</p>` : ''}${rec ? `<p class="caption-note">🔗 기록된 작업과 동일: <button class="table-link" data-action="record" data-id="${rec.id}">${esc(rec.title)}</button> — 중복 가산하지 않음</p>` : ''}${r.link ? `<p class="caption-note">자료: <a class="blue" href="${esc(r.link)}" target="_blank" rel="noopener noreferrer">${esc(r.link)}</a></p>` : ''}${r.note ? `<div class="notice-amber mt16"><strong>교수 전달 사항</strong><br>${esc(r.note)}</div>` : ''}</div>`;
}

function memberModal(id) {
  const t = state.team;
  const m = memberBy(id);
  const s = state.report.scores.find(x => x.member_id === id);
  const list = state.report.records.filter(r => r.member_id === id);
  const st = t.statements.find(x => x.member_id === id);
  const revs = state.report.reviews.filter(r => r.target_id === id);
  const hero = `<div class="detail-hero"><div class="flex gap12">${avatar(m)}<div><div class="name">${esc(m.name)}</div><div class="role">${esc(m.role || '')} · 기록 ${list.length}건 · ${axisCaption(s.counts)}</div></div></div><div><div class="big-score">${s.score.toFixed(1)}<small>%</small></div><div class="big-score-label">기여율 (로그 기반)</div></div></div>`;
  const verified = `<div class="formula-box"><div class="formula-label">기여율 = Σ [ 축별 팀 내 상대비율 × 가중치 ]</div><div class="formula-text">${s.shares.map((v, i) => `(${(v / 100).toFixed(2)} × ${s.applied[i].toFixed(0)}%)`).join(' + ')}<br>= ${s.parts.map(v => v.toFixed(1) + '%p').join(' + ')} = <strong>${s.score.toFixed(1)}%</strong></div></div><div class="table-wrap"><table><thead><tr><th>축</th><th>가중치</th><th>개인 활동량</th><th>팀 내 상대비율</th><th>반영</th><th>대표 근거</th></tr></thead><tbody>${AXES.map((c, i) => { const r = list.find(x => x.type === i); return `<tr><td>${c}</td><td>${t.weights[i]}%${s.applied[i].toFixed(1) !== t.weights[i].toFixed(1) ? ` <small class="muted">(적용 ${s.applied[i].toFixed(1)}%)</small>` : ''}</td><td>${s.counts[i]}건</td><td>${(s.shares[i] / 100).toFixed(2)}</td><td>${s.parts[i].toFixed(1)}%p</td><td>${r ? `<button class="table-link" data-action="record" data-id="${r.id}">기록 확인 ${icon('external', 'sm')}</button>` : '<span class="muted" style="font-size:10px">—</span>'}</td></tr>`; }).join('')}</tbody></table></div><div class="detail-section-title"><h3>전체 이력 <span class="muted">${list.length}</span></h3></div><div class="evidence-list">${list.map(recordItem).join('') || '<p class="caption-note">연결된 도구에 기록이 없습니다.</p>'}</div>`;
  const self = `<div class="detail-section-title"><h3>본인 기술</h3>${tag('기여율 반영 없음', 'amber')}</div>${st ? `<p class="offline-story">${esc(st.text).replace(/\n/g, '<br>')}</p>${fileChips(st)}` : '<p class="caption-note">작성하지 않았습니다.</p>'}`;
  const peer = `<div class="unverified mt24"><div class="detail-section-title" style="margin-top:0"><h3>동료 증언 <span class="muted">${revs.length}</span></h3>${tag('검증되지 않은 참고 자료', 'amber')}</div>${revs.map(testimony).join('') || '<p class="caption-note">이 팀원에 대한 동료 증언이 없습니다.</p>'}</div>`;
  openModal('개인 기여 상세', 'CONTRIBUTION EVIDENCE', `${hero}${s.score === 0 ? `<div class="notice-amber">연결된 도구에 ${esc(m.name)} 학생의 기록이 없습니다. <strong>온라인 기록 0% ≠ 전체 기여 0%</strong> — 본인 기술과 동료 증언, 교수님의 관찰로 확인해 주세요.</div>` : ''}${verified}${self}${peer}`, '위: 로그 기반 수치 · 아래: 수치에 반영되지 않는 서술과 증언', true);
}

function methodModal() {
  const t = state.team;
  openModal('기여율 산출 기준', 'METHOD / 4축 계산', `<div class="explain-card"><h3>교수가 설정하고 잠근 가중치로 계산합니다.</h3><p>학생은 가중치를 확인하고 의견을 낼 수 있으며, 교수가 반영 여부를 정한 뒤 잠급니다. 마감 후 한 번만 계산하며 성적을 산출하지 않습니다.</p></div><h3 class="mt24" style="margin-bottom:14px">${esc(t.name)}의 가중치</h3>${weightBar()}<p class="caption-note">${t.locked_at ? lockLabel(t) : '아직 잠기지 않았습니다.'}</p><div class="formula-box mt24"><p class="formula-label">계산식</p><div class="formula-text">r(i,k) = 개인 i의 축 k 활동량 ÷ 팀 전체 축 k 활동량 (축마다 팀원 합 = 1.0)<br>기여율(i) = Σ_k [ r(i,k) × w(k) ] × 100% (팀 전체 합 = 100%)<br>성적 변환·상하한·반영강도 조정 없음</div></div><div class="table-wrap mt16"><table><thead><tr><th>축</th><th>정의</th></tr></thead><tbody>${AXES.map((a, i) => `<tr><td>${a}</td><td>${AXIS_DESC[i]}</td></tr>`).join('')}</tbody></table></div><div class="notice-amber mt24"><strong>해석 시 유의사항</strong><br>온라인 기록 0% ≠ 전체 기여 0%. 활동량만으로 작업의 질을 판단할 수 없습니다. 팀 전체에 활동이 하나도 없는 축은 계산할 상대비율이 없어, 그 축의 가중치를 나머지 축에 비례해 나눕니다(팀 합 100% 유지). 자기 기술과 동료평가는 기여율에 반영하지 않습니다.</div><div class="detail-section-title"><h3>프리셋</h3></div><ul class="bullet-copy">${PRESETS.map(p => `<li>${p.title}: 생성 ${p.weights[0]} / 개선 ${p.weights[1]} / 조율 ${p.weights[2]} / 소통 ${p.weights[3]}</li>`).join('')}</ul>`, '4축 상대비율과 가중치가 기여율로 연결되는 방식입니다.', true);
}

function addRecordModal() {
  const t = state.team;
  const prof = isProf();
  openModal('작업 링크 추가', 'MANUAL RECORD', `<form id="record-form" class="form-grid">${prof ? `<label class="field">팀원<select class="select-control" name="member_id" required>${t.members.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select></label>` : ''}<label class="field">도구<select class="select-control" name="tool">${['Docs', 'Slides', 'Sheets', 'Figma', 'Notion', '기타'].map(x => `<option>${x}</option>`).join('')}</select></label><label class="field full">작업 제목<input class="input" name="title" required maxlength="200" placeholder="예: 요구사항 정의서 v3 작성"></label><label class="field full">링크<input class="input" type="url" name="url" placeholder="https://docs.google.com/..."></label><label class="field full">내용 요약 (선택)<textarea class="textarea" name="body" maxlength="4000" style="min-height:80px"></textarea></label><label class="field full">기여 축<select class="select-control" name="type"><option value="">자동 분류</option>${AXES.map((c, i) => `<option value="${i}">${c}</option>`).join('')}</select></label></form>`, 'API 연동 전인 도구의 작업을 근거로 남깁니다.', false, `<div class="flex gap8"><button class="button small" data-action="close-modal">취소</button><button class="button primary small" data-action="save-manual">추가</button></div>`);
}

// ---------- events ----------
const readFileB64 = f => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result.split(',')[1]); r.onerror = no; r.readAsDataURL(f); });

function collectPeer() {
  return [...document.querySelectorAll('.peer-card')].map(card => {
    const f = n => card.querySelector(`[data-f="${n}"]`).value.trim();
    return { target_id: Number(card.dataset.target), period: f('period'), axis: f('axis') === '' ? null : Number(f('axis')), did: f('did'), impact: f('impact'), basis: f('basis'), record_id: f('record_id') ? Number(f('record_id')) : null, link: f('link'), note: f('note'), _name: card.querySelector('h2').textContent };
  });
}

document.addEventListener('click', e => {
  const b = e.target.closest('[data-action]');
  if (!b || b.disabled) return;
  const t = state.team;
  const id = Number(b.dataset.id);
  switch (b.dataset.action) {
    case 'as': store.set(`hmk-as:${t.id}`, b.dataset.as); location.hash = `#/team/${t.id}`; route(); break;
    case 'view-as':
      keys[t.id] = { ...keys[t.id], member: b.dataset.key, name: b.dataset.name }; saveKeys();
      store.set(`hmk-as:${t.id}`, 'student'); location.hash = `#/team/${t.id}`; route();
      break;
    case 'menu': b.setAttribute('aria-expanded', String($('.sidebar').classList.toggle('mobile-open'))); break;
    case 'close-modal': closeModal(); break;
    case 'copy': navigator.clipboard?.writeText(b.dataset.text).then(() => notify('링크를 복사했습니다.'), () => notify('복사에 실패했습니다.')); break;
    case 'new-team': newTeamModal(); break;
    case 'row-add': $('#member-rows').insertAdjacentHTML('beforeend', newTeamModal.row()); break;
    case 'row-remove': if ($('#member-rows').children.length > 2) b.parentElement.remove(); break;
    case 'create-team': run(async () => {
      const f = $('#team-form');
      if (!f.reportValidity()) return;
      const fd = new FormData(f);
      const names = fd.getAll('m-name'), roles = fd.getAll('m-role'), ghs = fd.getAll('m-github'), notions = fd.getAll('m-notion');
      const r = await api('/teams', { method: 'POST', body: {
        course: fd.get('course'), name: fd.get('name'), project: fd.get('project'), start_date: fd.get('start_date'), deadline: fd.get('deadline'),
        repo: fd.get('repo').trim(), notion: fd.get('notion').trim(), weights: PRESETS[fd.get('preset')].weights,
        members: names.map((n, i) => ({ name: n, role: roles[i], github: ghs[i], notion_email: notions[i] })).filter(m => m.name.trim()),
      } }, null);
      keys[r.team.id] = { prof: r.prof_key }; saveKeys(); store.set(`hmk-as:${r.team.id}`, 'professor');
      location.hash = `#/team/${r.team.id}/setup`;
      notify('팀을 만들었습니다. 팀원에게 초대 링크를 보내 주세요.');
    }); break;
    case 'demo': run(async () => {
      const r = await api('/demo', { method: 'POST' }, null);
      keys[r.team.id] = { prof: r.prof_key }; saveKeys(); store.set(`hmk-as:${r.team.id}`, 'professor');
      location.hash = `#/team/${r.team.id}/report`;
    }); break;
    case 'delete-team':
      openModal('팀 프로젝트를 삭제할까요?', 'DELETE / 삭제', `<p class="offline-story"><strong>${esc(b.dataset.name)}</strong></p><div class="notice-amber mt16">팀원·수집된 기록·동의·의견·자기 기술·동료평가·첨부 파일이 모두 삭제되며 되돌릴 수 없습니다.</div>`, '', false, `<div class="flex gap8"><button class="button small" data-action="close-modal">취소</button><button class="button primary small" style="background:#c2410c;border-color:#c2410c" data-action="confirm-delete" data-id="${esc(b.dataset.id)}">삭제</button></div>`);
      break;
    case 'confirm-delete': run(async () => {
      const tid = b.dataset.id;
      await api(`/teams/${tid}`, { method: 'DELETE' }, tid);
      delete keys[tid]; saveKeys(); closeModal(); route(); notify('팀 프로젝트를 삭제했습니다.');
    }); break;
    case 'consent': run(async () => {
      if (!$('#consent-check').checked) return;
      state.team = await api(`/teams/${t.id}/consent`, { method: 'POST', body: { agree: true } });
      location.hash = `#/team/${t.id}/setup`; notify('동의했습니다. 착수 설정을 확인해 주세요.');
    }); break;
    case 'member': memberModal(id); break;
    case 'record': recordModal(id); break;
    case 'method': methodModal(); break;
    case 'export': window.print(); break;
    case 'filter': state.tool = b.dataset.tool; render(); break;
    case 'reset-filters': state.tool = 'all'; state.member = 'all'; render(); break;
    case 'preset': state.draftWeights = [...PRESETS[b.dataset.i].weights]; render(); break;
    case 'w-save': run(async () => {
      const team = await api(`/teams/${t.id}/weights`, { method: 'PUT', body: { weights: state.draftWeights.map(Number) } });
      state.draftWeights = null; await refreshTeam(team); notify('가중치를 저장했습니다. 학생들의 확인을 다시 받아 주세요.');
    }); break;
    case 'confirm': run(async () => { await refreshTeam(await api(`/teams/${t.id}/confirm`, { method: 'POST' })); notify('가중치를 확인했습니다.'); }); break;
    case 'opinion-submit': run(async () => {
      const text = $('#opinion-text').value.trim();
      if (!text) return notify('의견을 입력해 주세요.');
      await refreshTeam(await api(`/teams/${t.id}/opinions`, { method: 'POST', body: { text } })); notify('의견을 교수님께 제출했습니다.');
    }); break;
    case 'opinion': run(async () => {
      const reply = document.querySelector(`[data-reply="${id}"]`)?.value || '';
      await refreshTeam(await api(`/teams/${t.id}/opinions/${id}`, { method: 'PATCH', body: { status: b.dataset.status, reply } }));
      notify(b.dataset.status === 'accepted' ? '반영으로 표시했습니다. 필요하면 가중치를 수정해 주세요.' : '기각으로 표시했습니다.');
    }); break;
    case 'lock': run(async () => { await refreshTeam(await api(`/teams/${t.id}/lock`, { method: 'POST' })); notify('기준을 잠갔습니다. 이제 기록을 수집합니다.'); }); break;
    case 'close':
      openModal('지금 마감 처리할까요?', 'CLOSE / 마감', '<p class="offline-story">마감 처리하면 기여율이 산출되고 학생의 자기 기술·익명 동료평가가 열립니다. 되돌릴 수 없습니다.</p>', '', false, '<div class="flex gap8"><button class="button small" data-action="close-modal">취소</button><button class="button primary small" data-action="confirm-close">마감 처리</button></div>');
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
        member_id: fd.get('member_id') ? Number(fd.get('member_id')) : undefined, tool: fd.get('tool'), title: fd.get('title'), url: fd.get('url'), body: fd.get('body'),
        type: fd.get('type') === '' ? undefined : Number(fd.get('type')),
      } });
      closeModal(); await refreshTeam(team); notify('작업 기록을 추가했습니다.');
    }); break;
    case 'save-record': run(async () => {
      const mv = $('#record-member').value;
      await api(`/teams/${t.id}/records/${id}`, { method: 'PATCH', body: { type: Number($('#record-type').value), member_id: mv ? Number(mv) : null } });
      closeModal(); await refreshTeam(); notify('분류를 조정했습니다.');
    }); break;
    case 'attach': $('#file-input').click(); break;
    case 'submit-statement':
      if (!state.draftText.trim()) { notify('맡은 활동을 먼저 작성해 주세요.'); $('#statement-text').focus(); break; }
      openModal('이 내용으로 제출할까요?', 'SUBMISSION / 1회 제출 확인', `<p class="offline-story" style="white-space:pre-wrap">${esc(state.draftText)}</p><p class="caption-note">첨부 파일 ${state.draftFiles.length}개</p><div class="notice-amber mt24">제출 후에는 수정할 수 없습니다.</div>`, '작성한 내용은 기여율에 반영되지 않습니다.', false, '<div class="flex gap8"><button class="button small" data-action="close-modal">계속 작성</button><button class="button primary small" data-action="confirm-submit">제출하기</button></div>');
      break;
    case 'confirm-submit': run(async () => {
      const files = await Promise.all(state.draftFiles.map(async f => ({ name: f.name, mime: f.type, data: await readFileB64(f) })));
      const team = await api(`/teams/${t.id}/statements`, { method: 'POST', body: { text: state.draftText, files } });
      state.draftText = ''; state.draftFiles = [];
      closeModal(); await refreshTeam(team); notify('자기 기술을 제출했습니다.');
    }); break;
    case 'peer-submit': {
      const items = collectPeer();
      const bad = items.find(i => i.axis === null || !i.basis || (i.basis !== '관찰 못 함' && !i.did));
      if (bad) { notify(`${bad._name}: 기여 유형·근거·구체적으로 한 일을 입력해 주세요.`); break; }
      state.peerDraft = items;
      openModal('동료평가를 제출할까요?', 'ANONYMOUS PEER REVIEW', `<ul class="bullet-copy">${items.map(i => `<li><strong>${esc(i._name)}</strong> · ${AXES[i.axis]} · ${esc(i.basis)}</li>`).join('')}</ul><div class="notice-amber mt24">응답자 이름은 팀원에게 공개되지 않습니다. 교수님은 소명·확인을 위해 응답자를 볼 수 있습니다. 제출 후 수정할 수 없습니다.</div>`, '기여율에 반영되지 않는 교수님 참고 자료입니다.', false, '<div class="flex gap8"><button class="button small" data-action="close-modal">계속 작성</button><button class="button primary small" data-action="peer-confirm">제출하기</button></div>');
      break;
    }
    case 'peer-confirm': run(async () => {
      const team = await api(`/teams/${t.id}/peer-reviews`, { method: 'POST', body: { items: state.peerDraft.map(({ _name, ...i }) => i) } });
      closeModal(); await refreshTeam(team); notify('동료평가를 제출했습니다.');
    }); break;
  }
});

document.addEventListener('change', e => {
  const el = e.target;
  if (el.id === 'member-filter') { state.member = el.value; render(); }
  if (el.id === 'consent-check') $('#consent-next').disabled = !el.checked;
  if (el.id === 'file-input') {
    const files = [...el.files].slice(0, 5);
    if (files.some(f => f.size > 5 * 1024 * 1024)) return notify('파일은 5MB 이하여야 합니다.');
    state.draftFiles = files; render();
  }
});

document.addEventListener('input', e => {
  const el = e.target;
  if (el.id === 'statement-text') { state.draftText = el.value; $('#char-count').textContent = el.value.length; }
  if (el.dataset.w !== undefined && state.draftWeights) {
    state.draftWeights[el.dataset.w] = Number(el.value);
    const sum = state.draftWeights.reduce((a, b) => a + (Number(b) || 0), 0);
    $('#w-sum').textContent = `합계 ${sum}%`;
    $('#w-sum').className = sum === 100 ? 'green' : 'sum-bad';
  }
});

$('#modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal(); });
window.addEventListener('hashchange', route);
route();
