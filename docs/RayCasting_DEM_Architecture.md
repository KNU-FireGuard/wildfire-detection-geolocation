# Ray Casting 및 DEM 기반 산불 위치 추정 설계 (Track 1)

이 문서는 PTZ 데이터를 활용하여 2D 영상의 발화점을 3D 공간상의 광선(Ray)으로 변환하고, DEM(수치표고모델) 지형과 교차하는 좌표를 찾는 Track 1의 베이스라인 아키텍처입니다. 애자일(Agile) 원칙에 따라 복잡한 곡률이나 투영 변환을 배제하고 직교 좌표계(Flat Earth) 기준으로 직관적으로 설계되었습니다.

## 1. API Interface 규격 (필수 메타데이터 JSON)

Track 1 로직을 풀기 위해 프론트엔드/백엔드로부터 넘겨받아야 할 필수 물리 메타데이터입니다.

```json
{
  "camera": {
    "lat": 35.8562,       // 카메라 위도 (Y축 기준점)
    "lon": 128.6143,      // 카메라 경도 (X축 기준점)
    "altitude": 150.0,    // 카메라 해발 고도 (미터, Z축 기준점)
    "fov_h": 60.0,        // 수평 시야각 (Degree)
    "fov_v": 33.75,       // 수직 시야각 (Degree)
    "resolution_w": 1920, // 이미지 해상도 너비
    "resolution_h": 1080  // 이미지 해상도 높이
  },
  "ptz": {
    "pan": 45.0,          // 현재 카메라의 Pan 각도 (정북 0도 기준, Degree)
    "tilt": -5.0          // 현재 카메라의 Tilt 각도 (수평 0도 기준, 아래로 향하면 음수, Degree)
  }
}
```

## 2. 2D 픽셀 → 3D Ray 변환 로직 (Python 초안)

화면 중심을 기준으로 픽셀 오프셋을 각도로 변환한 뒤, 현재 카메라의 Pan/Tilt와 합산하여 최종 광선(Ray)의 방향 벡터를 구하는 코드 뼈대입니다.

```python
import math

def calculate_ray_vector(meta, fire_x, fire_y):
    """
    2D 픽셀 좌표를 3D 방향 벡터(단위 벡터)로 변환합니다.
    (Flat Earth 가정: 북쪽이 Y, 동쪽이 X, 위쪽이 Z축)
    """
    cam = meta["camera"]
    
    # 1. 픽셀 좌표를 이미지 중심 기준 오프셋 비율(-0.5 ~ 0.5)로 변환
    offset_x = (fire_x - (cam["resolution_w"] / 2)) / cam["resolution_w"]
    # y는 아래로 갈수록 커지므로 반전하여 위쪽을 양수로 처리
    offset_y = ((cam["resolution_h"] / 2) - fire_y) / cam["resolution_h"] 
    
    # 2. 중심 픽셀 기준 광선의 오프셋 각도 계산
    delta_pan = offset_x * cam["fov_h"]
    delta_tilt = offset_y * cam["fov_v"]
    
    # 3. 실제 카메라 각도와 합산하여 최종 절대 각도 산출
    ptz = meta["ptz"]
    final_pan = math.radians(ptz["pan"] + delta_pan)
    final_tilt = math.radians(ptz["tilt"] + delta_tilt)
    
    # 4. 3D 방향 벡터(Ray) 도출 (구면 좌표계 -> 직교 좌표계)
    # X: 동(East), Y: 북(North), Z: 상(Up)
    dx = math.sin(final_pan) * math.cos(final_tilt)
    dy = math.cos(final_pan) * math.cos(final_tilt)
    dz = math.sin(final_tilt)
    
    return dx, dy, dz
```

## 3. DEM 교차 탐색 알고리즘 구조 (Ray Marching + Binary Search)

연산 효율을 극대화하기 위해 '일정 간격 전진(Ray Marching)'과 '이진 탐색(Binary Search)'을 결합한 하이브리드 탐색 구조를 제안합니다.

1. **초기 설정**: 
   - `ray_origin = (0, 0, camera_altitude)` (카메라 위치를 원점(0,0)으로 가정)
   - `step_size = 50.0` (미터 단위)
2. **Ray Marching (성큼성큼 걷기)**:
   - Ray 벡터를 따라 `step_size` 만큼씩 빠르게 이동하며, 해당 (X, Y) 지점의 DEM 고도 데이터를 조회합니다.
   - `광선의 Z 높이 < DEM 고도`가 되는 순간 지형과 충돌한 것으로 판단하고 반복을 멈춥니다. (이전 step과 현재 step 사이에 교차점이 존재함)
3. **Binary Search (정밀 탐색)**:
   - 충돌이 발생한 구간(마지막 `step`과 그 이전 `step` 사이의 50m 구간)을 절반씩 쪼개며(이분할) 좁혀 나갑니다.
   - 지정된 오차 범위(예: 1m 이내)에 도달할 때까지 반복하여 교차점의 정확한 최종 (X, Y, Z) 좌표를 도출합니다.

## 4. [Future Work / 트러블슈팅 예정 사항]

- **지구 곡률 및 좌표계 투영 보정**:
  - 현재는 애자일한 구현을 위해 평면(Flat Earth)을 가정했습니다.
  - 향후 실제 테스트 시, 원거리(수 km 이상)에서 지구 곡률로 인해 타겟의 고도 오차가 발생하거나, 위경도 좌표(도 단위)와 직교 좌표(미터 단위) 간의 변환 충돌이 발생할 경우, **EPSG:3857(웹 메르카토르) 또는 UTM 투영 변환(Projection)**을 도입하여 알고리즘을 고도화할 예정입니다.
