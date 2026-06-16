'use strict';

const express = require('express');
const { getRequestOrigin } = require('../services/requestOrigin');
const { buildCoreInstanceContract } = require('../services/coreInstance');

const router = express.Router();

router.get('/core/instance', (req, res) => {
  res.json(buildCoreInstanceContract({ origin: getRequestOrigin(req) }));
});

module.exports = router;
