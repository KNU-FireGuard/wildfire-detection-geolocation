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
- 목록은 사용자 수동 요청으로만 갱신, 서버 시작·화면 조회·재생 실패 시 ITS 자동 호출 없음

### `POST /live-cctvs/refresh`

- 로그인 없이 호출, 서버의 `ITS_CCTV_API_KEY` 필요
- ITS `cctvInfo`에 전국 범위·공식 HLS 유형 `cctvType=1`·JSON으로 1회 요청
- `cctvtype=1`·`cctvformat=HLS`·HTTP 또는 HTTPS 주소·유효 좌표만 추려 분산된 6개를 저장하고 `GET /live-cctvs`와 같은 형식 반환
- 2026-10-29 운영 응답의 `cctvType=1` 주소는 HTTP, HTTPS 화면 배포 시 브라우저의 혼합 콘텐츠 차단 가능
- 진행 중인 갱신과 중복 요청은 거부, 완료 후 사용자가 다시 요청할 수 있음
- ITS 응답 후 DB 저장 실패 시 대기 목록으로 재시도, 추가 ITS 호출 없음
- `409` 갱신 진행 중, `502` ITS 응답 오류·후보 부족, `503` 키 없음
- 실제 키 테스트에서 6개 HLS 재생목록·영상 조각·CORS 응답 확인, 주소 만료 시 갱신 필요

### `GET /live-monitor/status`

- ITS API 호출 없음, 서버 메모리의 6개 감시 상태 조회
- `200` `{ "state": "waiting_for_ai", "cameras": [{ "camera_id": 9, "provider_key": "...", "name": "CCTV", "run_id": null, "state": "waiting_for_ai", "last_frame_at": null }] }`
- 상태: `waiting_for_cctv` | `waiting_for_ai` | `starting` | `running` | `restarting` | `failed` | `stopped`
- `AI_LIVE_RUNNER_PATH`가 비어 있으면 기본 `ai/inference/live_runner.py` 실행, 지정한 파일이 없으면 `waiting_for_ai` 표시
- Frontend는 30초마다 상태·카메라 정보를, 5초마다 탐지 이벤트를 다시 조회, 숨겨진 화면의 주기 조회는 생략하며 ITS 호출 한도를 사용하지 않음

### `POST /live-monitor/heartbeat`

- Header: `X-AI-Token: <AI_CALLBACK_TOKEN>`
- Body: `{ "run_id": 123, "camera_id": 9 }`
- AI 작업자는 카메라별 실제 프레임을 처리한 뒤 30초 이내 간격으로 전송
- `202` `{ "accepted": true }`, `400` 입력 오류, `401` 인증 실패, `404` 실행 ID·카메라 불일치
- 120초 동안 카메라 한 곳에서 신호가 없으면 Backend가 AI 작업자를 재시작

### 실시간 AI 작업자 입력 계약

- Backend 시작 시 저장된 CCTV 6곳을 읽고 `AI_LIVE_RUNNER_PATH`의 Python 파일 한 개를 실행
- Backend가 작업자의 표준 입력에 UTF-8 JSON 한 개를 보내고 입력을 닫음, AI는 시스템 문자 인코딩과 관계없이 UTF-8로 읽음
- AI 작업자는 모델을 한 번 로드해 6곳을 지속 분석하고 위 heartbeat와 `POST /detections`에 JSON 전송
- 기본 작업자는 카메라별 5fps·최근 20프레임 중 16회·불 0.3/연기 0.5·박스 IoU 0.2 기준 적용, HLS 조각 경계에서도 판정 유지
- 프레임 대기열은 카메라별 최대 3개, 누락·재접속·큰 장면 변화 시 판정 초기화, 대기열 등록 후 1초 넘은 프레임은 추론 전·후 폐기
- 디코더 시각이 누락·반복되면 마지막 영상 시각과 원본 FPS로 복원, 양수 시각이 역행하면 재접속하여 판정 초기화, 첫 영상 시각과 시각 복원 횟수를 로그로 기록
- 모델 경로는 `model_path`, 카메라 이름·좌표는 각 항목의 `name`, `latitude`, `longitude`로 전달, 위경도가 없으면 위치 추정 생략
- 위치는 이름이 일치하는 고정 자세 보정값을 우선 사용, 없으면 기존 `LocationSession`의 영상 능선·DEM 기반 360° 자세 추정 실행, 품질 게이트를 통과한 자세로만 좌표 산출
- 화각 설정이 없으면 기본 60°와 `FOV_DEFAULT_USED` 경고 사용, 54°·66° 대체 자세는 기존 오차 범위 평가에 반영하며 실제 화각 자동 측정은 미지원
- 확정 탐지는 `location_estimation: null`로 먼저 전송, Backend가 수락한 표본만 별도 위치 작업자에서 계산해 같은 `run_id`·클래스의 기존 이벤트 보완, 위치 계산 실패가 탐지·문자 알림을 막지 않음
- 위치 작업자는 첫 분석 프레임부터 DEM을 백그라운드에서 준비, 준비 요청은 카메라별 1개·위치 요청은 카메라·클래스별 최신 1개로 제한, 확정 탐지의 위치 보완을 다른 카메라의 사전 준비보다 우선
- DEM 준비·능선 미검출·정합 품질 실패는 최신 프레임으로 30·60·120·240·300초 간격 재시도, 이후 최대 300초 간격 유지, 좌표 없음은 재시도 생략
- 큰 장면 변화·해상도 변경·재접속 시 이전 자세와 대기 결과 무효화, 연속 10개 분석 프레임·영상 시각 1.8초 이상 안정된 뒤 기존 고정 자세를 재사용하지 않고 자동 재추정, 단순 프레임 누락은 탐지 투표만 초기화하고 같은 자세 유지
- 최초 탐지와 위치 보완은 각각 카메라·클래스별 최신 콜백으로 병합, 프레임 대기열 등록 시각부터 5초가 지난 결과는 위치 계산 전·후와 HTTP 전송 직전에 폐기, 위치 계산 후 유효시간을 새로 시작하지 않음
- 누락·재접속·장면 전환 전의 대기 중인 탐지·위치 결과는 무효화, 이미 전송 중인 HTTP 요청은 취소하지 않음
- 실제 분석한 프레임에 대해서만 heartbeat 전송, 30초마다 `analysis_fps`·`dropped`와 추론·대기·DEM 준비·위치 계산·전송 소요 시간의 횟수·평균·최댓값(`timings`, ms)을 로그로 기록
- 위 유효시간·소요 시간은 로컬 대기열 등록 이후 기준이며 HLS 원본 촬영 시각부터의 전체 지연은 별도 계측 필요
- `location_ready`, `mode`, `reason`, `warnings`, `retry_in_s`로 위치 준비 상태 기록, 야간·가림·능선 부족·정합 실패 시 위치는 null이며 화재 탐지와 알림은 계속 진행
- 위치 null은 기존 이벤트 좌표를 삭제하지 않으며 새 위치 보완 시 갱신하는 기존 Backend 저장 정책 유지, 큰 장면 변화 감지는 완전한 PTZ·줌 추적을 대체하지 않음
- AI 인증 토큰은 환경변수 `AI_CALLBACK_TOKEN`으로 전달, ITS API 키는 AI에 전달하지 않음
- AI 작업자 종료 시 Backend가 최대 5분 간격까지 늘어나는 재시도 후 재실행, 서버 종료 시 작업자 종료

```json
{
  "result_url": "http://127.0.0.1:3000/api/detections",
  "heartbeat_url": "http://127.0.0.1:3000/api/live-monitor/heartbeat",
  "model_path": "/project/ai/weights/yolo26s_final/weights/best.pt",
  "cameras": [
    { "run_id": 123, "camera_id": 9, "source_url": "http://provider.example/cctv.m3u8", "name": "CCTV", "latitude": 36.4, "longitude": 128.6 }
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
- `provider_key`: 실시간 CCTV 제공자 식별 키 또는 `null`, 상세 팝업에는 표시하지 않으며 SMS 수신번호·API 인증키는 포함하지 않음

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
  "acknowledged_at": null,
  "created_at": "2026-10-01T09:10:00.000Z",
  "updated_at": "2026-10-01T09:10:00.000Z"
}
```

- `acknowledged_at`: 운영자가 확인한 시각, `null`이면 확인 대기
- `is_alerting`: 확인하지 않았고 마지막 탐지가 30분 안인 `fire` 이벤트이면 `true`, 마지막 탐지는 종료된 이벤트의 `ended_at`, 진행 중이면 `updated_at`
- `is_popup_alerting`: 확인하지 않았고 마지막 탐지가 30분 안인 `fire`·`smoke` 이벤트이면 `true`, DB 시각으로 계산하며 Frontend는 브라우저 시각으로 재판정하지 않음
- `updated_at`: 진행 중 이벤트에서는 마지막 탐지 시각, 확인 API는 값을 바꾸지 않음

- 실시간 탐지 이벤트는 `video_id: null`, `camera_id: 카메라 ID`

## 이벤트 관리 추가 API

### `POST /events/acknowledge-all`

- 로그인 없이 호출, 화면 필터와 관계없이 실행 시점의 전체 미확인 이벤트를 한 SQL로 확인 처리
- 기존 확인 시각과 마지막 탐지 시각(`updated_at`)은 변경하지 않음
- `200` `{ "ids": [1, 2], "count": 2 }`, 처리 대상 없으면 빈 배열·0건
- 요청 처리 이후 새로 생성되는 이벤트는 별도 미확인 상태 유지

### `DELETE /events/:id`

- 로그인 없이 호출, 성공 `204`, 없는 이벤트 `404`, 잘못된 ID `400`
- 현재 실행이 갱신 중인 이벤트는 `409`, 분석 종료 후 삭제 가능
- 트랜잭션으로 문자 기록의 `event_id` 연결을 해제하고 이벤트 삭제, 연결된 캡처는 FK cascade로 삭제
- 문자 발송 이력은 유지하고 문자 재전송은 하지 않음
- Frontend는 체크박스로 여러 이벤트를 선택한 뒤 한 번의 삭제 확인을 거쳐 ID별로 순차 요청, 성공한 항목은 목록에서 제거하고 실패한 항목은 체크·오류 사유 유지
- 이미 삭제된 항목의 `404`는 목록에서 제거, 처리 중 중복 실행을 막고 페이지 전환 시 남은 삭제 요청 중단
- 이벤트 행 더블클릭·Enter는 상세 팝업을 열며 최초·마지막 탐지·확인 시각·추정 위치·오차·원본/캡처 확인 제공, 상세 페이지 링크는 팝업 내부에 배치

## 카메라별 Test

- Frontend에서 호출하는 Test 실행·상태·영상 스트림 API는 로그인 없이 사용 가능
- AI 콜백 API는 `X-AI-Token` 필요
- Test 작업자는 영상 시각 기준 5fps로 분석하고 불 0.3·연기 0.5 confidence 기준을 각각 적용
- 같은 클래스·박스 IoU 0.2 이상의 영역을 연결해 최근 20프레임 중 16회 이상 탐지 시 기존 탐지 JSON 전송, 첫 20프레임 이전에는 전송하지 않음
- 확정 후에도 현재 프레임 탐지와 16/20 조건을 만족할 때만 갱신 전송, Backend의 이벤트 집계·fire 문자 발송 규칙은 동일
- 현재 Test 화면은 원본 `GET /videos/:video_id/stream`을 재생하고 확정 탐지는 캡처로 표시, 분석 속도와 원본 재생·일시정지는 독립적
- 이벤트 목록·상세·확인 응답에 `latest_capture` 추가: 캡처 없으면 `null`, 있으면 `{ "id": 1, "video_time_ms": 3800, "image_url": "/api/event-captures/1/image" }`

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

- AI 프로세스 인자: `--run-id`, `--camera-id`, `--source-path`, `--video-url`, `--result-url`, `--capture-url`, `--model-path`, `--camera-name`
- `--capture-url`이 있으면 MJPEG 업로드 대신 확정 JPEG를 저장, 성공 종료는 MJPEG 수신 여부와 관계없이 `completed`
- `stream_url`과 아래 MJPEG API는 이전 작업자 호환용으로 유지하며 현재 Frontend는 연결하지 않음
- 카메라 DB 위경도가 있으면 `--camera-lat`, `--camera-lon` 추가, 없으면 생략하고 AI는 `location_estimation`을 `null`로 전송

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

### 테스트 캡처 기록

- 테스트 캡처는 탐지 JSON 수락 후 별도 업로드하며 실패해도 이미 저장된 이벤트를 취소하지 않음
- JPEG 생성·업로드는 별도 작업자에서 실행, 대기열은 최대 2건이고 가득 차면 추가 캡처를 생략해 후속 분석 대기 방지
- 실패 후 같은 클래스의 캡처는 실제 경과 시간 기준 5초 동안 추가 시도를 제한, 오래 대기한 캡처(15초 초과)는 생략
- 영상 종료 시 최대 20초 동안 남은 캡처 업로드 대기, 혼잡·장애·종료 제한으로 일부 캡처가 누락될 수 있으며 탐지 이벤트는 유지

### `POST /test-runs/:run_id/captures/:class_name`

- AI 콜백 토큰 필요, `class_name`은 `fire` 또는 `smoke`, 실행 중인 테스트의 해당 클래스 확정 이벤트에만 저장
- Header: `Content-Type: image/jpeg`, `X-AI-Token`, `X-Video-Time-Ms`(0 이상 안전 정수, 원본 영상 기준 밀리초)
- Body: JPEG 바이너리, 최대 2MiB, JPEG 시작·종료 마커 검증
- 최초 확정 캡처 저장, 이후 이전 저장 시각보다 5000ms 이상 뒤인 확정 캡처만 추가
- `201` `{ "item": { "id": 1, "event_id": 9, "video_time_ms": 3800, "created_at": "...", "image_url": "/api/event-captures/1/image" } }`
- 중복·간격 미달·역행은 `200` `{ "item": null }`, 잘못된 요청 `400`, 인증 실패 `401`, 실행 없음 `404`, 실행 종료·확정 이벤트 없음 `409`, 용량 초과 `413`

### `GET /events/:id/captures`

- 공개 조회, 기존 `limit`(1~100)·`offset` 페이지 규칙 사용
- 선택 `before_time_ms`: 해당 영상 시각보다 이전의 캡처만 조회, Frontend는 새 캡처 추가 중에도 누락 없이 과거 기록을 볼 수 있도록 이 커서 사용
- 최신 영상 시각 순으로 `{ "items": [캡처 메타데이터], "limit": 20, "offset": 0 }`, 이미지 본문 제외, 캡처 없으면 빈 배열
- Frontend는 최신 20건을 조회하고 시간순으로 배치, 대시보드 오른쪽은 최신 6장까지만 표시하고 `더보기`로 이벤트 상세 이동, 상세 화면의 `더보기`는 이전 캡처 추가 조회, 선택하면 연결된 원본 해당 시점 재생
- 이전 기록을 펼치는 동안 자동 갱신을 멈추고 `최신 캡처 보기`로 최신 20건 복귀

### `GET /event-captures/:id/image`

- 공개 조회, `200 image/jpeg`, `X-Content-Type-Options: nosniff`, 유효하지 않은 ID `400`, 이미지 없음 `404`

### 탐지 JSON · `POST /detections`

- 탐지 결과 주소: `http://127.0.0.1:3000/api/detections`
- Header: `Content-Type: application/json`
- Header: `X-AI-Token: <AI_CALLBACK_TOKEN>`
- `AI_CALLBACK_TOKEN`은 Backend와 AI가 동일하게 설정
- 탐지 1건당 요청 1회
- 같은 실행·클래스의 마지막 탐지가 30분 안이면 기존 이벤트를 갱신하고, 30분 넘게 탐지가 없었다면 새 이벤트를 만듦
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
- 위치는 실행 시작 시 1회 정한 카메라 자세로 bbox 아래 중앙을 광선 추적한 추정 발화 위치, 자세를 정하지 못했거나 광선이 지형과 만나지 않으면 `null`
- `error_range_m`: 추정 위치를 중심으로 카메라 자세 오차를 반영한 반경(m, 10m 단위 올림), 근거와 계산은 [오차 범위 모델](RayCasting_DEM_Architecture.md#32-오차-범위-모델-59)
  - 자세 오차 기준 모델 추정값이며 실측 검증 전, bbox 흔들림·카메라 좌표 오차는 미포함
  - 약 1km 이상: 연기 바닥이 능선에 걸려 능선 너머일 수 있음, 위치 신뢰 낮음 (최대 DEM 반경 5km)
  - `null`: 오차를 계산하지 않은 경우(평지 모드 등)

## 관리자 인증

- 관리자 로그인은 SMS 알림 번호 설정·발송 내역 조회에 사용, Test·CCTV 주소 갱신·이벤트 확인은 로그인 없이 사용

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

- SMS 관리 API(`/admin/cameras`, `/admin/cameras/:id/alert-phone`, `/admin/sms-logs`)는 `Authorization: Bearer <JWT>` 필요, 누락·오류·만료 시 `401`
- 알림 번호는 공개 `GET /cameras`에 포함하지 않고 아래 관리자 API에서만 제공
- 문자는 카메라의 `fire` 탐지 이벤트가 새로 생길 때 해당 카메라 번호로 발송, `smoke`는 발송하지 않음
- Test 실행과 실시간 감시 모두 `POST /detections` 경로로 같은 규칙 적용
- 문자는 카메라가 "알림 중"이 아닌 상태에서 새 `fire` 이벤트가 생길 때(지도에서 파랑 → 빨강)만 발송
- 같은 카메라에 알림 중인 `fire` 이벤트가 있으면 새 실행이 시작되어도 발송하지 않음, 서버 재시작·작업자 재시작 후에도 동일
- 알림 중: 확인하지 않았고 마지막 탐지가 30분 안인 `fire` 이벤트
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

## 이벤트 확인

### `POST /events/:id/acknowledge`

- 운영자가 이벤트를 확인했음을 기록, Request 본문 없음
- 로그인·Authorization 헤더 없이 호출, 기존 `/admin/events/:id/acknowledge`도 동일한 공개 확인 API의 호환 주소로 유지
- 처음 확인하면 `acknowledged_at`에 현재 시각 저장, 이미 확인했다면 값을 바꾸지 않고 `200`
- `fire` 이벤트를 확인하면 같은 카메라에서 알림 중인 다른 `fire` 이벤트도 함께 확인 처리, `smoke`는 해당 이벤트만 처리
- `200` `{ "item": <event> }`
- `400` 이벤트 ID 형식 오류
- `404` 이벤트 없음

## SMS 발송 내역

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

### `DELETE /admin/sms-logs`

- 관리자 JWT 인증 필수, 누락·오류·만료 시 `401`
- Body: `{ "ids": [1, 2, 3] }`, 1~100개 배열, 각 값은 1~2147483647 정수, 중복은 한 번만 처리
- 단일 DELETE 쿼리로 선택 내역만 삭제, 없는 ID는 무시
- `200` `{ "ids": [1, 2, 3], "count": 3 }`, 실제 삭제된 ID와 건수 반환
- 잘못된 배열·ID는 `400`, 이벤트·카메라·알림 번호 및 문자 발송 동작에 영향 없음
- Frontend는 최근 100건에서 체크박스·전체 선택 후 확인창을 거쳐 선택 삭제, 실패하면 선택 유지 및 오류 표시
- 문자 알림 관리 화면에서 카메라 ID 열과 발송 내역의 ID 대체 표시는 숨김, 내부 요청용 ID는 유지

### 발송 설정

- Backend 환경변수 `SMS_PROVIDER`: `console` 기본, 로그만 출력 | `solapi` 실제 발송
- `solapi`: `SOLAPI_API_KEY`, `SOLAPI_API_SECRET`, `SOLAPI_SENDER`(등록된 발신번호) 필수, `SOLAPI_API_URL` 선택
- 솔라피 호출: `POST /messages/v4/send-many/detail`(HMAC-SHA256 서명)
- 솔라피는 HTTP 오류, 응답의 `errorCode`, 비어 있지 않은 `failedMessageList` 중 하나라도 있으면 `failed`로 기록
- 키는 Backend 환경변수에만 저장, Frontend 노출 금지
