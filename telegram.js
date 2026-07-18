// Oddiy Telegram Bot API funksiyalari (bots.business kabi tashqi tizimlar
// bizning /api/* endpointlarimizni chaqirganda, shu funksiyalar orqali
// Telegram'ga xabar yuboramiz yoki admin holatini tekshiramiz).

const { BOT_TOKEN } = process.env;
const BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;

async function call(method, params) {
  const res = await fetch(`${BASE}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.description || 'Telegram API xatosi');
  return data.result;
}

let cachedBotId = null;
async function getBotId() {
  if (cachedBotId) return cachedBotId;
  const me = await call('getMe', {});
  cachedBotId = me.id;
  return cachedBotId;
}

async function getChat(chatIdOrUsername) {
  return call('getChat', { chat_id: chatIdOrUsername });
}

async function isBotAdmin(channelId) {
  const botId = await getBotId();
  const member = await call('getChatMember', { chat_id: channelId, user_id: botId });
  return member.status === 'administrator' || member.status === 'creator';
}

async function sendMessage(chatId, text, extra = {}) {
  return call('sendMessage', { chat_id: chatId, text, ...extra });
}

async function sendPhoto(chatId, photo, extra = {}) {
  return call('sendPhoto', { chat_id: chatId, photo, ...extra });
}

async function sendVideo(chatId, video, extra = {}) {
  return call('sendVideo', { chat_id: chatId, video, ...extra });
}

async function sendDocument(chatId, document, extra = {}) {
  return call('sendDocument', { chat_id: chatId, document, ...extra });
}

async function getChatPhotoFileId(channelId) {
  const chat = await call('getChat', { chat_id: channelId });
  return chat.photo ? chat.photo.big_file_id : null;
}

async function getFilePath(fileId) {
  const file = await call('getFile', { file_id: fileId });
  return file.file_path;
}

async function editMessageText(chatId, messageId, text) {
  return call('editMessageText', { chat_id: chatId, message_id: messageId, text });
}

async function editMessageCaption(chatId, messageId, caption) {
  return call('editMessageCaption', { chat_id: chatId, message_id: messageId, caption });
}

module.exports = { getChat, isBotAdmin, sendMessage, sendPhoto, sendVideo, sendDocument, getBotId, getChatPhotoFileId, getFilePath, editMessageText, editMessageCaption, BOT_TOKEN };
