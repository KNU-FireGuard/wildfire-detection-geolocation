# FireGuard AI - API 명세서 (초안)

이 문서는 **FireGuard AI (CCTV·영상 기반 산불 탐지 및 위치 추정 모니터링 시스템)**의 프론트엔드, AI, 백엔드 간 협업을 위한 API 및 데이터 인터페이스 명세서입니다.

> **[안내]**  
> AI → Backend 결과 전달 JSON의 기본 형식은 합의되었습니다. Frontend용 JSON과 AI 수신 응답·검증 세부 규칙은 협의 중이며, AI 수신 API는 기본 입력값 검사와 로컬 수신·응답을 구현했으며 나머지 기능별 API는 구현 전입니다.
>
> 아래 API 경로는 설계 초안입니다. 합의된 요청 예시와 미정 사항을 구분하여 관리합니다.

---

## 1. 기본 정보

- **Base URL:** `http://127.0.0.1:3000/api` (로컬 개발 기준)
- **데이터 형식:** JSON 요청·응답은 `Content-Type: application/json; charset=utf-8`을 사용합니다. 영상 파일 업로드 방식과 요청 형식은 별도 협의 예정입니다.
- **공통 응답 규칙:**
  - 성공 시: HTTP 상태 코드 `200 OK` 또는 `201 Created`
  - 실패 시: HTTP 에러 코드(`400`, `404`, `500`)와 함께 에러 메시지 반환
    ```json
    {
      "error": "에러 메시지"
    }
    ```

---

## 2. API 목록 요약

| 분류 | HTTP Method | Endpoint | 설명 | 상태 |
|---|---|---|---|:---:|
| **CCTV** | `GET` | `/api/cameras` | 전체 CCTV 카메라 목록 조회 (지도 표시용) | 협의 중 |
| **CCTV** | `GET` | `/api/cameras/:id` | 특정 CCTV 상세 정보 조회 | 협의 중 |
| **영상** | `GET` | `/api/videos` | 등록된 CCTV 영상 목록 조회 | 협의 중 |
| **영상** | `POST` | `/api/videos` | 새 영상 파일 등록/업로드 메타데이터 생성 | 협의 중 |
| **산불 이벤트** | `GET` | `/api/events` | 산불 감지 이벤트 목록 조회 (대시보드 목록용) | 협의 중 |
| **산불 이벤트** | `GET` | `/api/events/:id` | 산불 감지 이벤트 상세 정보 조회 | 협의 중 |
| **AI 연동** | `POST` | `/api/detections` | AI 탐지·위치 추정 결과 수신 | 로컬 수신·응답 구현 |

---

## 3. Frontend 제공 API (상세)

### 3.1. CCTV 카메라 목록 조회
- **Endpoint:** `GET /api/cameras`
- **설명:** 지도 화면에 설치된 CCTV 아이콘을 띄우기 위해 카메라 정보 목록을 반환합니다.
- **Request Parameters:** 없음
- **Response JSON:**
  ```text
  [협의 및 확정 예정 - 논의 후 작성]
  ```

---

### 3.2. CCTV 상세 정보 조회
- **Endpoint:** `GET /api/cameras/:id`
- **설명:** 특정 CCTV의 세부 설치 정보(화각, 방위각, 고도 등)를 반환합니다.
- **Request Parameters:** Path Parameter `id` (카메라 식별자)
- **Response JSON:**
  ```text
  [협의 및 확정 예정 - 논의 후 작성]
  ```

---

### 3.3. 영상 목록 조회
- **Endpoint:** `GET /api/videos`
- **설명:** 모니터링 분석에 사용되는 영상 메타데이터 목록을 반환합니다.
- **Response JSON:**
  ```text
  [협의 및 확정 예정 - 논의 후 작성]
  ```

---

### 3.4. 산불 감지 이벤트 목록 조회
- **Endpoint:** `GET /api/events`
- **설명:** 대시보드 메인 화면의 "최근 산불 발생 내역" 및 지도 위에 화재 발생 지점을 표시하기 위한 이벤트 목록을 반환합니다.
- **Query Parameters:** (예: `status`, `limit` 등 검토 예정)
- **Response JSON:**
  ```text
  [협의 및 확정 예정 - 논의 후 작성]
  ```

---

### 3.5. 산불 감지 이벤트 상세 조회
- **Endpoint:** `GET /api/events/:id`
- **설명:** 특정 이벤트 클릭 시 팝업에 표시할 상세 정보(카메라 정보, 영상 정보, 추정 위·경도, 오차 범위 등)를 반환합니다.
- **Request Parameters:** Path Parameter `id` (이벤트 고유 번호)
- **Response JSON:**
  ```text
  [협의 및 확정 예정 - 논의 후 작성]
  ```

---

### 3.6. 영상 등록

- **Endpoint:** `POST /api/videos`
- **설명:** 분석에 사용할 영상을 등록합니다. 실제 파일 업로드와 서버에 저장된 영상의 메타데이터 등록 중 어떤 방식을 사용할지는 협의 예정입니다.
- **Request:**
  ```text
  [전송 방식과 요청 필드 협의 예정]
  ```
- **Response JSON:**
  ```text
  [협의 및 확정 예정 - 논의 후 작성]
  ```

---

## 4. AI → Backend 결과 수신 API

### 4.1. 탐지 및 위치 추정 결과 수신

- **Endpoint (초안):** `POST /api/detections`
- **상태:** 로컬 수신·응답 구현 (입력값 검사 구현, 인증·DB 저장 미구현)
- **Content-Type:** `application/json`
- **처리 방향:** AI 결과는 Backend가 받아 처리·저장하며, AI가 PostgreSQL에 직접 접근하지 않습니다. 이 요청 하나를 DB 이벤트 하나로 저장한다는 의미는 아니며, 연속 탐지의 이벤트 묶음 기준은 별도로 정합니다.

#### 요청 JSON 및 필드 설명

AI 모듈의 탐지 결과와 위치 추정 결과는 다음 JSON 형식으로 Backend에 전달하기로 했습니다. 아래 값은 예시이며, 이 형식의 합의가 수신 API 구현 완료를 의미하지는 않습니다. Backend가 처리한 Frontend용 응답 JSON은 별도로 정의합니다.

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
| `timestamp` | 결과에 연결되는 시각 문자열 |
| `detection.class` | 탐지 클래스 (예시: `fire`) |
| `detection.confidence` | 탐지 신뢰도 |
| `detection.bbox` | 탐지 영역의 두 좌표 쌍 (`x1`, `y1`, `x2`, `y2`) |
| `location_estimation.latitude` | 추정 화재 위치의 위도 |
| `location_estimation.longitude` | 추정 화재 위치의 경도 |
| `location_estimation.error_range_m` | 위치 추정 오차 범위 (미터) |

좌표는 실제 화점의 확정 위치가 아닌 추정 결과입니다. 예시의 `timestamp`에는 시간대가 없으므로 시각 기준(촬영 시각 또는 분석 시각 등)과 시간대는 추가로 정해야 합니다. bbox의 좌표 기준·단위, 오차 범위의 구체적인 의미, 위치 추정 실패 시 표현도 별도 협의 사항입니다.

#### 추가로 정할 규칙

- 각 필드의 필수 여부와 null 허용 여부
- 허용할 탐지 클래스 목록과 값의 검증 범위
- 한 영상에서 여러 객체가 탐지될 때의 전달 방식과 전송 주기
- 성공 응답의 상태 코드·JSON 및 오류별 응답 규칙

#### 응답 JSON

현재 로컬 테스트 응답은 `200 OK`입니다. `data`는 요청 JSON 그대로이며 저장 완료를 의미하지 않습니다. 최종 연동용 응답 규칙은 추후 확정합니다.

```json
{
  "message": "탐지 결과를 수신했습니다.",
  "data": {
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
}
```

기본 입력값 검사는 구현했으며 인증은 미구현입니다. 기존 JSON 파서가 문법 오류는 400, 본문 크기 제한 초과는 413으로 처리합니다. 외부 공개 전 접근 제어를 추가해야 합니다.

#### 입력값 검사 규칙 (현재 개발용 기준)

예시의 모든 필드를 필수로 검사합니다. 필수 여부와 null 처리의 최종 팀 합의는 별도로 진행합니다.

| 필드 | 검사 규칙 |
| --- | --- |
| 본문, `detection`, `detection.bbox`, `location_estimation` | 배열·null이 아닌 JSON 객체 |
| `camera_id`, `video_id` | 1 이상 `Number.MAX_SAFE_INTEGER` 이하의 정수 |
| `timestamp`, `detection.class` | 공백만 있지 않은 문자열 |
| `detection.confidence` | 0~1의 유한한 숫자 |
| bbox의 `x1`, `y1`, `x2`, `y2` | 각각 유한한 숫자 |
| `location_estimation.latitude` | -90~90의 유한한 숫자 |
| `location_estimation.longitude` | -180~180의 유한한 숫자 |
| `location_estimation.error_range_m` | 0 이상의 유한한 숫자 |

숫자 문자열을 자동 변환하지 않으며 추가 필드는 허용합니다. timestamp의 날짜 유효성·시간대, 클래스 목록, bbox 순서·단위·이미지 경계는 검사하지 않습니다. 위치 추정 실패 표현이 미정이므로 현재 null 위치는 거절합니다.

검사 실패 시 `400 Bad Request` 응답 예시:

```json
{
  "error": "입력값이 올바르지 않습니다.",
  "details": [
    {
      "field": "detection.confidence",
      "message": "0 이상 1 이하의 숫자여야 합니다."
    }
  ]
}
```
