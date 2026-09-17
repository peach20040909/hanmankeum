# 한만큼

> 각자가 한 만큼의 기록을 모아, 공정하게 참여한 만큼 평가받을 수 있도록 — Team HMK

흩어진 팀 프로젝트 작업 기록(GitHub · Notion · Docs)을 모아, 교수님이 **근거와 함께** 기여를 확인하는 웹 서비스입니다.

## 흐름

| 시점 | 교수 | 학생 |
|---|---|---|
| 학기 초 | 팀 생성 · GitHub 저장소 연결 · 링크 공유 | 가중치 합의 → 팀원 전원 확인 → 기준 잠금 |
| 학기 중 | 기록 수집(점수 비공개) | 평소처럼 작업 · Notion/Docs 링크 기록 |
| 마감 후 | 기여도 리포트 · 근거 확인 · 분류 조정 · PDF | 오프라인 기여 서술 1회 제출(사진·캡처 첨부) |

**산식**: 개인 산출 비중 = Σ (유형 가중치 × 유형 내 활동 비중), 유형 내 활동 비중 = 해당 유형의 개인 기록 수 ÷ 팀 전체 기록 수. 팀 전체에 기록이 없는 유형의 가중치는 나머지 유형에 비례 배분합니다.
산출 결과는 성적에 자동 반영되지 않으며 최종 판단은 교수가 합니다.

## 실행

Node.js 22.13 이상 (내장 SQLite 사용)

```bash
npm install
cp .env.example .env   # 선택: GITHUB_TOKEN, ANTHROPIC_API_KEY
npm start              # http://localhost:3000
npm test
```

- `GITHUB_TOKEN` — 비공개 저장소 수집, API 한도 확대 (없으면 공개 저장소만, 시간당 60회)
- `ANTHROPIC_API_KEY` — Claude로 작업 기록을 기여 유형에 분류 (없으면 키워드 규칙 분류)
- `NOTION_TOKEN`, `NOTION_WEBHOOK_SECRET` — Notion 웹훅 수집 (아래 참고)

## Notion 웹훅 수집

Notion API 조회는 블록마다 **마지막 편집자**만 알려주고 편집 이력은 제공하지 않습니다. 그래서 착수 시점부터 웹훅 이벤트(`page.created`, `page.content_updated`, `page.properties_updated`)의 `authors`를 쌓아 편집자별 기록을 만듭니다.

1. https://app.notion.com/developers/connections 에서 연결 생성 → 시크릿을 `NOTION_TOKEN`에 등록 (기능: 콘텐츠 읽기, 사용자 정보 읽기(이메일 포함))
2. 연결의 **Webhooks** 탭 → 구독 생성 → URL `https://<배포 주소>/api/webhooks/notion`, 위 3개 이벤트 선택
3. 서버 로그의 `[Notion] verification_token: ...` 값을 Notion **Verify**에 붙여넣고, 같은 값을 `NOTION_WEBHOOK_SECRET`에 등록 후 재배포
4. 한만큼 착수 설정에 팀 Notion 페이지 링크와 팀원 Notion 이메일 입력, 팀 페이지를 연결에 공유

- 같은 페이지 · 같은 편집자 · 같은 날(KST) 편집은 1건으로 합칩니다.
- 연결 이전 편집, 편집 내용 자체(바뀐 블록 ID만 전달)는 수집하지 않습니다.
- 기준 잠금 후 · 마감 전 이벤트만 기록합니다.

## 본선 시연

1. 첫 화면 → **시연용 예시 팀 불러오기** → 마감된 팀 3 리포트가 바로 열림
2. 실제 흐름: **새 팀 만들기**(저장소 `owner/repo`, 팀원 GitHub 아이디) → 학생 화면에서 각자 확인 → 잠금 → 교수 화면 **GitHub 기록 수집** → **지금 마감 처리** → 리포트

## 구조

```
server.js    HTTP API + SQLite (node:sqlite)
collect.js   GitHub 수집 · Claude/규칙 분류
notion.js    Notion 웹훅 서명 검증 · 페이지/사용자 조회
score.js     기여도 산식
seed.js      시연용 예시 데이터
public/      화면 (Vanilla JS, UI·UX 초안 디자인)
```

## 아직 없는 것

- 로그인/권한 — 지금은 팀 링크를 아는 사람이 교수·학생 화면 전환 (학교 SSO 연동 예정)
- Google Docs 자동 수집 — 지금은 링크 기록으로 대체
- 기록 부풀리기 판별, 변경량·품질 가중
