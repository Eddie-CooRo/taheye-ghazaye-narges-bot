const qs = require('qs');
const TelegramBot = require('node-telegram-bot-api');
const cheerio = require('cheerio');
const fetch = require('isomorphic-fetch');
const express = require('express');

const app = express();
app.get('/', (req, res) => {
  res.send('Server is up');
});
app.listen(process.env.PORT || 3000, () => {
  console.log('Express server is up and running');
});

const token = '923328831:AAFWEByFEXCGyMbSS-7xoZvE_v1i0rUqpDo';

console.log('Starting bot');
const bot = new TelegramBot(token, { polling: true });

const REQUESTING = Symbol('requesting');

const db = (() => {
  const _db = {};
  const dbInterface = {
    getUser: id => {
      _db[id] = _db[id] || { name: '', selecteds: [] };
      return _db[id];
    },
    resetUser: id => {
      const user = dbInterface.getUser(id);
      delete user.invoiceMessage;
      user.selecteds = [];
    }
  };
  return dbInterface;
})();

function requestName(msg) {
  const chatID = msg.chat.id;
  const user = db.getUser(msg.chat.id);
  user.name = REQUESTING;
  bot.sendMessage(chatID, 'لطفا نام خود را وارد نمایید');
}

function submitName(msg) {
  const chatID = msg.chat.id;
  const user = db.getUser(msg.chat.id);
  user.name = msg.text;
  bot.sendMessage(
    chatID,
    'نام شما با موفقیت ثبت شد\nبرای ثبت سفارش میتوانید از /order استفاده کنید'
  );
}

function ensureName(msg) {
  const chatID = msg.chat.id;
  bot.sendMessage(
    chatID,
    'نام شما ثبت نشده است. برای ثبت نام میتوانید خود از /setName استفاده کنید'
  );
}

function orderGuide(msg) {
  bot.sendMessage(
    msg.chat.id,
    'میتوانید برای ثبت سفارش از /order استفاده کنید'
  );
}

const unselectedCheckbox = '☑️';
const selectedCheckbox = '✅';
function getKeyboard(user) {
  const options = user.invoiceMessage.options;
  return Object.values(options).map(option => [
    {
      text:
        (user.selecteds.includes(option.name)
          ? selectedCheckbox
          : unselectedCheckbox) +
        ' ' +
        option.label,
      callback_data: option.name
    }
  ]);
}

async function startOrder(msg) {
  const user = db.getUser(msg.chat.id);
  const webpage = await fetch
    .get('https://startupbasic.ir/food/')
    .then(res => res.text());
  const $ = cheerio.load(webpage);
  const cherOptions = $('div.entry-content p');

  const options = cherOptions.toArray().reduce((options, el) => {
    const cherEL = $(el);
    const input = cherEL.find('> input');
    let label;
    if (input.length) {
      label = cherEL.text();
    }
    const name = input.attr('name');
    const price = input.attr('value');
    if (name && price) {
      return {
        ...options,
        [name]: {
          name,
          price,
          label
        }
      };
    } else return options;
  }, {});

  user.invoiceMessage = {
    text: `
      لطفا غذاهای مورد نظر خود را انتخاب کنید
      میتوانید برای اتمام خرید و پرداخت از /pay استفاده کنید
      تعداد: %%, قیمت مجموع: $$ ریال`,
    options,
    totalPrice: '0'
  };

  const keyboard = getKeyboard(user);
  const res = await bot.sendMessage(
    msg.chat.id,
    user.invoiceMessage.text.replace('%%', '0').replace('$$', '0'),
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: keyboard
      }
    }
  );
  user.invoiceMessage.messageId = res.message_id;
}

async function pay(msg) {
  const chatID = msg.chat.id;
  const user = db.getUser(chatID);

  const webpage = await fetch
    .get('https://startupbasic.ir/food/')
    .then(res => res.text());
  const $ = cheerio.load(webpage);

  const form = $('form[action^="/food/"]');
  const action = form.attr('action');
  const hiddenInputs = form.find('input[type=hidden]');
  const nameInput = form.find('input[type=text]');

  let idpaydesc, idpayamount;
  hiddenInputs.toArray().forEach(el => {
    const cherEL = $(el);
    if (cherEL.attr('name') === 'idpay_description') {
      idpaydesc = cherEL;
    } else if (cherEL.attr('name') === 'idpay_amount') {
      idpayamount = cherEL;
    }
  });

  idpaydesc.attr('value', user.selecteds.join('-'));
  idpayamount.attr('value', user.invoiceMessage.totalPrice);
  nameInput.attr('value', user.name);

  const body = {};
  hiddenInputs.toArray().forEach(el => {
    const cherEL = $(el);
    body[cherEL.attr('name')] = cherEL.attr('value');
  });
  body[nameInput.attr('name')] = nameInput.attr('value');

  fetch('https://startupbasic.ir' + action, {
    redirect: 'manual',
    credentials: 'include',
    headers: {
      accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3',
      'accept-language': 'en-US,en;q=0.9,fa;q=0.8',
      'cache-control': 'max-age=0',
      'content-type': 'application/x-www-form-urlencoded',
      'sec-ch-ua': 'Chromium 76',
      'sec-fetch-dest': 'document',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-site': 'same-origin',
      'sec-fetch-user': '?1',
      'sec-origin-policy': '0',
      'upgrade-insecure-requests': '1'
    },
    referrer: 'https://startupbasic.ir/food/',
    referrerPolicy: 'no-referrer-when-downgrade',
    body: qs.stringify(body),
    method: 'POST',
    mode: 'cors'
  })
    .then(res => {
      return res.headers._headers.location[0];
    })
    .then(loc => {
      bot.sendMessage(chatID, `لینک پرداخت سفارش شما: ${loc}`);
      db.resetUser(chatID);
    })
    .catch(err => {
      console.log('Error', err);
      bot.sendMessage(chatID, 'مشکلی پیش آمد');
    });
}

async function updateKeyboard(msg) {
  const chatID = msg.chat.id;
  const user = db.getUser(chatID);
  const options = user.invoiceMessage.options;
  const selecteds = user.selecteds;
  const totalPrice = selecteds.reduce(
    (sum, current) => sum + parseInt(options[current].price),
    0
  );
  const keyboard = getKeyboard(user);
  user.invoiceMessage.totalPrice = totalPrice;
  await bot.editMessageText(
    user.invoiceMessage.text
      .replace('%%', selecteds.length)
      .replace('$$', totalPrice.toLocaleString('fa-IR')),
    {
      chat_id: chatID,
      message_id: user.invoiceMessage.messageId,
      reply_markup: {
        inline_keyboard: keyboard
      }
    }
  );
}

bot.onText(/^(?!\/)/, async msg => {
  console.log('Normal text');
  const chatID = msg.chat.id;
  const user = db.getUser(chatID);
  if (!user.name) {
    ensureName(msg);
  } else if (user.name === REQUESTING) {
    submitName(msg);
  } else {
    orderGuide();
  }
});

bot.onText(/\/start/i, async msg => {
  console.log('Starting');
  const chatID = msg.chat.id;
  const user = db.getUser(chatID);
  if (!user.name) {
    requestName(msg);
  } else if (user.name === REQUESTING) {
  } else {
    orderGuide();
  }
});

bot.onText(/\/setName/i, async msg => {
  console.log('Setting name');
  requestName(msg);
});

bot.onText(/\/order/i, async msg => {
  console.log('Order');
  const chatID = msg.chat.id;
  const user = db.getUser(chatID);
  if (!user.name || user.name === REQUESTING) {
    ensureName(msg);
  } else {
    await startOrder(msg);
  }
});

bot.onText(/\/pay/i, async msg => {
  console.log('Pay');
  const chatID = msg.chat.id;
  const user = db.getUser(chatID);
  if (!user.name || user.name === REQUESTING) {
    ensureName(msg);
  } else if (user.selecteds.length === 0) {
    bot.sendMessage(
      chatID,
      'شما هیچ غذایی انتخاب نکرده‌اید\nبرای انتخاب غذا می‌توانید از order استفاده کنید'
    );
  } else {
    pay(msg);
  }
});

bot.onText(/\/empty/i, async msg => {
  db.resetUser(msg.chat.id);
});

bot.on('polling_error', err => console.log('Error:', err));

bot.on('callback_query', query => {
  const chatID = query.message.chat.id;
  const user = db.getUser(chatID);
  if (!user.name || user.name === REQUESTING) {
    ensureName(query.message);
    bot.answerCallbackQuery(query.id);
  } else if (user.selecteds.includes(query.data)) {
    const index = user.selecteds.indexOf(query.data);
    user.selecteds.splice(index, 1);
    bot.answerCallbackQuery(query.id, {
      text: 'حذف شد'
    });
    updateKeyboard(query.message);
  } else {
    user.selecteds.push(query.data);
    bot.answerCallbackQuery(query.id, {
      text: 'اضافه شد'
    });
    updateKeyboard(query.message);
  }
});
