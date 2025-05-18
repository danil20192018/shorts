const fs = require('fs').promises;
const path = require('path');
const config = require('../config/config');


async function getMusicFiles(musicDir) {
  try {
    
    try {
      await fs.access(musicDir);
    } catch (err) {
      
      await fs.mkdir(musicDir, { recursive: true });
      console.log(`Создал папку для музыки: ${musicDir}`);
      return [];
    }

    
    const files = await fs.readdir(musicDir);
    console.log(`Нашел ${files.length} файлов в папке музыки`);
    
    
    const audioExtensions = ['.mp3', '.wav', '.ogg', '.m4a', '.aac'];
    const musicFiles = files
      .filter(file => {
        const ext = path.extname(file).toLowerCase();
        return audioExtensions.includes(ext);
      })
      .map(filename => {
        const name = path.basename(filename, path.extname(filename));
        return {
          filename,
          path: path.join(musicDir, filename),
          name: name.replace(/_/g, ' ')
        };
      });
    
    console.log(`Нашел ${musicFiles.length} песен и музыки`);
    return musicFiles;
  } catch (error) {
    console.error('Блин, не смог достать музыку из папки:', error);
    return [];
  }
}


async function ensureDirectoryExists(directory) {
  try {
    try {
      await fs.access(directory);
    } catch (err) {
      await fs.mkdir(directory, { recursive: true });
      console.log(`Создал папку: ${directory}`);
    }
    return true;
  } catch (error) {
    console.error(`Не смог создать папку ${directory}:`, error);
    return false;
  }
}


async function getMusicFileByName(filename) {
  try {
    const musicFiles = await getMusicFiles(config.paths.music);
    return musicFiles.find(file => 
      file.filename === filename || 
      file.name === filename
    ) || null;
  } catch (error) {
    throw new Error(`Не могу найти музыку: ${error.message}`);
  }
}

module.exports = {
  getMusicFiles,
  ensureDirectoryExists,
  getMusicFileByName
}; 