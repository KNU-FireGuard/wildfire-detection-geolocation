const express = require('express');
const { listCameras, listVideos, listEvents, getEvent, streamVideo } = require('../controllers/catalog.controller');
const { acknowledgeEvent } = require('../controllers/events.controller');
const { listCaptures, getCaptureImage } = require('../controllers/captures.controller');

const router = express.Router();
router.get('/cameras', listCameras);
router.get('/videos', listVideos);
router.get('/videos/:id/stream', streamVideo);
router.get('/events', listEvents);
router.get('/events/:id', getEvent);
router.post('/events/:id/acknowledge', acknowledgeEvent);
router.get('/events/:id/captures', listCaptures);
router.get('/event-captures/:id/image', getCaptureImage);

module.exports = router;
