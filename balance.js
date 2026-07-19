const Channel = require('./models/Channel');
const Donation = require('./models/Donation');
const Withdrawal = require('./models/Withdrawal');

async function getBalance(ownerId) {
  const channels = await Channel.find({ ownerId });
  const channelIds = channels.map(c => c.channelId);

  const incomeAgg = await Donation.aggregate([
    { $match: { channelId: { $in: channelIds }, status: 'paid' } },
    { $group: { _id: null, total: { $sum: '$amount' } } }
  ]);
  const expenseAgg = await Withdrawal.aggregate([
    { $match: { ownerId, status: { $in: ['pending', 'completed'] } } },
    { $group: { _id: null, total: { $sum: '$amount' } } }
  ]);

  const income = incomeAgg[0]?.total || 0;
  const expense = expenseAgg[0]?.total || 0;
  return { income, expense, balance: income - expense };
}

module.exports = { getBalance };
