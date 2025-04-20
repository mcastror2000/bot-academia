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
app.use(express.static('public'));

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
        textoTotal += `Contenido de ${url}:
` + texto + '\n\n';
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

app.post('/api/ask', async (req, res) => {
  const { message } = req.body;
  const urls = filtrarUrlsPorConsulta(message);
  const contexto = await obtenerContenidoDeSitio(urls);

  try {
    const completion = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: 'Eres un asistente que responde exclusivamente con la información disponible en la página web de la Academia Nacional de Artes. Recuerda que la página indica que existe una clase de prueba de 60 minutos con valor promocional, válida para distintos instrumentos. Si se menciona esa clase, debes informarla claramente al usuario.' },
          { role: 'system', content: contexto },
          { role: 'user', content: message }
        ]
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${OPENAI_API_KEY}`
        }
      }
    );
    res.json({ reply: completion.data.choices[0].message.content });
  } catch (error) {
    console.error('Error con OpenAI (web):', error.response?.data || error.message);
    res.json({ reply: 'Lo siento, hubo un error al procesar tu consulta.' });
  }
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userText = msg.text;

  if (!userText || userText.startsWith('/')) return;

  if (formulariosPendientes[chatId]) {
    const datos = formulariosPendientes[chatId];
    switch (datos.paso) {
      case 'nombre':
        datos.nombre = userText;
        datos.paso = 'rut';
        return bot.sendMessage(chatId, 'Gracias. ¿Cuál es tu RUT?');
      case 'rut':
        if (!/^[0-9kK.\-]+$/.test(userText)) return bot.sendMessage(chatId, '⚠️ El RUT no parece válido. Intenta nuevamente.');
        datos.rut = userText;
        datos.paso = 'correo';
        return bot.sendMessage(chatId, '¿Cuál es tu correo electrónico?');
      case 'correo':
        if (!/^\S+@\S+\.\S+$/.test(userText)) return bot.sendMessage(chatId, '⚠️ El correo ingresado no parece válido. Intenta nuevamente.');
        datos.correo = userText;
        datos.paso = 'telefono';
        return bot.sendMessage(chatId, '¿Cuál es tu número de teléfono (solo números)?');
      case 'telefono':
        if (!/^\d{7,15}$/.test(userText)) return bot.sendMessage(chatId, '⚠️ El número debe tener solo dígitos (mínimo 7, máximo 15).');
        datos.telefono = userText;
        datos.paso = 'preferencia';
        return bot.sendMessage(chatId, '¿Prefieres que te contacten por WhatsApp? (Sí / No)');
      case 'preferencia':
        const respuesta = userText.toLowerCase();
        if (!['sí', 'si', 'no'].includes(respuesta)) return bot.sendMessage(chatId, 'Por favor, responde solo "Sí" o "No".');
        datos.preferencia = respuesta;
        datos.paso = 'mensaje';
        return bot.sendMessage(chatId, 'Por último, escribe tu mensaje o consulta.');
      case 'mensaje':
        datos.mensaje = userText;
        await enviarCorreo(datos);
        delete formulariosPendientes[chatId];
        return bot.sendMessage(chatId, '✅ ¡Gracias! Tus datos fueron enviados correctamente. Pronto te contactaremos.');
    }
  }

  const urls = filtrarUrlsPorConsulta(userText);
  const contexto = await obtenerContenidoDeSitio(urls);

  const intencionContacto = [
    'quiero inscribirme',
    'quiero que me contacten',
    'quiero hablar con una persona',
    'me pueden llamar',
    'quiero inscribirme ya',
    'necesito ayuda para inscribirme'
  ];

  if (intencionContacto.some(frase => userText.toLowerCase().includes(frase))) {
    await bot.sendMessage(chatId, '📬 Si deseas ser contactado personalmente, por favor presiona el botón a continuación para iniciar el formulario.', {
      reply_markup: {
        inline_keyboard: [[{ text: '📨 Iniciar contacto', callback_data: 'formulario_contacto' }]]
      }
    });
    return;
  }

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
    console.error('Error con OpenAI (telegram):', error.response?.data || error.message);
    bot.sendMessage(chatId, 'Lo siento, hubo un error al procesar tu consulta.');
  }
});

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;

  if (query.data === 'formulario_contacto') {
    formulariosPendientes[chatId] = { paso: 'nombre' };
    await bot.sendMessage(chatId, '¡Perfecto! Comencemos. ¿Cuál es tu nombre completo?');
  }
});

async function enviarCorreo(datos) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS
    }
  });

  const mensaje = `
Nombre: ${datos.nombre}
RUT: ${datos.rut}
Correo: ${datos.correo}
Teléfono: ${datos.telefono}
¿Prefiere WhatsApp?: ${(datos.preferencia === 'sí' || datos.preferencia === 'si') ? 'Sí' : 'No'}
Mensaje: ${datos.mensaje}
  `;

  await transporter.sendMail({
    from: SMTP_USER,
    to: DESTINO_CONTACTO,
    subject: 'Nuevo contacto desde el bot de la Academia',
    text: mensaje
  });
}
