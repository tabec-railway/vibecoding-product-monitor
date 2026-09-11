# 바이브코딩대학 상품 모니터

Cafe24 공개 상품을 수집하는 과제용 Vercel 앱입니다.

## Vercel 환경 변수

- `DATABASE_URL`: PostgreSQL 연결 문자열
- `ADMIN_TOKEN`: 관리 화면 비밀번호
- `CRON_SECRET`: 자동 수집 엔드포인트 비밀값

Vercel Hobby에서는 매일 한국 시간 00:00에 자동 수집합니다.
