const mongoose = require('mongoose');

const donationSchema = new mongoose.Schema({
  donationId: { type: String, required: true, unique: true },
  channelId: { type: String, required: true },
  postId: { type: String, default: null },
  name: String,
  anonymous: { type: Boolean, default: false },
  comment: String,
  amount: { type: Number, required: true },
  method: { type: String, enum: ['click', 'payme'] },
  status: { type: String, enum: ['pending', 'paid'], default: 'pending' },
  reactions: { type: Map, of: Number, default: {} },
  telegramUserId: String,
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Donation', donationSchema);
