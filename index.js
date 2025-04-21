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

const bot = new TelegramBot(TELEGRAM_TOKEN);

const historialConsultas = {}; // Guarda el conteo por tema por IP
const formulariosPendientes = {};
const usuariosSaludados = new Set();

function detectarTema(texto) {
  const temas = [
    'canto', 'teatro', 'clase de prueba', 'piano', 'guitarra', 'bajo', 'ukelele', 'violín',
    'flauta', 'saxofón', 'violonchelo', 'batería', 'oratoria', 'inglés', 'francés'
  ];
  const lower = texto.toLowerCase();
  return temas.find(t => lower.includes(t)) || 'otros';
}

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
        const texto = $('body').text().replace(/\s+/g, ' ').trim();
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
  const { message, ip = req.ip } = req.body;
  const tema = detectarTema(message);

  if (!historialConsultas[ip]) historialConsultas[ip] = {};
  if (!historialConsultas[ip][tema]) historialConsultas[ip][tema] = 0;
  historialConsultas[ip][tema]++;

  const urls = filtrarUrlsPorConsulta(message);
  const contexto = await obtenerContenidoDeSitio(urls);

  let respuestaFinal = '';

  try {
    const completion = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: `Eres un asistente virtual cálido, profesional y amigable que responde exclusivamente con la información real disponible en el sitio web de la Academia Nacional de Artes. \n\nCuando detectes que el usuario está interesado en un curso específico, entrega todos los detalles disponibles (tipo de clases, duración, modalidad, instrumentos, etc.) y, si hay información sobre precios, clases de prueba u horarios, debes mencionarla con claridad.\n\nCuando el usuario solicite información sobre contacto, inscripción o demuestre interés evidente (por ejemplo, pregunta por precios, duración o cómo inscribirse), sugiérele completar el formulario de contacto. No inventes información que no esté en el sitio.\n\nUsa un lenguaje cercano, claro y directo, con un toque humano. Puedes usar emojis para dar calidez a las respuestas, y motiva al usuario a seguir consultando si lo necesita.`
          },
          { role: 'system', content: `A continuación se entrega información extraída del sitio oficial. Úsala para responder con precisión:\n\n${contexto}` },

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

    respuestaFinal = completion.data.choices[0].message.content;

    const deseaDetalles = message.toLowerCase().includes('precio') ||
                          message.toLowerCase().includes('valor') ||
                          message.toLowerCase().includes('horario') ||
                          message.toLowerCase().includes('inscripción') ||
                          message.toLowerCase().includes('contacten') ||
                          message.toLowerCase().includes('me pueden llamar') ||
                          message.toLowerCase().includes('hablar con alguien');

    if (historialConsultas[ip][tema] >= 3 || deseaDetalles) {
      respuestaFinal += '\n\n📞 Puedes contactar a la Academia Nacional de Artes directamente al 2 2884 2867 o escribir a info@academianacionaldeartes.cl.\n\nSi prefieres que alguien de la Academia se comunique contigo, puedes completar el formulario de contacto haciendo clic en el botón que aparece más abajo.';
    }

    res.json({ reply: respuestaFinal });
  } catch (error) {
    console.error('Error con OpenAI (web):', error.response?.data || error.message);
    res.json({ reply: 'Lo siento, hubo un error al procesar tu consulta.' });
  }
});

app.post('/api/contacto', async (req, res) => {
  const datos = req.body;

  if (!datos.nombre || !datos.rut || !datos.correo || !datos.telefono || !datos.preferencia || !datos.mensaje) {
    return res.status(400).json({ ok: false, message: 'Faltan campos requeridos' });
  }

  try {
    await enviarCorreo(datos);
    res.json({ ok: true, message: 'Datos enviados correctamente' });
  } catch (error) {
    console.error('Error al enviar el correo desde el formulario web:', error.message);
    res.status(500).json({ ok: false, message: 'Hubo un error al enviar el correo' });
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

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
  bot.setWebHook(`${WEBHOOK_URL}/bot${TELEGRAM_TOKEN}`);
});
