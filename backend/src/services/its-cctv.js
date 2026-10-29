const { createHash } = require('node:crypto');

const ENDPOINT = 'https://openapi.its.go.kr:9443/cctvInfo';
const KOREA_BOUNDS = { minX: '124.5', maxX: '132', minY: '33', maxY: '39' };

function normalizeItsResponse(body) {
  const data = body?.response?.data;
  if (!Array.isArray(data)) throw new Error('ITS CCTV 응답 형식이 올바르지 않습니다.');
  return data.flatMap(item => {
    const latitude = Number(item.coordy);
    const longitude = Number(item.coordx);
    let url;
    try { url = new URL(item.cctvurl); } catch { return []; }
    if (String(item.cctvtype) !== '1' || String(item.cctvformat).trim().toUpperCase() !== 'HLS'
      || !['http:', 'https:'].includes(url.protocol)
      || !Number.isFinite(latitude) || !Number.isFinite(longitude)
      || latitude < 33 || latitude > 39 || longitude < 124.5 || longitude > 132) return [];
    const name = String(item.cctvname || '').trim();
    if (!name) return [];
    return [{
      providerKey: createHash('md5').update(`${item.roadsectionid || ''}|${name}|${longitude}|${latitude}`).digest('hex'),
      name, latitude, longitude, streamUrl: url.href,
    }];
  });
}

function distanceSquared(a, b) {
  const north = (a.latitude - b.latitude) * 111;
  const east = (a.longitude - b.longitude) * 89;
  return north * north + east * east;
}

function selectDistributed(cameras, count = 6) {
  const remaining = [...new Map(cameras.map(camera => [camera.providerKey, camera])).values()]
    .sort((a, b) => a.providerKey.localeCompare(b.providerKey));
  if (remaining.length <= count) return remaining;
  const center = { latitude: 36, longitude: 128 };
  const selected = [remaining.reduce((best, camera) => distanceSquared(camera, center) > distanceSquared(best, center) ? camera : best)];
  while (selected.length < count) {
    const candidates = remaining.filter(camera => !selected.includes(camera));
    selected.push(candidates.reduce((best, camera) => {
      const score = Math.min(...selected.map(picked => distanceSquared(camera, picked)));
      const bestScore = Math.min(...selected.map(picked => distanceSquared(best, picked)));
      return score > bestScore ? camera : best;
    }));
  }
  return selected;
}

function createItsClient({ apiKey, fetchImpl = fetch } = {}) {
  return {
    async fetchCctvs() {
      if (!apiKey) throw new Error('ITS_CCTV_API_KEY가 설정되지 않았습니다.');
      const url = new URL(ENDPOINT);
      Object.entries({ apiKey, type: 'its', cctvType: '1', getType: 'json', ...KOREA_BOUNDS })
        .forEach(([key, value]) => url.searchParams.set(key, value));
      let response;
      try { response = await fetchImpl(url.href, { signal: AbortSignal.timeout(12000) }); }
      catch { throw new Error('ITS CCTV 조회에 연결할 수 없습니다.'); }
      if (!response.ok) throw new Error(`ITS CCTV 조회 실패 (HTTP ${response.status})`);
      let body;
      try { body = await response.json(); }
      catch { throw new Error('ITS CCTV 응답이 JSON 형식이 아닙니다.'); }
      if (body?.response?.errorcode || body?.response?.errorCode) {
        throw new Error(`ITS CCTV 오류 (${body.response.errorcode || body.response.errorCode})`);
      }
      return normalizeItsResponse(body);
    },
  };
}

module.exports = { normalizeItsResponse, selectDistributed, createItsClient };
