# FireGuard AI API 명세

[README](../README.md) · [시스템 아키텍처](System_architecture.md) · [ERD](DATABASE.md)

## 상태 구분

- **구현**: 현재 Backend 코드에서 호출 가능
- **부분 구현**: 경로는 있지만 목표 요청·처리는 아직 미구현
- **계획**: 팀이 작업할 목표 계약이며 현재 호출하면 `404`
- **보류**: 데모에 필요하지 않아 요청·응답을 아직 정하지 않음
- 로컬 Base URL: `http://127.0.0.1:3000/api`
- JSON 요청·응답: `Content-Type: application/json; charset=utf-8`
- 공통 오류 JSON: `{ "error": "오류 메시지" }`
- JSON 문법 오류 `400`, 본문 크기 초과 `413`, 서버 오류 `500`

## 데모 목표

- Test 버튼 한 번으로 준비된 영상 4개를 처음부터 동시에 재생하고 분석 시작
- 사용자 일시정지·되감기·탐색 기능 없음
- Frontend는 영상 스트리밍 API로 재생하고 프레임을 AI로 업로드하지 않음
- 같은 서버의 Backend가 Python 추론 코드에 영상 파일 경로와 카메라 ID 전달
- AI는 재생 시간에 맞춰 영상 처리, `fire`·`smoke` 탐지 결과 전송
- Backend는 AI 결과를 받은 현재 시각을 탐지 시각으로 기록
- 실시간 바운딩박스 표시는 이번 단계에서 제외
- `fire`와 `smoke` 모두 SMS 대상이며 문구는 종류별로 구분
- 이벤트 확정 기준과 정확한 SMS 문구·중복 발송·재시도 규칙은 SMS 구현 전에 결정

## API 목록

| 상태 | Method | 경로 | 용도 |
| --- | --- | --- | --- |
| 구현 | `GET` | `/api/cameras` | 카메라 목록 |
| 구현 | `GET` | `/api/videos` | 영상 목록 |
| 구현 | `GET` | `/api/videos/:id/stream` | 로컬 영상 스트리밍 |
| 구현 | `GET` | `/api/events` | 탐지 이벤트 목록 |
| 구현 | `GET` | `/api/events/:id` | 탐지 이벤트 상세 |
| 부분 구현 | `POST` | `/api/detections` | 기존 JSON 수신·반환만 가능, 목표 JSON과 저장은 미구현 |
| 계획 | `POST` | `/api/demo-runs` | 영상 4개 일괄 재생·분석 시작 |
| 계획 | `GET` | `/api/demo-runs/:id` | 전체·카메라별 분석 상태 |
| 계획 | `POST` | `/api/auth/login` | 관리자 JWT 발급 |
| 계획 | `GET` | `/api/auth/me` | 로그인 관리자 조회 |
| 계획 | `GET` | `/api/sms-recipients` | SMS 수신자 목록 |
| 계획 | `POST` | `/api/sms-recipients` | SMS 수신자 추가 |
| 계획 | `PATCH` | `/api/sms-recipients/:id` | SMS 수신자 변경 |
| 계획 | `DELETE` | `/api/sms-recipients/:id` | SMS 수신자 삭제 |
| 보류 | `GET` | `/api/cameras/:id` | 카메라 상세 |
| 보류 | `POST` | `/api/videos` | 일반 영상 등록·업로드 |

## 구현된 조회 API

### 목록 공통 규칙

- 응답 형식: `{ "items": [], "limit": 50, "offset": 0 }`
- `limit`: 기본 `50`, 허용 `1~100`
- `offset`: 기본 `0`, 허용 `0~2147483647`
- 잘못된 값·중복 파라미터는 `400`, 그 외 쿼리 파라미터는 무시
- 날짜는 UTC ISO 8601 문자열 `Z`, 한국 시각 표시는 Frontend 담당
- 빈 DB는 `items: []`
- 아래 ID와 값은 응답 형식 예시이며 고정된 데이터가 아님

### `GET /api/cameras`

- ID 오름차순
- 항목 필드: `id`, `name`, `latitude`, `longitude`, `created_at`
- 설치 좌표를 모르면 위도·경도 모두 `null`

```json
{
  "items": [
    {
      "id": 1,
      "name": "개발용 카메라",
      "latitude": 35.123456,
      "longitude": 128.123456,
      "created_at": "2026-10-01T09:00:00.000Z"
    }
  ],
  "limit": 50,
  "offset": 0
}
```

### `GET /api/videos`

- ID 내림차순
- 항목 필드: `id`, `camera_id`, `original_filename`, `created_at`
- `camera_id`는 `null` 가능
- 내부 `file_path`는 반환하지 않음
- 파일만 `data/videos/`에 놓아도 자동 등록되지 않으며 현재 데모 데이터는 `sql/seed.dev.sql`로 등록

```json
{
  "items": [
    {
      "id": 3,
      "camera_id": 1,
      "original_filename": "camera01_sample.mp4",
      "created_at": "2026-10-01T09:00:00.000Z"
    }
  ],
  "limit": 50,
  "offset": 0
}
```

### `GET /api/videos/:id/stream`

- `data/videos/` 아래에 실제 파일이 있는 등록 영상만 제공
- 일반 요청 `200`, 단일 HTTP Range 요청 `206`와 `Content-Range`
- `Accept-Ranges: bytes` 제공
- 잘못된 ID `400`, 영상·파일 없음 또는 허용 경로 밖 `404`
- 잘못된 Range `416`과 `Content-Range: bytes */파일크기`
- 브라우저의 영상 재생·탐색은 지원하지만 데모 화면에는 사용자 재생 조작을 제공하지 않음

### `GET /api/events` · `GET /api/events/:id`

- 목록은 `started_at` 내림차순, 같은 시각이면 ID 내림차순
- `camera_id`는 연결된 영상에서 조회하며 `null` 가능
- 상세 응답은 `{ "item": { ... } }`이고 항목 필드는 목록과 동일
- 상세 ID가 1~2147483647의 정수가 아니면 `400`, 항목이 없으면 `404`

```json
{
  "items": [
    {
      "id": 1,
      "video_id": 3,
      "camera_id": 1,
      "class": "fire",
      "started_at": "2026-10-01T09:10:00.000Z",
      "ended_at": null,
      "max_confidence": 0.94,
      "estimated_latitude": null,
      "estimated_longitude": null,
      "error_range_m": null,
      "created_at": "2026-10-01T09:10:00.000Z",
      "updated_at": "2026-10-01T09:10:00.000Z"
    }
  ],
  "limit": 50,
  "offset": 0
}
```

## 계획된 일괄 데모 API

### `POST /api/demo-runs`

- 요청 본문 없음
- DB의 영상이 정확히 4개이고 서로 다른 카메라에 연결되며 모든 파일을 읽을 수 있어야 시작
- 조건을 충족하지 못하거나 이미 실행 중이면 `409` 오류 JSON
- 영상 4개를 병행 분석하고 각 스트리밍 URL 반환
- `202 Accepted`는 실행 접수만 뜻하며 AI·SMS 처리 성공을 보장하지 않음
- Test 버튼의 JWT 요구 여부는 관리자 기능 구현 전에 결정

```json
{
  "id": 1,
  "status": "running",
  "videos": [
    { "camera_id": 1, "video_id": 1, "stream_url": "/api/videos/1/stream" },
    { "camera_id": 2, "video_id": 2, "stream_url": "/api/videos/2/stream" },
    { "camera_id": 3, "video_id": 3, "stream_url": "/api/videos/3/stream" },
    { "camera_id": 4, "video_id": 4, "stream_url": "/api/videos/4/stream" }
  ]
}
```

### Backend → AI 실행 계약

- 영상마다 같은 서버의 Python 프로세스 하나 실행
- 아래 경로와 ID는 예시이며 `ai/infer.py`는 아직 미구현

```text
python3 ai/infer.py --video-path /absolute/path/to/video.mp4 --camera-id 1 --callback-url http://127.0.0.1:3000/api/detections
```

- `--video-path`: Backend가 `data/videos/` 안의 등록 파일을 검사해 얻은 절대 경로
- `--camera-id`: 해당 영상의 카메라 ID이며 탐지 JSON의 `camera_id`와 일치
- `--callback-url`: 탐지 결과를 보낼 Backend 주소, 별도 AI용 FastAPI 서버 없음
- 영상 재생 시간에 맞춰 추론하고 파일을 정상 처리하면 종료 코드 `0`, 실패하면 `0`이 아닌 코드
- Python 의존성 설치와 AI 요청 인증 방식은 연동 전에 정함

### `GET /api/demo-runs/:id`

- 시작 후 발생한 AI 실패를 전체·카메라별 상태로 조회
- 전체 상태: `running`, `completed`, `completed_with_errors`, `failed`
- 카메라 상태: `running`, `completed`, `failed`
- 카메라 한 곳의 실패가 나머지 분석을 중단하지 않음
- 잘못된 ID `400`, 없는 실행 `404`
- 상태 저장 범위와 서버 재시작 후 조회 방식은 구현 전에 정함

```json
{
  "id": 1,
  "status": "completed_with_errors",
  "cameras": [
    { "camera_id": 1, "status": "completed", "error": null },
    { "camera_id": 2, "status": "completed", "error": null },
    { "camera_id": 3, "status": "failed", "error": "AI 분석에 실패했습니다" },
    { "camera_id": 4, "status": "completed", "error": null }
  ]
}
```

## AI → Backend 탐지 JSON

### 목표 계약 · 미구현

- 경로: `POST /api/detections`
- 탐지 객체 하나당 요청 한 건, 탐지가 없는 프레임은 요청하지 않음
- `camera_id`로 현재 실행의 영상 ID를 Backend가 찾음
- AI JSON에 `video_id`, 촬영 시각, 재생 위치, 실행 ID를 넣지 않음
- Backend가 결과 수신 시각을 UTC 탐지 시각으로 기록
- 위치를 추정할 수 없으면 `location_estimation: null`
- 카메라 설치 좌표를 화재 위치로 대체하지 않음

```json
{
  "camera_id": 1,
  "detection": {
    "class": "fire",
    "confidence": 0.94,
    "bbox": { "x1": 420, "y1": 210, "x2": 550, "y2": 300 }
  },
  "location_estimation": null
}
```

| 필드 | 목표 규칙 |
| --- | --- |
| `camera_id` | 현재 데모 카메라 ID, 1~2147483647의 정수 |
| `detection.class` | `fire` 또는 `smoke` |
| `detection.confidence` | 0~1의 유한한 숫자 |
| `detection.bbox` | 원본 프레임의 픽셀 좌표, `x1 < x2` 및 `y1 < y2` |
| `location_estimation` | `null` 또는 위도·경도·오차 범위 객체 |

- 위치 객체의 `latitude`: -90~90
- 위치 객체의 `longitude`: -180~180
- 위치 객체의 `error_range_m`: 0 이상의 숫자 또는 `null`
- 목표 응답: 탐지 결과 검증·처리에 성공한 경우 `200 { "accepted": true }`, 이벤트 확정이나 SMS 발송 완료를 뜻하지 않음
- 실패 시 성공 응답을 보내지 않음
- AI 요청의 접근 제한 방식은 연동 전에 결정
- `fire`·`smoke`는 종류별 SMS 문구 사용
- 이벤트 확정 기준, 두 종류가 함께 탐지될 때 발송 건수, 재실행·재시도 규칙은 미정

### 현재 코드 · 이전 개발용 JSON

- 현재 `POST /api/detections`는 새 목표 JSON을 받지 못하며 `400` 반환
- 현재 필수 항목: `camera_id`, `video_id`, `timestamp`, `detection`, `detection.bbox`, `location_estimation` 객체
- 현재 검증: 두 ID는 양의 안전한 정수, `timestamp`·클래스는 비어 있지 않은 문자열, 신뢰도 0~1, bbox 좌표는 유한한 숫자, 위치 좌표는 범위 검사
- 현재 코드는 날짜 유효성·시간대, 클래스 종류, bbox 순서·영상 경계는 검사하지 않음
- 현재 성공 응답: `200 { "message": "탐지 결과를 수신했습니다.", "data": 요청 JSON }`
- 현재 성공 응답은 DB 저장이나 SMS 발송을 뜻하지 않음
- 입력 오류 `400`과 `{ "error": "입력값이 올바르지 않습니다.", "details": [{ "field": "필드명", "message": "설명" }] }`
- 새 계약 구현 시 검증 코드와 응답을 함께 변경하고 이 현행 안내를 제거

## 관리자·SMS API · 모두 미구현

| Method · 경로 | 요청 | 성공 응답 |
| --- | --- | --- |
| `POST /api/auth/login` | `{ "username": "admin", "password": "입력값" }` | `200 { "access_token": "JWT", "token_type": "Bearer", "expires_in": 3600 }` |
| `GET /api/auth/me` | `Authorization: Bearer <JWT>` | `200 { "id": 1, "username": "admin" }` |
| `GET /api/sms-recipients` | JWT | `200 { "items": [{ "id": 1, "name": "담당자", "phone_number": "01012345678", "is_active": true }] }` |
| `POST /api/sms-recipients` | JWT · `{ "name": "담당자", "phone_number": "01012345678" }` | `201`과 생성 항목 |
| `PATCH /api/sms-recipients/:id` | JWT · `name`, `phone_number`, `is_active` 중 변경할 필드 | `200`과 수정 항목 |
| `DELETE /api/sms-recipients/:id` | JWT | `204`, 본문 없음 |

- 로그인 입력 오류 `400`, 인증 실패 `401`
- 수신자 입력 오류 `400`, 인증 실패 `401`, 대상 없음 `404`, 전화번호 중복 `409`
- `expires_in: 3600`은 예시이며 실제 만료·폐기 규칙은 구현 전에 결정
- 비밀번호 원문·해시, SMS 업체 비밀키는 응답에 포함하지 않음
- 수신자 관리 요청에는 모두 JWT 필요
- 기존 조회·영상 스트리밍과 Test 버튼의 인증 범위는 구현 전에 결정
- 전화번호 형식과 `fire`·`smoke`별 SMS 문구·발송 기준·실패 처리는 SMS 연동 전에 결정

## 보류한 API

- `GET /api/cameras/:id`: 데모에 필요하지 않아 응답 미정, 현재 `404`
- `POST /api/videos`: 데모 영상은 `sql/seed.dev.sql`로 등록, 업로드·메타데이터 등록 형식 미정
