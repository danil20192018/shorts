const path = require('path');
require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3000,
  geminiApiKey: process.env.GEMINI_API_KEY || 'AIzaSyDwj5hptxM9h-MTqX_0D0rYp2hzobaMsTU',
  paths: {
    uploads: path.join(__dirname, '../../uploads'),
    clips: path.join(__dirname, '../../clips'),
    music: path.join(__dirname, '../../music'),
    public: path.join(__dirname, '../../public')
  }
};