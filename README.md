# FireGuard AI

CCTV·영상 기반 산불 탐지 및 화재 위치 추정 모니터링 프로젝트입니다.

YOLO 기반 화재·연기 탐지 모델을 활용하여 영상에서 화재·연기를 탐지하고, 영상 정보를 기반으로 실제 화점 위치에 최대한 근접한 좌표를 추정하여 지도에 표시하는 시스템을 목표로 합니다. 핵심 연구 주제는 화재 위치 추정의 정확도 향상과 오차 분석입니다.

## 현재 상태

초기 저장소 구조와 PostgreSQL 개발 실행 설정을 준비하고, Backend 라이브러리(express, pg, dotenv) 설치 및 기본 코드 작성을 마친 단계입니다. 서버 실행 시 PostgreSQL 연결을 먼저 검증한 후 구동되는 기본 뼈대가 갖추어졌습니다.

Frontend는 Vue 3와 Vite 기반으로 초기 프로젝트 구성 및 백엔드 API 프록시 설정을 마쳤습니다. `POST /api/detections`의 로컬 수신·응답을 구현했습니다. 기본 입력값 검사를 추가했으며, 초기 테이블 생성 스크립트(`sql/init.sql`)를 작성했으며, 인증·DB 저장, 나머지 기능별 API, AI 모듈 연동은 구현 전입니다. AI → Backend 결과 전달 JSON의 기본 형식은 아래와 같이 합의했으며, Frontend 응답 규격은 협의 예정이며, DB 구조는 녹화영상 기준 초안입니다. 초기 입력은 제공된 녹화 영상을 사용하며, 실시간 CCTV는 접근 가능 여부에 따라 추가합니다.

## 시스템 흐름

![FireGuard AI 시스템 흐름도](docs/system-flow.png)

AI와 Frontend는 Backend를 통해 데이터를 주고받습니다. 영상 파일은 서버 파일시스템에 저장하고 DB에는 경로와 메타데이터를 저장합니다. 연속 탐지는 하나의 이벤트로 묶는 방향이며, 구체적인 기준은 추후 정합니다.

## AI → Backend 결과 전달 JSON

AI 모듈의 탐지 결과와 위치 추정 결과는 다음 JSON 형식으로 Backend에 전달하기로 했습니다. 아래 값은 예시이며, 이 형식의 합의가 수신 API 구현 완료를 의미하지는 않습니다. Backend가 처리한 Frontend용 응답 JSON은 별도로 정의합니다. 상세 명세는 [API_SPEC.md의 AI 결과 수신 항목](docs/API_SPEC.md#4-ai--backend-결과-수신-api)에서 관리하며, 형식 변경 시 이 README의 예시도 함께 갱신합니다.

```json
{
  "camera_id": 1,
  "video_id": 3,
  "timestamp": "2026-10-01T18:10:00",
  "detection": {
    "class": "fire",
    "confidence": 0.94,
    "bbox": {
      "x1": 420,
      "y1": 210,
      "x2": 550,
      "y2": 300
    }
  },
  "location_estimation": {
    "latitude": 35.123456,
    "longitude": 128.123456,
    "error_range_m": 50
  }
}
```

| 필드 | 의미 |
| --- | --- |
| `camera_id` | 카메라 식별자 |
| `video_id` | 영상 식별자 |
| `timestamp` | AI 프로그램이 실제로 탐지한 시각 문자열 |
| `detection.class` | 탐지 클래스 (예시: `fire`) |
| `detection.confidence` | 탐지 신뢰도 |
| `detection.bbox` | 탐지 영역의 두 좌표 쌍 (`x1`, `y1`, `x2`, `y2`) |
| `location_estimation.latitude` | 추정 화재 위치의 위도 |
| `location_estimation.longitude` | 추정 화재 위치의 경도 |
| `location_estimation.error_range_m` | 위치 추정 오차 범위 (미터) |

좌표는 실제 화점의 확정 위치가 아닌 추정 결과입니다. 예시의 `timestamp`에는 시간대가 없으므로 전달할 시간대 표기는 추가로 정해야 합니다. 이 값은 영상 재생 시간이 아니라 AI 프로그램이 실제로 탐지한 시각입니다. bbox의 좌표 기준·단위, 오차 범위의 구체적인 의미, 위치 추정 실패 시 표현도 별도 협의 사항입니다.

## 기술 스택

- Backend: Node.js, Express, PostgreSQL
- Frontend: JavaScript, Vue.js, Vite
- AI: Python, YOLO, 필요 시 OpenCV
- 실행 환경: Docker

## 팀 역할

| 담당자 | 역할 |
| --- | --- |
| 김경민 | YOLO 탐지 및 화재 위치 추정 공동 연구·개발 |
| 김형규 | 화재 위치 추정 공동 연구·개발, 관련 연구 검토 및 오차 분석 |
| 유선우 | Backend, DB·ERD, REST API, AI 결과 관리, Frontend·SMS 연동 |
| 채정인 | Vue.js 대시보드, Map API, 탐지 및 추정 위치 시각화 |

## 폴더 구조

```text
wildfire-detection-geolocation/
├── docs/                # 프로젝트 문서 및 API 명세서
│   ├── API_SPEC.md      # 협업용 API 및 데이터 인터페이스 명세서 (초안)
│   └── system-flow.png  # 시스템 구성 및 데이터 흐름도
├── backend/             # Backend
│   ├── src/
│   │   ├── app.js       # Express 앱 설정, 미들웨어, 공통 에러 처리
│   │   ├── config/
│   │   │   └── db.js    # PostgreSQL 연결 풀(Pool) 설정
│   │   ├── server.js    # DB 사전 검증 및 서버 기동/종료
│   │   ├── validators/
│   │   │   └── detections.validator.js # 입력값 검사
│   │   ├── controllers/
│   │   │   └── detections.controller.js # JSON 수신·응답
│   │   └── routes/
│   │       ├── index.js # 기능별 라우터 연결
│   │       └── detections.routes.js # 탐지 결과 POST 경로 연결
│   ├── package.json
│   └── package-lock.json
├── frontend/            # Frontend (Vue 3 + Vite)
│   ├── src/
│   │   ├── api/         # Backend API 통신 함수 모음
│   │   ├── components/  # 대시보드 화면 UI 컴포넌트
│   │   ├── utils/       # 공통 유틸리티 함수
│   │   ├── App.vue      # 대시보드 메인 컴포넌트
│   │   ├── main.js      # Vue 인스턴스 마운트
│   │   └── style.css    # 기본 리셋 스타일
│   ├── index.html       # 웹 진입점 HTML
│   ├── vite.config.js   # Vite 및 Backend 프록시(/api) 설정
│   ├── package.json
│   └── package-lock.json
├── ai/                  # 탐지 및 위치 추정
├── sql/                 # DB 테이블 생성 SQL
│   └── init.sql         # cameras, videos, detection_events 초기 생성
├── data/                # 로컬 영상 및 데이터
├── docker-compose.yml   # PostgreSQL 개발 실행 설정
├── .env.example         # 환경변수 예시
├── .gitignore
└── README.md
```

Git은 빈 폴더를 추적하지 않으므로 GitHub에 폴더가 표시되도록 `.gitkeep`을 넣어두었습니다. 해당 폴더에 Git으로 관리할 실제 파일을 추가한 뒤에는 `.gitkeep`을 삭제해도 됩니다.

`data/`의 실제 영상·데이터 파일은 `.gitignore`로 제외합니다. 필요한 파일은 별도로 전달받아 로컬에 배치합니다.

## Backend 라이브러리 설치 및 실행

Node.js와 npm이 설치되어 있어야 합니다. 프로젝트를 내려받은 뒤 프로젝트 루트에서 다음 명령을 실행합니다.

```bash
cd backend
npm ci
```

`npm ci`는 `package.json`과 `package-lock.json`을 기반으로 기록된 버전의 라이브러리를 설치합니다. `npm init`이나 라이브러리별 설치 명령을 다시 실행할 필요는 없습니다.

- `express`: API 서버 구성
- `pg`: PostgreSQL 연결
- `dotenv`: `.env` 파일의 환경변수 읽기

`package.json`과 `package-lock.json`은 Git으로 함께 관리합니다. 설치된 라이브러리가 들어가는 `node_modules/`는 `.gitignore`로 제외합니다.

아래 단계는 프로젝트 루트에서 진행합니다. 위 설치 명령을 실행했다면 `cd ..`로 돌아옵니다.

## 개발용 PostgreSQL 실행

Docker와 Docker Compose가 설치되어 있고 Docker가 실행 중이어야 합니다. 프로젝트 루트에서 실행합니다.

1. 환경변수 예시를 복사합니다. 이미 `.env`가 있다면 복사하지 않고 기존 설정을 확인합니다.

   ```bash
   cp .env.example .env
   ```

2. `.env`의 `DB_PASSWORD`를 로컬 개발용 비밀번호로 변경합니다. `.env`는 Git에 포함되지 않습니다.

3. PostgreSQL을 실행합니다.

   ```bash
   docker compose up -d db
   ```

4. 실행 상태를 확인합니다.

   ```bash
   docker compose ps
   ```

호스트에서 실행하는 Backend가 접속할 PostgreSQL 주소는 `localhost`, 기본 포트는 `5432`입니다. 데이터는 Docker 볼륨 `postgres_data`에 보관합니다. `sql/init.sql`은 DB 저장공간이 비어 있는 최초 초기화 때 자동 실행됩니다. 이미 사용하던 볼륨에는 자동 적용되지 않으므로 아래의 기존 DB 적용 방법을 사용합니다.

종료할 때는 `docker compose down`을 사용합니다. 일반 종료 시 DB 볼륨은 유지됩니다. `.env`의 DB 계정 설정은 빈 볼륨을 처음 초기화할 때 적용되므로, 이후 값을 변경해도 기존 DB 계정이 자동으로 변경되지는 않습니다.

## Backend 서버 실행

위 단계에서 PostgreSQL을 실행한 뒤, 프로젝트 루트에서 `cd backend`로 이동합니다. 다음 두 명령 중 하나를 선택해 실행합니다.

- **일반 실행:**
  ```bash
  npm start
  ```
- **개발용 자동 재실행 (`--watch`):**
  ```bash
  npm run dev
  ```

서버 기동 시 먼저 PostgreSQL에 `SELECT 1` 쿼리를 보내 DB 연결 상태를 확인합니다. DB 연결이 성공하면 `http://127.0.0.1:3000`에서 요청을 대기합니다(기본 포트이며 `.env`의 `PORT`로 변경 가능). 연결 실패 시에는 서버를 띄우지 않고 프로세스를 즉시 종료합니다.

종료 시에는 터미널에서 `Ctrl + C`를 누르면 처리 중인 요청과 DB 연결 풀을 안전하게 정리(Graceful Shutdown)한 후 종료됩니다. 현재 `POST /api/detections`는 수신 확인 응답을 반환하며, 미등록 경로는 404 응답을 반환합니다.

## DB 테이블 추가 및 변경

새 테이블을 만들거나 기존 테이블의 컬럼을 변경할 때는 컨테이너를 재생성할 필요가 없습니다. 실행 중인 DB에 `CREATE TABLE`, `ALTER TABLE` 등의 SQL을 적용합니다. 변경 SQL은 `sql/`에 파일로 남겨 공유하고, 팀원들은 각자의 DB에 필요한 변경을 순서대로 적용합니다. 컬럼이나 테이블을 삭제하면 해당 데이터도 삭제되므로 적용 전에 팀원들과 확인합니다.

컨테이너를 삭제하고 다시 만들어도 기존 DB 볼륨을 연결하면 테이블과 데이터는 그대로 유지됩니다. `init.sql`은 Docker의 초기화 스크립트로 연결되어 있으며, DB 저장 공간이 비어 있는 최초 초기화 때만 실행됩니다. 파일 수정이나 컨테이너 재생성만으로 기존 DB의 테이블 구조가 자동으로 변경되지는 않습니다.

### 초기 테이블 구성

| 테이블 | 역할 | 관계 |
| --- | --- | --- |
| cameras | 카메라 이름과 설치 좌표 | 카메라 1대에 영상 여러 개 |
| videos | 원본 파일명, 서버 파일 경로, 카메라 ID | 영상 1개에 이벤트 여러 개 |
| detection_events | 탐지 시작·종료 시각, 최대 신뢰도, 추정 위치 | video_id로 영상 연결 |

영상 파일 자체와 매 프레임 bbox는 DB에 저장하지 않습니다. 카메라를 모르는 제공 영상은 videos.camera_id를 비워둘 수 있게 했습니다. 이는 DB 초안의 허용 규칙이며, 현재 AI 수신 API의 필수 camera_id 검사는 그대로입니다. 카메라 좌표와 추정 위치도 모르면 비워둘 수 있습니다. 위도·경도는 함께 저장하거나 함께 비워둡니다. 참조 중인 카메라·영상은 연관 데이터와 함께 자동 삭제되지 않습니다.

날짜·시간은 TIMESTAMPTZ로 저장합니다. 저장할 때 시간대가 명시된 시각을 사용하고 화면에서 한국 시각으로 표시하는 방향입니다. created_at은 DB 등록 시각이며 촬영 시각이 아닙니다. 이벤트의 started_at은 첫 탐지 시각, ended_at은 종료 시 기록하는 마지막 탐지 시각이며 진행 중에는 NULL입니다. updated_at은 수정할 때 Backend에서 갱신해야 하며 DB가 자동 갱신하지 않습니다.

이벤트 그룹핑 기준과 대표 추정 위치 선정 방식은 아직 미정입니다. 테이블 생성만으로 API가 데이터를 저장하지는 않습니다. 현재 POST /api/detections는 수신·검증·응답만 수행합니다.

### 이미 실행했던 DB에 최초 적용

기존 볼륨에 아직 위 세 테이블이 없다면 프로젝트 루트에서 다음 명령을 **한 번** 실행합니다. DB가 실행 중이어야 합니다.

```bash
docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < sql/init.sql
```

테이블 생성 결과는 다음 명령으로 확인합니다.

```bash
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "\dt"'
```

이미 테이블이 있으면 init.sql을 다시 실행하지 않습니다. 중복 실행 시 오류로 중단되며 기존 테이블을 덮어쓰지 않습니다. 전체 생성은 트랜잭션으로 처리되어 중간 실패 시 일부 테이블만 생성되지 않습니다.

### 다음 날 다시 개발할 때

Docker를 켠 뒤 프로젝트 루트에서 실행합니다.

```bash
docker compose up -d db
cd backend
npm start
```

SQL을 매번 실행할 필요는 없습니다. 일반 종료에는 docker compose down을 사용하고, 데이터가 필요한 경우 볼륨까지 삭제하는 -v 옵션은 사용하지 않습니다. 이후 구조 변경은 별도 변경 SQL로 기존 DB에 적용하고, 새 설치를 위한 init.sql에도 같은 구조를 반영합니다.

## Frontend 라이브러리 설치 및 개발 서버 실행

Frontend는 Vue 3와 JavaScript, Vite 기반으로 기본 프로젝트 구성을 완료했습니다. Backend 통신은 브라우저 내장 `fetch()`를 기본으로 사용하며, 개발 중 발생하는 `/api` 요청은 Vite 프록시 설정을 통해 Backend(`http://127.0.0.1:3000`)로 자동 전달됩니다. Nginx 배포 설정은 추후 서버 배포 시 적용합니다.

### 1. Frontend 라이브러리 설치 및 실행

프로젝트를 내려받은 뒤 프로젝트 루트에서 다음 명령을 실행합니다.

```bash
cd frontend
npm ci
npm run dev
```

`npm run dev` 실행 시 `http://localhost:5173`에서 프론트엔드 모니터링 화면이 실행됩니다. 종료는 터미널에서 `Ctrl + C`를 사용합니다.

### 2. Proxy(프록시)의 역할과 로컬 개발

**프록시는 요청을 받아 다른 서버로 대신 전달하고, 그 응답을 요청한 쪽에 돌려주는 역할입니다. 이 프로젝트는 개발할 때 Vite를, 배포할 때 Nginx를 API 요청의 프록시로 사용할 계획입니다.**

```text
브라우저 → Vite 개발 서버 (기본 localhost:5173)
               ├─ Vue 화면 제공
               └─ /api 요청을 프록시로 전달
                         ↓
                  Node.js Backend (127.0.0.1:3000)
```

Frontend와 Backend는 각각 별도 터미널에서 실행합니다. `frontend/vite.config.js`에는 `/api` 요청을 Backend로 전달하는 규칙이 다음과 같이 설정되어 있습니다.

```javascript
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
});
```

Backend도 `/api` 접두사를 사용하므로 전달할 때 경로를 제거하지 않습니다. Backend의 `PORT`를 변경하면 프록시 대상 포트도 맞춰야 합니다.

Frontend에서는 Backend 주소 전체를 직접 지정하지 않고 상대 경로를 사용합니다.

```javascript
fetch('/api/events');
```

브라우저는 화면을 제공한 Vite 서버에 요청하고, Vite가 Backend에 전달합니다. **CORS를 끄는 것이 아니라, 브라우저가 같은 출처(프로토콜·호스트·포트)로 요청하도록 구성하는 방식입니다.** 이 경로로 통신할 때는 Backend에 별도의 CORS 허용 설정이 필요하지 않습니다. `changeOrigin`은 전달 요청의 Host 헤더를 대상에 맞추는 옵션이며, 브라우저의 CORS를 해제하는 옵션이 아닙니다.

프록시는 요청 전달만 담당합니다. `/api/events` 등의 실제 API는 Backend에 구현해야 하며, 미구현 경로의 404 응답을 CORS 오류와 구분해야 합니다. 지도 API 등 외부 서비스 호출은 해당 서비스의 연동 규칙을 따릅니다.

### 3. 배포용 빌드

Frontend 초기 구성이 완료되면 프로젝트 루트에서 다음 명령으로 배포용 파일을 생성합니다.

```bash
cd frontend
npm run build
```

빌드는 Vue 소스를 브라우저가 실행할 HTML·CSS·JavaScript와 관련 리소스로 변환하며, 기본 출력 위치는 `frontend/dist/`입니다. 정적 파일이라는 것은 서버가 미리 만들어진 파일을 전달한다는 뜻이며, 브라우저에서는 JavaScript가 실행되어 화면 갱신과 API 요청이 가능합니다.

`npm run build`는 파일을 생성하고 종료하는 작업입니다. 이미 실행 중인 `npm run dev`를 자동으로 종료하지 않습니다.

**회사 서버에서는 Vite 개발 서버를 실행하지 않고 Nginx가 빌드 결과를 제공합니다.** 따라서 Vite 프록시를 별도로 끌 필요가 없습니다. 개발용 프록시 설정은 로컬 개발을 위해 소스에 남겨두고, 배포 환경의 API 전달은 Nginx가 담당하도록 설정합니다.

### 4. 회사 서버의 Nginx 구성

```text
사용자 브라우저 ↔ Nginx
                    ├─ Frontend 빌드 파일 제공
                    └─ /api 요청을 Backend로 전달 (리버스 프록시)
                                      ├─ PostgreSQL
                                      ├─ AI 모듈
                                      └─ SMS API
```

Nginx는 회사 서버에 설치하거나 컨테이너로 실행합니다. 빌드한 파일을 제공하는 웹 서버 역할과 `/api` 요청을 Backend에 전달하는 리버스 프록시 역할을 함께 맡습니다. Frontend 코드는 전달받은 사용자 브라우저에서 실행됩니다.

화면과 API를 동일한 출처로 제공하도록 구성하면 Frontend의 상대 경로 요청을 유지할 수 있고, 이 통신에는 별도의 CORS 허용 설정이 필요하지 않습니다. 서로 다른 출처로 배포하기로 변경하면 Backend에서 허용할 Frontend 출처와 인증 방식에 맞는 CORS 설정을 검토합니다.

Nginx의 Backend 연결 주소는 실제 배포 형태에 맞춥니다. 특히 Nginx와 Backend가 서로 다른 컨테이너라면 `127.0.0.1`은 각 컨테이너 자신을 가리키므로, 컨테이너 간 통신 주소와 Backend 수신 주소를 별도로 설정해야 합니다. 구체적인 구성은 회사 서버 환경 확인 후 정합니다.

### 5. GitHub 관리 대상과 배포 대상

로컬에서 빌드한 결과를 회사 서버에 배포하는 방식을 기준으로 합니다.

| 항목 | GitHub 관리 | 회사 서버 배포 |
| --- | --- | --- |
| Frontend 소스·설정·패키지 파일 | 계속 관리 | 빌드 결과만 배포한다면 실행에 불필요 |
| Frontend `node_modules/` | 제외 | 업로드 불필요 |
| Frontend `dist/` | 초기 설정 시 제외 규칙 추가 예정 | 빌드 결과 배포 |
| Nginx 설정 | 작성 후 관리 | 서버에 적용하고 Nginx 실행 |
| Backend·AI | 코드와 의존성 목록 관리 | 코드 및 실행에 필요한 의존성 준비 |
| 실제 비밀번호·영상·모델 파일 | 저장소 밖에서 별도 관리하도록 구성 | 필요한 환경과 저장 위치에 배치 |

**배포 서버에 Frontend 소스 전체가 필요하지 않더라도, GitHub에는 소스를 계속 보관합니다.** 화면을 수정한 뒤 다시 빌드하려면 원본이 필요합니다. Frontend에 포함되는 값은 브라우저에서 볼 수 있으므로 DB 비밀번호나 SMS 서비스의 비밀키는 Backend에서만 관리합니다.

### 6. 진행 순서와 검증

1. 기존 `frontend/` 파일을 확인하고 Vue 프로젝트를 초기화합니다.
2. 예제 화면을 정리하고 Vite의 `/api` 프록시를 설정합니다.
3. `npm run dev`로 기본 화면이 표시되는지 확인합니다.
4. Backend API 구현 후 프록시를 통한 요청·응답을 확인합니다.
5. `npm run build`로 배포용 파일이 생성되는지 확인합니다.
6. README에 실제 실행 방법을 반영하고, `node_modules/`와 `dist/`의 Git 제외 여부를 확인합니다.
7. 회사 서버 배포 단계에서 Nginx를 구성하고 정적 파일 제공과 `/api` 전달을 검증합니다.

참고: [Vue 공식 시작 안내](https://vuejs.org/guide/quick-start), [Vite 개발 프록시](https://vite.dev/config/server-options#server-proxy), [Vite 배포용 빌드](https://vite.dev/guide/build).

## AI JSON 로컬 수신 테스트

Backend를 실행한 뒤 Postman에서 다음과 같이 요청합니다.

1. `POST http://127.0.0.1:3000/api/detections`를 선택합니다.
2. **Body → raw → JSON**에서 위의 AI JSON 예시를 붙여넣습니다. Content-Type은 `application/json`입니다.
3. `200 OK`와 함께 `message: "탐지 결과를 수신했습니다."`, 요청 JSON 그대로인 `data`가 반환되는지 확인합니다.

Route는 요청 경로와 함수를 연결하고, Controller는 JSON을 검사한 뒤 응답합니다. 입력 검사는 `backend/src/validators/detections.validator.js`에서 담당합니다. DB 저장, 이벤트 처리, 토큰 인증은 미구현입니다. 성공 응답은 저장 완료를 의미하지 않습니다. 인증 없는 로컬 테스트용이므로 외부 공개 전 접근 제어를 추가해야 합니다.

### 입력값 검사 및 테스트

정상 요청은 200, 검사 실패는 400과 `error`, 필드별 오류 목록인 `details`를 반환합니다. 현재 개발용 기준으로 예시의 모든 필드를 필수로 검사합니다. ID는 양의 안전한 정수, 신뢰도는 0~1, bbox 좌표는 유한한 숫자, 위도·경도는 각각 -90~90과 -180~180, 오차 범위는 0 이상의 유한한 숫자여야 합니다. 클래스와 timestamp는 비어 있지 않은 문자열인지 확인합니다.

숫자 문자열은 자동 변환하지 않고 추가 필드는 허용합니다. 날짜 유효성·시간대, 클래스 목록, bbox 단위·순서·이미지 경계는 아직 검사하지 않습니다. 위치 추정 실패 표현은 미정이므로 현재 `location_estimation`은 좌표 객체만 허용하며 null은 거절합니다. 필수 여부와 실패 표현은 AI 담당자와 확인 후 조정할 개발용 기준입니다.

Backend를 실행한 상태에서 JSON을 직접 POST로 보내 확인합니다. 정상 예시는 200과 수신 데이터가 반환되어야 합니다. 같은 예시에서 `detection.confidence`를 `1.5`로 바꾸거나 `camera_id`를 삭제하면 400과 해당 필드의 오류 이유가 반환되어야 합니다. 브라우저 주소창 접속은 GET 요청이므로 이 POST API의 확인 방법이 아닙니다.
