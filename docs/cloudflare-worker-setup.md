# RepView 글로벌 조회랭킹 (Cloudflare Worker + KV)

## 네가 해야 할 것 (Cloudflare 대시보드)
1. `Workers & Pages`에서 Worker 생성
2. `KV`에서 namespace 생성 (예: `REPVIEW_SEARCH_RANKING`)
3. Worker에 KV binding 추가
- Binding name: `SEARCH_RANKING_KV`
4. Route 연결
- `repview.app/api/*` -> 생성한 Worker
5. (선택) CORS 도메인 확인
- 현재 코드 기준 허용 origin: `https://repview.app`

## 내가 코드로 이미 해둔 것
- Worker 엔드포인트 템플릿 추가
- `POST /api/kr/member-view` (의원페이지 방문 카운트)
- `GET /api/kr/member-ranking?period=week&limit=500` (주간 집계)
- 프론트에서 로컬 기준 제거, 글로벌 API 기반으로 전환

## 배포 방법 (CLI)
`workers/search-ranking/wrangler.toml`에서 KV id를 실제 값으로 넣고:

```bash
cd workers/search-ranking
npx wrangler deploy
```

## 프론트 동작
- 메인 `이번 주 조회랭킹 TOP3`는 글로벌 집계 기반
- 랭킹 페이지 `조회 랭킹` 탭은 글로벌 집계 기반
- 의원페이지 진입 후 5초 체류 시 `POST /api/kr/member-view` 전송

## 주의
- Cloudflare KV는 원자적 increment를 제공하지 않아 극단적 동시성에서 소량 오차 가능
- 현재 트래픽 규모에서는 실사용 랭킹 지표로 충분

- 동일 사용자(anon_id) 기준 12시간 내 동일 의원 중복 집계는 차단
- IP 기준 분당 과도한 요청은 레이트리밋으로 무시
