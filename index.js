// index.js
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const cheerio = require('cheerio');
const nodemailer = require('nodemailer');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const DESTINO_CONTACTO = process.env.DESTINO_CONTACTO;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const PORT = process.env.PORT || 3000;

const app = express();
app.use(bodyParser.json());

const bot = new TelegramBot(TELEGRAM_TOKEN, { webHook: { port: PORT } });
bot.setWebHook(`${WEBHOOK_URL}/bot${TELEGRAM_TOKEN}`);

const historialConsultas = {};
const formulariosPendientes = {};
const usuariosSaludados = new Set();

function filtrarUrlsPorConsulta(userText) {
  const lowerText = userText.toLowerCase();
  if (lowerText.includes('canto')) return ['https://www.academianacionaldeartes.cl/clases-de-canto'];
  if (lowerText.includes('teatro')) return ['https://www.academianacionaldeartes.cl/talleres-de-teatro'];
  if (lowerText.includes('clase de prueba') || lowerText.includes('sesión de prueba')) return ['https://www.academianacionaldeartes.cl/clase-de-prueba'];
  if (lowerText.includes('piano')) return ['https://www.academianacionaldeartes.cl/clases-de-piano'];
  if (lowerText.includes('guitarra')) return ['https://www.academianacionaldeartes.cl/clases-de-guitarra'];
  if (lowerText.includes('bajo')) return ['https://www.academianacionaldeartes.cl/clases-de-bajo'];
  if (lowerText.includes('ukelele')) return ['https://www.academianacionaldeartes.cl/clases-de-ukelele'];
  if (lowerText.includes('violín') || lowerText.includes('violin')) return ['https://www.academianacionaldeartes.cl/clases-de-violin'];
  if (lowerText.includes('flauta')) return ['https://www.academianacionaldeartes.cl/clases-de-flauta-traversa'];
  if (lowerText.includes('saxofón') || lowerText.includes('saxofon')) return ['https://www.academianacionaldeartes.cl/clases-de-saxofon'];
  if (lowerText.includes('violonchelo')) return ['https://www.academianacionaldeartes.cl/clases-de-violonchelo'];
  if (lowerText.includes('batería') || lowerText.includes('bateria')) return ['https://www.academianacionaldeartes.cl/clases-de-bateria'];
  if (lowerText.includes('oratoria')) return ['https://www.academianacionaldeartes.cl/cursos-de-oratoria'];
  if (lowerText.includes('inglés') || lowerText.includes('ingles')) return ['https://www.academianacionaldeartes.cl/cursos-de-ingles'];
  if (lowerText.includes('francés') || lowerText.includes('frances')) return ['https://www.academianacionaldeartes.cl/cursos-de-frances'];
  return [
    'https://www.academianacionaldeartes.cl/cursos-de-musica',
    'https://www.academianacionaldeartes.cl/clase-de-prueba',
    'https://www.academianacionaldeartes.cl'
  ];
}

async function obtenerContenidoDeSitio(urls) {
  try {
    let textoTotal = '';
    for (const url of urls) {
      try {
        const { data } = await axios.get(url);
        const $ = cheerio.load(data);
        const texto = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 5000);
        textoTotal += `Contenido de ${url}:\n` + texto + '\n\n';
      } catch (err) {
        console.warn(`No se pudo acceder a ${url}`);
      }
    }
    return textoTotal.slice(0, 12000);
  } catch (error) {
    console.error('Error al obtener el contenido del sitio:', error);
    return 'No se pudo obtener la información actualizada del sitio.';
  }
}

app.post(`/bot${TELEGRAM_TOKEN}`, async (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userText = msg.text;

  if (!userText || userText.startsWith('/')) return;

  if (!usuariosSaludados.has(chatId)) {
    usuariosSaludados.add(chatId);
    await bot.sendMessage(chatId, '👋 ¡Hola! Soy tu asistente virtual. Cuéntame qué cursos te interesan y te ayudaré con gusto.');
  }

  const urls = filtrarUrlsPorConsulta(userText);
  const contexto = await obtenerContenidoDeSitio(urls);

  try {
    const completion = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: 'Eres un asistente que responde exclusivamente con la información disponible en la página web de la Academia Nacional de Artes. Recuerda que la página indica que existe una clase de prueba de 60 minutos con valor promocional, válida para distintos instrumentos. Si se menciona esa clase, debes informarla claramente al usuario.' },
          { role: 'system', content: contexto },
          { role: 'user', content: userText }
        ]
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${OPENAI_API_KEY}`
        }
      }
    );
    await bot.sendMessage(chatId, completion.data.choices[0].message.content);
  } catch (error) {
    console.error('Error con OpenAI:', error.response?.data || error.message);
    bot.sendMessage(chatId, 'Lo siento, hubo un error al procesar tu consulta.');
  }
});
