# onmyway-next

onmyway의 서버(API)와 웹. Next.js 16 (App Router) + TypeScript + Tailwind CSS v4.

```bash
npm install
npm run dev        # http://localhost:3000
curl localhost:3000/api/health
```

- 디자인 토큰: `design-tokens/tokens.json` 수정 후 `npm run tokens`
- 개발 규칙: `CLAUDE.md`
- 기획 문서: `../onmyway-planning`

## 배포 (Vercel)

설정은 `vercel.json`에 있다: 리전 `icn1`(서울), Node 22.

1. **Supabase 준비** — 프로젝트 리전은 Vercel 함수와 가까운 `ap-northeast-2`(서울)로 만든다
   ```bash
   npx supabase link --project-ref <ref>
   npx supabase db push          # supabase/migrations 적용
   ```
   Google·Apple 로그인은 Supabase Auth 공급자 설정에서 켠다 (D-065)
2. **Vercel 프로젝트 연결** — `vercel link` (또는 대시보드에서 Git 저장소 가져오기). Root Directory는 저장소 루트, 빌드 설정은 기본값
3. **환경 변수** — Production·Preview 둘 다 `.env.example`의 항목을 넣는다
   | 이름 | 필수 | 비고 |
   |------|------|------|
   | `SUPABASE_URL` | ✅ | 없으면 `/api/health` 외 API가 500. Vercel Supabase 연동이 넣는 `NEXT_PUBLIC_SUPABASE_URL`이 있으면 생략 |
   | `SUPABASE_SERVICE_ROLE_KEY` | ✅ | 서버 전용. `NEXT_PUBLIC_` 금지 |
   | `NOMINATIM_USER_AGENT` | ✅ | 연락처를 넣는다 (예: `onmyway/1.0 (ops@도메인)`). 공개 Nominatim 이용 정책 |
   | `NOMINATIM_URL` | — | 자체·유료 Nominatim을 쓸 때만 |
4. **배포** — `vercel` (Preview) → 확인 후 `vercel --prod`
5. **확인** — `curl https://<도메인>/api/health` → `{"status":"ok"}`. 앱은 `--dart-define=BACKEND=api API_BASE_URL=https://<도메인>`으로 붙인다

- Production: https://onmyway-next.vercel.app
- 공휴일(`holidays`)은 마이그레이션으로 넣는다. 매년 하반기 다음 해 월력요항이 나오면 `supabase/migrations/`에 추가하고 `db push`
