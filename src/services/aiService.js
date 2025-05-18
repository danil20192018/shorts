const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('../config/config');


function initGeminiClient() {
  if (!config.geminiApiKey) {
    throw new Error('API ключ Gemini не настроен. Пожалуйста, укажите GEMINI_API_KEY в .env файле.');
  }
  
  return new GoogleGenerativeAI(config.geminiApiKey);
}


async function selectMusicForVideo(videoDescription, musicFiles) {
  try {
    const genAI = initGeminiClient();
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    
    if (!musicFiles || musicFiles.length === 0) {
      throw new Error('Список музыкальных файлов пуст');
    }
    
    const musicNames = musicFiles.map(file => file.name);
    
    const prompt = `
      Выбери наиболее подходящую музыку для видео с такой тематикой: "${videoDescription}".
      
      Доступные музыкальные композиции:
      ${musicNames.join(', ')}
      
      Ответь только названием выбранной композиции, без дополнительного текста и объяснений.
    `;
    
    
    console.log('\n======= ЗАПРОС К GEMINI AI =======');
    console.log('Описание видео:', videoDescription);
    console.log('Доступные музыкальные файлы:', musicNames.join(', '));
    console.log('================================\n');
    
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text().trim();
    
    
    console.log('\n======= ОТВЕТ ОТ GEMINI AI =======');
    console.log('Выбранная композиция:', text);
    console.log('=================================\n');
    
    
    const selectedMusic = musicFiles.find(file => 
      file.name.toLowerCase() === text.toLowerCase() ||
      text.toLowerCase().includes(file.name.toLowerCase())
    );
    
    if (!selectedMusic) {
      
      console.log('Не удалось найти точное соответствие. Используется первый файл из списка:', musicFiles[0].filename);
      return musicFiles[0].filename;
    }
    
    return selectedMusic.filename;
  } catch (error) {
    console.error('Ошибка при работе с Gemini AI:', error.message);
    throw new Error(`Ошибка при выборе музыки с помощью AI: ${error.message}`);
  }
}


function fallbackMusicSelection(videoDescription, musicFiles) {
  if (!musicFiles || musicFiles.length === 0) {
    throw new Error('Список музыкальных файлов пуст');
  }
  
  console.log('\n======= ЗАПАСНОЙ МЕТОД ВЫБОРА МУЗЫКИ =======');
  console.log('Описание видео:', videoDescription);
  console.log('Доступные музыкальные файлы:', musicFiles.map(file => file.name).join(', '));
  
  
  const keywordMap = {
    'epic': ['эпичн', 'битва', 'сражени', 'драк', 'бой', 'героич'],
    'sad': ['грустн', 'печаль', 'меланхол', 'тоск', 'уныл'],
    'happy': ['весел', 'радост', 'счастлив', 'позитив', 'праздни'],
    'nature': ['природ', 'пейзаж', 'лес', 'гор', 'море', 'река'],
    'action': ['экшен', 'бег', 'гонк', 'скорост', 'адреналин'],
    'romantic': ['романти', 'любов', 'нежн', 'свидани'],
    'mysterious': ['загадоч', 'тайн', 'мистик', 'страшн', 'ужас'],
    'documentary': ['документ', 'истори', 'научн', 'познават'],
  };
  
  
  const normalizedDesc = videoDescription.toLowerCase();
  
  
  let bestMatch = null;
  let maxMatches = -1;
  
  for (const [category, keywords] of Object.entries(keywordMap)) {
    let matches = 0;
    for (const keyword of keywords) {
      if (normalizedDesc.includes(keyword)) {
        matches++;
      }
    }
    
    if (matches > maxMatches) {
      maxMatches = matches;
      bestMatch = category;
    }
  }
  
  console.log('Наилучшая категория:', bestMatch || 'не найдена', 'с', maxMatches, 'совпадениями');
  
  
  if (bestMatch && maxMatches > 0) {
    for (const file of musicFiles) {
      if (file.name.toLowerCase().includes(bestMatch)) {
        console.log('Выбран файл на основе категории:', file.filename);
        return file.filename;
      }
    }
  }
  
  
  console.log('Не найдено подходящей музыки, используется первый файл:', musicFiles[0].filename);
  console.log('===========================================\n');
  return musicFiles[0].filename;
}


async function generateContentStrategy(videoDescription) {
  try {
    const genAI = initGeminiClient();
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    
    const prompt = `
      На основе этого описания YouTube Shorts видео: "${videoDescription}" создай:
      
      1. Список из 10 наиболее релевантных хэштегов для YouTube, которые помогут продвинуть видео.
      2. Краткий контент-план из 5 идей для будущих видео, связанных с этой темой.
      
      Формат ответа должен быть строго в JSON:
      {
        "hashtags": ["#хэштег1", "#хэштег2", ...],
        "contentPlan": [
          {
            "title": "Название идеи",
            "description": "Краткое описание идеи в 1-2 предложения"
          },
          ...
        ]
      }
      
      Важно: хэштеги должны быть на русском или английском языке в зависимости от контекста описания, популярными и релевантными для YouTube и TikTok.
    `;
    
    
    console.log('\n======= ЗАПРОС К GEMINI AI (КОНТЕНТ-СТРАТЕГИЯ) =======');
    console.log('Описание видео:', videoDescription);
    console.log('============================================\n');
    
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text().trim();
    
    try {
      
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('Не удалось извлечь JSON из ответа');
      }
      
      const jsonData = JSON.parse(jsonMatch[0]);
      
      
      if (!jsonData.hashtags || !Array.isArray(jsonData.hashtags)) {
        jsonData.hashtags = generateFallbackHashtags(videoDescription);
      }
      
      if (!jsonData.contentPlan || !Array.isArray(jsonData.contentPlan)) {
        jsonData.contentPlan = generateFallbackContentPlan();
      }
      
      
      console.log('\n======= ОТВЕТ ОТ GEMINI AI (КОНТЕНТ-СТРАТЕГИЯ) =======');
      console.log('Хэштеги:', jsonData.hashtags);
      console.log('Контент-план:', jsonData.contentPlan.map(item => item.title).join(', '));
      console.log('================================================\n');
      
      return {
        hashtags: jsonData.hashtags.slice(0, 15), 
        contentPlan: jsonData.contentPlan.slice(0, 5) 
      };
    } catch (parseError) {
      console.error('Ошибка при парсинге ответа AI:', parseError);
      
      return {
        hashtags: generateFallbackHashtags(videoDescription),
        contentPlan: generateFallbackContentPlan()
      };
    }
  } catch (error) {
    console.error('Ошибка при работе с Gemini AI (контент-стратегия):', error.message);
    
    return {
      hashtags: generateFallbackHashtags(videoDescription),
      contentPlan: generateFallbackContentPlan()
    };
  }
}


function generateFallbackHashtags(description) {
  
  const keywords = extractKeywords(description);
  
  
  const commonHashtags = ['#shorts', '#youtubeshorts', '#viral'];
  
  
  const keywordHashtags = keywords.map(word => `#${word}`);
  
  
  return [...commonHashtags, ...keywordHashtags].slice(0, 10);
}


function extractKeywords(description) {
  
  const words = description.toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .split(/\s+/)
    .filter(word => word.length > 3);
  
  
  const stopWords = ['этот', 'того', 'также', 'только', 'более', 'менее', 'очень', 'может', 'быть', 'такой'];
  
  
  const uniqueWords = [...new Set(words)].filter(word => !stopWords.includes(word));
  
  
  return uniqueWords.slice(0, 10);
}


function generateFallbackContentPlan() {
  return [
    {
      title: 'Серия похожих видео',
      description: 'Создайте серию коротких видео на ту же тему, чтобы поддерживать интерес аудитории.'
    },
    {
      title: 'Ответы на комментарии',
      description: 'Создайте видео, в котором отвечаете на самые интересные комментарии к предыдущим роликам.'
    },
    {
      title: 'Закулисье процесса',
      description: 'Покажите, как создается контент, что происходит за кадром.'
    },
    {
      title: 'Сотрудничество с другими креаторами',
      description: 'Найдите других авторов в вашей нише и создайте совместный контент.'
    },
    {
      title: 'Тренды и челленджи',
      description: 'Адаптируйте популярные тренды и челленджи под вашу тематику для повышения охватов.'
    }
  ];
}

module.exports = {
  selectMusicForVideo,
  fallbackMusicSelection,
  generateContentStrategy
}; 