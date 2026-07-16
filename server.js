require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const bot = require('./bot');
const apiRoutes = require('./routes/api');
const paymentRoutes = require('./routes/payments');

const { PORT = 3000, MONGODB_URI, MINI_APP_URL } = process.env;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', apiRoutes);
app.use('/', paymentRoutes);
app.use(bot.webhookCallback('/bot'));

async function start() {
  if (!MONGODB_URI) {
    console.error("XATOLIK: MONGODB_URI yo'q! Render Environment Variables ga qo'shing.");
    process.exit(1);
  }

  await mongoose.connect(MONGODB_URI);
  console.log('MongoDB ulandi ✅');

  app.listen(PORT, async () => {
    console.log(`Server ${PORT} portda ishga tushdi`);

    if (MINI_APP_URL) {
      try {
        await bot.telegram.setWebhook(`${MINI_APP_URL}/bot`);
        console.log("Webhook o'rnatildi:", `${MINI_APP_URL}/bot`);
      } catch (e) {
        console.error('Webhook xato:', e.message);
      }
    } else {
      console.log("Diqqat: MINI_APP_URL sozlanmagan, webhook o'rnatilmadi.");
    }
  });
}

start();
