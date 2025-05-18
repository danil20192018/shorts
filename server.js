const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static').path;
const { promisify } = require('util');
const exec = promisify(require('child_process').exec);
const speech = require('@google-cloud/speech');
const util = require('fluent-ffmpeg-util');


if (!fs.existsSync(ffmpegPath)) {
} else {
}

if (!fs.existsSync(ffprobePath)) {
} else {
}


ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

const app = express();
const port = process.env.PORT || 3000;


app.use(express.json());


app.use(express.static(path.join(__dirname, 'public')));
app.use('/clips', express.static(path.join(__dirname, 'clips')));


const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'uploads');
    
    if (!fs.existsSync(uploadDir)) {
      try {
        fs.mkdirSync(uploadDir, { recursive: true });
      } catch (err) {
      }
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    
    const safeName = Date.now() + path.extname(file.originalname).replace(/\s+/g, '_');
    cb(null, safeName);
  }
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    
    if (file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Только видеофайлы!'), false);
    }
  },
  limits: {
    fileSize: 100 * 1024 * 1024 
  }
});


app.post('/upload', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Эй! А где файл? Ты ничего не загрузил!' });
    }

    const videoPath = req.file.path;
    
    
    if (!fs.existsSync(videoPath)) {
      return res.status(500).json({ error: 'Блин, не могу найти файл! Куда он делся?' });
    }

    const outputDir = path.join(__dirname, 'clips');
    const sessionId = Date.now().toString();
    const clipsDir = path.join(outputDir, sessionId);
    
    
    if (!fs.existsSync(clipsDir)) {
      try {
        fs.mkdirSync(clipsDir, { recursive: true });
      } catch (err) {
        return res.status(500).json({ error: 'Не могу создать папку для клипов, чё за жесть', details: err.message });
      }
    }

    
    try {
      const clips = await analyzeAndCutVideo(videoPath, clipsDir, sessionId);
      
      
      res.json({
        success: true,
        sessionId: sessionId,
        clips: clips
      });
    } catch (error) {
      
      
      let errorMessage = 'Чё-то пошло не так с видосом';
      
      if (error.message && error.message.includes('ffprobe')) {
        errorMessage = 'ФФпроба глючит! Походу видос какой-то левый формат';
      } else if (error.message && error.message.includes('ffmpeg')) {
        errorMessage = 'ФФмпег сломался! Видос наверно какой-то стрёмный';
      } else if (error.message && error.message.includes('permission')) {
        errorMessage = 'Комп не даёт права доступа! Чё за фигня?';
      }
      
      
      try {
        fs.unlinkSync(videoPath);
      } catch (unlinkErr) {
      }
      
      res.status(500).json({ 
        error: errorMessage, 
        details: error.message,
        stack: error.stack 
      });
    }
  } catch (error) {
    res.status(500).json({ error: 'Вообще чё-то странное случилось', details: error.message });
  }
});

async function analyzeAndCutVideo(videoPath, outputDir, sessionId) {
  try {
    
    const videoInfo = await getVideoInfo(videoPath);

    
    const hasAudio = videoInfo.hasAudio;
    let loudMoments = [];
    
    if (hasAudio) {
      
      loudMoments = await findLoudMoments(videoPath);
    } else {
    }
    
    
    const sceneChanges = await detectSceneChanges(videoPath);
    
    
    const interestingMoments = combineInterestingMoments(loudMoments, sceneChanges, videoInfo.duration);
    
    if (interestingMoments.length === 0) {
      
      const basicClip = {
        start: 0,
        end: Math.min(10, videoInfo.duration) 
      };
      return await cutVideoIntoClips(videoPath, [basicClip], outputDir, sessionId);
    }
    
    
    const clips = await cutVideoIntoClips(videoPath, interestingMoments, outputDir, sessionId);
    
    return clips;
  } catch (error) {
    throw error;
  }
}


function getVideoInfo(videoPath) {
  return new Promise((resolve, reject) => {
    
    if (!fs.existsSync(videoPath)) {
      return reject(new Error('Видеофайл не найден'));
    }
    
    
    const runManualFfprobe = () => {
      exec(`"${ffprobePath}" -v error -show_format -show_streams -print_format json "${videoPath}"`)
        .then(({ stdout }) => {
          try {
            const metadata = JSON.parse(stdout);
            const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
            const audioStream = metadata.streams.find(stream => stream.codec_type === 'audio');
            
            if (!videoStream) {
              return reject(new Error('Видеопоток не найден в файле'));
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
            return reject(new Error('Видеопоток не найден в файле'));
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


async function findLoudMoments(videoPath) {
  try {
    const outputDir = path.dirname(videoPath);
    const outputFile = path.join(outputDir, 'audio_analysis.txt');
    
    try {
      
      const { stdout, stderr } = await exec(`"${ffmpegPath}" -hide_banner -i "${videoPath}" -af "loudnorm=print_format=json" -f null - 2>&1`);
    } catch (execErr) {
      
      if (execErr.stderr && !execErr.stderr.includes('Error')) {
      } else {
      }
    }
    
    
    try {
      const cmd = `"${ffmpegPath}" -hide_banner -i "${videoPath}" -filter_complex "ebur128=metadata=1:peak=true" -f null - 2> "${outputFile}"`;
      await exec(cmd);
    } catch (execErr) {
    }
    
    
    if (!fs.existsSync(outputFile)) {
      return []; 
    }
    
    
    const analysisData = fs.readFileSync(outputFile, 'utf-8');
    
    
    const loudnessMatches = analysisData.match(/M:\s*(-?\d+\.\d+)/g) || [];
    
    const loudnessMoments = [];
    
    let timeCode = 0;
    const sampleInterval = 0.4; 
    
    for (let i = 0; i < loudnessMatches.length; i++) {
      const loudness = parseFloat(loudnessMatches[i].split(':')[1]);
      
      
      
      const loudnessThreshold = loudnessMatches.length < 10 ? -20 : -15;
      
      if (loudness > loudnessThreshold) {
        loudnessMoments.push({
          start: Math.max(0, timeCode - 2), 
          end: timeCode + 3 
        });
      }
      
      timeCode += sampleInterval;
    }
    
    
    const merged = mergeMoments(loudnessMoments);
    
    
    try {
      fs.unlinkSync(outputFile);
    } catch (unlinkErr) {
    }
    
    return merged;
  } catch (error) {
    return [];
  }
}


async function detectSceneChanges(videoPath) {
  try {
    const outputDir = path.dirname(videoPath);
    const outputFile = path.join(outputDir, 'scene_changes.txt');
    
    try {
      
      
      const cmd = `"${ffmpegPath}" -hide_banner -i "${videoPath}" -filter_complex "select=gt(scene\\,0.3),showinfo" -f null - 2> "${outputFile}"`;
      await exec(cmd);
    } catch (execErr) {
    }
    
    
    if (!fs.existsSync(outputFile)) {
      return []; 
    }
    
    
    const sceneData = fs.readFileSync(outputFile, 'utf-8');
    
    
    const sceneMatches = sceneData.match(/pts_time:(\d+\.\d+)/g) || [];
    
    const sceneChanges = [];
    
    for (const match of sceneMatches) {
      const time = parseFloat(match.split(':')[1]);
      sceneChanges.push({
        start: Math.max(0, time - 1), 
        end: time + 3 
      });
    }
    
    
    const merged = mergeMoments(sceneChanges);
    
    
    try {
      fs.unlinkSync(outputFile);
    } catch (unlinkErr) {
    }
    
    return merged;
  } catch (error) {
    return [];
  }
}


function mergeMoments(moments) {
  if (moments.length <= 1) return moments;
  
  
  moments.sort((a, b) => a.start - b.start);
  
  const merged = [moments[0]];
  
  for (let i = 1; i < moments.length; i++) {
    const current = moments[i];
    const previous = merged[merged.length - 1];
    
    
    if (current.start <= previous.end) {
      previous.end = Math.max(previous.end, current.end);
    } else {
      merged.push(current);
    }
  }
  
  return merged;
}


function combineInterestingMoments(loudMoments, sceneChanges, totalDuration) {
  
  const allMoments = [...loudMoments, ...sceneChanges];
  
  
  if (allMoments.length < 3) {
    const basicMoments = [];
    
    
    for (let i = 0; i < totalDuration; i += 30) {
      basicMoments.push({
        start: i,
        end: Math.min(i + 5, totalDuration)
      });
    }
    
    return mergeMoments(basicMoments);
  }
  
  
  const merged = mergeMoments(allMoments);
  return merged;
}


async function cutVideoIntoClips(videoPath, moments, outputDir, sessionId) {
  
  const maxClips = 10;
  if (moments.length > maxClips) {
    
    moments.sort((a, b) => (b.end - b.start) - (a.end - a.start));
    moments = moments.slice(0, maxClips);
  }

  const clipPromises = moments.map((moment, index) => {
    return new Promise((resolve, reject) => {
      const clipName = `clip_${index + 1}.mp4`;
      const clipPath = path.join(outputDir, clipName);
      const clipDuration = moment.end - moment.start;
      
      ffmpeg(videoPath)
        .setStartTime(moment.start)
        .setDuration(clipDuration)
        .output(clipPath)
        .outputOptions('-c copy') 
        .on('end', () => {
          resolve({
            id: index + 1,
            path: `/clips/${sessionId}/${clipName}`,
            start: moment.start,
            end: moment.end,
            duration: clipDuration
          });
        })
        .on('error', (err) => {
          
          ffmpeg(videoPath)
            .setStartTime(moment.start)
            .setDuration(clipDuration)
            .output(clipPath)
            
            .videoCodec('libx264')
            .videoBitrate('1000k')
            .audioCodec('aac')
            .audioBitrate('128k')
            .on('end', () => {
              resolve({
                id: index + 1,
                path: `/clips/${sessionId}/${clipName}`,
                start: moment.start,
                end: moment.end,
                duration: clipDuration
              });
            })
            .on('error', (recodeErr) => {
              
              reject(recodeErr);
            })
            .run();
        })
        .run();
    });
  });
  
  try {
    
    const results = await Promise.allSettled(clipPromises);
    
    
    const successfulClips = results
      .filter(result => result.status === 'fulfilled')
      .map(result => result.value);
    
    return successfulClips;
  } catch (error) {
    throw error;
  }
}


async function createYoutubeShorts(clips, videoPath, outputDir, sessionId, selectedMusicPath) {
  if (!clips || clips.length === 0) {
    throw new Error('Чё, серьёзно? Нет клипов! Чё мне монтировать-то?!');
  }
  
  try {
    
    const tmpDir = path.join(outputDir, 'tmp');
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
    
    
    const preparedClips = [];
    
    console.log(`Щас буду готовить эти ${clips.length} клипов, погнали...`);
    
    
    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      const clipPath = path.join(__dirname, 'clips', sessionId, `clip_${clip.id}.mp4`);
      
      if (!fs.existsSync(clipPath)) {
        console.log(`Блин, клипа ${clip.id} нету, проехали: ${clipPath}`);
        continue;
      }
      
      console.log(`Пашу над клипом ${i+1}/${clips.length}: ${path.basename(clipPath)}`);
      
      
      const subtitlesFile = await generateSubtitles(clipPath, tmpDir, i);
      
      
      const preparedClipPath = await prepareClipForShorts(clipPath, subtitlesFile, tmpDir, i);
      
      
      if (fs.existsSync(preparedClipPath)) {
        preparedClips.push({
          path: preparedClipPath,
          duration: clip.duration
        });
        console.log(`Клип ${i+1} готов, вышло круто: ${path.basename(preparedClipPath)}`);
      } else {
        console.log(`Ой, с клипом ${i+1} что-то пошло не так, файла нет: ${preparedClipPath}`);
      }
    }
    
    if (preparedClips.length === 0) {
      throw new Error('Вообще никакие клипы не получились, печалька(((');
    }
    
    console.log(`Норм, готово ${preparedClips.length} из ${clips.length} клипов, збс получилось`);
    
    
    const finalOutputPath = path.join(outputDir, 'youtube_shorts.mp4');
    
    
    const concatFile = path.join(tmpDir, 'concat.txt');
    const concatContent = preparedClips.map(clip => `file '${clip.path.replace(/\\/g, '/')}'`).join('\n');
    fs.writeFileSync(concatFile, concatContent);
    
    console.log(`Щас склею эти ${preparedClips.length} клипов в одно видосик...`);
    
    
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(concatFile)
        .inputOptions(['-f concat', '-safe 0'])
        .outputOptions(['-c copy'])
        .output(finalOutputPath)
        .on('start', (commandLine) => {
          console.log('Воу-воу, FFmpeg уже работает с клипами: ' + commandLine);
        })
        .on('end', () => {
          console.log('Йеее! Склеил все клипы: ' + path.basename(finalOutputPath));
          resolve(finalOutputPath);
        })
        .on('error', (err) => {
          console.error(`Блин, чёт не получилось склеить: ${err.message}`);
          reject(err);
        })
        .run();
    });

    
    if (!fs.existsSync(finalOutputPath)) {
      throw new Error('Чёт видос не получился, хз почему');
    }
    
    console.log(`Вау, видос готов: ${path.basename(finalOutputPath)}, весит: ${(fs.statSync(finalOutputPath).size / 1024 / 1024).toFixed(2)} МБ, норм так`);

    
    const textOutputPath = path.join(outputDir, 'text_transcript.txt');
    
    try {
      
      await transcribeVideoUsingFFmpeg(finalOutputPath, textOutputPath);
    } catch (transcribeError) {
      console.log(`Блин, текстовую расшифровку сделать не получилось: ${transcribeError.message}`);
      
      fs.writeFileSync(
        textOutputPath,
        'ОШИБКА ТРАНСКРИПЦИИ\n\nНе удалось создать транскрипцию для этого видео.\n\nПожалуйста, убедитесь, что ffmpeg правильно настроен.'
      );
    }
    
    
    let finalVideoPath = finalOutputPath;
    let musicApplied = false;
    
    if (selectedMusicPath && fs.existsSync(selectedMusicPath)) {
      console.log(`Щас бахнем музончик на фон: ${path.basename(selectedMusicPath)}`);
      try {
        
        const videoInfo = await getVideoInfo(finalOutputPath);
        const videoWithMusicPath = path.join(outputDir, 'youtube_shorts_with_music.mp4');
        
        
        await addAudioToVideo(finalOutputPath, selectedMusicPath, videoWithMusicPath, videoInfo.duration);
        
        
        if (fs.existsSync(videoWithMusicPath)) {
          console.log('Музычка на месте, звучит огонь!');
          finalVideoPath = videoWithMusicPath;
          musicApplied = true;
        } else {
          console.log('с музыкой не вышло. Ну и ладно!');
        }
      } catch (audioError) {
        console.log(`Блин, музыку не получилось прикрутить: ${audioError.message}`);
        
      }
    }
    
    
    console.log('Щас сделаю крутую превьюшку...');
    const thumbnailPath = path.join(outputDir, 'thumbnail.jpg');
    const thumbnailResult = await createThumbnail(finalVideoPath, thumbnailPath);
    
    
    const thumbnailUrlPath = thumbnailResult ? `/clips/${sessionId}/thumbnail.jpg` : null;
    
    console.log('УРААА! ВСЕ ГОТОВО! СМОТРИ КАКОЙ ШОРТС ЗАШИБИСЬ!');
    
    
    return {
      path: `/clips/${sessionId}/${path.basename(finalVideoPath)}`,
      thumbnail: thumbnailUrlPath,
      transcription: `/clips/${sessionId}/text_transcript.txt`,
      duration: preparedClips.reduce((total, clip) => total + clip.duration, 0),
      musicApplied: musicApplied
    };
  } catch (error) {
    console.error(`ОБЛОМ! НЕ ПОЛУЧАЕТСЯ СДЕЛАТЬ ШОРТ: ${error.message}`);
    throw error;
  }
}


async function transcribeVideoToText(videoPath, outputTextPath) {
  try {
    
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS || !fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
      throw new Error('Учетные данные Google Cloud Speech API не настроены');
    }
    
    
    const audioPath = videoPath.replace(/\.[^/.]+$/, '') + '_audio.wav';
    
    
    await new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .output(audioPath)
        .audioCodec('pcm_s16le')
        .audioChannels(1)
        .audioFrequency(16000)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });
    
    
    const audioBytes = fs.readFileSync(audioPath).toString('base64');
    
    
    const client = new speech.SpeechClient();
    
    
    const audio = {
      content: audioBytes,
    };
    const config = {
      encoding: 'LINEAR16',
      sampleRateHertz: 16000,
      languageCode: 'ru-RU', 
    };
    
    const request = {
      audio: audio,
      config: config,
    };
    
    
    const [response] = await client.recognize(request);
    
    
    let transcription = '';
    response.results.forEach(result => {
      transcription += result.alternatives[0].transcript + '\n';
    });
    
    
    fs.writeFileSync(outputTextPath, transcription);
    
    
    fs.unlinkSync(audioPath);
    
    return transcription;
  } catch (error) {
    
    fs.writeFileSync(
      outputTextPath, 
      `Ошибка при транскрипции видео: ${error.message}\nПожалуйста, убедитесь, что настроены учетные данные Google Cloud.`
    );
    
    return null;
  }
}


async function transcribeVideoUsingFFmpeg(videoPath, outputTextPath) {
  try {
    
    const audioPath = videoPath.replace(/\.[^/.]+$/, '') + '_audio.wav';
    const silenceInfoPath = videoPath.replace(/\.[^/.]+$/, '') + '_silence.txt';
    
    
    await new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .output(audioPath)
        .audioCodec('pcm_s16le')
        .audioChannels(1)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });
    
    
    await exec(`"${ffmpegPath}" -i "${audioPath}" -af "silencedetect=noise=-30dB:d=0.5" -f null - 2> "${silenceInfoPath}"`);
    
    
    const silenceData = fs.readFileSync(silenceInfoPath, 'utf-8');
    
    
    const segments = [];
    let startTime = 0;
    
    
    const silenceStartRegex = /silence_start: (\d+(\.\d+)?)/g;
    
    const silenceEndRegex = /silence_end: (\d+(\.\d+)?) \| silence_duration: (\d+(\.\d+)?)/g;
    
    let match;
    let lastEnd = 0;
    
    
    while ((match = silenceStartRegex.exec(silenceData)) !== null) {
      const silenceStart = parseFloat(match[1]);
      if (silenceStart > lastEnd) {
        segments.push({
          start: lastEnd,
          end: silenceStart,
          text: `Тут чё-то бормочут ${segments.length + 1}`
        });
      }
    }
    
    while ((match = silenceEndRegex.exec(silenceData)) !== null) {
      lastEnd = parseFloat(match[1]);
    }
    
    
    const totalDuration = await getAudioDuration(audioPath);
    if (lastEnd < totalDuration) {
      segments.push({
        start: lastEnd,
        end: totalDuration,
        text: `Тут опять кто-то говорит ${segments.length + 1}`
      });
    }
    
    
    const transcription = segments
      .map(segment => `[${formatTime(segment.start)} - ${formatTime(segment.end)}]: ${segment.text}`)
      .join('\n\n');
    
    
    const finalText = 
      'РАСШИФРОВКА ВИДОСА\n' +
      '=========================\n\n' +
      'Типа тут должны быть слова, но я не умею разбирать речь без Гугла, лол\n\n' +
      'Короч, вот где кто-то что-то говорит:\n\n' + 
      transcription;
    
    
    fs.writeFileSync(outputTextPath, finalText);
    
    
    fs.unlinkSync(audioPath);
    fs.unlinkSync(silenceInfoPath);
    
    return finalText;
  } catch (error) {
    
    fs.writeFileSync(
      outputTextPath, 
      `Блин, не получается расшифровать видос: ${error.message}\nПроверь настройки ffmpeg или забей.`
    );
    
    return null;
  }
}


async function getAudioDuration(audioPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(audioPath, (err, metadata) => {
      if (err) reject(err);
      else resolve(parseFloat(metadata.format.duration || 0));
    });
  });
}


function formatTime(timeInSeconds) {
  const hours = Math.floor(timeInSeconds / 3600);
  const minutes = Math.floor((timeInSeconds % 3600) / 60);
  const seconds = Math.floor(timeInSeconds % 60);
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}


async function generateSubtitles(videoPath, outputDir, index) {
  const subtitlesFile = path.join(outputDir, `subtitles_${index}.srt`);
  
  try {
    
    const videoInfo = await getVideoInfo(videoPath);
    const duration = videoInfo.duration;
    
    
    
    const subtitles = [
      {
        number: 1,
        start: formatSrtTime(0),
        end: formatSrtTime(Math.min(duration, 2)),
        text: 'Воу! Смотри чё!'
      },
      {
        number: 2,
        start: formatSrtTime(Math.min(duration, 2)),
        end: formatSrtTime(Math.min(duration, 4)),
        text: 'Это прям реально круто!'
      },
      {
        number: 3,
        start: formatSrtTime(Math.min(duration, 4)),
        end: formatSrtTime(duration),
        text: 'Лайк и подписка, бро!'
      }
    ];
    
    
    const srtContent = subtitles.map(sub => {
      return `${sub.number}\n${sub.start} --> ${sub.end}\n${sub.text}\n`;
    }).join('\n');
    
    
    fs.writeFileSync(subtitlesFile, srtContent);
    return subtitlesFile;
  } catch (error) {
    
    fs.writeFileSync(subtitlesFile, '');
    return subtitlesFile;
  }
}


function formatSrtTime(seconds) {
  const date = new Date(0);
  date.setSeconds(seconds);
  const timeStr = date.toISOString().substring(11, 19);
  const ms = Math.floor((seconds % 1) * 1000).toString().padStart(3, '0');
  return `${timeStr},${ms}`;
}


async function prepareClipForShorts(clipPath, subtitlesPath, outputDir, index) {
  const outputPath = path.join(outputDir, `shorts_clip_${index}.mp4`);
  
  
  const videoInfo = await getVideoInfo(clipPath);
  
  
  let filterComplex = '';
  const { width, height } = videoInfo;
  
  if (width / height > 9 / 16) {
    
    const newWidth = Math.floor(height * 9 / 16);
    const cropX = Math.floor((width - newWidth) / 2);
    filterComplex = `[0:v]crop=${newWidth}:${height}:${cropX}:0[cropped]`;
  } else if (width / height < 9 / 16) {
    
    const newHeight = Math.floor(width * 16 / 9);
    const padY = Math.floor((newHeight - height) / 2);
    filterComplex = `[0:v]pad=${width}:${newHeight}:0:${padY}:black[cropped]`;
  } else {
    
    filterComplex = `[0:v]copy[cropped]`;
  }
  
  
  filterComplex += `;[cropped]subtitles=${subtitlesPath.replace(/\\/g, '/').replace(/:/g, '\\:')}:force_style='FontSize=24,FontName=Arial,Alignment=2,BorderStyle=3,Outline=1,Shadow=1,MarginV=30'[withsubs]`;
  
  
  const stickerPath = path.join(__dirname, 'public', 'stickers', 'logo.png');
  if (fs.existsSync(stickerPath)) {
    filterComplex += `;[withsubs][1:v]overlay=W-w-10:10:enable='between(t,0,30)'[out]`;
  } else {
    filterComplex += `;[withsubs]copy[out]`;
  }
  
  return new Promise((resolve, reject) => {
    const ffmpegCmd = ffmpeg(clipPath);
    
    
    if (fs.existsSync(stickerPath)) {
      ffmpegCmd.input(stickerPath);
    }
    
    ffmpegCmd
      .videoCodec('libx264')
      .audioCodec('aac')
      .size('1080x1920') 
      .autopad()
      .duration(Math.min(30, videoInfo.duration)) 
      .complexFilter(filterComplex, 'out')
      .output(outputPath)
      .on('end', () => {
        resolve(outputPath);
      })
      .on('error', (err) => {
        
        ffmpeg(clipPath)
          .videoCodec('libx264')
          .audioCodec('aac')
          .size('1080x1920')
          .autopad()
          .duration(Math.min(30, videoInfo.duration))
          .output(outputPath)
          .on('end', () => {
            resolve(outputPath);
          })
          .on('error', (simpleErr) => {
            reject(simpleErr);
          })
          .run();
      })
      .run();
  });
}


async function createThumbnail(videoPath, outputPath) {
  return new Promise((resolve, reject) => {
    
    if (!fs.existsSync(videoPath)) {
      console.error(`Блин, не могу найти файл для превьюшки: ${videoPath}`);
      
      return resolve(null);
    }
    
    console.log(`Сейчас сделаю классную картинку из видоса: ${path.basename(videoPath)}`);
    
    
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        console.error(`Чёт не получается проверить файл для превьюшки: ${err.message}`);
        return resolve(null);
      }
      
      
      const videoStream = metadata.streams ? metadata.streams.find(stream => stream.codec_type === 'video') : null;
      if (!videoStream) {
        console.error(`В файле нет видео, чё за прикол: ${path.basename(videoPath)}`);
        return resolve(null);
      }
      
      
      ffmpeg(videoPath)
        .screenshots({
          count: 1,
          folder: path.dirname(outputPath),
          filename: path.basename(outputPath),
          size: '640x360'
        })
        .on('start', (commandLine) => {
          console.log('Комп работает над превьюшкой: ' + commandLine);
        })
        .on('end', () => {
          console.log(`Вау! Превьюшка гатова: ${path.basename(outputPath)}`);
          resolve(outputPath);
        })
        .on('error', (err) => {
          console.error(`Блин, не получилась превьюшка: ${err.message}`);
          
          resolve(null);
        });
    });
  });
}


async function addAudioToVideo(videoPath, audioPath, outputPath, videoDuration) {
  return new Promise((resolve, reject) => {
    
    if (!fs.existsSync(videoPath)) {
      console.error(`Ээээ, а где видос: ${videoPath}`);
      return reject(new Error(`Видос куда-то пропал: ${videoPath}`));
    }
    if (!fs.existsSync(audioPath)) {
      console.error(`Блин, где музыка: ${audioPath}`);
      return reject(new Error(`Музыка куда-то пропала: ${audioPath}`));
    }
    
    console.log(`Щас прикручу музяку ${path.basename(audioPath)} к видосу ${path.basename(videoPath)}`);
    console.log(`Путь видоса: ${videoPath}`);
    console.log(`Путь музыки: ${audioPath}`);
    console.log(`Куда сохраню: ${outputPath}`);
    console.log(`Видос идёт ${videoDuration} секунд`);
    
    try {
      ffmpeg(videoPath)
        .input(audioPath)
        .complexFilter([
          `[1:a]aloop=loop=-1:size=2e+09[loopedaudio]`,
          `[loopedaudio]atrim=0:${videoDuration}[audioout]`
        ])
        
        .outputOptions([
          '-map 0:v', 
          '-map [audioout]' 
        ])
        .videoCodec('copy') 
        .audioCodec('aac')
        .audioBitrate('192k')
        .output(outputPath)
        .on('start', (commandLine) => {
          console.log('FFmpeg делает свою магию: ' + commandLine);
        })
        .on('progress', (progress) => {
          const percent = progress.percent ? progress.percent.toFixed(1) : 'хз сколько';
          console.log(`Готово на ${percent}%, скоро будет огонь!`);
        })
        .on('end', () => {
          console.log(`Музон добавлен! Чекни файл: ${path.basename(outputPath)}`);
          
          if (fs.existsSync(outputPath)) {
            console.log(`Файлик готов, весит ${(fs.statSync(outputPath).size / 1024 / 1024).toFixed(2)} МБ, норм`);
            resolve(outputPath);
          } else {
            console.error(`Чё за фигня? Говорит готово, а файла нет: ${outputPath}`);
            reject(new Error('Файлик не появился, мистика какая-то'));
          }
        })
        .on('error', (err) => {
          console.error(`Не получается с музыкой: ${err.message}`);
          reject(err);
        })
        .run();
    } catch (err) {
      console.error(`Что-то пошло не так с FFmpeg: ${err.message}`);
      reject(err);
    }
  });
}


app.get('/api/status', (req, res) => {
  res.json({ 
    status: 'online',
    ffmpeg: fs.existsSync(ffmpegPath) ? 'available' : 'not found',
    uploads_dir: fs.existsSync(path.join(__dirname, 'uploads')) ? 'exists' : 'missing',
    clips_dir: fs.existsSync(path.join(__dirname, 'clips')) ? 'exists' : 'missing'
  });
});


app.post('/create-shorts', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Эй! А где файл? Загрузи видос!' });
    }

    const videoPath = req.file.path;
    
    
    const videoDescription = req.body.description || 'Какое-то рандомное видео без описания';
    
    console.log(`\n====== Новая заявка на шортс! ======`);
    console.log(`Видос: ${path.basename(videoPath)}`);
    console.log(`О чём: "${videoDescription}"`);
    
    
    if (!fs.existsSync(videoPath)) {
      return res.status(500).json({ error: 'Блин, не могу найти загруженный файл! Куда он делся?' });
    }

    const outputDir = path.join(__dirname, 'clips');
    const sessionId = Date.now().toString();
    const clipsDir = path.join(outputDir, sessionId);
    
    
    if (!fs.existsSync(clipsDir)) {
      try {
        fs.mkdirSync(clipsDir, { recursive: true });
      } catch (err) {
        return res.status(500).json({ 
          error: 'Не могу создать папку для клипов, комп глючит', 
          details: err.message 
        });
      }
    }

    
    try {
      console.log('Погнали резать видос...');
      const clips = await analyzeAndCutVideo(videoPath, clipsDir, sessionId);
      
      
      console.log('Ищу крутой трек для фона...');
      let selectedMusic = null;
      try {
        
        const musicDir = path.join(__dirname, 'music');
        const musicFiles = await fileUtils.getMusicFiles(musicDir);
        
        
        if (musicFiles && musicFiles.length > 0) {
          try {
            
            const selectedMusicFile = await aiService.selectMusicForVideo(videoDescription, musicFiles);
            selectedMusic = path.join(musicDir, selectedMusicFile);
          } catch (aiError) {
            console.log('ИИ тупит с выбором музыки:', aiError.message);
            
            const randomIndex = Math.floor(Math.random() * musicFiles.length);
            selectedMusic = path.join(musicDir, musicFiles[randomIndex].filename);
          }
        }
      } catch (musicError) {
        console.log('Не получается найти музыку, ну и ладно:', musicError.message);
      }
      
      
      console.log('Начинаю ваять шедевр...');
      const shortsResult = await createYoutubeShorts(clips, videoPath, clipsDir, sessionId, selectedMusic);
      
      
      console.log('Придумываю хэштеги и прочую фигню...');
      const contentStrategy = await aiService.generateContentStrategy(videoDescription);
      
      
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const fullVideoUrl = baseUrl + '/shorts/' + sessionId + '/' + path.basename(shortsResult.path);

      console.log('Делаю штуки для шаринга...');
      const qrCodePath = await shareService.generateQRCode(fullVideoUrl, sessionId);
      const shortUrlResult = await shareService.createShortUrl(fullVideoUrl);
      const shareLinks = shareService.generateShareLinks(shortUrlResult.shortUrl);
      
      const clipsWithUrls = clips.map(clip => ({
        ...clip,
        path: `/clips/${sessionId}/${path.basename(clip.path)}`
      }));
      
      
      res.json({
        success: true,
        sessionId: sessionId,
        clips: clipsWithUrls,
        shorts: shortsResult,
        contentStrategy: contentStrategy,
        qrCode: qrCodePath,
        shortUrl: shortUrlResult.shortUrl,
        originalUrl: fullVideoUrl,
        shareLinks
      });
      
      
      try {
        fs.unlinkSync(videoPath);
      } catch (unlinkErr) {
        console.log('Не смог удалить исходник, ну и фиг с ним:', unlinkErr.message);
      }
    } catch (error) {
      console.error('Всё пошло наперекосяк:', error);
      
      
      let errorMessage = 'Шортс создать не получилось';
      
      if (error.message && error.message.includes('ffprobe')) {
        errorMessage = 'ФФпроб сломался! Видос какой-то левый';
      } else if (error.message && error.message.includes('ffmpeg')) {
        errorMessage = 'ФФмпег глючит! Формат видоса стремный наверно';
      } else if (error.message && error.message.includes('permission')) {
        errorMessage = 'Комп не даёт доступ к файлам, вредничает';
      }
      
      
      try {
        fs.unlinkSync(videoPath);
      } catch (unlinkErr) {
        console.log('Не смог удалить видос:', unlinkErr.message);
      }
      
      res.status(500).json({ 
        error: errorMessage, 
        details: error.message,
        stack: process.env.NODE_ENV === 'production' ? undefined : error.stack
      });
    }
  } catch (error) {
    console.error('Ваще непонятка какая-то:', error);
    res.status(500).json({ error: 'Что-то пошло совсем не так', details: error.message });
  }
});


const aiService = require('./src/services/aiService');


const shareService = require('./src/services/shareService');


const fileUtils = require('./src/utils/fileUtils');


app.post('/generate-content-strategy', async (req, res) => {
  try {
    const { description } = req.body;
    
    if (!description) {
      return res.status(400).json({ error: 'Отсутствует описание видео' });
    }
    
    
    const result = await aiService.generateContentStrategy(description);
    
    res.json(result);
  } catch (error) {
    console.error('Ошибка при генерации контент-стратегии:', error);
    res.status(500).json({ 
      error: 'Ошибка при генерации контент-стратегии',
      details: error.message
    });
  }
});


app.post('/generate-share-links', async (req, res) => {
  try {
    const { videoUrl, sessionId, baseUrl } = req.body;
    
    if (!videoUrl || !sessionId) {
      return res.status(400).json({ error: 'Отсутствуют необходимые параметры' });
    }
    
    
    const fullVideoUrl = videoUrl.startsWith('http') ? videoUrl : `${baseUrl || ''}${videoUrl}`;
    
    
    const qrCodePath = await shareService.generateQRCode(fullVideoUrl, sessionId);
    
    
    const shortUrlResult = await shareService.createShortUrl(fullVideoUrl);
    
    
    const shareLinks = shareService.generateShareLinks(shortUrlResult.shortUrl);
    
    
    res.json({
      success: true,
      qrCode: qrCodePath,
      shortUrl: shortUrlResult.shortUrl,
      originalUrl: fullVideoUrl,
      shareLinks
    });
  } catch (error) {
    console.error('Ошибка при генерации материалов для шаринга:', error);
    res.status(500).json({ 
      error: 'Ошибка при генерации материалов для шаринга',
      details: error.message
    });
  }
});


app.get('/s/:shortId', (req, res) => {
  try {
    const { shortId } = req.params;
    
    
    const originalUrl = shareService.resolveShortUrl(shortId);
    
    if (!originalUrl) {
      return res.status(404).send('Ссылка не найдена или устарела');
    }
    
    
    res.redirect(originalUrl);
  } catch (error) {
    console.error('Ошибка при разрешении короткой ссылки:', error);
    res.status(500).send('Ошибка при обработке запроса');
  }
});

app.listen(port, () => {
  
  const dirs = ['uploads', 'clips'];
  dirs.forEach(dir => {
    const dirPath = path.join(__dirname, dir);
    if (!fs.existsSync(dirPath)) {
      try {
        fs.mkdirSync(dirPath, { recursive: true });
      } catch (err) {
      }
    }
  });
}); 