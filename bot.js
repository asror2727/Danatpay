const { Telegraf, Markup } = require('telegraf');
const { v4: uuidv4 } = require('uuid');
const Channel = require('./Channel');
const Post = require('./Post');
const Donation = require('./Donation');
const Withdrawal = require('./Withdrawal');
const { onDonationPaid, buildProgressBlock } = require('./donationEffects');
const { getBalance } = require('./balance');

const { BOT_TOKEN, MINI_APP_URL, ADMIN_CHAT_ID, SUPPORT_USERNAME } = process.env;
const bot = new Telegraf(BOT_TOKEN);

let BOT_USERNAME = '';
bot.telegram.getMe().then((me) => { BOT_USERNAME = me.username; }).catch(() => {});

// Oddiy xotiradagi holat (MVP uchun yetarli, server qayta ishga tushsa tozalanadi)
const userState = {};

function slugify(str) {
  return (str || '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 20) || 'kanal';
}

async function makeUniqueSlug(base) {
  let slug = slugify(base);
  let n = 0;
  while (await Channel.findOne({ slug: n === 0 ? slug : slug + n })) n++;
  return n === 0 ? slug : slug + n;
}

const mainMenu = Markup.keyboard([
  ['📢 Kanalim', '👤 Hisobim'],
  ["📄 Xizmat shartlari", "💰 To'lovlar"],
  ['🆘 Support']
]).resize();

const cancelKeyboard = Markup.keyboard([['🔙 Orqaga']]).resize();

// ============ FORWARD ORQALI KANAL ANIQLASH (global middleware) ============
bot.use(async (ctx, next) => {
  const state = ctx.from ? userState[ctx.from.id] : null;
  const fwdChat = ctx.message?.forward_from_chat;

  if (state && state.step === 'awaiting_channel' && fwdChat && fwdChat.type === 'channel') {
    const slug = await makeUniqueSlug(fwdChat.username || fwdChat.title);
    await Channel.findOneAndUpdate(
      { channelId: String(fwdChat.id) },
      {
        channelId: String(fwdChat.id),
        ownerId: String(ctx.from.id),
        title: fwdChat.title,
        username: fwdChat.username ? '@' + fwdChat.username : '',
        slug
      },
      { upsert: true }
    );
    userState[ctx.from.id] = { step: 'idle' };
    await ctx.reply(
      "Kanalingizni tizimga ulash uchun bu botni kanalingizda to'liq admin qiling va tasdiqlash tugmasini bosing.",
      Markup.inlineKeyboard([Markup.button.callback('✅ Tasdiqlash', `confirm_admin_${fwdChat.id}`)])
    );
    return;
  }
  return next();
});

// ============ START ============
bot.start(async (ctx) => {
  const payload = ctx.startPayload;

  if (payload && payload.startsWith('donate_')) {
    const postId = payload.replace('donate_', '');
    return ctx.reply(
      'Donat qilish uchun quyidagi tugmani bosing:',
      Markup.inlineKeyboard([
        Markup.button.webApp('🎁 Donat qilish', `${MINI_APP_URL}/donate.html?post=${postId}`)
      ])
    );
  }
  if (payload && payload.startsWith('comments_')) {
    const postId = payload.replace('comments_', '');
    return ctx.reply(
      "Izohlarni ko'rish uchun tugmani bosing:",
      Markup.inlineKeyboard([
        Markup.button.webApp('💬 Izohlar', `${MINI_APP_URL}/comments.html?post=${postId}`)
      ])
    );
  }

  userState[ctx.from.id] = { step: 'idle' };
  ctx.reply('Assalomu alaykum! 👋\nChiqqan tugmalardan botni boshqarishingiz mumkin.', mainMenu);
});

// ============ KANALIM ============
bot.hears('📢 Kanalim', async (ctx) => {
  const existing = await Channel.findOne({ ownerId: String(ctx.from.id), verified: true });
  if (existing) return showChannelMenu(ctx, existing);

  userState[ctx.from.id] = { step: 'awaiting_channel' };
  ctx.reply("Kanalingizdagi ixtiyoriy postni forward qiling, yoki kanal usernameni @kanal ko'rinishida yuboring.", cancelKeyboard);
});

async function showChannelMenu(ctx, channel) {
  if (!channel.slug) {
    channel.slug = await makeUniqueSlug(channel.username || channel.title);
    await channel.save();
  }
  const link = `${MINI_APP_URL}/${channel.slug}`;
  ctx.reply(
    `Kanalingiz ulandi ✅\nDonat havolasi:\n${link}`,
    Markup.inlineKeyboard([
      [Markup.button.callback('📝 Post joylash', `post_new_${channel.channelId}`)],
      [Markup.button.callback('ℹ️ Kanal haqida', `channel_info_${channel.channelId}`)],
      [Markup.button.callback('⬅️ Ortga', 'back_main')]
    ])
  );
}

bot.action('back_main', (ctx) => {
  userState[ctx.from.id] = { step: 'idle' };
  ctx.answerCbQuery();
  ctx.reply('Bosh menyu', mainMenu);
});

bot.action(/channel_info_(.+)/, async (ctx) => {
  const channelId = ctx.match[1];
  ctx.answerCbQuery();
  const channel = await Channel.findOne({ channelId });
  if (!channel) return ctx.reply('Kanal topilmadi.');

  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfWeek = new Date(startOfDay); startOfWeek.setDate(startOfDay.getDate() - startOfDay.getDay());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  async function sumSince(date) {
    const agg = await Donation.aggregate([
      { $match: { channelId, status: 'paid', createdAt: { $gte: date } } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    return agg[0]?.total || 0;
  }

  const [daily, weekly, monthly, totalAgg, postCount] = await Promise.all([
    sumSince(startOfDay),
    sumSince(startOfWeek),
    sumSince(startOfMonth),
    Donation.aggregate([
      { $match: { channelId, status: 'paid' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]),
    Post.countDocuments({ channelId })
  ]);

  let memberCount = "Noma'lum";
  try {
    memberCount = await ctx.telegram.getChatMembersCount(channelId);
  } catch (e) {}

  const total = totalAgg[0]?.total || 0;

  ctx.reply(
    `📊 Kanal statistika\n\n` +
    `Kanal: ${channel.title || channelId}\n` +
    `Owner ID: ${channel.ownerId}\n` +
    `Kanal ID: ${channel.channelId}\n\n` +
    `Kunlik tushum: ${daily.toLocaleString()} so'm\n` +
    `Haftalik tushum: ${weekly.toLocaleString()} so'm\n` +
    `Oylik tushum: ${monthly.toLocaleString()} so'm\n\n` +
    `Kanalda postlar soni: ${postCount}\n` +
    `Kanal jami olib kelgan: ${total.toLocaleString()} so'm\n` +
    `Obunachilar soni: ${memberCount}`
  );
});

// ============ ADMIN TASDIQLASH ============
bot.action(/confirm_admin_(.+)/, async (ctx) => {
  const channelId = ctx.match[1];
  try {
    const member = await ctx.telegram.getChatMember(channelId, ctx.botInfo.id);
    if (member.status === 'administrator' || member.status === 'creator') {
      const channel = await Channel.findOneAndUpdate({ channelId }, { verified: true }, { new: true });
      ctx.answerCbQuery();
      await ctx.reply('Kanalingiz tasdiqlandi ✅');
      return showChannelMenu(ctx, channel);
    }
    ctx.answerCbQuery('Hali admin qilinmagan', { show_alert: true });
  } catch (e) {
    ctx.answerCbQuery();
    ctx.reply('Xatolik: bot hali kanalga qoshilmagan yoki kanal topilmadi.');
  }
});

// ============ POST JOYLASH ============
bot.action(/post_new_(.+)/, (ctx) => {
  const channelId = ctx.match[1];
  userState[ctx.from.id] = { step: 'awaiting_post_content', data: { channelId } };
  ctx.answerCbQuery();
  ctx.reply("Kanalingizga tashlash kerak bo'lgan postni yuboring (matn, rasm, video yoki fayl).", cancelKeyboard);
});

bot.on(['photo', 'video', 'document'], async (ctx, next) => {
  const state = userState[ctx.from.id];
  if (!state || state.step !== 'awaiting_post_content') return next();

  let contentType, fileId;
  const text = ctx.message.caption || '';
  if (ctx.message.photo) { contentType = 'photo'; fileId = ctx.message.photo.at(-1).file_id; }
  else if (ctx.message.video) { contentType = 'video'; fileId = ctx.message.video.file_id; }
  else if (ctx.message.document) { contentType = 'document'; fileId = ctx.message.document.file_id; }

  userState[ctx.from.id] = { step: 'awaiting_post_title', data: { ...state.data, contentType, fileId, text } };
  ctx.reply('Post uchun nom toping:');
});

bot.on('text', async (ctx, next) => {
  const state = userState[ctx.from.id];
  if (!state) return next();

  if (ctx.message.text.trim() === '🔙 Orqaga' || ctx.message.text.trim() === '/cancel') {
    userState[ctx.from.id] = { step: 'idle' };
    return ctx.reply('Bosh menyu', mainMenu);
  }

  if (state.step === 'awaiting_channel') {
    const text = ctx.message.text.trim();
    if (!text.startsWith('@')) {
      return ctx.reply("Iltimos kanaldan forward qiling yoki @kanalusername yuboring.");
    }
    try {
      const chat = await ctx.telegram.getChat(text);
      const slug = await makeUniqueSlug(chat.username || chat.title);
      await Channel.findOneAndUpdate(
        { channelId: String(chat.id) },
        { channelId: String(chat.id), ownerId: String(ctx.from.id), title: chat.title, username: text, slug },
        { upsert: true }
      );
      userState[ctx.from.id] = { step: 'idle' };
      return ctx.reply(
        "Kanalingizni tizimga ulash uchun bu botni kanalingizda to'liq admin qiling va tasdiqlash tugmasini bosing.",
        Markup.inlineKeyboard([Markup.button.callback('✅ Tasdiqlash', `confirm_admin_${chat.id}`)])
      );
    } catch (e) {
      return ctx.reply("Kanal topilmadi. Username to'g'ri ekanini tekshiring.");
    }
  }

  if (state.step === 'awaiting_post_content') {
    userState[ctx.from.id] = {
      step: 'awaiting_post_title',
      data: { ...state.data, contentType: 'text', text: ctx.message.text }
    };
    return ctx.reply('Post uchun nom toping:');
  }

  if (state.step === 'awaiting_post_title') {
    const draft = { ...state.data, title: ctx.message.text };
    userState[ctx.from.id] = { step: 'awaiting_goal_choice', data: draft };
    return ctx.reply(
      "Ushbu post uchun maqsad (masalan yangi mikrofon, noutbuk uchun) belgilamoqchimisiz? Belgilansa, kanalda progress-bar avtomatik yangilanib turadi.",
      Markup.inlineKeyboard([
        [Markup.button.callback('Ha, maqsad qo\'yaman', 'goal_yes')],
        [Markup.button.callback("Yo'q, kerak emas", 'goal_no')]
      ])
    );
  }

  if (state.step === 'awaiting_goal_name') {
    userState[ctx.from.id] = {
      step: 'awaiting_goal_amount',
      data: { ...state.data, goalName: ctx.message.text.trim() }
    };
    return ctx.reply("Maqsad summasini kiriting (masalan: 100000):");
  }

  if (state.step === 'awaiting_goal_amount') {
    const goalAmount = Number(ctx.message.text.replace(/\D/g, ''));
    if (!goalAmount || goalAmount < 1) {
      return ctx.reply("Summani to'g'ri kiriting (faqat raqam):");
    }
    const draft = { ...state.data, goalAmount };
    userState[ctx.from.id] = { step: 'awaiting_payment_type', data: draft };
    return askPaymentType(ctx);
  }

  if (state.step === 'awaiting_withdraw_amount') {
    const amount = Number(ctx.message.text.replace(/\D/g, ''));
    if (!amount || amount < 10000) {
      return ctx.reply("Minimal summa 10 000 so'm. Qaytadan kiriting:");
    }
    if (amount > state.data.balance) {
      return ctx.reply("Hisobingizda yetarli mablag' yo'q. Qaytadan kiriting:");
    }
    userState[ctx.from.id] = { step: 'awaiting_withdraw_card', data: { ...state.data, amount } };
    return ctx.reply(
      "Pul yechish miqdori qabul qilindi ✅\n\nMablag' qabul qilish uchun Uzcard yoki Humo karta raqamingizni yozing (16 ta raqam):"
    );
  }

  if (state.step === 'awaiting_withdraw_card') {
    const cardNumber = ctx.message.text.replace(/\D/g, '');
    if (cardNumber.length !== 16) {
      return ctx.reply("Karta raqami 16 ta raqamdan iborat bo'lishi kerak. Qaytadan yozing:");
    }
    const bank = detectBank(cardNumber);
    if (!bank) {
      return ctx.reply("Bu Uzcard yoki Humo kartasiga o'xshamayapti. Qaytadan tekshirib yozing:");
    }
    userState[ctx.from.id] = {
      step: 'awaiting_withdraw_name',
      data: { ...state.data, cardNumber, bank }
    };
    return ctx.reply("Karta egasining F.I.Sh ni karta ustidagi kabi yozing (masalan: ASROR X):");
  }

  if (state.step === 'awaiting_withdraw_name') {
    const cardHolder = ctx.message.text.trim();
    const code = String(Math.floor(10000 + Math.random() * 90000));
    userState[ctx.from.id] = {
      step: 'awaiting_withdraw_otp',
      data: { ...state.data, cardHolder, code }
    };

    const masked = state.data.cardNumber.slice(0, 4) + ' **** **** ' + state.data.cardNumber.slice(-4);
    await ctx.reply(
      `Karta ma'lumotlaringiz aniqlandi ✅\n\n` +
      `Karta egasi: ${cardHolder}\n` +
      `Karta raqami: ${masked}\n` +
      `Bank: ${state.data.bank}\n\n` +
      `Tasdiqlash kodi yuborildi. Kodni shu yerga yuboring:`
    );
    // Eslatma: haqiqiy telefon SMS yubormaymiz (buning uchun eskiz.uz kabi
    // pullik SMS xizmati kerak). Kod hozircha shu botning o'zi orqali yuboriladi.
    return ctx.reply(`Tasdiqlash kodingiz: ${code}`);
  }

  if (state.step === 'awaiting_withdraw_otp') {
    if (ctx.message.text.trim() !== state.data.code) {
      return ctx.reply("Kod noto'g'ri. Qaytadan kiriting:");
    }
    const withdrawalId = 'wd' + Date.now();
    await Withdrawal.create({
      withdrawalId,
      ownerId: String(ctx.from.id),
      amount: state.data.amount,
      cardNumber: state.data.cardNumber,
      cardHolder: state.data.cardHolder,
      bank: state.data.bank,
      status: 'pending'
    });
    userState[ctx.from.id] = { step: 'idle' };
    ctx.reply("So'rovingiz qabul qilindi ✅\n30-50 daqiqa ichida mablag' kartangizga tashlab beriladi.", mainMenu);

    notifyAdmin(
      `💸 Yangi pul yechish so'rovi\n\n` +
      `Foydalanuvchi: ${ctx.from.id} (${ctx.from.username ? '@' + ctx.from.username : ctx.from.first_name})\n` +
      `Summa: ${state.data.amount.toLocaleString()} so'm\n` +
      `Karta: ${state.data.cardNumber} (${state.data.bank})\n` +
      `Karta egasi: ${state.data.cardHolder}\n` +
      `So'rov ID: ${withdrawalId}`
    );
    return;
  }

  return next();
});

bot.action('goal_yes', (ctx) => {
  const state = userState[ctx.from.id];
  state.step = 'awaiting_goal_name';
  ctx.answerCbQuery();
  ctx.reply("Maqsad nomini yozing (masalan: Yangi mikrofon):");
});

bot.action('goal_no', (ctx) => {
  const state = userState[ctx.from.id];
  state.step = 'awaiting_payment_type';
  ctx.answerCbQuery();
  askPaymentType(ctx);
});

function askPaymentType(ctx) {
  ctx.reply(
    "Ushbu postdan kanalingizga tushadigan to'lovlar turini tanlang:",
    Markup.inlineKeyboard([
      [Markup.button.callback('Shu post uchun', 'ptype_post')],
      [Markup.button.callback("Umumiy to'lovlar", 'ptype_general')],
      [Markup.button.callback("Ko'rsatilmasin", 'ptype_hidden')],
      [Markup.button.callback('Bekor qilish', 'ptype_cancel')]
    ])
  );
}

bot.action('ptype_post', (ctx) => setPaymentType(ctx, 'post'));
bot.action('ptype_general', (ctx) => setPaymentType(ctx, 'general'));
bot.action('ptype_hidden', (ctx) => setPaymentType(ctx, 'hidden'));
bot.action('ptype_cancel', (ctx) => {
  userState[ctx.from.id] = { step: 'idle' };
  ctx.answerCbQuery();
  ctx.reply('Bekor qilindi.', mainMenu);
});

function setPaymentType(ctx, type) {
  const state = userState[ctx.from.id];
  state.data.paymentType = type;
  ctx.answerCbQuery();

  if (type === 'hidden') return publishPost(ctx, state.data, false);

  state.step = 'awaiting_visibility';
  ctx.reply(
    "Izohlar (donat qilganlar ro'yxati) kanal obunachilariga ko'rinsinmi?",
    Markup.inlineKeyboard([
      [Markup.button.callback('Ha', 'vis_yes')],
      [Markup.button.callback("Yo'q", 'vis_no')]
    ])
  );
}

bot.action('vis_yes', (ctx) => finalizePost(ctx, true));
bot.action('vis_no', (ctx) => finalizePost(ctx, false));

async function finalizePost(ctx, visibility) {
  const state = userState[ctx.from.id];
  ctx.answerCbQuery();
  await publishPost(ctx, state.data, visibility);
}

async function publishPost(ctx, data, visibility) {
  const postId = uuidv4();
  const post = await Post.create({
    postId,
    channelId: data.channelId,
    ownerId: String(ctx.from.id),
    contentType: data.contentType,
    fileId: data.fileId,
    text: data.text,
    title: data.title,
    paymentType: data.paymentType,
    visibility,
    goalName: data.goalName || null,
    goalAmount: data.goalAmount || null
  });

  const bodyText = (data.goalAmount ? buildProgressBlock(data.goalName, 0, data.goalAmount) : '') + (data.text || '');

  const buttons = [];
  if (data.paymentType !== 'hidden') {
    buttons.push([
      { text: '🎁 Donat qilish', url: `https://t.me/${BOT_USERNAME}?start=donate_${postId}` },
      { text: '💬 Izohlar', url: `https://t.me/${BOT_USERNAME}?start=comments_${postId}` }
    ]);
  }

  try {
    const opts = { reply_markup: { inline_keyboard: buttons } };
    let sent;
    if (data.contentType === 'text') sent = await ctx.telegram.sendMessage(data.channelId, bodyText, opts);
    else if (data.contentType === 'photo') sent = await ctx.telegram.sendPhoto(data.channelId, data.fileId, { caption: bodyText, ...opts });
    else if (data.contentType === 'video') sent = await ctx.telegram.sendVideo(data.channelId, data.fileId, { caption: bodyText, ...opts });
    else if (data.contentType === 'document') sent = await ctx.telegram.sendDocument(data.channelId, data.fileId, { caption: bodyText, ...opts });

    post.messageId = sent.message_id;
    await post.save();
    userState[ctx.from.id] = { step: 'idle' };
    ctx.reply('Post kanalingizga muvaffaqiyatli joylandi ✅', mainMenu);
  } catch (e) {
    ctx.reply("Xatolik: postni kanalga joylab bo'lmadi. Bot kanalda admin ekanini tekshiring.\n" + e.message);
  }
}

// ============ HISOBIM ============
bot.hears('👤 Hisobim', async (ctx) => {
  const { income, expense, balance } = await getBalance(String(ctx.from.id));
  ctx.reply(
    `👤 Hisobingiz: ${balance.toLocaleString()} so'm\n\n` +
    `Kirim: ${income.toLocaleString()} so'm\n` +
    `Chiqim: ${expense.toLocaleString()} so'm`,
    Markup.inlineKeyboard([
      [Markup.button.callback("💳 Pul yechib olish", 'withdraw_start')],
      [Markup.button.callback("⚡ Tez yechib olish", 'withdraw_fast')]
    ])
  );
});

bot.action('withdraw_fast', (ctx) => {
  ctx.answerCbQuery();
  ctx.reply(`Tezkor pul yechish uchun adminga murojaat qiling:\n@${SUPPORT_USERNAME || 'x7fan'}`);
});

bot.action('withdraw_start', async (ctx) => {
  ctx.answerCbQuery();
  const { balance } = await getBalance(String(ctx.from.id));
  userState[ctx.from.id] = { step: 'awaiting_withdraw_amount', data: { balance } };
  ctx.reply(
    `Pullarni yechib olishingiz uchun qancha yechib olasiz, istalgan summani yozing.\n\nMinimal: 10 000 so'm\nHisobingizda: ${balance.toLocaleString()} so'm`,
    cancelKeyboard
  );
});

function detectBank(cardNumber) {
  if (cardNumber.startsWith('8600')) return 'Uzcard';
  if (cardNumber.startsWith('9860')) return 'Humo';
  return null;
}

async function notifyAdmin(text) {
  if (!ADMIN_CHAT_ID) return;
  try { await bot.telegram.sendMessage(ADMIN_CHAT_ID, text); } catch (e) {}
}

bot.command('qollab', async (ctx) => {
  const agg = await Donation.aggregate([
    { $match: { channelId: 'platform-support', status: 'paid' } },
    { $group: { _id: null, total: { $sum: '$amount' } } }
  ]);
  const total = agg[0]?.total || 0;

  ctx.reply(
    "Bizning Tizimni Qo'llab-quvvatlang!\n\n" +
    "Sizni danatlar.uz tizimini qo'llab-quvvatlashga taklif etamiz! Har bir donat, " +
    "platformamizni rivojlantirishga va yanada ko'proq Telegram kanal administratorlariga " +
    "yordam berishga xizmat qiladi.\n\n" +
    "Kichik bir hissa qo'shishingiz bilan katta o'zgarishlarga erishamiz. Birgalikda muvaffaqiyatga erishamiz!\n\n" +
    "Donat qiling va qo'llab-quvvatlang!\n\n" +
    `💰 ${total.toLocaleString()} so'm`,
    Markup.inlineKeyboard([
      Markup.button.webApp('💝 Donat qilish', `${MINI_APP_URL}/support.html`)
    ])
  );
});

// ============ TEST DONAT (faqat admin uchun, haqiqiy pulsiz) ============
bot.command('testdonat', async (ctx) => {
  if (!ADMIN_CHAT_ID || String(ctx.from.id) !== String(ADMIN_CHAT_ID)) {
    return ctx.reply("Bu buyruq faqat admin uchun.");
  }

  const parts = ctx.message.text.trim().split(/\s+/).slice(1);
  if (parts.length < 2) {
    return ctx.reply(
      "Foydalanish:\n/testdonat <kanal_slug_yoki_id> <summa> [post_id]\n\n" +
      "Masalan:\n/testdonat zenix 15000\n\n" +
      "Agar progress-bar'ni sinamoqchi bo'lsangiz, post_id'ni ham qo'shing (post_id'ni kanaldagi postning donat/izohlar tugmasidagi havoladan olishingiz mumkin)."
    );
  }

  const [slugOrId, amountStr, postIdArg] = parts;
  const amount = Number(amountStr.replace(/\D/g, ''));
  if (!amount || amount < 1) return ctx.reply("Summani to'g'ri kiriting.");

  const channel = await Channel.findOne({ slug: slugOrId }) || await Channel.findOne({ channelId: slugOrId });
  if (!channel) return ctx.reply("Kanal topilmadi. Slug yoki kanal ID'ni tekshiring.");

  const donationId = 'test' + Date.now();
  const donation = await Donation.create({
    donationId,
    channelId: channel.channelId,
    postId: postIdArg || null,
    name: 'Test foydalanuvchi',
    anonymous: false,
    comment: 'Bu soxta test donat (haqiqiy pul emas)',
    amount,
    method: 'click',
    status: 'paid',
    telegramUserId: String(ctx.from.id)
  });

  await onDonationPaid(donation);
  ctx.reply(`✅ Test donat yaratildi: ${amount.toLocaleString()} so'm → ${channel.title}\n\nBu haqiqiy pul emas, faqat sinov uchun.`);
});

// ============ HAQIQIY PULNI QO'LDA KIRITISH (faqat admin, o'zi tashlab bergan pul) ============
bot.command('danate', async (ctx) => {
  if (!ADMIN_CHAT_ID || String(ctx.from.id) !== String(ADMIN_CHAT_ID)) {
    return ctx.reply("Bu buyruq faqat admin uchun.");
  }

  const parts = ctx.message.text.trim().split(/\s+/).slice(1);
  if (parts.length < 2) {
    return ctx.reply(
      "Foydalanish:\n/danate <kanal_slug> <summa> [izoh]\n\n" +
      "Masalan:\n/danate xavixuz 5000 omad okam🌝"
    );
  }

  const [slugOrId, amountStr, ...commentParts] = parts;
  const amount = Number(amountStr.replace(/\D/g, ''));
  if (!amount || amount < 1) return ctx.reply("Summani to'g'ri kiriting.");

  const channel = await Channel.findOne({ slug: slugOrId }) || await Channel.findOne({ channelId: slugOrId });
  if (!channel) return ctx.reply("Kanal topilmadi. Slug yoki kanal ID'ni tekshiring.");

  const donationId = 'real' + Date.now();
  const donation = await Donation.create({
    donationId,
    channelId: channel.channelId,
    postId: null,
    name: 'Homiy',
    anonymous: false,
    comment: commentParts.join(' '),
    amount,
    method: 'click',
    status: 'paid',
    telegramUserId: String(ctx.from.id)
  });

  await onDonationPaid(donation);
  ctx.reply(`✅ ${amount.toLocaleString()} so'm → ${channel.title} hisobiga qo'shildi.`);
});

// ============ XIZMAT SHARTLARI ============
bot.hears("📄 Xizmat shartlari", (ctx) => {
  ctx.reply('Xizmat shartlari va qoidalari: ' + (MINI_APP_URL || '') + '/terms.html');
});

// ============ TO'LOVLAR ============
bot.hears("💰 To'lovlar", async (ctx) => {
  const channels = await Channel.find({ ownerId: String(ctx.from.id) });
  const donations = await Donation.find({ channelId: { $in: channels.map(c => c.channelId) }, status: 'paid' })
    .sort({ createdAt: -1 }).limit(10);
  if (!donations.length) return ctx.reply("Hozircha to'lovlar yo'q.");
  const list = donations.map(d => `${d.anonymous ? 'Anonim' : (d.name || "Noma'lum")} = ${d.amount} so'm`).join('\n');
  ctx.reply("So'nggi to'lovlar:\n" + list);
});

// ============ SUPPORT ============
bot.hears('🆘 Support', (ctx) => {
  ctx.reply(`Savollaringiz bo'lsa: @${SUPPORT_USERNAME || 'x7fan'}`);
});

module.exports = bot;
