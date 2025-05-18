const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const { promisify } = require('util');
const exec = promisify(require('child_process').exec);
const config = require('../config/config');


ffmpeg.setFfmpegPath(config.ffmpeg.ffmpegPath);
ffmpeg.setFfprobePath(config.ffmpeg.ffprobePath);


async function getVideoInfo(videoPath) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(videoPath)) {
      return reject(new Error('Видос не найден, куда дел?'));
    }
    
    
    const runManualFfprobe = () => {
      exec(`"${config.ffmpeg.ffprobePath}" -v error -show_format -show_streams -print_format json "${videoPath}"`)
        .then(({ stdout }) => {
          try {
            const metadata = JSON.parse(stdout);
            const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
            const audioStream = metadata.streams.find(stream => stream.codec_type === 'audio');
            
            if (!videoStream) {
              return reject(new Error('В файле нет видео, чё ты мне подсунул?'));
            }
            
            const info = {
              duration: parseFloat(metadata.format.duration || 0),
              width: videoStream.width,
              height: videoStream.height,
              fps: videoStream.r_frame_rate ? eval(videoStream.r_frame_rate) : 25,
              hasAudio: !!audioStream
            };
            
            resolve(info);
          } catch (parseErr) {
            reject(parseErr);
          }
        })
        .catch(error => {
          reject(error);
        });
    };
    
    
    try {
      ffmpeg.ffprobe(videoPath, (err, metadata) => {
        if (err) {
          
          return runManualFfprobe();
        }
        
        try {
          const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
          const audioStream = metadata.streams.find(stream => stream.codec_type === 'audio');
          
          if (!videoStream) {
            return reject(new Error('Видео нет в файле, только звук чтоли?'));
          }
          
          const info = {
            duration: parseFloat(metadata.format.duration || 0),
            width: videoStream.width,
            height: videoStream.height,
            fps: videoStream.r_frame_rate ? eval(videoStream.r_frame_rate) : 25,
            hasAudio: !!audioStream
          };
          
          resolve(info);
        } catch (parseErr) {
          
          runManualFfprobe();
        }
      });
    } catch (ffprobeErr) {
      
      runManualFfprobe();
    }
  });
}


async function createThumbnail(videoPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .screenshots({
        count: 1,
        folder: path.dirname(outputPath),
        filename: path.basename(outputPath),
        size: '640x360'
      })
      .on('end', () => {
        resolve(outputPath);
      })
      .on('error', (err) => {
        reject(err);
      });
  });
}


async function addAudioToVideo(videoPath, audioPath, outputPath, videoDuration) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .input(audioPath)
      
      .complexFilter([
        `[1:a]aloop=loop=-1:size=2e+09[loopedaudio]`,
        `[loopedaudio]atrim=0:${videoDuration}[audiocut]`,
        `[0:a][audiocut]amix=inputs=2:duration=longest:dropout_transition=2:weights=0.1 1[audioout]`
      ])
      .map('[audioout]')
      .videoCodec('copy')
      .audioCodec('aac')
      .audioBitrate('192k')
      .output(outputPath)
      .on('end', () => {
        resolve(outputPath);
      })
      .on('error', (err) => {
        reject(err);
      })
      .run();
  });
}

module.exports = {
  getVideoInfo,
  createThumbnail,
  addAudioToVideo
}; 