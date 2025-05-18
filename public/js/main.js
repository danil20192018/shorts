document.addEventListener('DOMContentLoaded', () => {
    
    const shortsDropArea = document.getElementById('shorts-drop-area');
    const shortsFileInput = document.getElementById('shorts-file-input');
    const shortsUploadSection = document.getElementById('shorts-upload-section');
    const shortsProcessingSection = document.getElementById('shorts-processing-section');
    const shortsResultsSection = document.getElementById('shorts-results-section');
    const shortsClipsContainer = document.getElementById('shorts-clips-container');
    const shortsProgressBar = document.getElementById('shorts-progress-bar');
    const shortsVideo = document.getElementById('shorts-video');
    const shortsDuration = document.getElementById('shorts-duration');
    const shortsDownloadBtn = document.getElementById('shorts-download-btn');
    const shortsNewUploadBtn = document.getElementById('shorts-new-upload-btn');
    const shortsSubmitBtn = document.getElementById('shorts-submit-btn');
    const videoDescription = document.getElementById('video-description');
    
    
    const generatedHashtags = document.getElementById('generated-hashtags');
    const contentPlan = document.getElementById('content-plan');
    const copyHashtagsBtn = document.getElementById('copy-hashtags-btn');
    
    
    const shareQRCode = document.getElementById('share-qr-code');
    const shortUrlLink = document.getElementById('short-url-link');
    const copyUrlBtn = document.getElementById('copy-url-btn');
    const telegramShareBtn = document.getElementById('telegram-share');
    const whatsappShareBtn = document.getElementById('whatsapp-share');
    const vkShareBtn = document.getElementById('vk-share');
    
    
    const errorModal = document.getElementById('error-modal');
    const errorMessage = document.getElementById('error-message');
    const errorOkBtn = document.getElementById('error-ok-btn');
    const closeModal = document.querySelector('.close-modal');

    let sessionId = null;
    let clips = [];
    let shortsData = null;
    
    let selectedShortsFile = null;
    
    let hashtagsList = [];
    let contentPlanItems = [];

    
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        shortsDropArea.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    ['dragenter', 'dragover'].forEach(eventName => {
        shortsDropArea.addEventListener(eventName, () => {
            shortsDropArea.classList.add('highlight');
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        shortsDropArea.addEventListener(eventName, () => {
            shortsDropArea.classList.remove('highlight');
        }, false);
    });

    
    shortsFileInput.addEventListener('change', () => {
        if (shortsFileInput.files && shortsFileInput.files[0]) {
            
            selectedShortsFile = shortsFileInput.files[0];
            
            showFileSelected(selectedShortsFile.name);
        }
    });

    
    shortsDropArea.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        
        if (files && files[0]) {
            
            selectedShortsFile = files[0];
            
            showFileSelected(selectedShortsFile.name);
        }
    });

    
    function showFileSelected(fileName) {
        const fileInfo = document.createElement('div');
        fileInfo.id = 'file-selection-info';
        fileInfo.className = 'file-selection-info';
        fileInfo.innerHTML = `<p>Выбран файл: <strong>${fileName}</strong></p>`;
        
        
        const existingInfo = document.getElementById('file-selection-info');
        if (existingInfo) {
            existingInfo.remove();
        }
        
        
        const videoDescContainer = document.querySelector('.video-description-container');
        videoDescContainer.parentNode.insertBefore(fileInfo, videoDescContainer);
    }

    
    shortsSubmitBtn.addEventListener('click', () => {
        
        if (!selectedShortsFile) {
            showError('Пожалуйста, выберите видеофайл для обработки.');
            return;
        }
        
        
        if (!selectedShortsFile.type.startsWith('video/')) {
            showError('Пожалуйста, выберите видеофайл.');
            return;
        }

        
        if (selectedShortsFile.size > 100 * 1024 * 1024) {
            showError('Размер файла превышает 100MB.');
            return;
        }
        
        
        const description = videoDescription.value.trim();
        if (!description) {
            showError('Пожалуйста, введите описание видео для подбора музыки.');
            return;
        }
        
        
        uploadFile(selectedShortsFile, description);
    });

    
    function uploadFile(file, description) {
        
        shortsUploadSection.classList.add('hidden');
        shortsProcessingSection.classList.remove('hidden');
        
        
        const formData = new FormData();
        formData.append('video', file);
        formData.append('description', description);
        
        
        fetch('/create-shorts', {
            method: 'POST',
            body: formData
        })
        .then(response => {
            if (!response.ok) {
                return response.json().then(error => {
                    throw new Error(error.error || 'Ошибка при обработке видео');
                });
            }
            return response.json();
        })
        .then(data => {
            
            sessionId = data.sessionId;
            clips = data.clips || [];
            shortsData = data.shorts;
            
            
            if (data.qrCode) {
                shortsData.qrCode = data.qrCode;
            }
            
            if (data.shortUrl) {
                shortsData.shortUrl = data.shortUrl;
            }
            
            if (data.shareLinks) {
                shortsData.shareLinks = data.shareLinks;
            }
            
            
            if (data.contentStrategy) {
                hashtagsList = data.contentStrategy.hashtags || [];
                contentPlanItems = data.contentStrategy.contentPlan || [];
                
                
                displayHashtags(hashtagsList);
                displayContentPlan(contentPlanItems);
            } else {
                
                generateContentStrategy(description);
            }
            
            
            displayShortsResult(shortsData, clips);
            
            
            shortsProcessingSection.classList.add('hidden');
            shortsResultsSection.classList.remove('hidden');
        })
        .catch(error => {
            console.error('Error:', error);
            showError(error.message || 'Произошла ошибка при обработке видео.');
            shortsProcessingSection.classList.add('hidden');
            shortsUploadSection.classList.remove('hidden');
        });
        
        
        let progress = 0;
        const progressInterval = setInterval(() => {
            progress += 1;
            shortsProgressBar.style.width = Math.min(progress, 95) + '%';
            
            if (progress >= 95) {
                clearInterval(progressInterval);
            }
        }, 500);
    }

    
    function displayShortsResult(shortsData, clips) {
        if (!shortsData) return;
        
        
        shortsVideo.src = shortsData.path;
        
        
        if (shortsData.duration) {
            shortsDuration.textContent = `Длительность: ${formatTime(shortsData.duration)}`;
        }
        
        
        shortsDownloadBtn.href = shortsData.path;
        
        
        if (shortsData.qrCode) {
            shareQRCode.src = shortsData.qrCode;
        }
        
        if (shortsData.shortUrl) {
            shortUrlLink.href = shortsData.shortUrl;
            shortUrlLink.textContent = shortsData.shortUrl;
            
            
            if (shortsData.shareLinks) {
                if (telegramShareBtn && shortsData.shareLinks.telegram) {
                    telegramShareBtn.href = shortsData.shareLinks.telegram;
                }
                
                if (whatsappShareBtn && shortsData.shareLinks.whatsapp) {
                    whatsappShareBtn.href = shortsData.shareLinks.whatsapp;
                }
                
                if (vkShareBtn && shortsData.shareLinks.vk) {
                    vkShareBtn.href = shortsData.shareLinks.vk;
                }
            }
        }
        
        
        if (clips && clips.length > 0) {
            shortsClipsContainer.innerHTML = '';
            
            clips.forEach((clip, index) => {
                const clipItem = document.createElement('div');
                clipItem.className = 'clip-item';
                
                clipItem.innerHTML = `
                    <video class="clip-video" src="${clip.path}" controls></video>
                    <div class="clip-info">
                        <h3>Клип ${index + 1}</h3>
                        <div class="clip-meta">
                            <svg xmlns="http:
                                <circle cx="12" cy="12" r="10"></circle>
                                <polyline points="12 6 12 12 16 14"></polyline>
                            </svg>
                            ${formatTime(clip.duration)}
                        </div>
                        <div class="clip-actions">
                            <a href="${clip.path}" download class="download-btn">
                                <svg xmlns="http:
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                    <polyline points="7 10 12 15 17 10"></polyline>
                                    <line x1="12" y1="15" x2="12" y2="3"></line>
                                </svg>
                                Скачать
                            </a>
                        </div>
                    </div>
                `;
                
                shortsClipsContainer.appendChild(clipItem);
            });
        } else {
            shortsClipsContainer.innerHTML = '<p>Нет доступных клипов для отображения.</p>';
        }
    }

    
    function formatTime(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const remainingSeconds = Math.floor(seconds % 60);
        
        let timeString = '';
        
        if (hours > 0) {
            timeString += hours + ':';
            timeString += minutes < 10 ? '0' + minutes : minutes;
        } else {
            timeString += minutes;
        }
        
        timeString += ':';
        timeString += remainingSeconds < 10 ? '0' + remainingSeconds : remainingSeconds;
        
        return timeString;
    }

    
    shortsNewUploadBtn.addEventListener('click', () => {
        
        selectedShortsFile = null;
        videoDescription.value = '';
        
        
        const existingInfo = document.getElementById('file-selection-info');
        if (existingInfo) {
            existingInfo.remove();
        }
        
        
        shortsResultsSection.classList.add('hidden');
        shortsUploadSection.classList.remove('hidden');
    });

    
    function showError(message) {
        errorMessage.textContent = message;
        errorModal.classList.add('active');
    }

    
    errorOkBtn.addEventListener('click', () => {
        errorModal.classList.remove('active');
    });
    
    closeModal.addEventListener('click', () => {
        errorModal.classList.remove('active');
    });
    
    window.addEventListener('click', (e) => {
        if (e.target === errorModal) {
            errorModal.classList.remove('active');
        }
    });

    
    function generateContentStrategy(description) {
        
        fetch('/generate-content-strategy', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ description })
        })
        .then(response => {
            if (!response.ok) {
                throw new Error('Ошибка при генерации контент-стратегии');
            }
            return response.json();
        })
        .then(data => {
            
            hashtagsList = data.hashtags || [];
            contentPlanItems = data.contentPlan || [];
            
            
            displayHashtags(hashtagsList);
            displayContentPlan(contentPlanItems);
        })
        .catch(error => {
            console.error('Error generating content strategy:', error);
            
            generateFallbackContentStrategy(description);
        });
    }
    
    
    function generateFallbackContentStrategy(description) {
        
        const keywords = extractKeywords(description);
        hashtagsList = keywords.map(keyword => `#${keyword}`);
        
        
        contentPlanItems = [
            {
                title: 'Основное видео',
                description: 'Публикация основного видео в формате YouTube Shorts.'
            },
            {
                title: 'Ответы на комментарии',
                description: 'Следите за комментариями и отвечайте на вопросы зрителей.'
            },
            {
                title: 'Серия связанных видео',
                description: 'Создайте несколько коротких видео на связанные темы для повышения вовлеченности.'
            }
        ];
        
        
        displayHashtags(hashtagsList);
        displayContentPlan(contentPlanItems);
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
    
    
    function displayHashtags(hashtags) {
        if (!hashtags || hashtags.length === 0) {
            generatedHashtags.innerHTML = '<p>Не удалось сгенерировать хэштеги.</p>';
            return;
        }
        
        generatedHashtags.innerHTML = '';
        hashtags.forEach(hashtag => {
            const tagElement = document.createElement('div');
            tagElement.className = 'hashtag';
            tagElement.textContent = hashtag;
            generatedHashtags.appendChild(tagElement);
        });
    }
    
    
    function displayContentPlan(planItems) {
        if (!planItems || planItems.length === 0) {
            contentPlan.innerHTML = '<p>Не удалось сгенерировать контент-план.</p>';
            return;
        }
        
        contentPlan.innerHTML = '';
        planItems.forEach(item => {
            const planItemElement = document.createElement('div');
            planItemElement.className = 'plan-item';
            planItemElement.innerHTML = `
                <h5>${item.title}</h5>
                <p>${item.description}</p>
            `;
            contentPlan.appendChild(planItemElement);
        });
    }
    
    
    if (copyHashtagsBtn) {
        copyHashtagsBtn.addEventListener('click', () => {
            const hashtagsText = hashtagsList.join(' ');
            if (hashtagsText) {
                navigator.clipboard.writeText(hashtagsText)
                    .then(() => {
                        const originalText = copyHashtagsBtn.innerHTML;
                        copyHashtagsBtn.innerHTML = `
                            <svg xmlns="http:
                                <polyline points="20 6 9 17 4 12"></polyline>
                            </svg>
                            Скопировано!
                        `;
                        
                        setTimeout(() => {
                            copyHashtagsBtn.innerHTML = originalText;
                        }, 2000);
                    })
                    .catch(err => {
                        console.error('Failed to copy hashtags:', err);
                        showError('Не удалось скопировать хэштеги. Попробуйте снова.');
                    });
            }
        });
    }

    
    if (copyUrlBtn) {
        copyUrlBtn.addEventListener('click', () => {
            if (shortUrlLink && shortUrlLink.href) {
                navigator.clipboard.writeText(shortUrlLink.href)
                    .then(() => {
                        const originalSVG = copyUrlBtn.innerHTML;
                        copyUrlBtn.innerHTML = `
                            <svg xmlns="http:
                                <polyline points="20 6 9 17 4 12"></polyline>
                            </svg>
                        `;
                        
                        setTimeout(() => {
                            copyUrlBtn.innerHTML = originalSVG;
                        }, 2000);
                    })
                    .catch(err => {
                        console.error('Failed to copy URL:', err);
                        showError('Не удалось скопировать ссылку. Попробуйте снова.');
                    });
            }
        });
    }
}); 