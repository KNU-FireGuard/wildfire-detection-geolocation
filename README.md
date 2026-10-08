# FireGuard AI

CCTV·영상 기반 산불 탐지 및 화재 위치 추정 모니터링 프로젝트입니다.

YOLO로 화재·연기를 탐지하고, 영상 정보를 기반으로 화점 좌표를 추정해 지도에 표시하는 시스템을 목표로 합니다. 핵심 연구 주제는 위치 추정의 정확도 향상과 오차 분석입니다.
초기 입력은 제공된 녹화 영상이며, 실시간 CCTV는 접근 가능 여부에 따라 추가합니다.

## 현재 상태

| 영역 | 구현된 내용 | 다음 작업 |
| --- | --- | --- |
| AI | YOLO26n 학습 결과 및 가중치 보관 | 위치 추정 연구·개발 및 Backend 연동 |
| Backend | DB 연결 검증, 탐지 결과 수신·검증, 카메라·영상·이벤트 조회 API, 로컬 영상 스트리밍 | 인증, 이벤트 처리·DB 저장, 영상 등록 |
| DB | PostgreSQL 개발 실행 설정, 카메라·영상·이벤트 초기 스키마 | 저장 로직 연동 및 스키마 구체화 |
| Frontend | 관제 대시보드, 영상 재생, 카메라·영상·이벤트 조회, 네이버 위성 지도 및 위치 마커 연동 | 지도 인증 설정·실제 표시 검증, 이벤트 자동 갱신 |

현재 탐지 결과 API의 성공 응답은 수신 확인이며, DB 저장 완료를 의미하지 않습니다.
AI 요청 JSON의 기본 형식은 합의했으며, 상세 규칙은 협의 중입니다. 조회 API 응답 예시는 API 명세서에서 관리합니다.

## 문서

- [시스템 아키텍처](docs/System_architecture.md): 시스템 흐름도, 구성요소, DB 설계 및 배포 계획
- [DB 명세서](docs/DATABASE.md): ERD, 컬럼 설명·제약조건 및 데이터 등록 순서
- [개발 환경 안내](docs/DEVELOPMENT.md): 설치·실행, 기존 DB 초기화, DB 변경 및 로컬 API 테스트
- [API 명세서](docs/API_SPEC.md): API 목록, AI 요청·응답 및 검증 규칙
- [AI 학습 결과](ai/README.md): 모델 설정 및 학습 성능
- [협업 규칙](.github/CONTRIBUTING.md): 브랜치, 커밋 및 코드 리뷰 규칙

## 기술 스택

| 영역 | 기술 |
| --- | --- |
| Backend | Node.js, Express |
| DB | PostgreSQL, Docker Compose |
| Frontend | JavaScript, Vue 3, Vite |
| AI | Python, YOLO; 필요 시 OpenCV |
| 배포 계획 | Nginx |

## 폴더 구조

```text
wildfire-detection-geolocation/
├── .github/             # 협업 규칙 및 이슈·PR 템플릿
├── docs/                # 아키텍처·개발 안내·API 명세서
├── backend/             # Express API 서버
├── frontend/            # Vue 모니터링 화면
├── ai/                  # AI 학습 결과 및 탐지·위치 추정 관련 파일
├── sql/                 # DB 초기 스키마 및 변경 SQL
├── data/                # 로컬 영상·데이터 (실제 파일은 Git 제외)
├── docker-compose.yml   # 개발용 PostgreSQL
├── .env.example         # 환경변수 예시
└── README.md
```

## 빠른 시작

Node.js·npm과 Docker Compose가 필요합니다. Docker를 실행한 뒤 프로젝트 루트에서 진행합니다.

### 1. 환경변수 및 DB 준비

`.env`가 없다면 예시를 복사하고 `DB_PASSWORD`를 로컬 개발용 비밀번호로 변경합니다.

```bash
cp .env.example .env
```

기존 `.env`가 있다면 유지하고 설정을 확인합니다. DB를 실행합니다.

```bash
docker compose up -d db
docker compose ps
```

빈 DB 볼륨은 `sql/init.sql`로 자동 초기화됩니다. 기존 볼륨에 테이블이 없다면 [기존 DB 적용 방법](docs/DEVELOPMENT.md#이미-실행했던-db에-최초-적용)을 따릅니다.

### 2. Backend 실행

프로젝트 루트에서 실행합니다.

```bash
cd backend
npm ci
npm run dev
```

기본 주소는 `http://127.0.0.1:3000`이며, DB 연결에 성공해야 서버가 시작됩니다.

### 3. Frontend 실행

별도 터미널을 열고 프로젝트 루트에서 실행합니다.

대시보드 지도용 Client ID를 발급받으려면 네이버 클라우드 콘솔에서 **Maps → Application**을 만들고 다음과 같이 등록합니다.

1. **Application 이름**에 `wildfire-dashboard`를 입력합니다. 이 이름은 콘솔에서 앱을 구분하기 위한 이름입니다.
2. **API 선택**에서 **Dynamic Map**을 체크합니다.
3. **Web 서비스 URL**에 `http://127.0.0.1:5173`을 입력하고 **추가**를 누릅니다. 브라우저에서 `http://localhost:5173`으로 접속할 경우 그 주소도 별도로 추가합니다.
4. 앱 등록 후 발급된 **Client ID**를 `frontend/.env.local`에 설정하고 Frontend 개발 서버를 재시작합니다.

프로젝트 루트에서 아래 명령으로 `frontend/.env.example`을 복사해 `frontend/.env.local`을 만듭니다.

```bash
cp frontend/.env.example frontend/.env.local
```

그다음 `.env.local`을 열어 Client ID를 입력하세요. 기존 `VITE_DATA_SOURCE=api` 설정은 유지합니다.

```dotenv
VITE_DATA_SOURCE=api
VITE_NAVER_MAP_CLIENT_ID=발급받은_Client_ID
```

`.env.local`은 Git에서 제외됩니다. Client ID를 README나 소스 코드에 적지 말고, **Client Secret은 프론트엔드에 넣지 마세요.** 설정하지 않아도 Frontend는 실행되지만 지도 대신 설정 안내가 표시됩니다. 자세한 내용은 [개발 환경 안내의 네이버 지도 설정](docs/DEVELOPMENT.md#네이버-지도-설정)을 참고하세요.

```bash
cd frontend
npm ci
npm run dev
```

기본 주소는 `http://127.0.0.1:5173`입니다. `/api` 요청은 Backend로 전달됩니다.

대시보드는 DB에 등록된 영상 중 이벤트에 연결된 영상 또는 첫 영상을 재생합니다. `/videos`에서 영상 목록과 재생 버튼을 사용할 수도 있습니다. 영상 파일은 용량 때문에 Git에 포함되지 않습니다. 테스트에 필요한 `경북의성.mp4`, `청성.mp4`, `기도4교.mp4`, `단촌4터널.mp4`를 조장에게 받아 프로젝트의 `data/videos/`에 넣은 뒤, 프로젝트 루트에서 개발용 메타데이터를 등록합니다.

```bash
docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < sql/seed.dev.sql
```

이 seed는 `경북의성.mp4`, `청성.mp4`, `기도4교.mp4`, `단촌4터널.mp4`를 등록합니다. 파일과 DB 메타데이터가 맞지 않으면 대시보드에 안내 문구가 표시됩니다. Frontend 페이지는 `/`(대시보드), `/cameras`(카메라 목록), `/videos`(영상 목록), `/events`(이벤트 목록), `/events/:id`(이벤트 상세)입니다. 영상 스트리밍 API는 [API 명세서](docs/API_SPEC.md#34-영상-스트리밍)를 참고합니다.

대시보드도 기본적으로 Backend 데이터를 조회합니다. 디자인 확인용 예시 데이터는 `frontend/.env.local`에 `VITE_DATA_SOURCE=mock`을 설정하고 개발 서버를 재시작하면 대시보드에서만 사용할 수 있습니다. 운영 배포 시에는 `/cameras` 등의 직접 접속과 새로고침을 위해 정적 호스팅 서버의 SPA fallback 설정이 필요합니다.
AI 실행·연동 절차는 아직 준비되지 않았으며, 요청 테스트는 [개발 환경 안내](docs/DEVELOPMENT.md#ai-json-로컬-수신-테스트)를 참고합니다.

서버는 각 터미널에서 `Ctrl + C`로 종료합니다. DB 종료는 루트에서 `docker compose down`을 사용하며, 데이터를 유지하려면 `-v` 옵션을 사용하지 않습니다.

## 팀 역할

| 담당자 | 역할 |
| --- | --- |
| 김경민 | YOLO 산불 탐지 모델 구축 및 화재 위치 추정 공동 연구·개발 |
| 김형규 | 화재 위치 추정 공동 연구·개발, 관련 연구 검토 및 오차 분석 |
| 유선우 | Backend, DB·ERD, REST API, AI 결과 관리, Frontend·SMS 연동 |
| 채정인 | Vue 대시보드, Map API, 탐지 및 추정 위치 시각화 |
