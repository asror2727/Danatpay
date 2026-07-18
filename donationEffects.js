const Channel = require('./Channel');
const Post = require('./Post');
const Donation = require('./Donation');
const telegram = require('./telegram');

function buildProgressBlock(goalName, raised, goal) {
  const pct = Math.min(100, Math.round((raised / goal) * 100));
  const filled = Math.min(10, Math.round(pct / 10));
  const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);
  return `🎯 ${goalName}\n\n${bar} ${pct}%\n\n${raised.toLocaleString()} / ${goal.toLocaleString()} so'm\n\n`;
}

// Donat "paid" bo'lganda ishga tushadigan barcha effektlar:
// 1) Kanal egasiga xabar yuborish
// 2) Agar post maqsad (goal) belgilangan bo'lsa - progress barni yangilash
async function onDonationPaid(donation) {
  if (donation.channelId !== 'platform-support') {
    try {
      const channel = await Channel.findOne({ channelId: donation.channelId });
      if (channel) {
        const name = donation.anonymous ? 'Anonim' : (donation.name || "Noma'lum");
        await telegram.sendMessage(
          channel.ownerId,
          `🎉 ${name} ${donation.amount.toLocaleString()} so'm tashladi!` +
          (donation.comment ? `\n"${donation.comment}"` : '')
        );
      }
    } catch (e) {}
  }

  if (donation.postId) {
    try {
      const post = await Post.findOne({ postId: donation.postId });
      if (post && post.goalAmount && post.messageId) {
        const agg = await Donation.aggregate([
          { $match: { postId: donation.postId, status: 'paid' } },
          { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);
        const raised = agg[0]?.total || 0;
        const progressBlock = buildProgressBlock(post.goalName, raised, post.goalAmount);
        const fullText = progressBlock + (post.text || '');

        if (post.contentType === 'text') {
          await telegram.editMessageText(post.channelId, post.messageId, fullText);
        } else {
          await telegram.editMessageCaption(post.channelId, post.messageId, fullText);
        }
      }
    } catch (e) {}
  }
}

module.exports = { onDonationPaid, buildProgressBlock };
