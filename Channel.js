const mongoose = require('mongoose');

const channelSchema = new mongoose.Schema({
  channelId: { type: String, required: true, unique: true },
  ownerId: { type: String, required: true },
  title: String,
  username: String,
  slug: { type: String, unique: true, sparse: true },
  verified: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Channel', channelSchema);
