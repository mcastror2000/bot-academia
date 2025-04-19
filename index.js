// index.js
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const cheerio = require('cheerio');
const nodemailer = require('nodemailer');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const DESTINO_CONTACTO = process.env.DESTINO_CONTACTO;

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

const historialConsultas = {};
const formulariosPendientes = {};
const usuariosSaludados = new Set();

function filtrarUrlsPorConsulta(userText) {
  const lowerText = userText.toLowerCase();

  if (lowerText.includes('canto')) {
    return [
      'https://www.academianacionaldeartes.cl/clases-de-canto',
      'https://www.academianacionaldeartes.cl/curso-de-formacion-musical'
    ];
  }
  if (lowerText.includes('teatro')) {
    return [
      'https://www.academianacionaldeartes.cl/talleres-de-teatro',
      'https://www.academianacionaldeartes.cl/taller-de-iniciacion-en-teatro',
      'https://www.academianacionaldeartes.cl/preuniversitario-teatral'
    ];
  }
  if (lowerText.includes('piano')) {
    return ['https://www.academianacionaldeartes.cl/clases-de-piano'];
  }
  if (lowerText.includes('guitarra')) {
    return ['https://www.academianacionaldeartes.cl/clases-de-guitarra'];
  }
  if (lowerText.includes('bajo')) {
    return ['https://www.academianacionaldeartes.cl/clases-de-bajo'];
  }
  if (lowerText.includes('ukelele')) {
    return ['https://www.academianacionaldeartes.cl/clases-de-ukelele'];
  }

  return [
    'https://www.academianacionaldeartes.cl/cursos-de-musica',
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
        const texto = $('main').text().replace(/\s+/g, ' ').trim().slice(0, 1500);
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

bot.on('new_chat_members', (msg) => {
  const bienvenida = '👋 ¡Hola! Soy tu asistente virtual. Cuéntame qué cursos te interesan y te ayudaré con gusto. Si deseas que te contacten directamente, pulsa el botón a continuación.';
  const chatId = msg.chat.id;
  const opciones = {
    reply_markup: {
      inline_keyboard: [[
        { text: '📬 Quiero ser contactado', callback_data: 'iniciar_contacto' }
      ]]
    }
  };
  bot.sendMessage(chatId, bienvenida, opciones);
});

bot.onText(/\/quiero_contacto/, (msg) => {
  const chatId = msg.chat.id;
  formulariosPendientes[chatId] = { paso: 'nombre' };
  bot.sendMessage(chatId, 'Por favor, indícame tu nombre completo.');
});

bot.onText(/\/inicio/, (msg) => {
  const chatId = msg.chat.id;
  const opciones = {
    reply_markup: {
      inline_keyboard: [[
        { text: '📬 Quiero ser contactado', callback_data: 'iniciar_contacto' }
      ]]
    }
  };
  bot.sendMessage(chatId, '¡Hola! ¿En qué puedo ayudarte hoy?', opciones);
});

bot.on('callback_query', async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const action = callbackQuery.data;

  if (action === 'iniciar_contacto') {
    formulariosPendientes[chatId] = { paso: 'nombre' };
    bot.sendMessage(chatId, 'Perfecto. Comencemos con tu nombre completo.');
  }
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userText = msg.text;

  if (msg.text && !msg.text.startsWith('/') && !usuariosSaludados.has(chatId)) {
    usuariosSaludados.add(chatId);
    const opciones = {
      reply_markup: {
        inline_keyboard: [[
          { text: '📬 Quiero ser contactado', callback_data: 'iniciar_contacto' }
        ]]
      }
    };
    bot.sendMessage(chatId, '👋 ¡Hola! Soy tu asistente virtual. Cuéntame qué cursos te interesan y te ayudaré con gusto. Si deseas que te contacten directamente, pulsa el botón a continuación.', opciones);
  }

  if (userText.startsWith('/')) return;

  if (formulariosPendientes[chatId]) {
    const datos = formulariosPendientes[chatId];
    switch (datos.paso) {
      case 'nombre':
        datos.nombre = userText;
        datos.paso = 'rut';
        bot.sendMessage(chatId, 'Gracias. Ahora dime tu RUT.');
        break;
      case 'rut': {
        const rutValido = /^[0-9kK.\-]+$/.test(userText);
        if (!rutValido) {
          bot.sendMessage(chatId, '⚠️ El RUT ingresado no parece válido. Intenta nuevamente.');
          return;
        }
        datos.rut = userText;
        datos.paso = 'correo';
        bot.sendMessage(chatId, 'Perfecto. ¿Cuál es tu correo electrónico?');
        break;
      }
      case 'correo': {
        const correoValido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userText);
        if (!correoValido) {
          bot.sendMessage(chatId, '⚠️ El correo ingresado no parece válido. Intenta nuevamente.');
          return;
        }
        datos.correo = userText;
        datos.paso = 'telefono';
        bot.sendMessage(chatId, '¿Cuál es tu número de teléfono (solo números)?');
        break;
      }
      case 'telefono': {
        const telefonoValido = /^\d{7,15}$/.test(userText);
        if (!telefonoValido) {
          bot.sendMessage(chatId, '⚠️ El número debe tener solo dígitos (mínimo 7, máximo 15). Intenta nuevamente.');
          return;
        }
        datos.telefono = userText;
        datos.paso = 'preferencia';
        bot.sendMessage(chatId, '¿Prefieres que te contacten por WhatsApp? (Sí / No)');
        break;
      }
      case 'preferencia': {
        const texto = userText.toLowerCase();
        if (texto !== 'sí' && texto !== 'no' && texto !== 'si') {
          bot.sendMessage(chatId, 'Por favor, responde solo "Sí" o "No".');
          return;
        }
        datos.preferencia = texto;
        datos.paso = 'mensaje';
        bot.sendMessage(chatId, 'Por último, escribe tu mensaje o consulta.');
        break;
      }
      case 'mensaje':
        datos.mensaje = userText;
        await enviarCorreo(datos);
        delete formulariosPendientes[chatId];
        bot.sendMessage(chatId, '¡Gracias! Tus datos han sido enviados correctamente. Pronto te contactaremos.');
        break;
    }
    return;
  }

  if (!historialConsultas[chatId]) historialConsultas[chatId] = 0;
  historialConsultas[chatId]++;

  const urlsRelevantes = filtrarUrlsPorConsulta(userText);
  const contexto = await obtenerContenidoDeSitio(urlsRelevantes);

  try {
    const completion = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: 'Eres un asistente experto en orientar a estudiantes sobre los cursos y servicios ofrecidos por la Academia Nacional de Artes. Usa solo la información proporcionada.' },
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

    let respuesta = completion.data.choices[0].message.content;

    const textoDetallado = userText.toLowerCase();
    const deseaDetalles = textoDetallado.includes('precio') || textoDetallado.includes('valor') || textoDetallado.includes('horario') || textoDetallado.includes('clase') || textoDetallado.includes('inscripción');

    if (historialConsultas[chatId] >= 3 && deseaDetalles) {
      respuesta += '\n\n👉 Si deseas concretar tu participación o recibir más información personalizada, puedes completar el formulario de contacto con /quiero_contacto o pulsar "📬 Quiero ser contactado" con el comando /inicio.';
    }

    await bot.sendMessage(chatId, respuesta);
  } catch (error) {
    console.error('Error al consultar OpenAI:', error.response?.data || error.message);
    await bot.sendMessage(chatId, 'Lo siento, hubo un error al generar la respuesta.');
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

  const mailOptions = {
    from: SMTP_USER,
    to: DESTINO_CONTACTO,
    subject: 'Nuevo mensaje de contacto desde el bot',
    text: `Nombre: ${datos.nombre}\nRUT: ${datos.rut}\nCorreo: ${datos.correo}\nTeléfono: ${datos.telefono}\n¿Prefiere WhatsApp?: ${(datos.preferencia === 'sí' || datos.preferencia === 'si') ? 'Sí' : 'No'}\nMensaje: ${datos.mensaje}`
  };

  await transporter.sendMail(mailOptions);
}

