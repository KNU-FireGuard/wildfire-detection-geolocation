const fs = require('node:fs/promises');
const path = require('node:path');
const { createItsClient, selectDistributed } = require('./its-cctv');

function createCctvCatalog({
  cachePath = path.resolve(__dirname, '../../../data/its-cctv-cache.json'),
  client,
  saveCameras = async items => items,
  now = () => new Date(),
} = {}) {
  const itsClient = client || createItsClient({ apiKey: process.env.ITS_CCTV_API_KEY });
  let refreshing = false;

  async function readCache() {
    try {
      const data = JSON.parse(await fs.readFile(cachePath, 'utf8'));
      if (!Array.isArray(data.items) || typeof data.refreshedAt !== 'string') throw new Error('캐시 형식 오류');
      return data;
    } catch (error) {
      if (error.code === 'ENOENT') return { source: 'live', refreshedAt: null, items: [] };
      throw new Error('ITS CCTV 캐시를 읽을 수 없습니다.');
    }
  }

  async function readPending() {
    try {
      const data = JSON.parse(await fs.readFile(`${cachePath}.pending`, 'utf8'));
      if (!Array.isArray(data.items) || data.items.length !== 6 || typeof data.refreshedAt !== 'string') {
        throw new Error('대기 목록 형식 오류');
      }
      return data;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw new Error('ITS CCTV 대기 목록을 읽을 수 없습니다.');
    }
  }

  async function writePrivate(file, data) {
    const tempPath = `${file}.${process.pid}.tmp`;
    try {
      await fs.writeFile(tempPath, JSON.stringify(data), { mode: 0o600 });
      await fs.rename(tempPath, file);
    } finally { await fs.rm(tempPath, { force: true }); }
  }

  async function savePending(pending) {
    const items = await saveCameras(pending.items);
    const result = { source: 'live', refreshedAt: pending.refreshedAt, items };
    await writePrivate(cachePath, result);
    await fs.rm(`${cachePath}.pending`, { force: true });
    return result;
  }

  return {
    async list() {
      return readCache();
    },
    async refresh() {
      if (refreshing) throw new Error('ITS CCTV 갱신이 이미 진행 중입니다.');
      refreshing = true;
      try {
        const pending = await readPending();
        if (pending) return savePending(pending);
        if (!client && !process.env.ITS_CCTV_API_KEY) throw new Error('ITS_CCTV_API_KEY가 설정되지 않았습니다.');
        await readCache();
        await fs.mkdir(path.dirname(cachePath), { recursive: true });
        const candidates = await itsClient.fetchCctvs();
        if (candidates.length < 6) throw new Error('재생 가능한 HTTPS HLS CCTV가 6개 미만입니다. 캐시는 유지됩니다.');
        const selected = { refreshedAt: now().toISOString(), items: selectDistributed(candidates, 6) };
        await writePrivate(`${cachePath}.pending`, selected);
        return savePending(selected);
      } finally { refreshing = false; }
    },
  };
}

module.exports = { createCctvCatalog };
