# FireGuard AI 아키텍처 결정 기록

[시스템 아키텍처](System_architecture.md) · [API 명세](API_SPEC.md) · [ERD](DATABASE.md)

## ADR 0001 · 관리자와 SMS 수신자

- 상태: 제안
- 관리자 계정은 `admins`에 저장하고 로그인은 JWT 사용
- 수신자는 관리자별이 아닌 시스템 공용 목록으로 관리
- 비밀번호는 해시로 저장하고 SMS 인증 정보는 Backend에서 관리

## ADR 0002 · 녹화 영상 저장

- 상태: 현행
- 원본 영상은 `data/videos/`에 저장하고 DB에는 경로와 메타데이터 저장
- Backend가 등록 영상을 HTTP Range 방식으로 제공

## ADR 0003 · 영상 4개 일괄 분석

- 상태: ADR 0004로 대체
- 이전 결정: Test 버튼 하나로 녹화 영상 4개를 동시에 분석

## ADR 0004 · 카메라별 테스트와 실시간 구분

- 상태: 현행
- `cameras.source_type` 값은 `test` 또는 `live`
- `test` 카메라별 버튼은 연결된 영상 하나를 분석
- `live` 카메라는 ITS CCTV 영상 주소 사용

## ADR 0005 · Python 표준 출력으로 영상 전달

- 상태: ADR 0006으로 대체
- 이전 결정: Python 표준 출력의 MJPEG 프레임을 Backend가 프론트에 전달

## ADR 0006 · AI 영상·탐지 결과 전송

- 상태: 채택, 구현 전
- AI는 MJPEG 영상을 `POST /api/test-runs/:id/video`로 전송
- AI는 탐지 JSON을 `POST /api/detections`로 전송
- Backend는 영상을 저장하지 않고 `GET /api/test-runs/:id/stream`으로 중계
- 실행 ID로 영상과 탐지 결과를 연결
- Backend가 실행 ID를 생성해 `run_id`, `camera_id`, 영상 경로와 전송 주소를 AI 프로세스 인자로 전달

## ADR 0007 · Test API 인증

- 상태: 채택
- Frontend가 호출하는 Test 실행·상태·영상 스트림 API는 관리자 JWT로 인증
- AI가 호출하는 영상·탐지 콜백 API는 `AI_CALLBACK_TOKEN`으로 인증

## ADR 0008 · Test 실행 중 SMS 중복 방지

- 상태: 제안
- 데모에서는 같은 `run_id`와 탐지 클래스 조합에 SMS를 한 번만 발송
- `fire`와 `smoke`는 각각 별도 알림
- 실시간 CCTV의 연속 탐지 이벤트 구분과 재알림 간격은 실제 탐지 누락·오탐을 확인한 뒤 결정

## ADR 0009 · Test 실행 상태 관리

- 상태: 채택
- 실행 상태와 영상 중계 연결은 Backend 프로세스 메모리에서 관리
- 탐지 이벤트는 `detection_events`에 저장하고 같은 실행·클래스의 후속 탐지는 기존 이벤트를 갱신
- Backend 재시작 시 진행 중 실행과 스트림은 종료되며 상태 조회는 유지되지 않음
