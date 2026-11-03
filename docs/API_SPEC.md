# FireGuard AI API 명세

[시스템 아키텍처](System_architecture.md) · [ERD](DATABASE.md) · [ADR](ADR.md)

- Base URL: `http://127.0.0.1:3000/api`
- JSON: `Content-Type: application/json`
- 공통 오류 응답: `{ "error": "메시지" }`

## 오류 코드

| HTTP | 의미 |
| --- | --- |
| `400` | 요청 값 오류 |
| `401` | 인증 실패 |
| `404` | 대상 없음 |
| `409` | 상태 충돌 |
| `413` | 본문 크기 초과 |
| `416` | 잘못된 Range 요청 |
| `500` | 서버 오류 |
| `502` | ITS CCTV 응답·연결 오류 |
| `503` | ITS CCTV 키 미설정 |

## 카메라·영상

### `GET /live-cctvs`

- ITS API 호출 없음, 저장된 목록만 반환
- 성공 `200` `{ "source": "live", "refreshedAt": null, "items": [] }`
- `source`는 항상 `live`, 키 설정 여부와 관계없이 저장된 목록만 반환
- `live`에서 갱신 전 목록은 빈 배열, 갱신 후 항목의 `cameraId`는 DB 카메라 ID, `streamUrl`은 제공자가 반환한 HTTP 또는 HTTPS HLS 주소
- 목록은 최대 6개, 서버 시작과 목록 조회는 ITS 호출 없음
- 목록은 관리자 수동 요청으로만 갱신, 서버 시작·화면 조회·재생 실패 시 ITS 자동 호출 없음

### `POST /live-cctvs/refresh`

- 관리자 Bearer JWT와 서버의 `ITS_CCTV_API_KEY` 필요
- ITS `cctvInfo`에 전국 범위·공식 HLS 유형 `cctvType=1`·JSON으로 1회 요청
- `cctvtype=1`·`cctvformat=HLS`·HTTP 또는 HTTPS 주소·유효 좌표만 추려 분산된 6개를 저장하고 `GET /live-cctvs`와 같은 형식 반환
- 2026-10-29 운영 응답의 `cctvType=1` 주소는 HTTP, HTTPS 화면 배포 시 브라우저의 혼합 콘텐츠 차단 가능
- 진행 중인 갱신과 중복 요청은 거부, 완료 후 관리자가 다시 요청할 수 있음
- ITS 응답 후 DB 저장 실패 시 대기 목록으로 재시도, 추가 ITS 호출 없음
- `401` 인증 실패, `409` 갱신 진행 중, `502` ITS 응답 오류·후보 부족, `503` 키 없음
- 실제 키 테스트에서 6개 HLS 재생목록·영상 조각·CORS 응답 확인, 주소 만료 시 갱신 필요

### `GET /live-monitor/status`

- ITS API 호출 없음, 서버 메모리의 6개 감시 상태 조회
- `200` `{ "state": "waiting_for_ai", "cameras": [{ "camera_id": 9, "provider_key": "...", "name": "CCTV", "run_id": null, "state": "waiting_for_ai", "last_frame_at": null }] }`
- 상태: `waiting_for_cctv` | `waiting_for_ai` | `starting` | `running` | `restarting` | `failed` | `stopped`
- `AI_LIVE_RUNNER_PATH`가 없으면 실제 AI 프로세스 없이 `waiting_for_ai` 표시
- Frontend는 30초마다 상태와 탐지 이벤트를 다시 조회, 상태 조회는 ITS 호출 한도를 사용하지 않음

### `POST /live-monitor/heartbeat`

- Header: `X-AI-Token: <AI_CALLBACK_TOKEN>`
- Body: `{ "run_id": 123, "camera_id": 9 }`
- AI 작업자는 카메라별 실제 프레임을 처리한 뒤 30초 이내 간격으로 전송
- `202` `{ "accepted": true }`, `400` 입력 오류, `401` 인증 실패, `404` 실행 ID·카메라 불일치
- 120초 동안 카메라 한 곳에서 신호가 없으면 Backend가 AI 작업자를 재시작

### 실시간 AI 작업자 입력 계약

- Backend 시작 시 저장된 CCTV 6곳을 읽고 `AI_LIVE_RUNNER_PATH`의 Python 파일 한 개를 실행
- Backend가 작업자의 표준 입력에 아래 JSON 한 개를 보내고 입력을 닫음
- AI 작업자는 모델을 한 번 로드해 6곳을 지속 분석하고 위 heartbeat와 `POST /detections`에 JSON 전송
- AI 인증 토큰은 환경변수 `AI_CALLBACK_TOKEN`으로 전달, ITS API 키는 AI에 전달하지 않음
- AI 작업자 종료 시 Backend가 최대 5분 간격까지 늘어나는 재시도 후 재실행, 서버 종료 시 작업자 종료

```json
{
  "result_url": "http://127.0.0.1:3000/api/detections",
  "heartbeat_url": "http://127.0.0.1:3000/api/live-monitor/heartbeat",
  "cameras": [
    { "run_id": 123, "camera_id": 9, "source_url": "http://provider.example/cctv.m3u8" }
  ]
}
```

### `GET /cameras`

- Query: `limit` 기본 `50` · `1~100`, `offset` 기본 `0` · `0~2147483647`
- `200`

```json
{
  "items": [
    { "id": 1, "name": "카메라 1", "source_type": "test", "latitude": 35.1, "longitude": 128.1, "created_at": "2026-10-01T09:00:00.000Z" }
  ],
  "limit": 50,
  "offset": 0
}
```

- `source_type`: `test` | `live`
- 설치 좌표: 숫자 또는 `null`

### `GET /videos`

- Query: `limit` 기본 `50` · `1~100`, `offset` 기본 `0` · `0~2147483647`
- `200` `{ "items": [{ "id": 7, "camera_id": 1, "original_filename": "camera.mp4", "created_at": "2026-10-01T09:00:00.000Z" }], "limit": 50, "offset": 0 }`

### `GET /videos/:id/stream`

- 응답 형식: `video/mp4`
- 성공: `200`, Range 요청 `206`

## 탐지 이벤트

### `GET /events`

- Query: `limit` 기본 `50` · `1~100`, `offset` 기본 `0` · `0~2147483647`
- 정렬: `started_at` 내림차순
- `200` `{ "items": [<event>], "limit": 50, "offset": 0 }`

### `GET /events/:id`

- `200` `{ "item": <event> }`

### 탐지 이벤트 항목

```json
{
  "id": 1,
  "video_id": 7,
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
```

- 실시간 탐지 이벤트는 `video_id: null`, `camera_id: 카메라 ID`

## 카메라별 Test

- Frontend에서 호출하는 Test 실행·상태·영상 스트림 API는 관리자 JWT 필요
- Header: `Authorization: Bearer <JWT>`
- AI 콜백 API는 관리자 JWT 대신 `X-AI-Token` 사용

### `POST /cameras/:camera_id/test-runs`

- 성공 `202`

```json
{
  "id": 123,
  "camera_id": 1,
  "video_id": 7,
  "status": "ready",
  "stream_url": "/api/test-runs/123/stream",
  "status_url": "/api/test-runs/123"
}
```

### `GET /test-runs/:run_id/stream`

- 응답 형식: `multipart/x-mixed-replace; boundary=frame`
- 각 프레임 형식: `image/jpeg`
- `Cache-Control: no-store`

### `GET /test-runs/:run_id`

- 성공 `200`
- `status`: `ready` | `running` | `completed` | `failed`
- 응답: `{ "id": 123, "camera_id": 1, "video_id": 7, "status": "running", "error": null }`

### `POST /test-runs/:run_id/video`

- 영상 업로드 주소: `http://127.0.0.1:3000/api/test-runs/{run_id}/video`
- Header: `Content-Type: multipart/x-mixed-replace; boundary=frame`
- Header: `X-AI-Token: <AI_CALLBACK_TOKEN>`
- Body: `--frame\r\nContent-Type: image/jpeg\r\nContent-Length: {bytes}\r\n\r\n{JPEG bytes}\r\n` 반복
- 성공 `200` `{ "accepted": true }`

### `POST /detections`

- 탐지 결과 주소: `http://127.0.0.1:3000/api/detections`
- Header: `Content-Type: application/json`
- Header: `X-AI-Token: <AI_CALLBACK_TOKEN>`
- `AI_CALLBACK_TOKEN`은 Backend와 AI가 동일하게 설정
- 탐지 1건당 요청 1회
- 성공 `202` `{ "accepted": true }`

```json
{
  "run_id": 123,
  "camera_id": 1,
  "detection": {
    "class": "fire",
    "confidence": 0.94,
    "bbox": { "x1": 420, "y1": 210, "x2": 550, "y2": 300 }
  },
  "location_estimation": null
}
```

- `class`: `fire` | `smoke`
- `confidence`: `0~1`
- `bbox`: 원본 프레임 픽셀 좌표
- `location_estimation`: `null` 또는 `{ "latitude": 숫자, "longitude": 숫자, "error_range_m": 숫자 또는 null }`

## 관리자 인증

### `POST /auth/login`

- Request: `{ "username": "admin", "password": "비밀번호" }`
- `200` `{ "access_token": "JWT", "token_type": "Bearer", "expires_in": 3600 }`
- `400` 요청 형식 오류
- `401` ID 또는 비밀번호 오류
- Access token 만료: 1시간
- JWT 서명 키: Backend 환경변수 `JWT_SECRET` · 32바이트 이상의 임의 문자열

### `GET /auth/me`

- Header: `Authorization: Bearer <JWT>`
- `200` `{ "id": 1, "username": "admin" }`
- `401` 토큰 누락·오류·만료

## 화재 알림 SMS 관리

- 모든 `/admin/*` API는 `Authorization: Bearer <JWT>` 필요, 누락·오류·만료 시 `401`
- 알림 번호는 공개 `GET /cameras`에 포함하지 않고 아래 관리자 API에서만 제공
- 문자는 카메라의 `fire` 탐지 이벤트가 새로 생길 때 해당 카메라 번호로 발송, `smoke`는 발송하지 않음
- Test 실행과 실시간 감시 모두 `POST /detections` 경로로 같은 규칙 적용
- 같은 실행(run)에서 `fire` 이벤트는 1회만 발송, Test 실행을 새로 시작하면 다시 발송
- 발송 실패는 탐지 저장과 `POST /detections` 응답에 영향 없음, 결과는 `sms_logs`에 기록

### `GET /admin/cameras`

- Query: `limit` 기본 `50` · `1~100`, `offset` 기본 `0` · `0~2147483647`
- `200` `{ "items": [{ "id": 1, "name": "카메라 1", "source_type": "test", "alert_phone": "01012345678" }], "limit": 50, "offset": 0 }`
- `alert_phone`: 문자열 또는 `null`

### `PATCH /admin/cameras/:id/alert-phone`

- Request: `{ "alert_phone": "01012345678" }`, `null`이면 번호 해제
- `alert_phone` 형식: 하이픈 없는 `010` 휴대전화 11자리 또는 `null`
- `200` `{ "id": 1, "name": "카메라 1", "alert_phone": "01012345678" }`
- `400` 카메라 ID 또는 번호 형식 오류
- `404` 카메라 없음

### `GET /admin/sms-logs`

- Query: `limit` 기본 `50` · `1~100`, `offset` 기본 `0` · `0~2147483647`
- 정렬: `created_at` 내림차순
- `200` `{ "items": [<sms_log>], "limit": 50, "offset": 0 }`

```json
{
  "id": 4,
  "camera_id": 1,
  "camera_name": "카메라 1",
  "event_id": 9,
  "phone_number": "01012345678",
  "message": "[FireGuard] 화재 탐지: 카메라 1",
  "status": "sent",
  "provider": "solapi",
  "error": null,
  "created_at": "2026-11-03T01:00:00.000Z"
}
```

- `status`: `sent` 업체가 발송 요청을 수락 | `failed` 발송 실패 | `skipped` 번호 미설정
- `phone_number`: `skipped`이면 `null`

### 발송 설정

- Backend 환경변수 `SMS_PROVIDER`: `console` 기본, 로그만 출력 | `solapi` 실제 발송
- `solapi`: `SOLAPI_API_KEY`, `SOLAPI_API_SECRET`, `SOLAPI_SENDER`(등록된 발신번호) 필수, `SOLAPI_API_URL` 선택
- 솔라피 호출: `POST /messages/v4/send-many/detail`(HMAC-SHA256 서명)
- 솔라피는 HTTP 오류, 응답의 `errorCode`, 비어 있지 않은 `failedMessageList` 중 하나라도 있으면 `failed`로 기록
- 키는 Backend 환경변수에만 저장, Frontend 노출 금지
