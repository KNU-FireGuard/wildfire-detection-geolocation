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
        추후 고도화된 알고리즘으로 교체하기 쉽도록 확장성을 고려한 구조입니다.
        :param bbox: [x_min, y_min, x_max, y_max] 형태의 리스트
        :param metadata: 카메라 메타데이터 (pan, tilt, preset_id 등 포함) 딕셔너리
        :return: 추정된 주소 또는 에러 메시지 문자열
        """
        if "pan" in metadata and "tilt" in metadata:
            return self._estimate_by_ray_dem(bbox, metadata)
        elif "preset_id" in metadata:
            return self._estimate_by_roi_point(bbox, metadata)
        else:
            return "추정 불가: 유효한 메타데이터(pan/tilt 또는 preset_id)가 없습니다."

    def _estimate_by_ray_dem(self, bbox, metadata):
        """
        Track 1: PTZ 값이 존재할 때 (추후 Ray Marching + DEM 결합 로직으로 확장)
        """
        # Ray+DEM 기반 정밀 좌표 추정 및 API 호출 로직 위치 (현재는 더미 구현)
        return "정밀 추론 주소: 대구 가창면 10-1"

    def _estimate_by_roi_point(self, bbox, metadata):
        """
        Track 2: PTZ 부재 시 프리셋 ID를 기반으로 단순 최하단 중앙 픽셀(Bottom-Center) 위치 추정
        애자일(Agile)한 베이스라인 확보를 위한 가장 직관적인 판별 방식
        """
        preset_id = metadata.get("preset_id")
        
        if preset_id not in self.roi_database:
            return f"추정 불가: 프리셋 '{preset_id}'에 대한 ROI 데이터가 없습니다."
            
        preset_sectors = self.roi_database[preset_id]
        
        x_min, y_min, x_max, y_max = bbox
        
        # 발화점 추정: 연기의 발생 근원지인 최하단 중앙 픽셀(Bottom-Center) 계산
        fire_x = (x_min + x_max) / 2.0
        fire_y = float(y_max)
        
        # 계산된 단일 픽셀(fire_x, fire_y)이 어느 ROI(Sector)에 속하는지 판별
        for sector_name, sector_data in preset_sectors.items():
            s_x_min, s_y_min, s_x_max, s_y_max = sector_data["bbox"]
            
            if s_x_min <= fire_x <= s_x_max and s_y_min <= fire_y <= s_y_max:
                return sector_data["address"]
                
        return "알 수 없는 구역 (ROI 범위 외)"

if __name__ == "__main__":
    estimator = FireLocationEstimator()
    
    print("=" * 50)
    print("--- 테스트 1: Track 1 실행 (PTZ 데이터 존재) ---")
    bbox_1 = [400, 500, 500, 1000]
    meta_1 = {"pan": 120.5, "tilt": 15.2, "zoom": 2.0}
    result_1 = estimator.estimate_location(bbox_1, meta_1)
    print(f"입력 바운딩 박스: {bbox_1}")
    print(f"입력 메타데이터: {meta_1}")
    print(f"추정 결과: {result_1}")
    
    print("\n" + "=" * 50)
    print("--- 테스트 2: Track 2 실행 (PTZ 부재, 최하단 중앙 픽셀이 A구역에 속함) ---")
    bbox_2 = [400, 500, 500, 1000]
    # Bottom-center: x = 450, y = 1000 -> Sector_1 (0~960, 0~1080) 에 속함
    meta_2 = {"preset_id": "preset_1"}
    result_2 = estimator.estimate_location(bbox_2, meta_2)
    print(f"입력 바운딩 박스: {bbox_2}")
    print(f"입력 메타데이터: {meta_2}")
    print(f"추정된 발화점 픽셀: x=450.0, y=1000.0")
    print(f"추정 결과: {result_2} (기대값: A구역)")
    
    print("\n" + "=" * 50)
    print("--- 테스트 3: Track 2 실행 (최하단 중앙 픽셀이 B구역에 속함) ---")
    bbox_3 = [940, 500, 1040, 1000] 
    # Bottom-center: x = 990, y = 1000 -> Sector_2 (960~1920, 0~1080) 에 속함
    result_3 = estimator.estimate_location(bbox_3, meta_2)
    print(f"입력 바운딩 박스: {bbox_3}")
    print(f"입력 메타데이터: {meta_2}")
    print(f"추정된 발화점 픽셀: x=990.0, y=1000.0")
    print(f"추정 결과: {result_3} (기대값: B구역)")
    print("=" * 50)
