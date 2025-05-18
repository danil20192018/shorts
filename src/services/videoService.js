const fs = require('fs-extra');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const { promisify } = require('util');
const exec = promisify(require('child_process').exec);
const config = require('../config/config');
const { ensureDirectoryExists } = require('../utils/fileUtils');
const { getVideoInfo, createThumbnail, addAudioToVideo } = require('../utils/ffmpegUtils');


async function analyzeAndCutVideo(videoPath, clipsDir, sessionId) {
  try {
    
    const videoInfo = await getVideoInfo(videoPath);

    
    const hasAudio = videoInfo.hasAudio;
    let loudMoments = [];
    
    if (hasAudio) {
      
      loudMoments = await findLoudMoments(videoPath);
    }
    
    
    const sceneChanges = await detectSceneChanges(videoPath);
    
    
    const interestingMoments = combineInterestingMoments(loudMoments, sceneChanges, videoInfo.duration);
    
    if (interestingMoments.length === 0) {
      
      const basicClip = {
        start: 0,
        end: Math.min(10, videoInfo.duration) 
      };
      return await cutVideoIntoClips(videoPath, [basicClip], clipsDir, sessionId);
    }
    
    
    const clips = await cutVideoIntoClips(videoPath, interestingMoments, clipsDir, sessionId);
    
    return clips;
  } catch (error) {
    throw error;
  }
}


async function findLoudMoments(videoPath) {
  try {
    const outputDir = path.dirname(videoPath);
    const outputFile = path.join(outputDir, 'audio_analysis.txt');
    
    try {
      
      await exec(`"${config.ffmpeg.ffmpegPath}" -hide_banner -i "${videoPath}" -af "loudnorm=print_format=json" -f null - 2>&1`);
    } catch (execErr) {
      
    }
    
    
    try {
      const cmd = `"${config.ffmpeg.ffmpegPath}" -hide_banner -i "${videoPath}" -filter_complex "ebur128=metadata=1:peak=true" -f null - 2> "${outputFile}"`;
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
      
      const cmd = `"${config.ffmpeg.ffmpegPath}" -hide_banner -i "${videoPath}" -filter_complex "select=gt(scene\\,0.3),showinfo" -f null - 2> "${outputFile}"`;
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


async function createYoutubeShorts(clips, videoPath, outputDir, sessionId, musicFilePath = null) {
  if (!clips || clips.length === 0) {
    throw new Error('Чё монтировать-то? Клипов нет!');
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
      const clipPath = path.join(path.dirname(outputDir), 'clips', sessionId, `clip_${clip.id}.mp4`);
      
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
        console.log(`Блин, с клипом ${i+1} чёт не так, файла нет: ${preparedClipPath}`);
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
    
    console.log(`Щас склею эти ${preparedClips.length} клипов в один видосик...`);
    
    
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(concatFile)
        .inputOptions(['-f concat', '-safe 0'])
        .outputOptions(['-c copy'])
        .output(finalOutputPath)
        .on('start', (commandLine) => {
          console.log('Воу-воу, FFmpeg начал склеивать: ' + commandLine);
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
        'НЕ ВЫШЛО РАСШИФРОВАТЬ\n\nЧё-т не получилось, сорян.\n\nПроверь настройки, может ffmpeg глючит.'
      );
    }
    
    
    let finalVideoPath = finalOutputPath;
    let musicApplied = false;
    
    if (musicFilePath && fs.existsSync(musicFilePath)) {
      console.log(`Щас бахнем музончик на фон: ${path.basename(musicFilePath)}`);
      try {
        
        const videoInfo = await getVideoInfo(finalOutputPath);
        const videoWithMusicPath = path.join(outputDir, 'youtube_shorts_with_music.mp4');
        
        
        await addAudioToVideo(finalOutputPath, musicFilePath, videoWithMusicPath, videoInfo.duration);
        
        
        if (fs.existsSync(videoWithMusicPath)) {
          console.log('Музычка на месте, звучит огонь!');
          finalVideoPath = videoWithMusicPath;
          musicApplied = true;
        } else {
          console.log('Эх, с музыкой не вышло. Ну и ладно!');
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
  
  
  const stickerPath = path.join(path.dirname(outputDir), 'public', 'stickers', 'logo.png');
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
    
    
    await exec(`"${config.ffmpeg.ffmpegPath}" -i "${audioPath}" -af "silencedetect=noise=-30dB:d=0.5" -f null - 2> "${silenceInfoPath}"`);
    
    
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

module.exports = {
  analyzeAndCutVideo,
  cutVideoIntoClips,
  createYoutubeShorts,
  transcribeVideoUsingFFmpeg
}; 