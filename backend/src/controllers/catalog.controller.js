const pool = require('../config/db');
const fs = require('node:fs');
const path = require('node:path');

const EVENT_COLUMNS = `e.id, e.video_id, v.camera_id, e.class, e.started_at,
  e.ended_at, e.max_confidence, e.estimated_latitude, e.estimated_longitude,
  e.error_range_m, e.created_at, e.updated_at`;
const EVENT_FROM = 'FROM detection_events e JOIN videos v ON v.id = e.video_id';

function pagination(query) {
  const read = (key, fallback, min, max) => {
    const value = query[key];
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
  };
  const limit = read('limit', 50, 1, 100);
  const offset = read('offset', 0, 0, 2147483647);
  return limit === null || offset === null ? null : { limit, offset };
}

function list(sql) {
  return async (req, res) => {
    const page = pagination(req.query);
    if (!page) {
      return res.status(400).json({ error: 'limit은 1~100, offset은 0~2147483647의 정수여야 합니다.' });
    }
    const { rows } = await pool.query(sql, [page.limit, page.offset]);
    res.json({ items: rows, ...page });
  };
}

const listCameras = list(`SELECT id, name, source_type, latitude, longitude, created_at
  FROM cameras ORDER BY id ASC LIMIT $1 OFFSET $2`);
const listVideos = list(`SELECT id, camera_id, original_filename, created_at
  FROM videos ORDER BY id DESC LIMIT $1 OFFSET $2`);
const listEvents = list(`SELECT ${EVENT_COLUMNS} ${EVENT_FROM}
  ORDER BY e.started_at DESC, e.id DESC LIMIT $1 OFFSET $2`);

async function getEvent(req, res) {
  const raw = req.params.id;
  const id = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isInteger(id) || id < 1 || id > 2147483647) {
    return res.status(400).json({ error: '이벤트 ID는 1~2147483647의 정수여야 합니다.' });
  }
  const { rows } = await pool.query(`SELECT ${EVENT_COLUMNS} ${EVENT_FROM} WHERE e.id = $1`, [id]);
  if (rows.length === 0) {
    return res.status(404).json({ error: '탐지 이벤트가 없습니다.' });
  }
  res.json({ item: rows[0] });
}

async function streamVideo(req, res) {
  const raw = req.params.id;
  const id = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(id) || id < 1 || id > 2147483647) {
    return res.status(400).json({ error: '영상 ID는 1~2147483647의 정수여야 합니다.' });
  }

  const { rows } = await pool.query('SELECT file_path FROM videos WHERE id = $1', [id]);
  if (rows.length === 0) return res.status(404).json({ error: '등록된 영상이 없습니다.' });

  let videoPath;
  let fileStat;
  try {
    const projectRoot = path.resolve(__dirname, '../../../');
    const videoRoot = await fs.promises.realpath(path.join(projectRoot, 'data', 'videos'));
    videoPath = await fs.promises.realpath(path.resolve(projectRoot, rows[0].file_path));
    const relativePath = path.relative(videoRoot, videoPath);
    if (!relativePath || relativePath.startsWith(`..${path.sep}`) || relativePath === '..' || path.isAbsolute(relativePath)) {
      return res.status(404).json({ error: '영상 파일을 찾을 수 없습니다.' });
    }
    fileStat = await fs.promises.stat(videoPath);
    if (!fileStat.isFile()) return res.status(404).json({ error: '영상 파일을 찾을 수 없습니다.' });
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
      return res.status(404).json({ error: '영상 파일을 찾을 수 없습니다.' });
    }
    throw error;
  }

  const size = fileStat.size;
  const extension = path.extname(videoPath).toLowerCase();
  const contentType = ({ '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime' })[extension] || 'application/octet-stream';
  const headers = {
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff',
  };
  let start = 0;
  let end = size - 1;
  const range = req.get('range');

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || size === 0 || (!match[1] && !match[2])) {
      res.set('Content-Range', `bytes */${size}`);
      return res.status(416).end();
    }
    if (!match[1]) {
      const suffixLength = Number(match[2]);
      if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
        res.set('Content-Range', `bytes */${size}`);
        return res.status(416).end();
      }
      start = Math.max(size - suffixLength, 0);
    } else {
      start = Number(match[1]);
      if (!Number.isSafeInteger(start) || start >= size) {
        res.set('Content-Range', `bytes */${size}`);
        return res.status(416).end();
      }
    }
    if (match[2] && match[1]) {
      end = Number(match[2]);
      if (!Number.isSafeInteger(end) || end < start) {
        res.set('Content-Range', `bytes */${size}`);
        return res.status(416).end();
      }
    }
    end = Math.min(end, size - 1);
    headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    headers['Content-Length'] = end - start + 1;
    res.writeHead(206, headers);
  } else {
    headers['Content-Length'] = size;
    if (size === 0) return res.writeHead(200, headers).end();
    res.writeHead(200, headers);
  }

  const stream = fs.createReadStream(videoPath, { start, end });
  res.on('close', () => {
    if (!res.writableEnded) stream.destroy();
  });
  stream.on('error', (error) => {
    if (!res.headersSent) res.status(500).json({ error: '영상 스트리밍 중 오류가 발생했습니다.' });
    else res.destroy(error);
  });
  stream.pipe(res);
}

module.exports = { listCameras, listVideos, listEvents, getEvent, streamVideo };
