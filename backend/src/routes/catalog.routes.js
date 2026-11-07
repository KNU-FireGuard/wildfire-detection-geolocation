const express = require('express');
const { listCameras, listVideos, listEvents, getEvent, streamVideo } = require('../controllers/catalog.controller');
const { acknowledgeEvent } = require('../controllers/events.controller');

const router = express.Router();
router.get('/cameras', listCameras);
router.get('/videos', listVideos);
router.get('/videos/:id/stream', streamVideo);
router.get('/events', listEvents);
router.get('/events/:id', getEvent);
router.post('/events/:id/acknowledge', acknowledgeEvent);

module.exports = router;
