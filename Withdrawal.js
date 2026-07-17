const mongoose = require('mongoose');

const withdrawalSchema = new mongoose.Schema({
  withdrawalId: { type: String, required: true, unique: true },
  ownerId: { type: String, required: true },
  amount: { type: Number, required: true },
  cardNumber: String,
  cardHolder: String,
  bank: String,
  status: { type: String, enum: ['pending', 'completed', 'rejected'], default: 'pending' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Withdrawal', withdrawalSchema);
