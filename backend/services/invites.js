const crypto = require('crypto');

const hashInviteToken = (token) => crypto
  .createHash('sha256')
  .update(String(token || ''))
  .digest('hex');

module.exports = { hashInviteToken };
