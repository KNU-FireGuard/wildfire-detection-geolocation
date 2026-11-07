# FireGuard AI

- 모든 명령은 별도 안내가 없으면 프로젝트 루트에서 실행
- Bash는 macOS·Linux·Git Bash용, Windows 명령은 CMD용
- 실제 영상 4개는 Git에 없으므로 조장에게 요청

## 준비물

- Node.js `^20.19.0 || >=22.12.0`과 npm
- Python과 pip
- Docker와 Docker Compose
- [Git LFS](https://git-lfs.com): 저장소를 내려받기 전에 `git lfs install` 실행, 설치하지 않으면 모델 가중치(`.pt`)가 포인터 파일로 받아져 분석이 실패

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
- `AI_CALLBACK_TOKEN`은 32바이트 이상의 임의 문자열로 설정
- 초기 관리자 비밀번호는 12자 이상으로 설정
- AI 모델은 기본값 `ai/weights/yolo26s_final/weights/best.pt`를 사용, 다른 가중치를 쓰려면 `.env`에 `AI_MODEL_PATH`(저장소 루트 기준 경로) 설정

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

- 기존 DB 볼륨을 사용하는 경우 아래 명령을 다시 실행해 ITS 카메라·실시간 탐지·이벤트 확인 컬럼 반영, 기존 데이터는 유지

### Bash

```bash
docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < sql/init.sql
```

### Windows CMD

```cmd
docker compose exec -T db sh -c "psql -v ON_ERROR_STOP=1 -U $POSTGRES_USER -d $POSTGRES_DB" < sql\init.sql
```

## 2 영상 등록

- 조장에게 받은 영상을 아래 파일명으로 `data/videos/`에 배치

| 카메라 | 파일명 |
| --- | --- |
| 경북의성 | `경북의성.mp4` |
| 청성 | `청성.mp4` |
| 기도4교 | `기도4교.mp4` |
| 단촌4터널 | `단촌4터널.mp4` |

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
- ITS 실영상 사용 시 루트 `.env`에 `ITS_CCTV_API_KEY=발급키` 설정 후 Backend 재시작
- 대시보드의 CCTV 주소 갱신 버튼에서 관리자 계정으로 최초 목록 조회 또는 영상 주소 수동 갱신
- Test 카메라를 선택한 뒤 `Test 분석 시작`을 누르면 로그인 없이 등록 영상 분석 실행
- Backend를 재시작하면 저장된 실시간 CCTV 6대를 자동 분석, 기본 작업자는 `ai/inference/live_runner.py`이며 `AI_LIVE_RUNNER_PATH`는 비워 둬도 됨
- 실시간도 5fps·최근 20프레임 중 16회·불 0.3/연기 0.5 적용, Backend 로그의 `analysis_fps`·`dropped`로 처리 속도 확인
- 화재 문자: 기존 DB는 `sql/init.sql` 재실행, 사이드 메뉴 `문자 알림 관리`에서 관리자 로그인 후 카메라별 번호 설정과 발송 내역 확인
- `SMS_PROVIDER=console`(기본)은 실제 발송 없이 Backend 로그와 발송 내역만 기록
- 실제 발송은 [솔라피](https://solapi.com) 가입 후 `.env`에 `SMS_PROVIDER=solapi`, `SOLAPI_API_KEY`, `SOLAPI_API_SECRET`, `SOLAPI_SENDER` 설정, Backend 재시작
- 가입 본인인증 번호는 발신번호로 자동 등록, 가입 시 300P 무료(SMS 건당 18P), 소진되면 충전 필요

## 4 Frontend

- 다른 터미널에서 프로젝트 루트 기준으로 환경 파일 준비
- 지도 사용 시 `frontend/.env.local`에 `VITE_NAVER_MAP_CLIENT_ID` 설정
- 네이버 클라우드 Maps의 Web 서비스 URL에 접속 주소를 포트 없이 등록(`http://localhost`, `http://127.0.0.1`)
- 등록하지 않은 주소로 접속하면 지도 인증이 실패하므로 등록한 주소로 접속

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
