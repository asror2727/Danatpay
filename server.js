 const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const TOKEN = process.env.BOT_TOKEN;

app.post("/checkAdmin", async (req, res) => {

  const { channel } = req.body;

  try {

    const me = await axios.get(
      `https://api.telegram.org/bot${TOKEN}/getMe`
    );

    const botId = me.data.result.id;

    const member = await axios.get(
      `https://api.telegram.org/bot${TOKEN}/getChatMember`,
      {
        params: {
          chat_id: "@" + channel,
          user_id: botId
        }
      }
    );

    const status = member.data.result.status;

    if (
      status == "administrator" ||
      status == "creator"
    ) {

      return res.json({
        ok: true,
        url: "https://danatpay.onrender.com/" + channel
      });

    } else {

      return res.json({
        ok: false,
        error: "Bot admin emas"
      });

    }

  } catch (e) {

    return res.json({
      ok: false,
      error: e.response?.data || e.message
    });

  }

});

app.listen(process.env.PORT || 3000);
