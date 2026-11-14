# FireGuard 배포 준비

- 회사 서버: 실시간 CCTV 전용, 개인 Mac: 테스트 영상 데모
- 이 문서는 실행 절차이며 회사 서버에서 자동으로 명령을 수행하지 않음
- 서버에서 다운로드·파일 배치·포트 공개·컨테이너 실행은 담당자에게 경로·포트·GPU 사용 범위를 승인받은 뒤 진행
- 기존 컨테이너·Docker daemon·드라이버·80번 포트는 변경하지 않음, `prune`이나 전체 컨테이너 종료 명령 사용 금지
- 알고리즘 개선 중인 배포 후보 구성, 최종 알고리즘과 실제 모델의 GPU 추론 검증 전 운영 완료로 간주하지 않음

## 배포와 데모 분리

| 구분 | 회사 배포 | 개인 Mac 데모 |
| --- | --- | --- |
| Compose | compose.yml + compose.gpu.yml | compose.yml + compose.demo.yml |
| 프로젝트 이름 | fireguard-live | fireguard-demo |
| 테스트 API | 차단 | 허용 |
| 테스트 영상·seed | 전달·포함·실행하지 않음 | Mac 폴더 연결·명시적 seed 실행 |
| DB | 새 운영 DB | 별도 데모 DB |
| GPU | 승인받은 T4 | CPU, 빠른 데모는 기존 Mac 네이티브 MPS 실행 권장 |

- `sql/init.sql`은 테이블·인덱스·제약 생성용이며 데이터 INSERT 없음
- 공통 스키마의 videos·video_id 등 빈 테이블·컬럼은 이벤트 조회 호환을 위해 유지, 실제 영상·좌표 데이터는 배포 DB에 없음
- DEMO_MODE=false 서버는 videos 또는 test 카메라 데이터가 있으면 시작을 거부, 데이터 자동 삭제는 하지 않음
- 웹 빌드의 VITE_DEMO_MODE=false와 Backend의 DEMO_MODE=false를 함께 적용, 화면 숨김만으로 차단하지 않음
- DB 볼륨은 Compose 프로젝트별 분리, 데모 DB 덤프를 운영에 복사하지 않음

## 운영 소스 묶음 준비 · 로컬

프로젝트 루트에서 실행

```bash
python3 -m unittest discover -s deploy -p 'test_*.py'
python3 deploy/package.py /tmp/fireguard-production.tar.gz
```

- 출력 파일이 이미 있으면 덮어쓰지 않고 실패, 다른 이름 사용
- 묶음에는 명시적으로 허용된 소스·스키마·운영 설정만 포함
- 테스트 영상·모델 가중치·seed.dev.sql·데모 설정·실제 보정 메타데이터·mock 데이터·캐시·비밀키·.git 제외
- 웹 이미지의 mock 모듈은 빈 배열로 대체, 모델은 별도 파일로 전달하여 읽기 전용 연결
- Git LFS 포인터가 아니라 실제 모델 파일인지 전달 전 확인
- 소스 묶음 생성은 현재 작업 파일 기준이므로 리뷰된 커밋에서 생성하고 커밋 ID와 함께 전달

## 회사 서버 · 승인 후에만 실행

- 담당자가 승인한 전용 폴더에 운영 묶음과 실제 모델 파일 배치
- `deploy/.env.example`을 `deploy/.env`로 복사하고 비밀키·모델 절대 경로·승인 포트 입력
- JWT_SECRET·AI_CALLBACK_TOKEN은 각각 32바이트 이상 임의 값, 초기 관리자 비밀번호는 12자 이상
- WEB_BIND_IP 기본 127.0.0.1은 서버 내부 접속용, 외부 공개 시 담당자가 지정한 주소로 변경
- 기존 Nginx가 역방향 프록시한다면 loopback 유지, 직접 포트 공개가 필요하면 승인 후 0.0.0.0 등 지정
- HTTPS·발표 접속 주소는 담당자와 조율, 네이버 지도 Web 서비스 URL에 실제 접속 주소 등록
- 아래 build는 베이스 이미지·npm·Python 패키지를 다운로드하고 up은 프로젝트 전용 네트워크·볼륨·컨테이너를 생성

```bash
docker compose --env-file deploy/.env -p fireguard-live -f deploy/compose.yml -f deploy/compose.gpu.yml config --quiet
docker compose --env-file deploy/.env -p fireguard-live -f deploy/compose.yml -f deploy/compose.gpu.yml build
docker compose --env-file deploy/.env -p fireguard-live -f deploy/compose.yml -f deploy/compose.gpu.yml up -d
docker compose --env-file deploy/.env -p fireguard-live -f deploy/compose.yml -f deploy/compose.gpu.yml exec api npm run create-admin
```

- config --quiet는 설정 검증만 수행, build·up·create-admin은 각각 별도 승인된 작업으로 실행
- 관리자 생성 후 ADMIN_INITIAL_PASSWORD를 비우고 승인된 절차로 API 재생성하여 실행 환경에서도 제거
- SMS_PROVIDER는 console 기본값, 실제 문자 발송은 번호·키·비용 승인 후 solapi로 설정
- 실시간 분석은 서버 재시작 시 OFF, 관리자 설정에서 명시적으로 ON
- DB·CCTV 목록·Terrarium 타일은 볼륨에 유지, 동적 DEM npz는 컨테이너 재생성 시 다시 계산될 수 있음
- 업그레이드는 DB 백업 후 검토된 이미지 태그로 진행, 기존 DB의 스키마 변경은 별도 검토 후 적용
- 중지는 승인된 경우에만 동일 프로젝트의 compose stop 사용, down -v·image prune·system prune 사용 금지

## Mac 데모 · 선택 사항

- 기존 README의 Node·Python 네이티브 실행은 그대로 사용 가능, DEMO_MODE=true로 지정
- 아래 Docker 데모는 Linux CPU 분석으로 Mac MPS보다 느릴 수 있음
- deploy/.env에 별도 데모 비밀키·MODEL_FILE·DEMO_VIDEO_DIR 절대 경로·로컬 포트 설정
- 네 영상 파일명·메타데이터는 기존 sql/seed.dev.sql과 일치해야 하며 읽기 권한 필요

```bash
docker compose --env-file deploy/.env -p fireguard-demo -f deploy/compose.yml -f deploy/compose.demo.yml up -d --build db
docker compose --env-file deploy/.env -p fireguard-demo -f deploy/compose.yml -f deploy/compose.demo.yml --profile demo-tools run --rm demo-seed
docker compose --env-file deploy/.env -p fireguard-demo -f deploy/compose.yml -f deploy/compose.demo.yml up -d --build
```

- 운영용 GPU override는 Mac에 적용하지 않음, 데모용 소스는 Git 작업 폴더에서 실행하며 운영 묶음에는 없음
- 이 명령들도 로컬 이미지 다운로드·컨테이너·볼륨 생성이 발생하므로 실행 전 확인

## 남은 검증

- 후보 선택 근거: [PyTorch 이전 버전 설치표](https://docs.pytorch.org/get-started/previous-versions/), [Compose GPU 장치 예약](https://docs.docker.com/compose/how-tos/gpu-support/)

- 회사 Linux amd64 GPU 이미지 빌드·실제 모델 로딩, Mac CPU 검증과 구분
- 회사 서버 드라이버 535와 CUDA 11.8 PyTorch 후보의 실제 GPU 추론
- 관리자 로그인·실시간 1대→6대 처리량·OFF 시 프로세스 종료·실제 위치 추정
- 외부 HTTPS·지도 인증·CCTV와 DEM API 접근·실제 SMS는 담당자 승인 후 확인

## 로컬 검증 기록 · 2026-11-14

- 배포·Mac 데모 Compose 병합 설정 검증 통과, Docker daemon 변경·이미지 다운로드·컨테이너 실행 없이 config만 수행
- 운영 소스 묶음 생성·내부 파일 검사 통과, 테스트 영상·가중치·seed·데모 override 제외
- 운영 묶음을 임시 폴더에 풀고 기존 node_modules로 웹 빌드 통과, TestRunPanel 청크와 mock 카메라 레코드 미포함 확인
- 일반 개발 모드 웹 빌드 통과, HLS 번들 크기 경고 존재
- 초기 검증의 프론트 테스트 실패 2건은 아래 후속 보완에서 해결
- Mac arm64의 웹 이미지·CPU Backend/AI 이미지 빌드 및 Python 의존성 설치 통과
- 실제 로컬 Compose에서 웹·API·PostgreSQL 연결, 빈 운영 DB, 관리자 생성·로그인·권한 검사, 기본 OFF·테스트 경로 차단 확인
- 임시 프로젝트 fireguard-local-check-f3809e24의 컨테이너·네트워크·볼륨만 검증 후 삭제, 이미지와 빌드 캐시는 로컬에 유지
- /app에서 PyTorch·OpenCV·Ultralytics·실시간 runner·LocationSession import 및 이미지 내 테스트 영상·seed·보정 데이터 미포함 확인
- 최초 모듈 점검은 /app/backend에서 실행해 ai 모듈 검색 실패, /app에서 재검증하여 통과
- 실제 모델 추론·최종 GPU 이미지 빌드·T4 검증은 미실행, Mac arm64 CPU 이미지 성공을 회사 Linux amd64 GPU 검증으로 간주하지 않음
- 초기 npm 감사 경고는 아래 후속 보안 패치에서 해결, 무조건적인 audit fix는 사용하지 않음
- 회사 서버 접속·설치·다운로드·삭제·컨테이너 실행 없음

## 후속 보완 검증 · 2026-11-14

- body-parser 2.3.0 → 2.4.0, qs 6.16.0 → 6.17.1로 허용 범위 내 lockfile 갱신
- Vite 8.3.2 → 8.3.8, package.json은 ~8.3.8로 같은 패치 계열 유지
- 카메라 추가 정보 조회·컴포넌트 import 테스트 fixture 복구, 이벤트 더블클릭 상세·체크박스 선택 삭제·취소·실패·부분 성공 재시도 검증
- 독립 영상 목록 금지 검사를 유지하면서 상세 팝업의 등록 영상 메타데이터 조회 허용
- 프론트 전체 170개 통과, 백엔드 102개 통과·DB 통합 4개 생략, 웹 빌드 통과
- Backend·Frontend 전체 npm audit 모두 알려진 취약점 0건, 검사 시점 기준이며 향후 공지까지 보장하지 않음
- 패치된 lockfile로 Mac arm64 웹·CPU API 이미지 재빌드 통과, 컨테이너 npm ci에서도 취약점 0건
- 로컬 임시 Compose에서 일반·gzip 관리자 로그인, 웹/API/DB 연결, 인증·OFF·테스트 API 차단·테스트 UI와 레코드 미포함 확인
- fireguard-security-smoke-24dcdfc5 프로젝트의 임시 컨테이너·네트워크·볼륨만 정리, 회사 서버 변경 없음
