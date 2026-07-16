const express = require('express');
const Donation = require('./Donation');
const Post = require('./Post');
const Channel = require('./Channel');

const router = express.Router();
const { CLICK_MERCHANT_ID, CLICK_SERVICE_ID, PAYME_MERCHANT_ID } = process.env;

// Post haqida ma'lumot (mini app sarlavhasi uchun)
router.get('/post/:postId', async (req, res) => {
  const post = await Post.findOne({ postId: req.params.postId });
  if (!post) return res.status(404).json({ error: 'Post topilmadi' });
  const channel = await Channel.findOne({ channelId: post.channelId });
  res.json({
    title: post.title,
    channelId: post.channelId,
    channelTitle: channel?.title || '',
    paymentType: post.paymentType
  });
});

// Kanal haqida ma'lumot
router.get('/channel/:channelId', async (req, res) => {
  const channel = await Channel.findOne({ channelId: req.params.channelId });
  if (!channel) return res.status(404).json({ error: 'Kanal topilmadi' });
  res.json({ title: channel.title, username: channel.username });
});

// Donat yaratish
router.post('/donate', async (req, res) => {
  const { channelId, postId, name, anonymous, comment, amount, method, telegramUserId } = req.body;

  if (!amount || Number(amount) < 5000) {
    return res.status(400).json({ error: "Minimal summa 5 000 so'm" });
  }
  if (!['click', 'payme'].includes(method)) {
    return res.status(400).json({ error: "Noto'g'ri to'lov usuli" });
  }
  if (!channelId) {
    return res.status(400).json({ error: 'Kanal aniqlanmadi' });
  }

  const donationId = 'don' + Date.now() + Math.floor(Math.random() * 1000);
  await Donation.create({
    donationId,
    channelId,
    postId: postId || null,
    name: anonymous ? '' : name,
    anonymous: !!anonymous,
    comment,
    amount: Number(amount),
    method,
    telegramUserId
  });

  let payUrl = '';
  if (method === 'click') {
    payUrl = `https://my.click.uz/services/pay?service_id=${CLICK_SERVICE_ID}&merchant_id=${CLICK_MERCHANT_ID}&amount=${amount}&transaction_param=${donationId}`;
  } else {
    const raw = `m=${PAYME_MERCHANT_ID};ac.order_id=${donationId};a=${Number(amount) * 100}`;
    payUrl = `https://checkout.paycom.uz/${Buffer.from(raw).toString('base64')}`;
  }

  res.json({ donationId, payUrl });
});

// Izohlar ro'yxati (to'langan donatlar)
router.get('/comments/:channelId', async (req, res) => {
  const { post: postId } = req.query;
  const filter = { channelId: req.params.channelId, status: 'paid' };

  if (postId) {
    const post = await Post.findOne({ postId });
    if (post && post.visibility === false) {
      return res.json({ visible: false, comments: [] });
    }
    filter.postId = postId;
  }

  const donations = await Donation.find(filter).sort({ createdAt: -1 }).limit(50);
  res.json({
    visible: true,
    comments: donations.map(d => ({
      name: d.anonymous ? 'Anonim' : (d.name || "Noma'lum"),
      amount: d.amount,
      comment: d.comment,
      date: d.createdAt
    }))
  });
});

module.exports = router;
