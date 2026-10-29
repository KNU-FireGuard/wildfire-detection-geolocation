async function start() {
  // config/db.js에서 .env를 읽은 후 서버 포트를 확인합니다.
  const pool = require('./config/db');
  const { getJwtSecret } = require('./middleware/require-admin');
  const { getAiCallbackToken } = require('./middleware/require-ai-callback');
  const app = require('./app');
  const { monitor } = require('./services/live-cctv-runtime');
  const port = Number(process.env.PORT || 3000);
  let server;

  try {
    getJwtSecret();
    getAiCallbackToken();
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('PORT는 1부터 65535 사이의 정수여야 합니다.');
    }
    await pool.query('SELECT 1');
    console.log('PostgreSQL 연결 성공');

    server = app.listen(port, '127.0.0.1');
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    console.log(`Backend 서버 실행: http://127.0.0.1:${port}`);
    await monitor.start();
    console.log(`실시간 CCTV 감시 상태: ${monitor.status().state}`);

    let stopping = false;
    async function shutdown() {
      if (stopping) return;
      stopping = true;
      console.log('Backend 서버 종료 중');
      const timeout = setTimeout(() => process.exit(1), 10000);
      timeout.unref();
      await monitor.stop();
      require('./services/run-manager').stopAll();
      server.close(async () => {
        try {
          await pool.end();
        } catch (error) {
          console.error('DB 연결 종료 실패:', error.message);
          process.exitCode = 1;
        } finally {
          clearTimeout(timeout);
        }
      });
    }
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  } catch (error) {
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    await pool.end();
    throw error;
  }
}

start().catch((error) => {
  console.error('Backend 시작 실패:', error.message);
  process.exitCode = 1;
});
