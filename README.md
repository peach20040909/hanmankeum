# 한만큼

> 각자가 한 만큼의 기록을 모아, 공정하게 참여한 만큼 평가받을 수 있도록 — Team HMK

흩어진 팀 프로젝트 작업 기록(GitHub · Notion · Docs)을 모아, 교수님이 **근거와 함께** 기여를 확인하는 웹 서비스입니다.

## 흐름

| 시점 | 교수 | 학생 |
|---|---|---|
| 학기 초 | 팀 생성 · GitHub 저장소 연결 · 링크 공유 | 가중치 합의 → 팀원 전원 확인 → 기준 잠금 |
| 학기 중 | 기록 수집(점수 비공개) | 평소처럼 작업 · Notion/Docs 링크 기록 |
| 마감 후 | 기여도 리포트 · 근거 확인 · 분류 조정 · PDF | 오프라인 기여 서술 1회 제출(사진·캡처 첨부) |

**산식**: 개인 산출 비중 = Σ (유형 가중치 × 유형 내 활동 비중), 유형 내 활동 비중 = 해당 유형의 개인 기록 수 ÷ 팀 전체 기록 수.
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

## 본선 시연

1. 첫 화면 → **시연용 예시 팀 불러오기** → 마감된 팀 3 리포트가 바로 열림
2. 실제 흐름: **새 팀 만들기**(저장소 `owner/repo`, 팀원 GitHub 아이디) → 학생 화면에서 각자 확인 → 잠금 → 교수 화면 **GitHub 기록 수집** → **지금 마감 처리** → 리포트

## 구조

```
server.js    HTTP API + SQLite (node:sqlite)
collect.js   GitHub 수집 · Claude/규칙 분류
score.js     기여도 산식
seed.js      시연용 예시 데이터
public/      화면 (Vanilla JS, UI·UX 초안 디자인)
```

## 아직 없는 것

- 로그인/권한 — 지금은 팀 링크를 아는 사람이 교수·학생 화면 전환 (학교 SSO 연동 예정)
- Notion·Google Docs API 자동 수집 — 지금은 링크 기록으로 대체
- 기록 부풀리기 판별, 변경량·품질 가중
