class AddressMapper:
    def __init__(self, roi_database: dict):
        if not isinstance(roi_database, dict):
            raise TypeError("roi_database는 딕셔너리 형태여야 합니다.")
        self.roi_database = roi_database

    def _get_fire_point(self, bbox: list) -> tuple:
        """바운딩 박스의 하단 중앙(가로 가운데, 가장 아래) 픽셀 좌표를 추출합니다."""
        if not isinstance(bbox, list) or len(bbox) != 4:
            raise TypeError("bbox는 [x_min, y_min, x_max, y_max] 형태의 리스트여야 합니다.")
        
        x_min, y_min, x_max, y_max = bbox
        
        if x_min >= x_max or y_min >= y_max:
            raise ValueError("잘못된 바운딩 박스 좌표입니다.")

        # 발화점(불씨) 추정: 가로 중앙, 가장 아래쪽 픽셀
        fire_x = (x_min + x_max) / 2
        fire_y = y_max
        
        return (fire_x, fire_y)

    def _is_point_in_box(self, point: tuple, box: list) -> bool:
        """특정 픽셀 좌표가 주어진 박스 영역 안에 포함되는지 확인합니다."""
        px, py = point
        x_min, y_min, x_max, y_max = box
        return (x_min <= px <= x_max) and (y_min <= py <= y_max)

    def map_address(self, bbox: list) -> str:
        """YOLO bbox를 입력받아 하단 중앙 픽셀 기반으로 유력한 발화지 주소를 반환합니다."""
        try:
            fire_point = self._get_fire_point(bbox)
        except (TypeError, ValueError) as e:
            print(f"[Error] 입력값 오류: {e}")
            return "주소 미상"

        for sector, data in self.roi_database.items():
            roi_bbox = data.get("bbox")
            address = data.get("address")
            
            if not roi_bbox or not address:
                continue
                
            # 해당 픽셀 점이 구역(ROI) 안에 들어가면 즉시 반환
            if self._is_point_in_box(fire_point, roi_bbox):
                return address

        return "주소 미상"

if __name__ == "__main__":
    # 테스트용 ROI 데이터베이스
    roi_db = {
        "Sector_1": {
            "bbox": [0, 0, 960, 1080], 
            "address": "대구 가창면 오리 산 12-3 부근 (서측)"
        },
        "Sector_2": {
            "bbox": [960, 0, 1920, 1080], 
            "address": "대구 가창면 오리 산 15-1 부근 (동측)"
        }
    }

    mapper = AddressMapper(roi_db)
    test_bbox = [400, 500, 500, 650]
    # 중심(450)과 바닥(650) 픽셀 추출 예상 -> Sector_1에 속해야 함
    print(f"입력 bbox: {test_bbox} -> 추정 주소: {mapper.map_address(test_bbox)}")
