import math

class FireLocationEstimator:
    def __init__(self, roi_database=None):
        """
        roi_database: 프리셋 기반의 ROI 데이터를 담은 딕셔너리
        주어지지 않을 경우, 예시 규격의 기본값을 사용합니다.
        """
        if roi_database is None:
            self.roi_database = {
                "preset_1": {
                    "Sector_1": {"bbox": [0, 0, 960, 1080], "address": "A구역"},
                    "Sector_2": {"bbox": [960, 0, 1920, 1080], "address": "B구역"}
                }
            }
        else:
            self.roi_database = roi_database

    def estimate_location(self, bbox, metadata):
        """
        메인 라우터: 메타데이터에 따라 Track 1과 Track 2로 동적 분기하여 위치를 추정합니다.
        :param bbox: [x_min, y_min, x_max, y_max] 형태의 리스트
        :param metadata: 카메라 메타데이터 (pan, tilt, preset_id 등 포함) 딕셔너리
        :return: 추정된 주소 또는 에러 메시지 문자열
        """
        if "camera" in metadata and "ptz" in metadata:
            return self._estimate_by_ray_dem(bbox, metadata)
        elif "preset_id" in metadata:
            return self._estimate_by_roi_point(bbox, metadata)
        else:
            return "추정 불가: 유효한 메타데이터(camera/ptz 또는 preset_id)가 없습니다."

    def _get_mock_dem_altitude(self, x, y):
        """
        임시 DEM 고도 함수: 실제 지형 데이터 연동 전까지 평면(고도 0m)으로 가정합니다.
        (x, y): 카메라로부터의 상대 거리 (미터 단위)
        """
        return 0.0

    def _estimate_by_ray_dem(self, bbox, metadata):
        """
        Track 1: PTZ 및 물리적 카메라 정보가 존재할 때 Ray Marching + Binary Search 로직
        """
        x_min, y_min, x_max, y_max = bbox
        
        # 발화점 추정: 최하단 중앙 픽셀 계산
        fire_x = (x_min + x_max) / 2.0
        fire_y = float(y_max)
        
        cam = metadata["camera"]
        ptz = metadata["ptz"]
        
        # 1. 2D 픽셀 좌표를 이미지 중심 기준 오프셋 비율(-0.5 ~ 0.5)로 변환
        offset_x = (fire_x - (cam["resolution_w"] / 2.0)) / cam["resolution_w"]
        offset_y = ((cam["resolution_h"] / 2.0) - fire_y) / cam["resolution_h"] # y는 아래로 커지므로 반전
        
        # 중심 픽셀 기준 광선의 오프셋 각도 계산
        delta_pan = offset_x * cam["fov_h"]
        delta_tilt = offset_y * cam["fov_v"]
        
        # 실제 카메라 각도와 합산 후 라디안(Radian) 변환
        final_pan = math.radians(ptz["pan"] + delta_pan)
        final_tilt = math.radians(ptz["tilt"] + delta_tilt)
        
        # 3D 방향 벡터(Ray) 도출 (X: 동, Y: 북, Z: 상)
        dx = math.sin(final_pan) * math.cos(final_tilt)
        dy = math.cos(final_pan) * math.cos(final_tilt)
        dz = math.sin(final_tilt)
        
        # 방어 로직: Ray가 위로 향하거나 수평이면 지면에 닿지 않음
        if dz >= 0:
            return "추정 불가: 발화점의 광선(Ray)이 하늘이나 수평을 향하고 있습니다."
        
        # 2. Ray Marching 초기 설정
        ray_x, ray_y = 0.0, 0.0  # 카메라 위치를 상대 원점(0,0)으로 설정
        ray_z = float(cam["altitude"])
        step_size = 50.0  # 50m 간격 전진
        
        prev_x, prev_y, prev_z = ray_x, ray_y, ray_z
        hit = False
        
        # 3. Ray Marching (성큼성큼 전진)
        max_steps = 1000 # 최대 50km 제한 (무한 루프 방지)
        for _ in range(max_steps):
            ray_x += dx * step_size
            ray_y += dy * step_size
            ray_z += dz * step_size
            
            dem_z = self._get_mock_dem_altitude(ray_x, ray_y)
            
            # 광선이 지형보다 낮아지면 충돌(교차) 판단
            if ray_z <= dem_z:
                hit = True
                break
                
            prev_x, prev_y, prev_z = ray_x, ray_y, ray_z
            
        if not hit:
            return "추정 불가: 최대 탐색 범위(50km) 내에서 지형과 교차하지 않았습니다."
            
        # 4. Binary Search (정밀 탐색)
        # 충돌 구간(prev ~ ray)을 좁혀가며 정확한 (X, Y) 지점을 탐색
        low_x, low_y, low_z = prev_x, prev_y, prev_z
        high_x, high_y, high_z = ray_x, ray_y, ray_z
        
        # 10회 이분할 시 오차 범위 매우 정밀하게 축소 (50m -> 약 0.05m 오차)
        for _ in range(10):
            mid_x = (low_x + high_x) / 2.0
            mid_y = (low_y + high_y) / 2.0
            mid_z = (low_z + high_z) / 2.0
            
            mid_dem_z = self._get_mock_dem_altitude(mid_x, mid_y)
            
            if mid_z <= mid_dem_z:
                # 중간 지점이 이미 땅 아래임 -> 충돌점은 더 앞(low ~ mid)에 있음
                high_x, high_y, high_z = mid_x, mid_y, mid_z
            else:
                # 중간 지점은 땅 위임 -> 충돌점은 더 뒤(mid ~ high)에 있음
                low_x, low_y, low_z = mid_x, mid_y, mid_z
                
        # 최종 교차점 (카메라로부터의 상대 거리 미터)
        final_x = (low_x + high_x) / 2.0
        final_y = (low_y + high_y) / 2.0
        
        # 5. 상대 직교 좌표를 실제 위경도로 변환 (Flat Earth 가정)
        # 위도 1도는 약 111,000m, 경도 1도는 111,000m * cos(위도)
        lat_offset = final_y / 111000.0
        lon_offset = final_x / (111000.0 * math.cos(math.radians(cam["lat"])))
        
        est_lat = cam["lat"] + lat_offset
        est_lon = cam["lon"] + lon_offset
        
        return f"정밀 추론 좌표: 위도 {est_lat:.6f}, 경도 {est_lon:.6f} (카메라 기준 상대거리: 동쪽 {final_x:.1f}m, 북쪽 {final_y:.1f}m)"

    def _estimate_by_roi_point(self, bbox, metadata):
        """
        Track 2: PTZ 부재 시 프리셋 ID를 기반으로 단순 최하단 중앙 픽셀 위치 추정
        """
        preset_id = metadata.get("preset_id")
        if preset_id not in self.roi_database:
            return f"추정 불가: 프리셋 '{preset_id}'에 대한 ROI 데이터가 없습니다."
            
        preset_sectors = self.roi_database[preset_id]
        
        x_min, y_min, x_max, y_max = bbox
        fire_x = (x_min + x_max) / 2.0
        fire_y = float(y_max)
        
        for sector_name, sector_data in preset_sectors.items():
            s_x_min, s_y_min, s_x_max, s_y_max = sector_data["bbox"]
            if s_x_min <= fire_x <= s_x_max and s_y_min <= fire_y <= s_y_max:
                return sector_data["address"]
                
        return "알 수 없는 구역 (ROI 범위 외)"

if __name__ == "__main__":
    estimator = FireLocationEstimator()
    
    print("=" * 50)
    print("--- 테스트 1: Track 1 실행 (Ray Casting + DEM 탐색) ---")
    bbox_1 = [860, 700, 1060, 900]
    meta_1 = {
        "camera": {
            "lat": 35.8562, "lon": 128.6143, "altitude": 150.0,
            "fov_h": 60.0, "fov_v": 33.75, "resolution_w": 1920, "resolution_h": 1080
        },
        "ptz": {"pan": 45.0, "tilt": -10.0} # 카메라를 우상단 북동쪽(45도)으로 바라보고 아래로(-10도) 숙임
    }
    result_1 = estimator.estimate_location(bbox_1, meta_1)
    print(f"입력 바운딩 박스: {bbox_1}")
    print(f"입력 메타데이터: {meta_1}")
    print(f"추정 결과: {result_1}")
    
    print("\n" + "=" * 50)
    print("--- 테스트 2: Track 2 실행 (PTZ 부재, 프리셋 ID) ---")
    bbox_2 = [400, 500, 500, 1000]
    meta_2 = {"preset_id": "preset_1"}
    result_2 = estimator.estimate_location(bbox_2, meta_2)
    print(f"입력 바운딩 박스: {bbox_2}")
    print(f"입력 메타데이터: {meta_2}")
    print(f"추정 결과: {result_2} (기대값: A구역)")
    print("=" * 50)
