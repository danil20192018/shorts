const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const { nanoid } = require('nanoid');
const config = require('../config/config');


const urlStorage = new Map();


async function generateQRCode(videoUrl, sessionId) {
  try {
    
    const qrDir = path.join(config.paths.clips, sessionId);
    if (!fs.existsSync(qrDir)) {
      fs.mkdirSync(qrDir, { recursive: true });
    }

    
    const qrCodePath = path.join(qrDir, 'qr_code.png');
    
    
    await QRCode.toFile(qrCodePath, videoUrl, {
      color: {
        dark: '#6366f1', 
        light: '#ffffff' 
      },
      width: 300,
      margin: 1
    });
    
    console.log(`QR-код готов: ${qrCodePath}`);
    
    
    return `/clips/${sessionId}/qr_code.png`;
  } catch (error) {
    console.error('Блин, не смог сделать QR-код:', error);
    throw error;
  }
}


function generateShareLinks(videoUrl) {
  const encodedUrl = encodeURIComponent(videoUrl);
  
  return {
    
    telegram: `https://t.me/share/url?url=${encodedUrl}`,
    whatsapp: `https://wa.me/?text=${encodedUrl}`,
    viber: `viber://forward?text=${encodedUrl}`,
    
    
    vk: `https://vk.com/share.php?url=${encodedUrl}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
    twitter: `https://twitter.com/intent/tweet?url=${encodedUrl}`,
    
    
    email: `mailto:?subject=Смотри%20мое%20видео&body=${encodedUrl}`
  };
}


async function createShortUrl(originalUrl) {
  try {
    
    for (const [shortId, url] of urlStorage.entries()) {
      if (url === originalUrl) {
        console.log(`О, уже есть короткая ссылка: ${shortId} для ${originalUrl}`);
        return {
          success: true,
          originalUrl,
          shortUrl: '/s/' + shortId,
        };
      }
    }

    
    const shortId = nanoid(8); 
    
    
    urlStorage.set(shortId, originalUrl);
    
    
    const shortUrl = '/s/' + shortId;
      
    console.log(`Короткая ссылка готова: ${shortUrl} для ${originalUrl}`);
    
    return {
      success: true,
      originalUrl,
      shortUrl
    };
  } catch (error) {
    console.error('Блин, не получилось сделать короткую ссылку:', error);
    return {
      success: false,
      originalUrl,
      shortUrl: originalUrl
    };
  }
}


function resolveShortUrl(shortId) {
  if (urlStorage.has(shortId)) {
    return urlStorage.get(shortId);
  }
  return null;
}

module.exports = {
  generateQRCode,
  generateShareLinks,
  createShortUrl,
  resolveShortUrl
}; 