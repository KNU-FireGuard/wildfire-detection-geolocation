function isDemoModeEnabled() {
  return process.env.DEMO_MODE === undefined
    ? process.env.NODE_ENV !== 'production'
    : process.env.DEMO_MODE === 'true';
}

function deploymentMode(req, res, next) {
  if (isDemoModeEnabled()) return next();
  if (/\/test-runs(?:\/|$)/i.test(req.path) || /^\/videos\//i.test(req.path)) {
    return res.status(404).json({ error: '배포 환경에서는 테스트 기능이 비활성화되어 있습니다.' });
  }
  if (/^\/videos\/?$/i.test(req.path)) {
    const { pagination } = require('../controllers/catalog.controller');
    const page = pagination(req.query);
    if (!page) return res.status(400).json({ error: '올바른 페이지 값을 입력하세요.' });
    return res.json({ items: [], ...page });
  }
  return next();
}

async function assertDeploymentDatabase(pool) {
  if (isDemoModeEnabled()) return;
  const result = await pool.query("SELECT (SELECT count(*) FROM videos) + (SELECT count(*) FROM cameras WHERE source_type = 'test') AS count");
  if (Number(result.rows[0]?.count) !== 0) {
    throw new Error('배포 DB에 테스트 데이터가 있습니다. 데모 DB를 복사하지 말고 별도 DB를 사용하세요.');
  }
}

module.exports = { isDemoModeEnabled, deploymentMode, assertDeploymentDatabase };
