process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import fs from 'fs';
import express from 'express';
import { Bot, Keyboard } from '@maxhub/max-bot-api';
import { GoogleGenAI } from '@google/genai';

const app = express();
app.get('/', (req, res) => res.send('Eva AI Bot is alive and running 24/7!'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Web keep-alive server is listening on port ${PORT}`);
});

const MAX_TOKEN = 'f9LHodD0cOIp9eHOCQb4IQNMf3L6hh9RKbUZP30aaual-1kQdr2FCgpuSBhE-IIB8YewzL3CSYdQO5MRxvwF';
const GEMINI_KEY = 'AQ.Ab8RN6IuzNVQp62CzZyy5b6RIbTActuSgKLuyyk3QTqB7e-HJw';

const bot = new Bot(MAX_TOKEN);
const ai = new GoogleGenAI({ apiKey: GEMINI_KEY });

const MODELS = [
  'gemini-flash-lite-latest',
  'gemini-flash-latest',
  'gemini-3.0-flash',
  'gemini-pro-latest'
];

const userState = new Map();

function getUserData(userId) {
  if (!userState.has(userId)) {
    userState.set(userId, { mode: 'upload_ref', pinUrl: null, lastPrompt: null, faceDescription: null });
  }
  return userState.get(userId);
}

const PINTEREST_THEMES = [
  'site:pinterest.com editorial fashion portrait photoshoot lighting',
  'site:pinterest.com cinematic street style portrait photography',
  'site:pinterest.com dramatic studio portrait lighting photoshoot',
  'site:pinterest.com old money aesthetic portrait photoshoot',
  'site:pinterest.com neon cyberpunk night portrait photography',
  'site:pinterest.com golden hour aesthetic portrait photoshoot',
  'site:pinterest.com vintage 90s film flash portrait photoshoot',
  'site:pinterest.com Vogue magazine style portrait photography'
];

const SYSTEM_PROMPT = `Ты — профессиональный AI-промпт-инженер для фотореалистичной генерации (Midjourney v6, Flux, Stable Diffusion).
Твоя задача: проанализировать загруженное фото и составить детальный промпт, чтобы пользователь мог сгенерировать точно такой же кадр со своим лицом.

ПРАВИЛА АНАЛИЗА:
1. НЕ описывай уникальные черты лица человека на фото. Пиши универсальный маркер: "[subject]".
2. Детально опиши на английском: позу, наклон головы, взгляд, эмоцию, одежду, текстуру ткани, аксессуары, прическу, локацию, фон, глубину резкости (bokeh), схему освещения и параметры камеры (85mm lens, f/1.8, medium shot, photorealistic, 8k, raw photo).

СТРОГИЙ ФОРМАТ ОТВЕТА:
Твой ответ ОБЯЗАТЕЛЬНО должен состоять из двух частей, разделенных строкой ===SPLIT===

В ПЕРВОЙ ЧАСТИ (до ===SPLIT===) напиши ТОЛЬКО английский промпт и негативный промпт:
Prompt:
[Детальный промпт на английском с маркером [subject]]

Negative prompt:
deformed, blurry, bad anatomy, disfigured, poorly drawn face, mutation, extra limbs, ugly, plastic skin, CGI, 3d render, oversaturated

ВО ВТОРОЙ ЧАСТИ (после ===SPLIT===) напиши на русском языке:
💡 **Рекомендации и разбор кадра:**
- Схема света и ракурс.
- Рекомендуемое соотношение сторон (--ar).
- Совет по выбору селфи.`;

function getMainMenuKeyboard() {
  return Keyboard.inlineKeyboard([
    [Keyboard.button.callback('📸 Сделать промпт по моему фото', 'mode_upload')],
    [Keyboard.button.callback('✨ Идеи фотосессий (Pinterest)', 'mode_pinterest')],
    [Keyboard.button.callback('🎨 Сгенерировать фото', 'mode_generate')]
  ]);
}

function getPinterestKeyboard() {
  return Keyboard.inlineKeyboard([
    [Keyboard.button.callback('✅ Выбрать это фото (Создать промпт)', 'pin_select')],
    [Keyboard.button.callback('🔄 Другой вариант', 'mode_pinterest')],
    [Keyboard.button.callback('🏠 В главное меню', 'main_menu')]
  ]);
}

function getAfterPromptKeyboard() {
  return Keyboard.inlineKeyboard([
    [Keyboard.button.callback('🤳 Загрузить своё лицо и сгенерировать!', 'ask_face_for_gen')],
    [Keyboard.button.callback('⚡ Сгенерировать без селфи (случайное лицо)', 'gen_without_face')],
    [Keyboard.button.callback('✨ Еще идеи из Pinterest', 'mode_pinterest')],
    [Keyboard.button.callback('🏠 В главное меню', 'main_menu')]
  ]);
}

function getWaitFaceKeyboard() {
  return Keyboard.inlineKeyboard([
    [Keyboard.button.callback('⚡ Пропустить и сгенерировать без селфи', 'gen_without_face')],
    [Keyboard.button.callback('🏠 Отмена (В меню)', 'main_menu')]
  ]);
}

function getAfterGenKeyboard() {
  return Keyboard.inlineKeyboard([
    [Keyboard.button.callback('🔄 Ещё вариант (с этими же данными)', 'regen_same')],
    [Keyboard.button.callback('🤳 Поменять селфи лица', 'ask_face_for_gen')],
    [Keyboard.button.callback('🏠 В главное меню', 'main_menu')]
  ]);
}

async function createMaxImageAttachment(imageUrl) {
  const response = await fetch(imageUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
  });
  if (!response.ok) {
    throw new Error(`Генератор вернул статус ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const tempFile = `./temp_${Date.now()}.jpg`;
  fs.writeFileSync(tempFile, buffer);

  try {
    const uploaded = await bot.api.uploadImage({ source: fs.createReadStream(tempFile) });
    fs.unlinkSync(tempFile);
    return uploaded.toJson();
  } catch (uploadErr) {
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    const uploadedByUrl = await bot.api.uploadImage({ url: imageUrl });
    return uploadedByUrl.toJson();
  }
}

async function getRandomPinterestPhoto() {
  const query = PINTEREST_THEMES[Math.floor(Math.random() * PINTEREST_THEMES.length)];
  try {
    const tokenRes = await fetch(`https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const html = await tokenRes.text();
    const vqdMatch = html.match(/vqd=([\d-]+)/) || html.match(/vqd="([\d-]+)"/) || html.match(/vqd='([\d-]+)'/);

    if (vqdMatch && vqdMatch[1]) {
      const imgRes = await fetch(`https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(query)}&vqd=${vqdMatch[1]}&f=,,,&p=1`, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      const data = await imgRes.json();
      if (data.results && data.results.length > 0) {
        const pinImages = data.results.filter(r => r.image && r.image.includes('pinimg.com'));
        const pool = pinImages.length > 0 ? pinImages : data.results;
        const chosen = pool[Math.floor(Math.random() * Math.min(pool.length, 25))];
        return { url: chosen.image, title: chosen.title || 'Editorial Photoshoot' };
      }
    }
  } catch (e) {
    console.log('Резервный каталог фотосессий:', e.message);
  }

  const fallbackPhotos = [
    'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=1000&q=85',
    'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=1000&q=85',
    'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=1000&q=85',
    'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=1000&q=85',
    'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=1000&q=85',
    'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=1000&q=85',
    'https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?auto=format&fit=crop&w=1000&q=85'
  ];
  return {
    url: fallbackPhotos[Math.floor(Math.random() * fallbackPhotos.length)],
    title: 'Стильная фотосессия'
  };
}

async function downloadImageAsPart(url) {
  const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const arrayBuffer = await response.arrayBuffer();
  const base64Data = Buffer.from(arrayBuffer).toString('base64');
  const mimeType = response.headers.get('content-type') || 'image/jpeg';
  return { inlineData: { data: base64Data, mimeType } };
}

async function askGemini(contents, customSystemInstruction = SYSTEM_PROMPT) {
  for (const modelName of MODELS) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model: modelName,
          contents: contents,
          config: { systemInstruction: customSystemInstruction }
        });
        return response.text;
      } catch (err) {
        if (err.message.includes('503') || err.message.includes('UNAVAILABLE')) {
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        if (err.message.includes('404') || err.message.includes('NOT_FOUND')) {
          break;
        }
        throw err;
      }
    }
  }
  throw new Error('Все серверы Google сейчас перегружены, попробуй через минуту.');
}

async function extractFaceFeatures(imageUrl) {
  const imagePart = await downloadImageAsPart(imageUrl);
  const faceSystem = 'Describe ONLY the person physical appearance from this selfie in concise English (max 25 words): gender, age, skin tone, face shape, eye color, nose, lips, and hair color/style. Output ONLY the phrase, e.g.: "a 22-year-old blonde woman with long straight hair, blue eyes, soft facial features, full lips".';
  const desc = await askGemini([imagePart, 'Describe face features in English.'], faceSystem);
  return desc.replace(/[\r\n]+/g, ' ').trim();
}

async function generatePhotoAndSend(ctx, rawText, isAlreadyCleanEnglishPrompt = false) {
  const userId = ctx.user?.user_id || ctx.chatId || 'default';
  const state = getUserData(userId);

  await ctx.reply('🎨 Генерирую фотографию и загружаю в чат (подожди 10–15 секунд)...');

  let finalEnglishPrompt = rawText;

  if (!isAlreadyCleanEnglishPrompt) {
    const enhancerSystem = 'Convert the user request into a concise English photorealistic prompt (max 35 words). Use "[subject]" as the person placeholder. Include "85mm, f/1.8, photorealistic, 8k". Output ONLY the raw English prompt.';
    finalEnglishPrompt = await askGemini(`Create a photorealistic prompt for: ${rawText}`, enhancerSystem);
    finalEnglishPrompt = finalEnglishPrompt.replace(/[\r\n]+/g, ' ').trim();
  }

  const subjectReplacement = state.faceDescription || 'a stylish person';

  const cleanForUrl = finalEnglishPrompt
    .replace(/^Prompt:\s*/i, '')
    .split(/Negative prompt:/i)[0]
    .replace(/\[subject\]/gi, subjectReplacement)
    .replace(/a person \[.*?\]/gi, subjectReplacement)
    .replace(/\[.*?\]/g, subjectReplacement)
    .replace(/[^\w\s,.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 320);

  state.lastPrompt = finalEnglishPrompt;

  const seed = Math.floor(Math.random() * 1000000);
  const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(cleanForUrl)}?width=768&height=1024&seed=${seed}&nologo=true`;

  const imageAttachment = await createMaxImageAttachment(imageUrl);

  await ctx.reply(`✨ **Готово! Сгенерировано по промпту:**\n\n${cleanForUrl}`, {
    attachments: [
      imageAttachment,
      getAfterGenKeyboard()
    ]
  });
}

async function analyzeAndSendPrompts(ctx, imageUrl, customNote = '') {
  const userId = ctx.user?.user_id || ctx.chatId || 'default';
  const state = getUserData(userId);

  await ctx.reply('🔍 Анализирую свет, ракурс и детали кадра...');

  const imagePart = await downloadImageAsPart(imageUrl);
  const promptText = customNote
    ? `Создай промпт и негативный промпт по этому фото с учетом пожелания: ${customNote}. Отдели русские рекомендации маркером ===SPLIT===`
    : 'Проанализируй это фото и создай промпт + негативный промпт. Отдели русские рекомендации маркером ===SPLIT===';

  const answer = await askGemini([imagePart, promptText]);

  if (answer.includes('===SPLIT===')) {
    const parts = answer.split('===SPLIT===');
    const promptsBlock = parts[0].trim();
    const recommendations = parts[1].trim();

    state.lastPrompt = promptsBlock;

    if (promptsBlock) await ctx.reply(promptsBlock);
    if (recommendations) {
      await new Promise((r) => setTimeout(r, 500));
      await ctx.reply(recommendations + '\n\n👇 **Хочешь сразу создать это фото со своим лицом?**', {
        attachments: [getAfterPromptKeyboard()]
      });
    }
  } else {
    state.lastPrompt = answer;
    await ctx.reply(answer, { attachments: [getAfterPromptKeyboard()] });
  }
}

async function sendMainMenu(ctx) {
  const userId = ctx.user?.user_id || ctx.chatId || 'default';
  getUserData(userId).mode = 'upload_ref';

  await ctx.reply(
    '👋 Привет! Я **Eva AI** — твоя ИИ-фотостудия и генератор промптов.\n\nВыбери нужный режим кнопкой ниже:',
    { attachments: [getMainMenuKeyboard()] }
  );
}

bot.catch((err) => console.error('Ошибка MAX:', err));
bot.on('bot_started', sendMainMenu);

bot.action('main_menu', sendMainMenu);

bot.action('mode_upload', async (ctx) => {
  const userId = ctx.user?.user_id || ctx.chatId || 'default';
  getUserData(userId).mode = 'upload_ref';
  await ctx.reply('📸 **Шаг 1.** Отправь мне фото-пример (референс позы и света), который ты хочешь повторить!');
});

bot.action('ask_face_for_gen', async (ctx) => {
  const userId = ctx.user?.user_id || ctx.chatId || 'default';
  getUserData(userId).mode = 'wait_face_for_prompt';
  await ctx.reply('🤳 **Отправь мне своё селфи (фото лица)!**\n\nЯ считаю твои черты, вставлю их в промпт и сгенерирую фото.', {
    attachments: [getWaitFaceKeyboard()]
  });
});

bot.action('gen_without_face', async (ctx) => {
  const userId = ctx.user?.user_id || ctx.chatId || 'default';
  const state = getUserData(userId);
  state.faceDescription = null;
  if (!state.lastPrompt) return await sendMainMenu(ctx);
  try {
    await generatePhotoAndSend(ctx, state.lastPrompt, true);
  } catch (error) {
    await ctx.reply('Ошибка генерации: ' + error.message);
  }
});

bot.action('regen_same', async (ctx) => {
  const userId = ctx.user?.user_id || ctx.chatId || 'default';
  const state = getUserData(userId);
  if (!state.lastPrompt) return await sendMainMenu(ctx);
  try {
    await generatePhotoAndSend(ctx, state.lastPrompt, true);
  } catch (error) {
    await ctx.reply('Ошибка генерации: ' + error.message);
  }
});

bot.action('mode_generate', async (ctx) => {
  const userId = ctx.user?.user_id || ctx.chatId || 'default';
  getUserData(userId).mode = 'generate_text';
  await ctx.reply('🎨 **Режим генерации фото с нуля!**\n\nОтправь **своё селфи с подписью** желаемой сцены или просто напиши идею текстом!');
});

bot.action('mode_pinterest', async (ctx) => {
  try {
    await ctx.reply('✨ Ищу интересную идею для фотосессии в Pinterest...');
    const photo = await getRandomPinterestPhoto();
    const userId = ctx.user?.user_id || ctx.chatId || 'default';
    getUserData(userId).pinUrl = photo.url;

    const imgAttachment = await createMaxImageAttachment(photo.url);
    await ctx.reply('🔥 Как тебе такая идея для фотосессии?', {
      attachments: [imgAttachment, getPinterestKeyboard()]
    });
  } catch (error) {
    console.error('Ошибка Pinterest:', error);
    await ctx.reply('Не удалось загрузить картинку, нажми кнопку еще раз.', {
      attachments: [getPinterestKeyboard()]
    });
  }
});

bot.action('pin_select', async (ctx) => {
  const userId = ctx.user?.user_id || ctx.chatId || 'default';
  const savedUrl = getUserData(userId).pinUrl;
  if (!savedUrl) return await ctx.reply('Нажми «Другой вариант»!', { attachments: [getPinterestKeyboard()] });
  try {
    await analyzeAndSendPrompts(ctx, savedUrl);
  } catch (error) {
    await ctx.reply('Ошибка: ' + error.message);
  }
});

bot.on('message_created', async (ctx) => {
  const body = ctx.message?.body;
  const userText = body?.text || '';
  const attachments = body?.attachments || [];
  const userId = ctx.user?.user_id || ctx.chatId || 'default';
  const state = getUserData(userId);

  if (userText.startsWith('/start') || userText.toLowerCase() === 'меню') {
    return await sendMainMenu(ctx);
  }

  const imageAttachment = attachments.find(
    (att) => att.type === 'image' || att.type === 'photo' || att.payload?.url
  );

  if (!imageAttachment && !userText) return;

  try {
    if (imageAttachment) {
      const imageUrl = imageAttachment.payload?.url || imageAttachment.url;
      if (!imageUrl) return await ctx.reply('Не удалось получить ссылку на фото.');

      if (state.mode === 'wait_face_for_prompt' && state.lastPrompt) {
        await ctx.reply('🤳 Анализирую черты твоего лица по селфи...');
        state.faceDescription = await extractFaceFeatures(imageUrl);
        state.mode = 'upload_ref';
        await generatePhotoAndSend(ctx, state.lastPrompt, true);
        return;
      }

      if (state.mode === 'generate_text') {
        await ctx.reply('🤳 Считываю черты твоего лица...');
        state.faceDescription = await extractFaceFeatures(imageUrl);
        const sceneIdea = userText || 'cinematic studio portrait photography, moody lighting';
        await generatePhotoAndSend(ctx, sceneIdea, false);
        return;
      }

      await analyzeAndSendPrompts(ctx, imageUrl, userText);
      return;
    }

    if (state.mode === 'generate_text') {
      await generatePhotoAndSend(ctx, userText, false);
      return;
    }

    await sendMainMenu(ctx);
  } catch (error) {
    console.error('Ошибка обработки:', error);
    await ctx.reply('Ошибка: ' + error.message);
  }
});

bot.start();
console.log('Облачный бот на Render запущен!');
