require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const apiRoutes = require('./api');
const paymentRoutes = require('./payments');

const { PORT = 3000, MONGODB_URI } = process.env;

const app = express();
app.use(express.json());
app.use(express.static(__dirname));
app.use('/api', apiRoutes);
app.use('/', paymentRoutes);

// Chiroyli URL: https://domen.com/kanalnomi -> donate.html?ch=...
app.get('/:slug', async (req, res, next) => {
  const Channel = require('./Channel');
  const channel = await Channel.findOne({ slug: req.params.slug });
  if (!channel) return next();
  const post = req.query.post ? `&post=${req.query.post}` : '';
  res.redirect(`/donate.html?ch=${channel.channelId}${post}`);
});

async function start() {
  if (!MONGODB_URI) {
    console.error("XATOLIK: MONGODB_URI yo'q! Render Environment Variables ga qo'shing.");
    process.exit(1);
  }

  await mongoose.connect(MONGODB_URI);
  console.log('MongoDB ulandi ✅');

  app.listen(PORT, () => {
    console.log(`Server ${PORT} portda ishga tushdi`);
    console.log("Bu server endi faqat API + mini app xizmat qiladi. Telegram webhook bots.business tomonidan boshqariladi.");
  });
}

start();
