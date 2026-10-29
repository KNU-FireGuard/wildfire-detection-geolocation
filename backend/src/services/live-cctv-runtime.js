const { createCctvCatalog } = require('./cctv-catalog');
const { saveLiveCameras } = require('./live-camera-sync');
const { createLiveMonitor } = require('./live-monitor');

const catalog = createCctvCatalog({ saveCameras: saveLiveCameras });
const monitor = createLiveMonitor({ catalog });

module.exports = { catalog, monitor };
