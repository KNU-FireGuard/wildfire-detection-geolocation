const { validateDetection } = require('../validators/detections.validator');

function receiveDetection(req, res) {
  const detection = req.body;
  const errors = validateDetection(detection);
  if (errors.length > 0) {
    return res.status(400).json({
      error: '입력값이 올바르지 않습니다.',
      details: errors,
    });
  }

  // 로컬 수신 확인용 응답입니다. DB 저장은 아직 수행하지 않습니다.
  res.status(200).json({
    message: '탐지 결과를 수신했습니다.',
    data: detection,
  });
}

module.exports = { receiveDetection };
