## 🤝 FireGuard 협업 규칙 (Convention)

### 🌳 브랜치(Branch) 규칙
- `main`: 최종 배포용 안정화 브랜치
- `develop`: 통합 테스트 브랜치 (모든 작업은 여기로 모입니다)
- `feature/파트명/#이슈번호-짧은설명`: 개인 기능 작업 브랜치
  - 파트명: `frontend`(프론트), `backend`(백엔드), `ai`(AI/알고리즘)
  - *(예시)* `feature/ai/#8-dem-ray-marching`
  - *(예시)* `feature/backend/#12-api-setup`

### 💬 커밋(Commit) 메시지 규칙
- `Feat`: 새로운 기능 추가
- `Fix`: 버그 수정
- `Docs`: 문서 수정 (README 등)
- `Refactor`: 코드 리팩토링 (결과는 같고 코드 구조만 개선)
- `Chore`: 패키지 매니저(npm, pip), 설정 파일 등 자잘한 수정
- *(예시)* `Feat: Camera Ray 교차 연산 유틸 함수 추가 (#8)`

### 🛠 코드 리뷰 및 머지(Merge) 규칙
- 모든 코드는 반드시 1명 이상의 팀원에게 리뷰(Approve)를 받아야 `develop`에 병합할 수 있습니다.
- FE와 BE는 API 통신이 제대로 되는지 서로의 코드를 교차 리뷰합니다.
- AI 담당자 2명은 서로의 알고리즘 로직과 딥러닝 파이프라인을 교차 검증합니다.
