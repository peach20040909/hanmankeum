# 개발·운영 안내

[README](../README.md)에서 옮긴 개발자용 내용입니다. 테스트, 로컬 실행, 환경변수, 배포, Notion 웹훅, 녹화 도구를 다룹니다.

## 테스트

`npm test` — 외부 네트워크 없이 실제 서버를 띄워 돌립니다.

| 파일 | 검증 내용 |
|---|---|
| `api.test.js` | 착수→잠금→마감 흐름, 초대 키 권한(학생이 리포트 접근 403), 동료평가 1회 제한, 익명 처리, 첨부 3MB 한도와 본인 첨부만 열람, 확인 필요·AI 도움 표시 |
| `score.test.js` | 가중치 × 항목 내 상대비율 합산, 기록이 없는 항목의 가중치 재배분(팀 합 100% 유지) |
| `legacy.test.js` | 교수 기준 도입 전에 만든 옛 팀은 읽을 때 '이전 방식 기준'으로 표시하고, DB·기준·점수는 그대로 보존 |
| `collect.test.js` | 교수 기준(키워드·활동 종류)으로 규칙 분류가 맞게 떨어지는지, '기준 밖' 처리, AI 기준 초안 정리·검증 |
| `generate.test.js` | 근거 번호 검증(전부 없는 번호·근거 없음·평가 표현은 제외, 일부만 틀리면 유효한 근거만 남김), 근거-내용 연결이 약한 문장 표시, 초안 대비 수정률 |
| `notion.test.js` | 가짜 외부 조회 + 실제 교수 기준 규칙 분류·DB 저장: 페이지 생성, 남의 문서 편집, 기준 밖, 분류 출처/버전, 중복·팀 범위, 틀린 웹훅 서명 거부 |

### 화면과 시연 도구 자동 점검

```bash
npm ci
npx playwright install chromium   # 호환 Chromium이 이미 설치돼 있으면 생략
npm run e2e
```

`e2e/readiness.spec.js`는 데스크톱 1300px·모바일 390px에서 기준 입력·규칙 초안·항목 추가/삭제·합계 경고·확정·학생 확인·잠금, 시연 리포트·활동·산식 모달, 교수 조정의 원래 근거 보존과 기준 밖 저장을 검사합니다. 예시 기준 상태의 확인·잠금 비활성과 브라우저 콘솔 오류 0건도 확인합니다.

실패 경로는 실행 중 생성한 잘못된 임시 키와 **로컬 401 제공자**를 사용해 실제 SDK → 규칙 대체 → DB/API → 요약·초안의 `AI 호출 실패` 배지를 검사합니다. 실제 Anthropic 서비스의 인증 거부나 장애를 호출하는 테스트는 아닙니다. 임시 파일 DB 서버 두 개(4173/4174)를 자동 시작하며 운영 DB·자격 환경변수와 `.env`를 사용하지 않습니다.

분류 저장 회귀 테스트는 활동 근거·리포트의 목록 응답을 의도적으로 보류합니다. 목록 갱신이 끝날 때까지 모달이 유지되고, 닫히자마자 다시 열어도 변경한 분류·작성자·기준 밖 값과 원래 판단이 보존되는지 두 화면 크기에서 검사합니다.

`e2e/tools.spec.js`는 녹화(CDP PNG 프레임)·슬라이드·정지 캡처 도구를 끝까지 실행합니다. GitHub 외부 응답만 고정 fixture이며 수집 라우트·분류·저장은 실제 코드입니다. 스크린샷·프레임·실패 trace는 **git에서 제외한 `tools/out/`**에 저장합니다. 기존 판정 기준과 프롬프트 문구는 바꾸지 않습니다.

이 자동 검증은 **실제 Notion 웹훅·배포본 AI·영상 인코딩 확인을 대신하지 않습니다.** Notion 수동 점검 절차와 미확인 표기는 [docs/prompts.md 1-1장](prompts.md)에 있습니다.

## 실행 (로컬)

Node.js 22.13 이상. 환경변수가 없으면 로컬 파일 `hanmankeum.db`(libSQL)로 동작합니다.

```bash
npm install
cp .env.example .env   # 전부 선택 사항
npm start              # http://localhost:3000
npm test
```

## 환경변수

| 이름 | 용도 | 없으면 |
|---|---|---|
| `TURSO_DATABASE_URL` | Turso(libSQL) 데이터베이스 주소 (`libsql://...`) | 로컬 파일 `file:hanmankeum.db` |
| `TURSO_AUTH_TOKEN` | Turso 접근 토큰 | 로컬 파일은 토큰 없이 동작 |
| `ANTHROPIC_API_KEY` | Claude로 교수 평가기준 정리 · 기록 분류 · 요약 · 초안 생성 | 기준은 '항목 40%' 줄만 규칙으로 읽음, 분류는 교수 키워드 규칙, 요약·초안은 규칙 문장 |
| `HANMANKEUM_MODEL` | 사용할 Claude 모델 | `claude-haiku-5-5` |
| `GITHUB_TOKEN` | 비공개 저장소 수집, API 한도 확대 | 공개 저장소만, 시간당 60회 |
| `NOTION_TOKEN` | Notion 페이지·사용자 조회 | 웹훅 이벤트를 기록으로 만들지 못함 |
| `NOTION_WEBHOOK_SECRET` | Notion 웹훅 서명 검증 | 웹훅 요청을 모두 거부 |

## 배포 (Vercel + Turso)

정적 화면은 `public/`에서 바로 서빙되고, `/api/*`는 `api/index.js` 함수 하나가 받습니다(`vercel.json` rewrites). 서버리스 함수는 요청마다 새로 뜨기 때문에 파일 DB를 쓸 수 없어 DB는 Turso(libSQL)를 씁니다.

1. **Turso DB 생성 · 토큰 발급**

   ```bash
   turso db create hanmankeum
   turso db show hanmankeum --url      # TURSO_DATABASE_URL
   turso db tokens create hanmankeum   # TURSO_AUTH_TOKEN
   ```

2. **Vercel 프로젝트 연결** — 대시보드에서 이 저장소를 Import 하거나 `vercel link`. 프레임워크는 "Other", 빌드 명령 없음.
3. **환경변수 입력** — 위 표의 값을 Production·Preview에 등록하고 재배포.
4. **Notion 웹훅 URL 변경** — 구독 URL을 `https://<vercel-주소>/api/webhooks/notion`으로 바꾸고 다시 Verify.

- 스키마 생성과 컬럼 추가는 서버가 시작할 때 자동으로 실행됩니다(`db.js`의 `init()`).
- 함수 실행 한도는 60초(`vercel.json`), 요청 본문 한도는 Vercel 기본 4.5MB라 자기 기술 첨부는 **파일당 3MB · 최대 5개**입니다.

## Notion 웹훅 수집

Notion API 조회는 블록마다 **마지막 편집자**만 알려주고 편집 이력은 제공하지 않습니다. 그래서 착수 시점부터 웹훅 이벤트의 `authors`를 쌓아 편집자별 기록을 만듭니다.

| 이벤트 | 활동 종류 (교수 기준 분류에 쓰임) |
|---|---|
| `page.created` | 페이지 생성 |
| `page.content_updated` | 본인 페이지면 문서 편집, 남이 만든 페이지면 남의 문서 편집 |
| `page.properties_updated` | 속성 편집 (일정·담당·상태) |
| `comment.created` | 댓글 (연결에 "댓글 읽기" 기능 필요) |

기록이 들어오면 다른 기록과 똑같이 교수님 기준 항목으로 분류합니다(Claude + 규칙 교차 확인).

1. https://app.notion.com/developers/connections 에서 연결 생성 → 시크릿을 `NOTION_TOKEN`에 등록 (기능: 콘텐츠 읽기, 댓글 읽기, 사용자 정보 읽기(이메일 포함))
2. 연결의 **Webhooks** 탭 → 구독 생성 → URL `https://<배포 주소>/api/webhooks/notion`, 위 4개 이벤트 선택
3. 서버 로그의 `[Notion] verification_token: ...` 값을 Notion **Verify**에 붙여넣고, 같은 값을 `NOTION_WEBHOOK_SECRET`에 등록 후 재배포
4. 착수 설정에서 팀 Notion 페이지 링크(교수)와 Notion 이메일(각자) 입력, 팀 페이지를 연결에 공유

- 같은 페이지 · 같은 편집자 · 같은 날(KST) · 같은 이벤트는 1건으로 합칩니다.
- 편집한 문서의 본문, 연결 이전 편집은 수집하지 않습니다. 기준 잠금 후 · 마감 전 이벤트만 기록합니다.

## 시연 흐름 직접 해 보기

1. 첫 화면 → **시연용 예시 팀 불러오기** → 마감된 팀 3 리포트 (기여율 · 동료 증언 · 자기 기술)
2. 실제 흐름: **새 팀 만들기** → 착수 설정의 **이 학생으로 보기**로 학생 확인·의견 → 교수 화면에서 반영 → 잠금 → **지금 마감 처리** → 학생 화면 동료평가 → 교수 리포트

### 녹화·발표 캡처

로컬 서버(`npm start`, 기본 3000)를 실행한 뒤:

```bash
node tools/record-demo.mjs tools/out/record           # PNG 프레임 + timeline.json
node tools/record-demo.mjs tools/out/check --check    # 같은 흐름, 주요 12장만 캡처
node tools/capture-slides.mjs tools/out/slides        # 2배 해상도 12장
node tools/capture-demo.mjs tools/out/capture         # 같은 흐름의 정지 캡처
```

공유 흐름(`tools/demo-flow.mjs`): **교수 기준 붙여넣기 → AI 정리 버튼 → 교수 수정·확정 → 학생 확인 → 잠금 → GitHub 수집 → 확인 필요 → 리포트·산식·원본**. 키가 없으면 규칙 초안·규칙 분류로 표시됩니다. 실제 수집은 공개 저장소를 조회하므로 네트워크와 GitHub 한도가 필요합니다. 불일치 설명은 예시 표시가 있는 별도 시연 팀의 고정 2건으로 보여 주며, 이 값을 실제 LLM의 이번 출력으로 주장하지 않습니다. 도구가 만든 팀은 종료 시 삭제합니다.

`DEMO_BASE_URL`로 로컬 서버 주소, `DEMO_PAUSE_MS`로 장면 대기 시간을 지정할 수 있습니다. `CHROME_PATH`는 선택 사항이며 기본값은 Playwright Chromium입니다. 네트워크 없는 도구 점검은 `npm run e2e`에 포함됩니다.

Python 합성 도구(`compose-demo.py`, `cut-demo.py`, `make-video.py`, `compose-slides.py`)는 새 PNG 이름과 `invite → criteria → lock → collect → review → report` 단계를 사용합니다. `cut-demo.py`는 과거 촬영의 절대 타임코드 대신 새 `timeline.json`의 단계 시작점을 사용합니다. 실제 영상 제작에는 기존 Pillow·imageio-ffmpeg 환경이 필요하며 **촬영 속도·최종 MP4/GIF와 발표 자막은 사람이 확인**해야 합니다.

## 구조

자세한 데이터 흐름과 수집·AI 전달 범위는 [docs/architecture.md](architecture.md)에 있습니다.

```
handler.js   API 핸들러 (Web 표준 Request/Response), 초대 키 권한
server.js    로컬 실행용 node:http 어댑터 + 정적 파일
api/index.js Vercel 함수 진입점 (handler.js의 handle을 그대로 사용)
db.js        libSQL(Turso) 연결 · 스키마 · 컬럼 마이그레이션
collect.js   교수 기준 정리 · GitHub 수집 · Claude/규칙 분류 · AI 사용 감지
ai.js        Claude 호출 한 곳 (모델·구조화 출력)
notion.js    Notion 웹훅 서명 검증 · 페이지/사용자 조회
score.js     기여율 산식
seed.js      시연용 예시 데이터
public/      화면 (Vanilla JS)
```

## 앞으로 — 학교 LMS 연동 (미구현)

지금 가장 큰 도입 마찰은 **교수가 팀과 팀원을 손으로 등록하고 초대 링크를 일일이 돌려야 한다**는 점입니다. 수강생 명단은 이미 학교 LMS에 있습니다.

LMS 연동은 **학교 기관 승인이 필요한 영역이라 학생 팀이 자체적으로 받을 수 없어** 이번 범위에서는 제외했습니다. 대신 나중에 붙일 수 있도록 설계해 두었습니다.

| 단계 | 내용 | 필요한 것 |
|---|---|---|
| 1 | 수강생 명단 CSV 올리기 → 팀·초대 링크 일괄 생성 | 없음 (현 구조에서 바로 가능) |
| 2 | **LTI 1.3**으로 LMS 안에서 바로 열기 · 명단과 역할 자동 동기화 | 학교 LMS 관리자 등록 |
| 3 | 기여도 리포트를 LMS 성적 화면에 첨부 · SSO로 초대 키 대체 | 기관 계약 |

이미 준비된 부분:

- 권한이 **초대 키 한 겹**으로만 묶여 있어, 인증을 SSO로 바꿔도 나머지 로직은 그대로입니다.
- 리포트가 PDF로 떨어지므로 LMS 연동 전에도 과제 평가 화면에 첨부할 수 있습니다.

**연동 여부와 무관하게 성적은 산출하지 않습니다.** LMS에 올라가는 것은 점수가 아니라 근거 문서입니다.
