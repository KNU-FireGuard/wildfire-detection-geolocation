# FireGuard AI

- 모든 명령은 별도 안내가 없으면 프로젝트 루트에서 실행
- Bash는 macOS·Linux·Git Bash용, Windows 명령은 CMD용
- 실제 영상 4개는 Git에 없으므로 조장에게 요청

## 준비물

- Node.js `^20.19.0 || >=22.12.0`과 npm
- Python과 pip
- Docker와 Docker Compose

## 1 환경 파일과 DB

- `.env`가 없으면 예시 파일을 복사

### Bash

```bash
test -f .env || cp .env.example .env
```

### Windows CMD

```cmd
if not exist ".env" copy ".env.example" ".env"
```

- `.env`의 `DB_PASSWORD`, `ADMIN_USERNAME`, `ADMIN_INITIAL_PASSWORD`, `JWT_SECRET`, `AI_CALLBACK_TOKEN` 입력
- `JWT_SECRET`은 32바이트 이상의 임의 문자열로 설정
- `AI_CALLBACK_TOKEN`은 AI 콜백 인증에 사용할 임의 문자열로 설정
- 초기 관리자 비밀번호는 12자 이상으로 설정

카메라 Test 기능을 사용하려면 AI 패키지 설치

### Bash

```bash
python3 -m pip install -r ai/requirements.txt
```

### Windows CMD

```cmd
python -m pip install -r ai/requirements.txt
```

```text
docker compose up -d db
```

- 기존 DB 볼륨을 사용하는 경우 아래 명령을 한 번 실행

### Bash

```bash
docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < sql/init.sql
```

### Windows CMD

```cmd
docker compose exec -T db sh -c "psql -v ON_ERROR_STOP=1 -U $POSTGRES_USER -d $POSTGRES_DB" < sql\init.sql
```

## 2 영상 등록

- 조장에게 받은 `경북의성.mp4`, `청성.mp4`, `기도4교.mp4`, `단촌4터널.mp4`를 `data/videos/`에 배치
- 카메라와 영상 정보를 DB에 등록

### Bash

```bash
docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < sql/seed.dev.sql
```

### Windows CMD

```cmd
docker compose exec -T db sh -c "psql -v ON_ERROR_STOP=1 -U $POSTGRES_USER -d $POSTGRES_DB" < sql\seed.dev.sql
```

## 3 관리자 계정과 Backend

- 새 터미널에서 실행
- `npm run create-admin`은 최초 설정 시 한 번만 실행, 이후 실행할 때는 생략
- 생성 후 `.env`의 `ADMIN_INITIAL_PASSWORD` 값 삭제

```text
cd backend
npm ci
npm run create-admin
npm run dev
```

- Backend 주소: `http://127.0.0.1:3000`

## 4 Frontend

- 다른 터미널에서 프로젝트 루트 기준으로 환경 파일 준비
- 지도 사용 시 `frontend/.env.local`에 `VITE_NAVER_MAP_CLIENT_ID` 설정
- 네이버 클라우드 Maps에 `http://127.0.0.1:5173`을 Web 서비스 URL로 등록

### Bash

```bash
test -f frontend/.env.local || cp frontend/.env.example frontend/.env.local
```

### Windows CMD

```cmd
if not exist "frontend\.env.local" copy "frontend\.env.example" "frontend\.env.local"
```

```text
cd frontend
npm ci
npm run dev
```

- 화면 주소: `http://127.0.0.1:5173`
- Backend 없이 화면 예시만 볼 때 `frontend/.env.local`의 `VITE_DATA_SOURCE=mock`으로 변경 후 Frontend 재시작

## 종료

- Backend와 Frontend 터미널에서 `Ctrl + C`
- 프로젝트 루트에서 `docker compose down`, DB 데이터는 유지

## 문서

- [API 명세](docs/API_SPEC.md) · [DB와 ERD](docs/DATABASE.md) · [시스템 아키텍처](docs/System_architecture.md) · [ADR](docs/ADR.md)
