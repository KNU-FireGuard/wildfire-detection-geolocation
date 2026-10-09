# FireGuard AI 작업 지침

## 시작 전 확인

- 변경할 영역의 코드와 관련 문서 확인
- API 변경 시 [API 명세](docs/API_SPEC.md), DB 변경 시 [ERD·DB 명세](docs/DATABASE.md)와 SQL을 함께 갱신
- README에는 실행에 필요한 짧은 절차만 기록하고 설계 설명은 `docs/`에 작성
- 문서 설명은 핵심을 유지하며 개조식으로 간단히 작성하고 문장 끝 마침표 생략
- 팀 협업 규칙은 [.github/CONTRIBUTING.md](.github/CONTRIBUTING.md), PR 항목은 [.github/pull_request_template.md](.github/pull_request_template.md) 확인

## 프로젝트 기준

- `backend/`: Express API
- `frontend/`: Vue 화면
- `sql/`: PostgreSQL 스키마와 개발용 데이터
- `ai/`: 현재 YOLO 학습 결과와 향후 추론 코드
- 목표 데모: `test` 카메라별 Test 버튼으로 해당 영상 하나를 YOLO 분석하고 MJPEG 영상·탐지 JSON 전달
- 카메라별 실행 API와 AI의 MJPEG 영상·탐지 JSON 전송 계약은 [API 명세](docs/API_SPEC.md)를 따름
- Backend가 실행 ID를 만들고 `run_id`, `camera_id`, 영상 경로와 전송 주소를 AI 프로세스 인자로 전달, AI 코드에 실행 ID를 하드코딩하지 않음
- 구현 상태는 [시스템 아키텍처](docs/System_architecture.md), 요청·응답 계약은 [API 명세](docs/API_SPEC.md)를 기준으로 확인
- 현재 `POST /api/detections`는 이전 개발용 JSON을 검증·반환할 뿐 DB 저장·SMS 발송을 하지 않음
- 목표 AI JSON을 구현할 때 기존 `video_id`·`timestamp` 필수 검사와 위치 객체 필수 검사를 함께 변경
- 실제 영상·`.env`·`frontend/.env.local`은 Git에서 제외
- 초기 관리자는 루트 `.env`와 `backend/`의 `npm run create-admin`으로 생성, 비밀번호 원문을 SQL이나 Git에 저장하지 않음
- 비밀키를 Frontend 소스나 `VITE_` 환경변수에 넣지 않음
- Frontend의 API 데이터와 개발용 mock 데이터를 구분하고 API 실패를 mock 성공으로 대체하지 않음

## Git과 리뷰

- 새 기능 브랜치: `feature/파트명/#이슈번호-짧은설명`
- 파트명: `frontend`, `backend`, `ai`
- `main`: 배포용, `develop`: 통합용
- 커밋 접두어: `Feat`, `Fix`, `Docs`, `Refactor`, `Chore`
- 커밋 예시: `Feat: 카메라 목록 추가 (#8)`
- `develop` 병합 전 팀원 1명 이상 승인
- FE·BE API 변경은 교차 리뷰, AI 알고리즘 변경은 AI 담당자끼리 교차 검증
- PR에 요약·연관 이슈·작업 내용·재현 가능한 테스트 방법 기록

## 테스트 주도 개발

- 기능 추가·버그 수정은 기대 동작을 검증하는 테스트부터 작성
- 테스트가 의도한 이유로 실패하는지 확인한 뒤 코드 구현
- 통과 후 관련 회귀 테스트 실행, 필요한 경우 구조 정리
- 관찰 가능한 동작과 경계 조건을 검증하고 구현을 반복하는 테스트는 제외
- 문서·동작에 영향 없는 단순 수정은 새 테스트 생략 가능
- Backend 단위·API 테스트: `backend/`에서 `npm test`
- DB 동작 변경 시 PostgreSQL 준비 후 `backend/`에서 `npm run test:integration`
- Frontend 테스트: `frontend/`에서 `node --test test/*.test.js`
- 화면·빌드 설정 변경 시 `frontend/`에서 `npm run build`
- 실행하지 못한 테스트는 완료 보고에 이유와 검증 범위 기록

## 아키텍처 결정 기록

- 장기 구조·데이터 흐름·외부 서비스 의존성에 영향을 주는 선택은 [ADR](docs/ADR.md)에 번호순으로 기록
- 새 결정에 배경·선택·대안·결과·상태 포함
- 작은 화면 문구·스타일 수정과 단순 기술 사용 사실에는 ADR 불필요
- 기존 결정을 바꿀 때는 이전 항목을 남기고 새 번호에서 대체 관계 명시
