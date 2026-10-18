@AGENTS.md

## 프로젝트
**onmyway-next** — onmyway(직장인 출근길 서비스)의 **서버(API) + 웹**.
모바일 앱(`../onmyway-app`, Flutter)과 웹이 이 저장소의 API를 함께 쓴다.

- 기획 SoT: `../onmyway-planning` — 구현 전 해당 프로젝트의 `02-planning-spec.md`(또는 `03-prd.md`)와 `06-decisions.md`를 읽는다
- 아키텍처: `../onmyway-planning/knowledge/system-architecture.md`
- 디자인: `../onmyway-planning/knowledge/design-guide.md` — **토스 디자인 시스템(TDS)은 쓰지 않는다** (D-003)

## 스택
- Next.js 16 (App Router, `src/` 디렉토리), TypeScript, Tailwind CSS v4, npm
- `next.config.ts`에 `cacheComponents`가 켜져 있다. 데이터 캐싱은 `use cache`·`connection()` 모델을 따른다 (`node_modules/next/dist/docs/` 참고)

## 구조
```
design-tokens/tokens.json   디자인 토큰 SoT (웹·앱 공용)
scripts/build-tokens.mjs    토큰 → src/styles/tokens.css + ../onmyway-app/lib/core/theme/tokens.g.dart
src/app/                    웹 화면 (page.tsx)
src/app/api/**/route.ts     앱·웹이 쓰는 API (Route Handler)
src/app/fonts/              Pretendard (OFL)
src/styles/tokens.css       생성 파일 — 직접 수정 금지
```

## 규칙
- **API는 기획 문서에 정의된 것만 만든다.** 있을 법한 엔드포인트·필드를 추측으로 추가하지 않는다
- `/api/**`는 앱(Flutter)도 호출한다. 응답 형태를 바꾸면 앱 쪽 영향도 확인한다
- 색·글자 크기·간격·모서리는 **토큰만** 쓴다 (`bg-brand-primary`, `text-signal-go`, `text-title1`, `rounded-md`). 임의 hex 값 금지
- `signal-*` 색은 신호 표현에만 쓴다. 신호 상태는 색 + 텍스트 + 형태로 표현한다
- 토큰을 바꾸려면 `design-tokens/tokens.json` 수정 → `npm run tokens` → 생성된 CSS·Dart를 각 저장소에 함께 커밋한다. 값 변경은 기획 레포 design-guide·decisions와 맞춘다
- UI 문구는 해요체·능동형·긍정형, 다이얼로그 왼쪽 버튼은 `닫기` (design-guide 5장)
- 다크 모드는 미정(DG-02) — 라이트 모드만

## 명령어
```bash
npm run dev      # 개발 서버
npm run build    # 프로덕션 빌드
npm run lint     # ESLint
npm run tokens   # 디자인 토큰 생성
```
