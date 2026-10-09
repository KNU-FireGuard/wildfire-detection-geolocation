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

## 카메라·영상

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

## 카메라별 Test

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
- `status`: `ready` | `running` | `completed` | `failed` | `cancelled`
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
- `200` `{ "access_token": "JWT", "token_type": "Bearer" }`

### `GET /auth/me`

- Header: `Authorization: Bearer <JWT>`
- `200` `{ "id": 1, "username": "admin" }`

## SMS 수신자

| Method · 경로 | 요청 | 성공 응답 |
| --- | --- | --- |
| `GET /sms-recipients` | Bearer JWT | `200` `{ "items": [<recipient>] }` |
| `POST /sms-recipients` | Bearer JWT · `{ "name": "담당자", "phone_number": "01012345678" }` | `201` 생성 항목 |
| `PATCH /sms-recipients/:id` | Bearer JWT · 변경할 필드 | `200` 수정 항목 |
| `DELETE /sms-recipients/:id` | Bearer JWT | `204` |

### 수신자 항목

```json
{ "id": 1, "name": "담당자", "phone_number": "01012345678", "is_active": true }
```
