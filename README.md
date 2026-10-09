# FireGuard AI

- 목표: 실시간 CCTV 산불 탐지와 종류별 SMS 알림
- 현재 데모 계획: Test 버튼 한 번으로 준비된 영상 4개 동시 재생·분석
- 현재 구현: 카메라·영상·이벤트 조회, 로컬 영상 스트리밍, 지도 화면, 기존 탐지 JSON 수신 확인
- 미구현: Test 버튼, 4개 동시 재생, AI 자동 추론, 이벤트 자동 저장, 관리자 로그인, SMS 발송

## 준비물

- Node.js·npm: Frontend Vite 기준 `^20.19.0 || >=22.12.0`
- Docker와 Docker Compose
- 실제 영상 4개는 Git에 없으므로 조장에게 요청
  - `경북의성.mp4`, `청성.mp4`, `기도4교.mp4`, `단촌4터널.mp4`
- 네이버 지도 Client ID는 선택, 없으면 지도 설정 안내 표시
- 아래 명령의 기본 실행 위치는 프로젝트 루트

## 1 DB 실행

- `.env`가 없으면 예시 파일 복사
- `DB_PASSWORD`를 로컬 비밀번호로 변경
- 기존 `.env`가 있으면 유지

```bash
test -f .env || cp .env.example .env
docker compose up -d db
```

- 새 DB 볼륨에는 `sql/init.sql` 자동 적용
- 기존 볼륨은 [기존 DB에 스키마 적용](#기존-db에-스키마-적용) 참고

## 2 영상 등록

- 조장에게 받은 파일을 `data/videos/`에 배치
- 아래 명령으로 카메라·영상 메타데이터 등록
- 파일만 배치하면 DB 목록에 자동 등록되지 않음

```bash
docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < sql/seed.dev.sql
```

- 영상 없이 화면 구조만 확인할 때는 이 단계 생략 가능

## 3 Backend 실행

- 새 터미널에서 실행
- DB 연결 성공 후 API 주소: `http://127.0.0.1:3000`

```bash
cd backend
npm ci
npm run dev
```

## 4 Frontend 실행

- 다른 터미널에서 프로젝트 루트 기준으로 환경 파일 준비
- `VITE_DATA_SOURCE=api` 유지
- Backend 연결 없이 화면 예시를 볼 때만 `VITE_DATA_SOURCE=mock`으로 변경하고 Frontend 재시작
- 지도 사용 시 네이버 클라우드 Maps의 Dynamic Map Client ID를 `VITE_NAVER_MAP_CLIENT_ID`에 설정
- Web 서비스 URL에 `http://127.0.0.1:5173` 등록, `localhost:5173`을 사용하면 해당 주소도 등록
- Client Secret은 Frontend에 넣지 않음

```bash
test -f frontend/.env.local || cp frontend/.env.example frontend/.env.local
```

- 새 터미널에서 실행

```bash
cd frontend
npm ci
npm run dev
```

- 화면 주소: `http://127.0.0.1:5173`
- 경로: `/` 대시보드, `/cameras` 카메라, `/videos` 영상, `/events` 탐지 이벤트
- 현재 이벤트 자동 저장 기능이 없으므로 DB에 이벤트가 없으면 목록도 비어 있음

## 기존 DB에 스키마 적용

- 기존 Docker 볼륨에는 `sql/init.sql` 변경이 자동 반영되지 않음
- 기존 카메라·영상·이벤트 테이블은 유지하고 누락된 관리자·SMS 수신자 테이블 생성
- 이미 존재하는 테이블의 컬럼·제약조건은 변경하지 않음

```bash
docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < sql/init.sql
```

- `sql/seed.dev.sql`은 개발용 데이터만 등록

## 테스트와 종료

- Backend: `backend/`에서 `npm test`
- DB 통합 테스트: PostgreSQL 실행 후 `backend/`에서 `npm run test:integration`
- Frontend 테스트: `frontend/`에서 `node --test test/*.test.js`
- Frontend 빌드: `frontend/`에서 `npm run build`
- Backend·Frontend 종료: 각 터미널에서 `Ctrl + C`
- DB 종료: 프로젝트 루트에서 `docker compose down`, 볼륨 유지

## 관련 문서

- [시스템 아키텍처](docs/System_architecture.md)
- [API 명세](docs/API_SPEC.md)
- [ERD와 DB 명세](docs/DATABASE.md)
- [ADR](docs/ADR.md)
- [AI 학습 결과](ai/README.md)
- [협업 규칙](.github/CONTRIBUTING.md)
