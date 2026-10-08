# 개발 환경 안내

[프로젝트 소개](../README.md) · [시스템 아키텍처](System_architecture.md) · [API 명세서](API_SPEC.md)

이 문서의 실행 명령은 별도 설명이 없으면 프로젝트 루트를 기준으로 합니다.

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

## Frontend 실행 및 빌드

Backend와 별도 터미널을 열고 프로젝트 루트에서 실행합니다.

```bash
cd frontend
npm ci
npm run dev
```

기본 주소는 `http://127.0.0.1:5173`입니다. 포트가 사용 중이면 Vite가 출력한 주소를 확인합니다.
`/api` 요청은 Vite 프록시를 통해 `http://127.0.0.1:3000`으로 전달됩니다.
Backend의 `PORT`를 변경하면 `frontend/vite.config.js`의 대상 포트도 맞춥니다.

### 네이버 지도 설정

대시보드 지도는 네이버 지도 JavaScript API를 사용합니다. 네이버 클라우드 콘솔에서 Maps 애플리케이션을 만들고 **Dynamic Map**을 활성화한 뒤 Client ID를 발급받습니다. Web 서비스 URL에는 `http://127.0.0.1:5173`을 등록하세요. `localhost`로 접속한다면 그 주소도 등록해야 합니다.

`frontend/.env.local`에 Client ID를 설정합니다. 파일이 없으면 `frontend/.env.example`을 복사하고 기존 `VITE_DATA_SOURCE` 값은 유지합니다.

```dotenv
VITE_DATA_SOURCE=api
VITE_NAVER_MAP_CLIENT_ID=발급받은_Client_ID
```

Client ID는 브라우저에서 사용되므로 README나 소스에 직접 적지 말고, Client Secret은 프론트엔드 환경변수에 넣지 않습니다. 설정 후 Frontend 개발 서버를 재시작합니다. Client ID가 없거나 인증이 실패하면 지도 대신 안내 메시지가 표시됩니다. 기본 지도는 위성·지명(HYBRID)이며 일반·위성 지도로 전환할 수 있습니다. 실제 타일 표시는 유효한 Client ID로 브라우저에서 확인해야 합니다. [Client ID 발급 안내](https://navermaps.github.io/maps.js.ncp/docs/tutorial-1-Getting-Client-ID.html) · [지도 시작하기](https://navermaps.github.io/maps.js.ncp/docs/tutorial-2-Getting-Started.html)

배포용 파일을 만들 때는 `frontend/`에서 실행합니다.

```bash
npm run build
```

결과는 `frontend/dist/`에 생성됩니다. 빌드는 실행 중인 개발 서버를 자동 종료하지 않습니다.
Frontend와 Backend는 각 터미널에서 `Ctrl + C`로 종료합니다.

## AI JSON 로컬 수신 테스트

Backend를 실행한 뒤 Postman에서 다음과 같이 요청합니다.

1. `POST http://127.0.0.1:3000/api/detections`를 선택합니다.
2. **Body → raw → JSON**에서 [API 명세서](API_SPEC.md#4-ai--backend-결과-수신-api)의 요청 JSON 예시를 붙여넣습니다. Content-Type은 `application/json`입니다.
3. `200 OK`와 함께 `message: "탐지 결과를 수신했습니다."`, 요청 JSON 그대로인 `data`가 반환되는지 확인합니다.

Route는 요청 경로와 함수를 연결하고, Controller는 JSON을 검사한 뒤 응답합니다. 입력 검사는 `backend/src/validators/detections.validator.js`에서 담당합니다. DB 저장, 이벤트 처리, 토큰 인증은 미구현입니다. 성공 응답은 저장 완료를 의미하지 않습니다. 인증 없는 로컬 테스트용이므로 외부 공개 전 접근 제어를 추가해야 합니다.

### 입력값 검사 확인

상세 검증 규칙은 [API 명세서](API_SPEC.md#4-ai--backend-결과-수신-api)에서 관리합니다.
정상 예시는 200과 수신 데이터가 반환되어야 합니다. 같은 예시에서 `detection.confidence`를 `1.5`로 바꾸거나 `camera_id`를 삭제하면 400과 해당 필드의 오류 이유가 반환되어야 합니다.
브라우저 주소창 접속은 GET 요청이므로 이 POST API의 확인 방법이 아닙니다.

## 조회 API 확인

Backend 실행 후 브라우저나 curl로 확인할 수 있습니다.

```bash
curl 'http://127.0.0.1:3000/api/cameras'
curl 'http://127.0.0.1:3000/api/videos'
curl 'http://127.0.0.1:3000/api/events?limit=20&offset=0'
curl 'http://127.0.0.1:3000/api/events/1'
```

DB에 데이터가 없으면 목록은 빈 배열, 이벤트 상세는 404를 반환합니다.
상세 응답 및 입력 범위는 [API 명세서](API_SPEC.md)를 참고합니다.
`data/videos/`의 파일은 Git에서 제외하며, 파일 배치만으로 DB에 등록되지 않습니다.

영상 파일과 DB 등록 데이터가 준비되어 있으면 Frontend를 실행하고 `http://127.0.0.1:5173/` 대시보드 또는 `http://127.0.0.1:5173/videos`에 접속합니다. 대시보드는 연결된 이벤트의 영상이 있으면 그 영상을, 그렇지 않으면 첫 등록 영상을 재생합니다. 영상 목록에서 **재생**을 눌러 다른 영상을 선택할 수도 있습니다. 서버는 `GET /api/videos/:id/stream`으로 파일을 전달합니다. Range 응답을 직접 확인하려면 `curl -i -H 'Range: bytes=0-1023' http://127.0.0.1:3000/api/videos/1/stream`을 실행해 `206 Partial Content`를 확인합니다.

Backend 디렉터리에서 `npm test`로 조회 API 테스트를 실행합니다. 이 테스트는 DB 응답을 대체해 HTTP 라우팅·응답·입력 검사·오류 처리를 확인합니다.

실제 PostgreSQL 연동 검증은 DB를 실행하고 루트 `.env`를 설정한 뒤 Backend 디렉터리에서 실행합니다(macOS/Linux).

```bash
npm run test:integration
```

통합 테스트는 `sql/init.sql`을 기반으로 세션 전용 임시 테이블을 만들고 샘플 데이터를 넣어 정렬·페이지 처리·null 값·이벤트 상세 응답을 확인합니다. 기존 테이블과 데이터는 변경하지 않으며 테스트 종료 시 롤백합니다. 일반 `npm test`에서는 이 테스트를 건너뜁니다.

## 개발용 샘플 카메라·영상 등록

프로젝트 루트에서 아래 SQL을 실행합니다. 카메라 ID와 영상 ID는 DB가 생성하며, 같은 카메라 이름이나 파일 경로가 이미 있으면 재등록하지 않습니다.

```bash
docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < sql/seed.dev.sql
```

영상 파일은 Git에 포함되지 않습니다. 테스트에 필요한 `경북의성.mp4`, `청성.mp4`, `기도4교.mp4`, `단촌4터널.mp4`를 조장에게 받아 `data/videos/`에 넣은 뒤 seed SQL을 실행합니다. SQL은 영상 파일을 DB에 복사하지 않고 카메라 좌표와 영상 메타데이터·상대 경로를 등록합니다. 조회 결과는 `GET /api/cameras`와 `GET /api/videos`에서 확인할 수 있습니다. 파일이 없거나 경로가 DB 값과 다르면 스트리밍 API가 404를 반환합니다. ID는 DB가 생성하므로 팀원별 로컬 DB에서 값이 다를 수 있습니다.
