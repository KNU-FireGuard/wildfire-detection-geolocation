const express = require('express');
const { listCameras, listVideos, listEvents, getEvent } = require('../controllers/catalog.controller');

const router = express.Router();
router.get('/cameras', listCameras);
router.get('/videos', listVideos);
router.get('/events', listEvents);
router.get('/events/:id', getEvent);

module.exports = router;
