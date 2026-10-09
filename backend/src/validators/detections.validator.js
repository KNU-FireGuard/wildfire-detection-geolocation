// 요청 객체를 변경하지 않고 필드별 오류 목록을 반환합니다.
function validateDetection(body) {
  const errors = [];
  const add = (field, message) => errors.push({ field, message });
  const object = (value, field) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      add(field, 'JSON 객체여야 합니다.');
      return false;
    }
    return true;
  };
  const text = (value, field) => {
    if (typeof value !== 'string' || value.trim() === '') {
      add(field, '비어 있지 않은 문자열이어야 합니다.');
    }
  };
  const number = (value, field, min = -Infinity, max = Infinity) => {
    if (!Number.isFinite(value) || value < min || value > max) {
      add(field, min === -Infinity && max === Infinity
        ? '유한한 숫자여야 합니다.'
        : max === Infinity
          ? `${min} 이상의 유한한 숫자여야 합니다.`
          : `${min} 이상 ${max} 이하의 숫자여야 합니다.`);
    }
  };

  if (!object(body, 'body')) return errors;
  if (!Number.isSafeInteger(body.run_id) || body.run_id <= 0) {
    add('run_id', '안전한 정수 범위의 양의 정수여야 합니다.');
  }
  if (!Number.isSafeInteger(body.camera_id) || body.camera_id <= 0 || body.camera_id > 2147483647) {
    add('camera_id', '1~2147483647의 정수여야 합니다.');
  }

  if (object(body.detection, 'detection')) {
    if (!['fire', 'smoke'].includes(body.detection.class)) {
      add('detection.class', 'fire 또는 smoke여야 합니다.');
    }
    number(body.detection.confidence, 'detection.confidence', 0, 1);
    if (object(body.detection.bbox, 'detection.bbox')) {
      for (const field of ['x1', 'y1', 'x2', 'y2']) {
        number(body.detection.bbox[field], `detection.bbox.${field}`);
      }
    }
  }

  if (body.location_estimation !== null) {
    if (object(body.location_estimation, 'location_estimation')) {
      number(body.location_estimation.latitude, 'location_estimation.latitude', -90, 90);
      number(body.location_estimation.longitude, 'location_estimation.longitude', -180, 180);
      if (body.location_estimation.error_range_m !== null) {
        number(body.location_estimation.error_range_m, 'location_estimation.error_range_m', 0);
      }
    }
  }
  return errors;
}

module.exports = { validateDetection };
