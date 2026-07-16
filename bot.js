const { Telegraf, Markup } = require('telegraf');
const { v4: uuidv4 } = require('uuid');
const Channel = require('./Channel');
const Post = require('./Post');
const Donation = require('./Donation');

const { BOT_TOKEN, MINI_APP_URL } = process.env;
const bot = new Telegraf(BOT_TOKEN);

let BOT_USERNAME = '';
bot.telegram.getMe().then((me) => { BOT_USERNAME = me.username; }).catch(() => {});

// Oddiy xotiradagi holat (MVP uchun yetarli, server qayta ishga tushsa tozalanadi)
const userState = {};

const mainMenu = Markup.keyboard([
  ['📢 Kanalim', '👤 Hisobim'],
  ["📄 Xizmat shartlari", "💰 To'lovlar"],
  ['🆘 Support']
]).resize();

// ============ FORWARD ORQALI KANAL ANIQLASH (global middleware) ============
bot.use(async (ctx, next) => {
  const state = ctx.from ? userState[ctx.from.id] : null;
  const fwdChat = ctx.message?.forward_from_chat;

  if (state && state.step === 'awaiting_channel' && fwdChat && fwdChat.type === 'channel') {
    await Channel.findOneAndUpdate(
      { channelId: String(fwdChat.id) },
      {
        channelId: String(fwdChat.id),
        ownerId: String(ctx.from.id),
        title: fwdChat.title,
        username: fwdChat.username ? '@' + fwdChat.username : ''
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
  ctx.reply("Kanalingizdagi ixtiyoriy postni forward qiling, yoki kanal usernameni @kanal ko'rinishida yuboring.");
});

async function showChannelMenu(ctx, channel) {
  const link = `${MINI_APP_URL}/donate.html?ch=${channel.channelId}`;
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
  const channel = await Channel.findOne({ channelId: ctx.match[1] });
  ctx.answerCbQuery();
  ctx.reply(`Kanal: ${channel?.title || ctx.match[1]}\nHolati: ${channel?.verified ? 'Tasdiqlangan ✅' : 'Tasdiqlanmagan'}`);
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
  ctx.reply("Kanalingizga tashlash kerak bo'lgan postni yuboring (matn, rasm, video yoki fayl).");
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

  if (state.step === 'awaiting_channel') {
    const text = ctx.message.text.trim();
    if (!text.startsWith('@')) {
      return ctx.reply("Iltimos kanaldan forward qiling yoki @kanalusername yuboring.");
    }
    try {
      const chat = await ctx.telegram.getChat(text);
      await Channel.findOneAndUpdate(
        { channelId: String(chat.id) },
        { channelId: String(chat.id), ownerId: String(ctx.from.id), title: chat.title, username: text },
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
    userState[ctx.from.id] = { step: 'awaiting_payment_type', data: draft };
    return ctx.reply(
      "Ushbu postdan kanalingizga tushadigan to'lovlar turini tanlang:",
      Markup.inlineKeyboard([
        [Markup.button.callback('Shu post uchun', 'ptype_post')],
        [Markup.button.callback("Umumiy to'lovlar", 'ptype_general')],
        [Markup.button.callback("Ko'rsatilmasin", 'ptype_hidden')],
        [Markup.button.callback('Bekor qilish', 'ptype_cancel')]
      ])
    );
  }

  return next();
});

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
    visibility
  });

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
    if (data.contentType === 'text') sent = await ctx.telegram.sendMessage(data.channelId, data.text, opts);
    else if (data.contentType === 'photo') sent = await ctx.telegram.sendPhoto(data.channelId, data.fileId, { caption: data.text, ...opts });
    else if (data.contentType === 'video') sent = await ctx.telegram.sendVideo(data.channelId, data.fileId, { caption: data.text, ...opts });
    else if (data.contentType === 'document') sent = await ctx.telegram.sendDocument(data.channelId, data.fileId, { caption: data.text, ...opts });

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
  const channels = await Channel.find({ ownerId: String(ctx.from.id) });
  const agg = await Donation.aggregate([
    { $match: { channelId: { $in: channels.map(c => c.channelId) }, status: 'paid' } },
    { $group: { _id: null, total: { $sum: '$amount' } } }
  ]);
  const total = agg[0]?.total || 0;
  ctx.reply(`👤 Hisobingiz:\nKanallar soni: ${channels.length}\nJami tushum: ${total} so'm`);
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
  ctx.reply('Savollaringiz bo\'lsa: @your_support_username');
});

module.exports = bot;
