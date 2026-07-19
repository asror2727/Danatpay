const express = require('express');
const Donation = require('./Donation');
const Post = require('./Post');
const Channel = require('./Channel');
const Withdrawal = require('./Withdrawal');
const telegram = require('./telegram');
const THEMES = require('./themes');
const { getBalance } = require('./balance');

const router = express.Router();
const { CLICK_MERCHANT_ID, CLICK_SERVICE_ID, PAYME_MERCHANT_ID, MINI_APP_URL } = process.env;

function slugify(str) {
  return (str || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 20) || 'kanal';
}

async function makeUniqueSlug(base) {
  let slug = slugify(base);
  let n = 0;
  while (await Channel.findOne({ slug: n === 0 ? slug : slug + n })) {
    n++;
  }
  return n === 0 ? slug : slug + n;
}

// ============ BOTS.BUSINESS UCHUN: KANAL ULASH ============
// Foydalanuvchi kanal @username yoki forward qilingan chat_id yuborganda chaqiriladi
router.post('/channel/link', async (req, res) => {
  const { ownerId, channelId, title, username } = req.body;
  if (!ownerId || !channelId) return res.status(400).json({ error: 'ownerId va channelId kerak' });

  let channel = await Channel.findOne({ channelId: String(channelId) });
  if (!channel) {
    const slug = await makeUniqueSlug(username || title);
    channel = await Channel.create({
      channelId: String(channelId), ownerId: String(ownerId), title, username, slug
    });
  }
  res.json({ slug: channel.slug, verified: channel.verified });
});

// Foydalanuvchi botni kanalda admin qilib, "Tasdiqlash" bosganda chaqiriladi
router.post('/channel/verify', async (req, res) => {
  const { channelId } = req.body;
  const channel = await Channel.findOne({ channelId: String(channelId) });
  if (!channel) return res.status(404).json({ error: 'Kanal topilmadi' });

  try {
    const isAdmin = await telegram.isBotAdmin(channelId);
    if (isAdmin) {
      channel.verified = true;
      await channel.save();
    }
    res.json({ verified: channel.verified, link: `${MINI_APP_URL}/${channel.slug}` });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Foydalanuvchining kanallari ro'yxati (Kanalim tugmasi uchun)
router.get('/channel/owner/:ownerId', async (req, res) => {
  const channels = await Channel.find({ ownerId: req.params.ownerId });
  res.json(channels.map(c => ({
    channelId: c.channelId, title: c.title, verified: c.verified,
    slug: c.slug, link: c.verified ? `${MINI_APP_URL}/${c.slug}` : null
  })));
});

// ============ BOTS.BUSINESS UCHUN: POST JOYLASH ============
router.post('/post/create', async (req, res) => {
  const { ownerId, channelId, contentType, fileId, text, title, paymentType, visibility } = req.body;
  if (!channelId || !contentType) return res.status(400).json({ error: 'Malumot yetarli emas' });

  const channel = await Channel.findOne({ channelId: String(channelId) });
  if (!channel || !channel.verified) return res.status(400).json({ error: 'Kanal tasdiqlanmagan' });

  const { v4: uuidv4 } = require('uuid');
  const postId = uuidv4();
  const post = await Post.create({
    postId, channelId: String(channelId), ownerId: String(ownerId),
    contentType, fileId, text, title, paymentType, visibility: visibility !== false
  });

  const buttons = [];
  if (paymentType !== 'hidden') {
    const botInfo = await telegram.getBotId().catch(() => null);
    buttons.push([
      { text: '🎁 Donat qilish', url: `${MINI_APP_URL}/${channel.slug}?post=${postId}` },
      { text: '💬 Izohlar', url: `${MINI_APP_URL}/comments.html?post=${postId}` }
    ]);
  }
  const opts = { reply_markup: { inline_keyboard: buttons } };

  try {
    let sent;
    if (contentType === 'text') sent = await telegram.sendMessage(channelId, text, opts);
    else if (contentType === 'photo') sent = await telegram.sendPhoto(channelId, fileId, { caption: text, ...opts });
    else if (contentType === 'video') sent = await telegram.sendVideo(channelId, fileId, { caption: text, ...opts });
    else if (contentType === 'document') sent = await telegram.sendDocument(channelId, fileId, { caption: text, ...opts });

    post.messageId = sent.message_id;
    await post.save();
    res.json({ ok: true, postId, messageId: sent.message_id });
  } catch (e) {
    res.status(400).json({ error: 'Kanalga joylab bolmadi: ' + e.message });
  }
});

// ============ HISOBIM ============
router.get('/account/:ownerId', async (req, res) => {
  const channels = await Channel.find({ ownerId: req.params.ownerId });
  const agg = await Donation.aggregate([
    { $match: { channelId: { $in: channels.map(c => c.channelId) }, status: 'paid' } },
    { $group: { _id: null, total: { $sum: '$amount' } } }
  ]);
  res.json({ channelsCount: channels.length, total: agg[0]?.total || 0 });
});

// ============ TO'LOVLAR ============
router.get('/payments/:ownerId', async (req, res) => {
  const channels = await Channel.find({ ownerId: req.params.ownerId });
  const donations = await Donation.find({
    channelId: { $in: channels.map(c => c.channelId) }, status: 'paid'
  }).sort({ createdAt: -1 }).limit(10);
  res.json(donations.map(d => ({
    name: d.anonymous ? 'Anonim' : (d.name || "Noma'lum"),
    amount: d.amount, comment: d.comment, date: d.createdAt
  })));
});

// Post haqida ma'lumot (mini app sarlavhasi uchun)
router.get('/post/:postId', async (req, res) => {
  const post = await Post.findOne({ postId: req.params.postId });
  if (!post) return res.status(404).json({ error: 'Post topilmadi' });
  const channel = await Channel.findOne({ channelId: post.channelId });
  res.json({
    title: post.title,
    channelId: post.channelId,
    channelTitle: channel?.title || '',
    paymentType: post.paymentType,
    theme: channel?.theme || 'dark'
  });
});

// Kanal haqida ma'lumot (slug orqali ham qidiradi)
router.get('/channel/:channelId', async (req, res) => {
  let channel = await Channel.findOne({ channelId: req.params.channelId });
  if (!channel) channel = await Channel.findOne({ slug: req.params.channelId });
  if (!channel) return res.status(404).json({ error: 'Kanal topilmadi' });
  res.json({ title: channel.title, username: channel.username, channelId: channel.channelId, theme: channel.theme || 'dark' });
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
  const returnUrl = `${MINI_APP_URL}/donate.html?donation=${donationId}`;
  if (method === 'click') {
    payUrl = `https://my.click.uz/services/pay?service_id=${CLICK_SERVICE_ID}&merchant_id=${CLICK_MERCHANT_ID}&amount=${amount}&transaction_param=${donationId}&return_url=${encodeURIComponent(returnUrl)}`;
  } else {
    const raw = `m=${PAYME_MERCHANT_ID};ac.order_id=${donationId};a=${Number(amount) * 100};c=${returnUrl}`;
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
      donationId: d.donationId,
      name: d.anonymous ? 'Anonim' : (d.name || "Noma'lum"),
      amount: d.amount,
      comment: d.comment,
      date: d.createdAt,
      reactions: Object.fromEntries(d.reactions || new Map())
    }))
  });
});

// Kanal rasmi (dumaloq avatar uchun) - bot tokenini yashirib, rasmni o'zimiz orqali beramiz
router.get('/channel-photo/:channelId', async (req, res) => {
  try {
    let channel = await Channel.findOne({ channelId: req.params.channelId });
    if (!channel) channel = await Channel.findOne({ slug: req.params.channelId });
    const channelId = channel ? channel.channelId : req.params.channelId;

    const fileId = await telegram.getChatPhotoFileId(channelId);
    if (!fileId) return res.status(404).end();

    const filePath = await telegram.getFilePath(fileId);
    const fileUrl = `https://api.telegram.org/file/bot${telegram.BOT_TOKEN}/${filePath}`;

    const imgRes = await fetch(fileUrl);
    if (!imgRes.ok) return res.status(404).end();

    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=3600');
    const buffer = Buffer.from(await imgRes.arrayBuffer());
    res.send(buffer);
  } catch (e) {
    res.status(404).end();
  }
});

// Foydalanuvchi qabul qilgan donatlar (hisobotlar uchun)
router.get('/received/:ownerId', async (req, res) => {
  const channels = await Channel.find({ ownerId: req.params.ownerId });
  const channelIds = channels.map(c => c.channelId);

  const donations = await Donation.find({
    channelId: { $in: channelIds },
    status: 'paid'
  }).sort({ createdAt: -1 }).limit(50);

  res.json(donations.map(d => ({
    name: d.anonymous ? 'Anonim' : (d.name || "Noma'lum"),
    amount: d.amount,
    comment: d.comment,
    date: d.createdAt
  })));
});

// Platformani (butun tizimni) qo'llab-quvvatlash uchun umumiy yig'ilgan summa
const PLATFORM_CHANNEL_ID = 'platform-support';
router.get('/platform-total', async (req, res) => {
  const agg = await Donation.aggregate([
    { $match: { channelId: PLATFORM_CHANNEL_ID, status: 'paid' } },
    { $group: { _id: null, total: { $sum: '$amount' } } }
  ]);
  res.json({ total: agg[0]?.total || 0 });
});

// To'lov holatini tekshirish (mini app pollingi uchun)
router.get('/donation-status/:donationId', async (req, res) => {
  const donation = await Donation.findOne({ donationId: req.params.donationId });
  if (!donation) return res.status(404).json({ error: 'Topilmadi' });
  res.json({ status: donation.status });
});

// Top kanallar (reyting) - eng ko'p donat yig'gan kanallar
router.get('/leaderboard', async (req, res) => {
  const agg = await Donation.aggregate([
    { $match: { status: 'paid', channelId: { $ne: 'platform-support' } } },
    { $group: { _id: '$channelId', total: { $sum: '$amount' } } },
    { $sort: { total: -1 } },
    { $limit: 20 }
  ]);

  const channelIds = agg.map(a => a._id);
  const channels = await Channel.find({ channelId: { $in: channelIds } });
  const channelMap = {};
  channels.forEach(c => { channelMap[c.channelId] = c; });

  res.json(agg.map((a, i) => ({
    rank: i + 1,
    channelId: a._id,
    title: channelMap[a._id]?.title || "Noma'lum",
    slug: channelMap[a._id]?.slug || null,
    total: a.total
  })));
});

// Izohga reaksiya (like/emoji) qo'yish
router.post('/react/:donationId', async (req, res) => {
  const { emoji } = req.body;
  if (!emoji) return res.status(400).json({ error: 'Emoji kerak' });

  const donation = await Donation.findOne({ donationId: req.params.donationId });
  if (!donation) return res.status(404).json({ error: 'Topilmadi' });

  const current = donation.reactions.get(emoji) || 0;
  donation.reactions.set(emoji, current + 1);
  await donation.save();

  res.json({ reactions: Object.fromEntries(donation.reactions) });
});

// ============ TEMA DO'KONI ============
router.get('/theme-shop/:ownerId', async (req, res) => {
  const channel = await Channel.findOne({ ownerId: req.params.ownerId });
  const { balance } = await getBalance(req.params.ownerId);
  res.json({
    balance,
    hasChannel: !!channel,
    currentTheme: channel?.theme || 'dark',
    themes: Object.entries(THEMES).map(([key, t]) => ({ key, name: t.name, price: t.price }))
  });
});

router.post('/theme-buy', async (req, res) => {
  const { ownerId, theme } = req.body;
  const themeInfo = THEMES[theme];
  if (!themeInfo) return res.status(400).json({ error: "Noto'g'ri tema" });

  const channel = await Channel.findOne({ ownerId });
  if (!channel) return res.status(400).json({ error: 'Avval kanalingizni ulang' });

  if (theme !== channel.theme && themeInfo.price > 0) {
    const { balance } = await getBalance(ownerId);
    if (balance < themeInfo.price) {
      return res.status(400).json({ error: "Balansingizda yetarli mablag' yo'q" });
    }
    await Withdrawal.create({
      withdrawalId: 'theme' + Date.now(),
      ownerId,
      amount: themeInfo.price,
      cardNumber: 'THEME:' + theme,
      cardHolder: 'Theme Store',
      bank: 'INTERNAL',
      status: 'completed'
    });
  }

  channel.theme = theme;
  await channel.save();
  res.json({ ok: true, theme });
});

module.exports = router;
