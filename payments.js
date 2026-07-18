const express = require('express');
const crypto = require('crypto');
const Donation = require('./Donation');
const Channel = require('./Channel');
const telegram = require('./telegram');

const router = express.Router();
const { CLICK_SERVICE_ID, CLICK_SECRET_KEY, PAYME_KEY } = process.env;

async function notifyOwner(donation) {
  if (donation.channelId === 'platform-support') return;
  try {
    const channel = await Channel.findOne({ channelId: donation.channelId });
    if (!channel) return;
    const name = donation.anonymous ? 'Anonim' : (donation.name || "Noma'lum");
    await telegram.sendMessage(
      channel.ownerId,
      `🎉 ${name} ${donation.amount.toLocaleString()} so'm tashladi!` +
      (donation.comment ? `\n"${donation.comment}"` : '')
    );
  } catch (e) {}
}

// ============ CLICK ============
router.post('/click/prepare', async (req, res) => {
  const { click_trans_id, merchant_trans_id, amount, sign_string, sign_time, action } = req.body;

  const checkSign = crypto.createHash('md5')
    .update(`${click_trans_id}${CLICK_SERVICE_ID}${CLICK_SECRET_KEY}${merchant_trans_id}${amount}${action}${sign_time}`)
    .digest('hex');

  const donation = await Donation.findOne({ donationId: merchant_trans_id });
  if (!donation) return res.json({ error: -5, error_note: 'Topilmadi' });
  if (checkSign !== sign_string) return res.json({ error: -1, error_note: 'Sign xato' });

  res.json({
    click_trans_id,
    merchant_trans_id,
    merchant_prepare_id: merchant_trans_id,
    error: 0,
    error_note: 'OK'
  });
});

router.post('/click/complete', async (req, res) => {
  const { merchant_trans_id, error } = req.body;
  const donation = await Donation.findOne({ donationId: merchant_trans_id });
  if (!donation) return res.json({ error: -5, error_note: 'Topilmadi' });

  if (Number(error) === 0 && donation.status !== 'paid') {
    donation.status = 'paid';
    await donation.save();
    notifyOwner(donation);
  }
  res.json({ merchant_trans_id, error: 0, error_note: 'OK' });
});

// ============ PAYME ============
router.post('/payme', async (req, res) => {
  const auth = req.headers['authorization'] || '';
  const expected = 'Basic ' + Buffer.from('Paycom:' + PAYME_KEY).toString('base64');
  if (auth !== expected) {
    return res.json({ error: { code: -32504, message: "Ruxsat yo'q" } });
  }

  const { method, params, id } = req.body;

  if (method === 'CheckPerformTransaction') {
    const donation = await Donation.findOne({ donationId: params.account.order_id });
    if (!donation) return res.json({ error: { code: -31050, message: 'Topilmadi' }, id });
    return res.json({ result: { allow: true }, id });
  }

  if (method === 'PerformTransaction') {
    const donation = await Donation.findOne({ donationId: params.account.order_id });
    if (donation && donation.status !== 'paid') {
      donation.status = 'paid';
      await donation.save();
      notifyOwner(donation);
    }
    return res.json({ result: { transaction: params.id, perform_time: Date.now(), state: 2 }, id });
  }

  res.json({ result: {}, id });
});

module.exports = router;
