# FireGuard AI 데이터베이스 명세와 ERD

[README](../README.md) · [시스템 아키텍처](System_architecture.md) · [API 명세](API_SPEC.md) · [초기 스키마](../sql/init.sql)

스키마 기준: [`sql/init.sql`](../sql/init.sql) · 개발 데이터: [`sql/seed.dev.sql`](../sql/seed.dev.sql)

## ERD

```mermaid
erDiagram
    cameras |o--o{ videos : has
    videos |o--o{ detection_events : recorded_source
    cameras |o--o{ detection_events : live_source
    cameras |o--o{ sms_logs : alert_target
    detection_events |o--o{ sms_logs : trigger
    detection_events ||--o{ event_captures : evidence

    event_captures {
        integer id PK
        integer event_id FK
        bigint video_time_ms
        bytea jpeg
        timestamptz created_at
    }

    cameras {
        integer id PK
        text name
        text source_type
        text provider_key UK
        double_precision latitude
        double_precision longitude
        text alert_phone
        timestamptz created_at
    }
    videos {
        integer id PK
        integer camera_id FK
        text original_filename
        text file_path
        timestamptz created_at
    }
    detection_events {
        integer id PK
        integer video_id FK
        integer camera_id FK
        text class
        timestamptz started_at
        timestamptz ended_at
        double_precision max_confidence
        double_precision estimated_latitude
        double_precision estimated_longitude
        double_precision error_range_m
        timestamptz acknowledged_at
        timestamptz created_at
        timestamptz updated_at
    }
    admins {
        integer id PK
        text username UK
        text password_hash
    }
    sms_logs {
        integer id PK
        integer camera_id FK
        integer event_id FK
        text phone_number
        text message
        text status
        text provider
        text error
        timestamptz created_at
    }
```

- 카메라 1대는 영상 0개 이상 보유
- 영상은 카메라 0대 또는 1대와 연결
- 탐지 이벤트는 녹화 영상 1개 또는 실시간 카메라 1개에 연결
- 카메라 1대는 알림 번호 0~1개, 번호는 `cameras.alert_phone`에 저장
- 문자 발송 기록은 카메라·탐지 이벤트 0~1개와 연결
- `PK`는 기본 키, `FK`는 외래 키, `UK`는 고유 제약

## 공통 규칙

- ID는 자동 생성 정수
- 시각은 `TIMESTAMPTZ`, API 응답은 UTC ISO 8601
- 참조 중인 카메라·영상은 연쇄 삭제하지 않음
- 실제 영상 파일은 DB와 Git에 저장하지 않음
- 초기화·실행 방법은 [README](../README.md) 참고

## 테이블별 필드

### `cameras` · 카메라 설치 정보

| 필드 | 입력 | 의미·제약 |
| --- | --- | --- |
| `id` | 자동 | 기본 키 |
| `name` | 필수 | 공백 불가, 고유 제약 없음 |
| `source_type` | 필수 | `test`는 로컬 테스트 영상, `live`는 실시간 CCTV, 기존 카메라는 `test` |
| `provider_key` | 선택 | ITS CCTV 식별 키, 도로구간 ID와 이름으로 생성하며 좌표는 제외, 고유, 기존 카메라는 `NULL` |
| `latitude`, `longitude` | 선택 | 설치 위도 -90~90, 경도 -180~180, 둘 다 값이 있거나 둘 다 `NULL` |
| `alert_phone` | 선택 | 화재 탐지 문자 수신 번호, 하이픈 없는 `010` 휴대전화 11자리, `NULL`이면 발송 안 함 |
| `created_at` | 자동 | 등록 시각 |

- Frontend는 `source_type`으로 Test 버튼 표시 여부 결정
- 실시간 카메라는 갱신할 때 같은 키 또는 이름이 같고 좌표가 약 1km 안인 기존 행을 재사용하고 새 행은 해당하는 행이 없을 때만 추가
- `alert_phone`은 관리자 API에서만 조회·수정, 공개 카메라 목록에는 미포함
- 위경도는 화재 위치 추정의 카메라 눈 위치로 사용, 틀리면 추정 위치도 그대로 틀림

#### 개발용 카메라 좌표 확인 방법

- ITS CCTV 목록(`type=ex` 고속도로)에서 영상 OSD 이름으로 카메라 식별
  - 같은 이름의 카메라가 여러 대일 수 있음 (단촌4터널 청주외부1·청주외부2), 영상 파일명과 대조
  - ITS 좌표는 경도 소수 셋째 자리(약 90m)까지만 제공, 위치 확인용으로만 사용
- 위성지도에서 기둥(그림자, 거리뷰 미니맵)을 찾아 정밀 위치 측정 ([카메라 보정 도구](Camera_Calibration.md) 랜드마크 좌표 측정)
- 지도 서비스의 지번 좌표는 필지 기준이라 사용 금지 (단촌4터널 91m 차이)
- 랜드마크 보정 오차로 최종 확인

| 카메라 | 좌표 | 근거 |
| --- | --- | --- |
| 경북의성 | 36.368431, 128.572611 | ITS [중앙선] 안평과 35m(반올림 범위), 위성지도에서 고속도로 갓길 |
| 청성 | 36.270014, 127.749227 | ITS [경부선] 청성과 20m(반올림 범위), 기둥 정밀 위치는 #80에서 확인 |
| 기도4교 | 36.382015, 128.577886 | ITS [중앙선] 기도4교와 일치(반올림 범위), 영상 미검증 |
| 단촌4터널 | 36.421821, 128.724045 | 위성지도 실측(중앙분리대 기둥), ITS 청주외부1 부근, 랜드마크 오차 0.5°, 이전 값은 청주외부2 좌표(약 2.6km) |

### `videos` · 로컬 영상 메타데이터

| 필드 | 입력 | 의미·제약 |
| --- | --- | --- |
| `id` | 자동 | 기본 키 |
| `camera_id` | 선택 | `cameras.id` 참조, 모르면 `NULL` |
| `original_filename` | 필수 | 공백 불가 |
| `file_path` | 필수 | 공백 불가, 고유 제약 없음 |
| `created_at` | 자동 | 등록 시각 |

- 경로는 프로젝트 기준 `data/videos/파일명.mp4` 형태로 관리
- 목표 카메라별 Test 버튼은 선택한 `test` 카메라의 영상 하나를 분석
- 파일은 `data/videos/`에 두며 DB에는 상대 경로만 저장
- Test 실행 시 카메라에 연결된 영상이 정확히 하나여야 함

- 기준 파일명은 [README 영상 등록 목록](../README.md#2-영상-등록)과 `sql/seed.dev.sql`의 `file_path`
- 단촌4터널은 영상 OSD 등을 통해 청주외부1 영상인지 확인, 청주외부2 영상은 해당 좌표·보정값과 맞지 않음
- 카메라에 이미 다른 파일명의 영상이 등록되어 있으면 시드는 새 행을 만들지 않고 기존 등록을 유지하므로, 그 파일명을 그대로 쓰면 됨
- 시드는 DB 메타데이터만 등록·갱신하며 로컬 파일을 검색·이동·변경하지 않음
- DB 경로에 해당하는 파일이 없으면 영상 스트리밍은 `404`, Test 분석 시작은 `409`로 실패

### `detection_events` · 연속 탐지 이벤트

| 필드 | 입력 | 의미·제약 |
| --- | --- | --- |
| `id` | 자동 | 기본 키 |
| `video_id` | 선택 | 녹화 탐지 시 `videos.id` 참조, 실시간 탐지 시 `NULL` |
| `camera_id` | 선택 | 실시간 탐지 시 `cameras.id` 참조, 녹화 탐지 시 `NULL` |
| `class` | 필수 | 공백 불가, DB는 클래스 종류를 제한하지 않음 |
| `started_at` | 필수 | 첫 탐지를 받은 실제 시각 |
| `ended_at` | 선택 | 마지막 탐지 시각, `started_at` 이상 |
| `max_confidence` | 필수 | 0~1 |
| `estimated_latitude`, `estimated_longitude` | 선택 | 위도 -90~90, 경도 -180~180, 함께 값 또는 함께 `NULL` |
| `error_range_m` | 선택 | 0 이상의 유한한 수, 위치 좌표가 없으면 `NULL` |
| `acknowledged_at` | 선택 | 운영자가 확인한 시각, `NULL`이면 확인 대기, 처음 확인할 때만 기록 |
| `created_at`, `updated_at` | 자동 | `updated_at`은 탐지 갱신 시 Backend가 갱신, 진행 중 이벤트에서는 마지막 탐지 시각, 확인 시에는 갱신하지 않음 |

- AI 목표 JSON은 `camera_id`를 보내고 Backend가 실행 중인 영상의 `video_id`를 찾아 저장
- `video_id`와 `camera_id`는 정확히 하나만 값이 있어야 함
- `started_at`: Backend가 탐지를 받은 시각
- 위치 추정이 없으면 위치 필드는 `NULL`

### `admins` · 관리자 로그인

| 필드 | 입력 | 의미·제약 |
| --- | --- | --- |
| `id` | 자동 | 기본 키 |
| `username` | 필수 | 공백 불가, 고유 |
| `password_hash` | 필수 | 공백 불가, 원문 비밀번호 저장 금지 |

- 비밀번호는 원문이 아닌 scrypt 해시로 저장
- 관리자 생성 절차는 [README](../README.md) 참고

### `sms_logs` · 화재 탐지 문자 발송 기록

| 필드 | 입력 | 의미·제약 |
| --- | --- | --- |
| `id` | 자동 | 기본 키 |
| `camera_id` | 선택 | 대상 카메라, `cameras.id` 참조 |
| `event_id` | 선택 | 발송을 일으킨 탐지 이벤트, `detection_events.id` 참조 |
| `phone_number` | 선택 | 발송 당시 번호, 번호 미설정(`skipped`)이면 `NULL` |
| `message` | 필수 | 발송 문구, 공백 불가 |
| `status` | 필수 | `sent` 업체가 발송 요청을 수락, `failed` 발송 실패, `skipped` 번호 미설정 |
| `provider` | 필수 | 발송 제공자 `console` · `solapi` |
| `error` | 선택 | `failed` 사유 |
| `created_at` | 자동 | 기록 시각 |

- `sent`는 업체의 요청 수락이며 단말 수신 확인은 아님
- 번호는 발송 당시 값을 보관하므로 이후 카메라 번호를 바꿔도 기록은 유지
- 기존 DB의 `sms_recipients`는 더 이상 사용하지 않으며 삭제하지 않고 유지

## event_captures · 확정 탐지 캡처

- 테스트 영상의 확정 프레임 JPEG와 원본 영상 시각을 이벤트에 연결, 기존 이벤트 집계·확인·SMS 규칙은 유지
- `id`: 정수 기본 키, `event_id`: 탐지 이벤트 외래 키, 이벤트 삭제 시 함께 삭제
- `video_time_ms`: 원본 영상 시작 기준 밀리초, 0 이상, `(event_id, video_time_ms)` 유일
- `jpeg`: 4바이트 이상·2MiB 이하 BYTEA, 조회 API는 이미지 본문을 별도 제공
- `created_at`: DB 저장 시각, 영상 시각과 구분
- 저장 트랜잭션에서 부모 이벤트 행 잠금 후 마지막 캡처와 최소 5000ms 간격 검증, 같은 시각·역행 업로드는 추가 저장하지 않음
- 기존 DB 적용: `sql/003-event-captures.sql`, 신규 DB: `sql/init.sql`
- JPEG 보관은 DB 용량을 사용하며 자동 만료는 없음, 향후 장기 운영 시 보존 기간과 외부 저장소 전환을 별도로 결정
