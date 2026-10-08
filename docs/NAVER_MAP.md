# 네이버 지도 설정

대시보드의 지도는 네이버 지도 JavaScript API v3을 사용합니다. 기본은 위성 이미지에 도로·지명을 겹쳐 표시하는 HYBRID이며, 일반·위성·위성/지명 전환을 지원합니다.

## Client ID 설정

1. [네이버 클라우드 콘솔](https://console.ncloud.com/)에서 Maps 애플리케이션을 등록합니다. Dynamic Map을 활성화합니다.
2. 애플리케이션의 인증 정보에서 Client ID를 확인합니다. Client Secret은 프론트엔드에서 사용하지 않습니다.
3. Web 서비스 URL에 개발 환경 접속 주소를 등록합니다. 이 프로젝트의 접속 주소는 `http://127.0.0.1:5173`입니다. localhost로도 접속한다면 해당 주소도 등록합니다. 등록 형식은 콘솔의 안내를 따릅니다.
4. `frontend/.env.local`에 다음 값을 설정합니다. 파일이 없으면 `.env.example`을 복사합니다. 기존 설정은 유지합니다.

```dotenv
VITE_DATA_SOURCE=api
VITE_NAVER_MAP_CLIENT_ID=발급받은_Client_ID
```

5. 프론트엔드 개발 서버를 재시작하고 대시보드에 접속합니다.

Client ID는 브라우저 SDK 로딩에 사용되는 공개 식별자입니다. Client Secret을 VITE 변수에 넣지 않습니다. `.env.local`은 Git에서 제외됩니다. 배포할 때는 호스팅 환경에 같은 변수를 설정한 후 빌드하고 배포 주소도 Maps 콘솔에 등록합니다.

## 표시 및 검증

- 카메라 API의 위도·경도에 CCTV 마커를 표시합니다. 좌표가 없거나 범위를 벗어나면 지도에서 제외하고 안내합니다.
- 선택한 이벤트의 추정 위치는 빨간 마커로 표시합니다. 연결된 카메라에 좌표가 있으면 두 위치를 선으로 연결합니다.
- CCTV 마커 또는 지도 아래 카메라 버튼을 누르면 해당 카메라의 최신 이벤트를 선택합니다.
- 이벤트 목록 선택 시 해당 위치로 이동합니다. 전체 위치 버튼으로 전체 데이터의 좌표 범위를 볼 수 있습니다.
- API 모드에서 빈 DB인 경우 지도 배경만 표시됩니다. 예시 마커 확인은 `VITE_DATA_SOURCE=mock`을 설정하고 재시작합니다. 목록·상세 페이지는 계속 실제 API를 사용합니다.
- 키 미설정, SDK 로딩 실패, 인증 실패 시 지도 영역에 안내합니다. 키·접속 URL·Dynamic Map 설정을 확인합니다.
- 페이지를 나갔다 다시 들어올 때 지도와 마커가 중복 생성되지 않는지 확인합니다.

`npm.cmd run build`와 `node --test test/*.test.js`로 빌드 및 API/지도 동작 테스트를 실행합니다. 자동 테스트는 SDK 대역을 사용하므로 실제 지도 타일과 인증은 유효한 Client ID를 설정한 브라우저에서 확인해야 합니다.

## 공식 문서

- [Client ID 발급](https://navermaps.github.io/maps.js.ncp/docs/tutorial-1-Getting-Client-ID.html)
- [지도 시작하기: ncpKeyId 사용](https://navermaps.github.io/maps.js.ncp/docs/tutorial-2-Getting-Started.html)
- [지도 유형](https://navermaps.github.io/maps.js.ncp/docs/tutorial-MapTypes.html)
- [마커](https://navermaps.github.io/maps.js.ncp/docs/tutorial-2-Marker.html)
