# Donat bot v2 — Kanal ulash, post joylash, izohlar (MongoDB)

## Bot qanday ishlaydi (foydalanuvchi uchun)

1. `/start` → asosiy menyu: 📢 Kanalim, 👤 Hisobim, 📄 Xizmat shartlari, 💰 To'lovlar, 🆘 Support
2. **Kanalim** → kanaldan forward yuboriladi yoki `@username` kiritiladi → bot admin qilishni so'raydi → "Tasdiqlash" bosiladi → bot tekshiradi
3. Tasdiqlangandan keyin: **Post joylash**, **Kanal haqida**, **Ortga**
4. **Post joylash** → matn/rasm/video/fayl yuboriladi → nom so'raladi → to'lov turi tanlanadi (shu post uchun / umumiy / ko'rsatilmasin / bekor) → izohlar ko'rinishi (ha/yo'q) → bot avtomatik kanalga post qo'yadi, tagida **🎁 Donat qilish** va **💬 Izohlar** tugmalari bilan
5. Foydalanuvchi shu tugmalarni bosganda botga o'tadi, u yerdan mini app ochiladi (donat yoki izohlar sahifasi)

## 1-qadam: Bot yaratish
@BotFather → `/newbot` → token oling.

## 2-qadam: MongoDB (bepul baza)
1. [mongodb.com/cloud/atlas](https://www.mongodb.com/cloud/atlas) da ro'yxatdan o'ting.
2. **Free Cluster (M0)** yarating.
3. **Database Access** → yangi foydalanuvchi yarating (login+parol).
4. **Network Access** → **Allow access from anywhere** (0.0.0.0/0) qo'shing — Render'dan ulanishi uchun kerak.
5. **Connect** → **Drivers** → ulanish satrini (connection string) nusxalang, masalan:
   `mongodb+srv://user:parol@cluster0.xxxxx.mongodb.net/donatebot`
   Bu qatorni `MONGODB_URI` sifatida ishlatasiz.

## 3-qadam: GitHub'ga yuklash
Shu papkadagi barcha fayllarni (`server.js`, `bot.js`, `models/`, `routes/`, `public/`, `package.json`, `README.md`) repoga yuklang. `.env` faylini hech qachon yuklamang.

## 4-qadam: Render'da deploy
1. Render → **New +** → **Web Service** → repo tanlang.
2. Language: **Node**
3. Build Command: `npm install`
4. Start Command: `node server.js`
5. **Environment** bo'limida qo'shing:
   - `BOT_TOKEN`
   - `MONGODB_URI`
   - `CLICK_MERCHANT_ID`, `CLICK_SERVICE_ID`, `CLICK_SECRET_KEY`
   - `PAYME_MERCHANT_ID`, `PAYME_KEY`
   - `MINI_APP_URL` — hozircha bo'sh qoldiring
6. Deploy qiling, domen chiqadi (masalan `https://danatbek.onrender.com`).
7. Qaytib **Environment**'ga kirib, `MINI_APP_URL` ni shu domen bilan to'ldiring, saqlang — qayta deploy bo'ladi.

## 5-qadam: Click va Payme sozlash
- Click: Prepare URL → `.../click/prepare`, Complete URL → `.../click/complete`
- Payme: Cashbox URL → `.../payme`

## 6-qadam: Test qilish
1. Botga `/start` yozing.
2. **Kanalim** → bir kanaldan post forward qiling (yoki `@kanalim` yozing).
3. Botni o'sha kanalga **admin** qilib qo'ying (Telegram kanal sozlamalaridan).
4. Botga qaytib **Tasdiqlash** tugmasini bosing.
5. **Post joylash** → biror matn/rasm yuboring → nom bering → to'lov turini tanlang → izoh ko'rinishini tanlang.
6. Kanalga post avtomatik chiqadi, tagida "🎁 Donat qilish" va "💬 Izohlar" tugmalari bilan.
7. Shu tugmalarni bosib sinab ko'ring.

## Muhim eslatmalar
- Bot holati (conversation state) hozircha **xotirada** saqlanadi — Render qayta ishga tushsa (masalan yangi deploy), foydalanuvchi jarayon o'rtasida bo'lsa, qaytadan boshlashi kerak bo'ladi. Buni keyinchalik bazaga o'tkazish mumkin, agar kerak bo'lsa ayting.
- `web_app` tugmalari faqat **shaxsiy chatda** ishlaydi (Telegram cheklovi), shuning uchun kanal postida oddiy URL tugmalar bor — ular botni ochadi, bot esa ichida web_app tugmasini ko'rsatadi. Bu Telegramning standart yechimi.
- Click/Payme'ning haqiqiy pul qabul qilishi uchun ular bilan rasmiy shartnoma tasdiqlangan bo'lishi kerak.
