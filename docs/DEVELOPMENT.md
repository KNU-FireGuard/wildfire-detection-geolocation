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

기본 주소는 `http://localhost:5173`입니다. 포트가 사용 중이면 Vite가 출력한 주소를 확인합니다.
`/api` 요청은 Vite 프록시를 통해 `http://127.0.0.1:3000`으로 전달됩니다.
Backend의 `PORT`를 변경하면 `frontend/vite.config.js`의 대상 포트도 맞춥니다.

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
