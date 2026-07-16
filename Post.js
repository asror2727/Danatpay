const mongoose = require('mongoose');

const postSchema = new mongoose.Schema({
  postId: { type: String, required: true, unique: true },
  channelId: { type: String, required: true },
  ownerId: String,
  contentType: { type: String, enum: ['text', 'photo', 'video', 'document'] },
  fileId: String,
  text: String,
  title: String,
  paymentType: { type: String, enum: ['post', 'general', 'hidden'], default: 'post' },
  visibility: { type: Boolean, default: true },
  messageId: Number,
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Post', postSchema);
