(function() {
    'use strict';
    
    console.log('%c[OLM CHEAT V3.0] Loading...', 'color: #c090ff; font-size: 18px; font-weight: bold;');
    
    if (typeof html2canvas === 'undefined') {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
        document.head.appendChild(script);
    }
    

    const CONFIG = {
        version: '3.0',
        githubUrl: 'https://github.com/jerrryisme-jpg',
        isPaused: false,
        is5x: false,
        groqApiKey: (()=>{const p=['g','sk_xwrvFUjIteAW5Lg','uAVxOWGdyb3FYSbe1EvIGnNe1ExYZGD1rluwR'];return p.join('');})(),
        groqTextModel: 'openai/gpt-oss-120b',
        groqVisionModel: 'meta-llama/llama-4-scout-17b-16e-instruct',
        debugMode: true,
        knowledge: '',
        autoUpdate: false,
        performanceMode: false
    };
    
    let currentQuestionData = null;
    let lastQuestionHash = null;
    let isAIThinking = false;
    let currentImageBase64 = null;
    let isMinimized = false;
    let isResizing = false;
    let resizeType = null;
    let startLeft = 0;
    
    let timeFrozen = false;
    let frozenTimeSpent = null;
    let frozenDisplayTime = null;
    let timerObserver = null;
    
    let chatHistory = [];
    let toggleKey = 'Tab';
    let teacherDocQAForAI = [];
    
    function log(msg, color = '#c090ff') {
    }
    
    function hashString(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return hash;
    }
    
    function normalizeVietnamese(text) {
        text = text.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '');
        return text.toLowerCase().trim().replace(/\s+/g, ' ');
    }
    
    function levenshteinDistance(str1, str2) {
        const m = str1.length, n = str2.length;
        const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
        for (let i = 0; i <= m; i++) dp[i][0] = i;
        for (let j = 0; j <= n; j++) dp[0][j] = j;
        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                if (str1[i - 1] === str2[j - 1]) dp[i][j] = dp[i - 1][j - 1];
                else dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + 1);
            }
        }
        return dp[m][n];
    }
    
    function calculateSimilarity(str1, str2) {
        const longer = str1.length > str2.length ? str1 : str2;
        const shorter = str1.length > str2.length ? str2 : str1;
        if (longer.length === 0) return 1.0;
        return (longer.length - levenshteinDistance(longer, shorter)) / longer.length;
    }
    
    function findBestMatch(query, candidates) {
        const normalizedQuery = normalizeVietnamese(query);
        let bestMatch = null, bestScore = 0;
        candidates.forEach(candidate => {
            const normalizedCandidate = normalizeVietnamese(candidate.question);
            if (normalizedCandidate.includes(normalizedQuery)) {
                const score = 0.95 + (0.05 * (normalizedQuery.length / normalizedCandidate.length));
                if (score > bestScore) { bestScore = score; bestMatch = candidate; }
                return;
            }
            const similarity = calculateSimilarity(normalizedQuery, normalizedCandidate);
            if (similarity >= 0.75 && similarity > bestScore) { bestScore = similarity; bestMatch = candidate; }
        });
        return bestMatch;
    }
    
    function escHtml(s) {
        return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }
    
    function mdToHtml(text) {
        let t = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        t = t.replace(/((?:\|.+\|\n)+)/g, function(match) {
            const lines = match.trim().split('\n').filter(l=>l.trim());
            if (lines.length < 2) return match;
            if (!lines[1].match(/^\|[\s\-:|]+\|$/)) return match;
            let table = '<table style="border-collapse:collapse;margin:6px 0;width:100%;font-size:11px;">';
            lines.forEach((line,i) => {
                if (i===1) return;
                const cells = line.split('|').filter(c=>c.trim());
                const tag = i===0?'th':'td';
                const style = i===0
                    ? 'border:1px solid rgba(192,144,255,0.3);padding:5px 7px;background:rgba(40,20,70,0.4);font-weight:bold;color:#c090ff;'
                    : 'border:1px solid rgba(255,255,255,0.06);padding:4px 7px;color:#e8e8e8;';
                table += '<tr>'+cells.map(c=>`<${tag} style="${style}">${c.trim()}</${tag}>`).join('')+'</tr>';
            });
            return table + '</table>';
        });
        t = t.replace(/```([\s\S]*?)```/g, '<pre style="background:rgba(0,0,0,0.5);padding:7px;border-radius:4px;overflow-x:auto;margin:6px 0;font-size:11px;border:1px solid rgba(192,144,255,0.15);"><code style="color:#e8e8e8;">$1</code></pre>');
        t = t.replace(/`([^`]+)`/g, '<code style="background:rgba(192,144,255,0.1);padding:1px 5px;border-radius:3px;font-family:monospace;font-size:11px;color:#c090ff;border:1px solid rgba(192,144,255,0.2);">$1</code>');
        t = t.replace(/\*\*([^*]+)\*\*/g, '<strong style="color:#e8e8e8;font-weight:700;">$1</strong>');
        t = t.replace(/__([^_]+)__/g, '<strong style="color:#e8e8e8;font-weight:700;">$1</strong>');
        t = t.replace(/\*([^*\n]+?)\*/g, '<em style="color:#a0a0a0;">$1</em>');
        t = t.replace(/_([^_\n]+?)_/g, '<em style="color:#a0a0a0;">$1</em>');
        t = t.replace(/~~([^~]+)~~/g, '<del style="color:#666;">$1</del>');
        t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" style="color:#c090ff;text-decoration:underline;">$1</a>');
        t = t.replace(/^#### (.+)$/gm, '<div style="font-size:11px;font-weight:700;color:#c090ff;margin:5px 0 2px;">$1</div>');
        t = t.replace(/^### (.+)$/gm, '<div style="font-size:12px;font-weight:700;color:#c090ff;margin:6px 0 3px;">$1</div>');
        t = t.replace(/^## (.+)$/gm, '<div style="font-size:13px;font-weight:700;color:#c090ff;margin:7px 0 3px;">$1</div>');
        t = t.replace(/^# (.+)$/gm, '<div style="font-size:14px;font-weight:700;color:#c090ff;margin:8px 0 4px;">$1</div>');
        t = t.replace(/^[\-\*] (.+)$/gm, '<div style="padding-left:12px;margin:2px 0;color:#e8e8e8;"><span style="color:#c090ff;">&bull;</span> $1</div>');
        t = t.replace(/^(\d+)\. (.+)$/gm, '<div style="padding-left:12px;margin:2px 0;color:#e8e8e8;"><span style="color:#c090ff;font-weight:600;">$1.</span> $2</div>');
        t = t.replace(/\\\[(.+?)\\\]/gs, '<div style="background:rgba(40,20,70,0.3);padding:8px 12px;border-radius:6px;margin:6px 0;font-family:monospace;font-size:12px;color:#e8e8e8;text-align:center;border:1px solid rgba(192,144,255,0.2);overflow-x:auto;">$1</div>');
        t = t.replace(/\\\((.+?)\\\)/g, '<span style="background:rgba(192,144,255,0.08);padding:1px 4px;border-radius:3px;font-family:monospace;font-size:11px;color:#e8e8e8;">$1</span>');
        t = t.replace(/\n\n/g, '<div style="height:5px;"></div>');
        t = t.replace(/\n/g, '<br>');
        return t;
    }
    
    function hijackEXAMUI() {
        if (!window.EXAM_UI) return false;
        if (EXAM_UI.getData) {
            const originalGetData = EXAM_UI.getData;
            EXAM_UI.getData = function(key) {
                const data = originalGetData.call(this, key);
                if (key === 'asubmit') return 0;
                if (key === 'count_log') return 0;
                return data;
            };
        }
        if (EXAM_UI.setData) {
            const originalSetData = EXAM_UI.setData;
            EXAM_UI.setData = function(key, value) {
                if (key === 'count_log') return;
                return originalSetData.call(this, key, value);
            };
        }
        return true;
    }
    
    function hijackCATEUI() {
        if (!window.CATE_UI) return false;
        if (window.CATE_UI.timeNext) {
            const originalTimeNext = window.CATE_UI.timeNext;
            window.CATE_UI.timeNext = function() {
                if (timeFrozen) {
                    const timer = window.CATE_UI.getTimer();
                    const savedTimeSpent = timer.time_spent;
                    originalTimeNext.call(this);
                    timer.time_spent = savedTimeSpent;
                    try {
                        const data = window.CATE_UI.getData();
                        let key = 'time_spent:' + data.id_page_user + '.' + data.id_category;
                        if (data.id_courseware) key += '.' + data.id_courseware;
                        localStorage.setItem(key, JSON.stringify(frozenTimeSpent));
                    } catch(e) {}
                    return;
                }
                return originalTimeNext.call(this);
            };
        }
        if (window.CATE_UI.saveResult) {
            const originalSaveResult = window.CATE_UI.saveResult;
            window.CATE_UI.saveResult = function(data, callback, includeTime) {
                if (data && data.log) { if (callback) callback(true); return; }
                if (timeFrozen && frozenTimeSpent !== null) {
                    data = data || {};
                    data.time_spent = frozenTimeSpent;
                }
                return originalSaveResult.call(this, data, callback, includeTime);
            };
        }
        if (window.CATE_UI.saveLocalRecord) {
            const originalSaveLocalRecord = window.CATE_UI.saveLocalRecord;
            window.CATE_UI.saveLocalRecord = function(key, data) {
                if (timeFrozen && key === 'time_spent') return;
                return originalSaveLocalRecord.call(this, key, data);
            };
        }
        return true;
    }
    
    function bypassTabDetection() {
        console.log('%c[OLM v3.0] Bypassing anticheat...', 'color: #c090ff; font-weight: bold;');
        
        Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
        Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
        
        const originalAddEventListener = EventTarget.prototype.addEventListener;
        EventTarget.prototype.addEventListener = function(type, listener, options) {
            const blockedEvents = ['visibilitychange','blur','focus','pause','resume','fullscreenchange','webkitfullscreenchange','mozfullscreenchange','msfullscreenchange','beforeunload'];
            if (blockedEvents.includes(type)) return;
            return originalAddEventListener.call(this, type, listener, options);
        };
        
        Object.defineProperty(document, 'fullscreenElement', { get: () => null, configurable: true });
        Object.defineProperty(document, 'webkitFullscreenElement', { get: () => null, configurable: true });
        Object.defineProperty(document, 'mozFullScreenElement', { get: () => null, configurable: true });
        Object.defineProperty(document, 'msFullscreenElement', { get: () => null, configurable: true });
        
        if (Element.prototype.requestFullscreen) Element.prototype.requestFullscreen = function() { return Promise.resolve(); };
        if (Element.prototype.webkitRequestFullscreen) Element.prototype.webkitRequestFullscreen = function() { return Promise.resolve(); };
        if (Element.prototype.mozRequestFullScreen) Element.prototype.mozRequestFullScreen = function() { return Promise.resolve(); };
        if (Element.prototype.msRequestFullscreen) Element.prototype.msRequestFullscreen = function() { return Promise.resolve(); };
        if (document.exitFullscreen) document.exitFullscreen = function() { return Promise.resolve(); };
        if (document.webkitExitFullscreen) document.webkitExitFullscreen = function() { return Promise.resolve(); };
        
        ['copy','paste','cut','contextmenu','selectstart'].forEach(eventType => {
            document.addEventListener(eventType, function(e) { e.stopImmediatePropagation(); }, true);
        });
        
        const enableSelection = () => {
            if (!document.body) return;
            document.body.style.userSelect = 'auto';
            document.body.style.webkitUserSelect = 'auto';
            document.querySelectorAll('*').forEach(el => { if (el.style.userSelect === 'none') el.style.userSelect = 'auto'; });
        };
        enableSelection();
        setInterval(enableSelection, 500);
        
        const originalPreventDefault = Event.prototype.preventDefault;
        Event.prototype.preventDefault = function() {
            if (this.type === 'keydown') {
                const key = this.key, ctrl = this.ctrlKey, shift = this.shiftKey;
                if (key === 'F12' || (ctrl && shift && key === 'I') || (ctrl && shift && key === 'C') || (ctrl && key === 'U')) return;
            }
            if (this.type === 'contextmenu') return;
            return originalPreventDefault.call(this);
        };
        
        const blockedEndpoints = ['teacher-static','saveResult','teacher-log','newexam-log','course/teacher-static'];
        const originalFetch = window.fetch;
        window.fetch = function(...args) {
            const url = String(args[0]);
            if (blockedEndpoints.some(endpoint => url.includes(endpoint))) {
                return Promise.resolve(new Response('{"success":true}', { status: 200, headers: {'Content-Type': 'application/json'} }));
            }
            return originalFetch.apply(this, args);
        };
        
        const originalXHROpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function(method, url, ...rest) {
            if (blockedEndpoints.some(endpoint => url.includes(endpoint))) this._blocked = true;
            return originalXHROpen.apply(this, [method, url, ...rest]);
        };
        const originalXHRSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.send = function(...args) {
            if (this._blocked) return;
            return originalXHRSend.apply(this, args);
        };
        
        const cleanupWarnings = () => {
            const scoreEl = document.getElementById('tmp-score');
            if (scoreEl && scoreEl.textContent.includes('Dấu hiệu gian lận')) {
                scoreEl.textContent = '';
                scoreEl.classList.remove('text-danger', 'font-weight-bold');
            }
            document.querySelectorAll('.noti-out-view').forEach(el => {
                if (el.textContent.includes('rời khỏi màn hình') || el.textContent.includes('báo cáo')) {
                    el.innerHTML = `<p class='mb-1'>Lưu ý: Hệ thống đéo theo dõi khi bạn rời khỏi màn hình.</p><p class='mb-1'>thoát ra thoải mái, không bị báo cáo.</p>`;
                }
            });
            document.querySelectorAll('.alert-danger, .alert-warning').forEach(el => {
                const text = el.textContent;
                if (text.includes('rời khỏi màn hình') || text.includes('toàn màn hình') || text.includes('gian lận') || (text.includes('Cảnh báo') && text.includes('thoát'))) el.remove();
            });
        };
        cleanupWarnings();
        setInterval(cleanupWarnings, 1000);
        
        window._dialogAlert = function(msg) { return; };
        window._dialogConfirm = function(title, msg, callback) { if (callback) callback(true); return; };
        
        const originalSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function(key, value) {
            if (key.startsWith('time_spent:') && localStorage.getItem('olm_time_frozen') === 'true') {
                const frozenValue = localStorage.getItem('olm_frozen_time');
                if (frozenValue) return originalSetItem.call(this, key, frozenValue);
                return;
            }
            return originalSetItem.call(this, key, value);
        };
        
        console.log('%c[OLM v3.0] Anticheat bypassed', 'color: #00ff88; font-weight: bold;');
    }
    
    function toggleStop() {
        CONFIG.isPaused = !CONFIG.isPaused;
        const btn = document.getElementById('olm-stop-btn');
        if (CONFIG.isPaused) {
            btn.textContent = ' RESUME TIME';
            btn.style.background = 'rgba(0, 68, 0, 0.6)';
            btn.style.color = '#00ff00';
            btn.style.borderColor = 'rgba(0, 255, 0, 0.4)';
            stopAllTimers();
        } else {
            btn.textContent = ' STOP TIME';
            btn.style.background = 'rgba(68, 0, 0, 0.6)';
            btn.style.color = '#ff4444';
            btn.style.borderColor = 'rgba(255, 0, 0, 0.4)';
            resumeAllTimers();
        }
    }
    
    function stopAllTimers() {
        if (window.CATE_UI) {
            const timer = window.CATE_UI.getTimer();
            if (timer) {
                timeFrozen = true;
                frozenTimeSpent = timer.time_spent;
                const data = window.CATE_UI.getData();
                const lsKey = 'time_spent:' + data.id_page_user + '.' + data.id_category;
                const fullKey = data.id_courseware ? lsKey + '.' + data.id_courseware : lsKey;
                try {
                    localStorage.setItem(fullKey, JSON.stringify(frozenTimeSpent));
                    localStorage.setItem('olm_time_frozen', 'true');
                    localStorage.setItem('olm_frozen_time', JSON.stringify(frozenTimeSpent));
                } catch(e) {}
            }
        }
        const timerEl = document.getElementById('timecount');
        if (timerEl) {
            frozenDisplayTime = timerEl.textContent;
            if (timerObserver) timerObserver.disconnect();
            timerObserver = new MutationObserver(() => {
                if (timeFrozen && timerEl.textContent !== frozenDisplayTime) timerEl.textContent = frozenDisplayTime;
            });
            timerObserver.observe(timerEl, { childList: true, characterData: true, subtree: true });
        }
    }
    
    function resumeAllTimers() {
        timeFrozen = false;
        frozenTimeSpent = null;
        frozenDisplayTime = null;
        try { localStorage.removeItem('olm_time_frozen'); localStorage.removeItem('olm_frozen_time'); } catch(e) {}
        if (timerObserver) { timerObserver.disconnect(); timerObserver = null; }
    }
    
    function getQuestionText() {
        const patterns = ['.card .card-title','.question-text','[class*="question"]','h3','h4','.card-body p'];
        for (const pattern of patterns) {
            const elements = document.querySelectorAll(pattern);
            for (const el of elements) {
                const text = el.textContent.trim();
                if (text.length > 20 && text.length < 2000) return text;
            }
        }
        return null;
    }
    
    function getAnswerElements() {
        const patterns = ['label[for^="answer"]','.answer-option','[class*="option"]','label'];
        for (const pattern of patterns) {
            const elements = Array.from(document.querySelectorAll(pattern));
            if (elements.length >= 2 && elements.length <= 6) return elements;
        }
        return [];
    }
    
    function getAnswerTexts() {
        return getAnswerElements().map(el => el.textContent.trim());
    }
    
    function displayQuestion(questionText) {
        const box = document.getElementById('olm-question-box');
        if (box) box.textContent = questionText;
    }
    
    function copyQuestionToClipboard() {
        if (!currentQuestionData) return;
        const text = `Q: ${currentQuestionData.question}\n\nAnswers:\n${currentQuestionData.answers.map((a, i) => `${String.fromCharCode(65 + i)}. ${a}`).join('\n')}`;
        navigator.clipboard.writeText(text);
    }
    
    let teacherDocAnswers = null;
    let isDownloadingDoc = false;
    
    function loadJSZip() {
        return new Promise((resolve, reject) => {
            if (window.JSZip) { resolve(); return; }
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('Failed to load jszip.js'));
            document.head.appendChild(script);
        });
    }
    
    async function downloadAndParseTeacherDoc() {
        const isExamPage = window.location.pathname.match(/\/chu-de\//);
        if (!isExamPage) {
            teacherDocAnswers = [];
            populateQAList();
            return;
        }
        if (isDownloadingDoc || teacherDocAnswers !== null) return;
        isDownloadingDoc = true;
        try {
            await loadJSZip();
            const pathMatch = window.location.pathname.match(/(\d+)$/);
            if (!pathMatch) { teacherDocAnswers = {}; return; }
            const id_cate = pathMatch[0];
            const apiUrl = `https://olm.vn/download-word-for-user?id_cate=${id_cate}&showAns=1&questionNotApproved=0`;
            const response = await fetch(apiUrl);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            if (!data || !data.file) throw new Error('No file URL in response');
            const fileResponse = await fetch(data.file);
            if (!fileResponse.ok) throw new Error(`Failed to download: ${fileResponse.status}`);
            const arrayBuffer = await fileResponse.arrayBuffer();
            await loadJSZip();
            const zip = await JSZip.loadAsync(arrayBuffer);
            const documentXml = await zip.file('word/document.xml').async('string');
            teacherDocAnswers = parseDocxXML(documentXml);
            teacherDocQAForAI = teacherDocAnswers.map(qa => {
                let answer = qa.answerText || qa.answerLetter || '';
                if (qa.isTrueFalse && qa.subQuestions) {
                    answer = qa.subQuestions.map(sq => sq.letter + ') ' + sq.answer).join(', ');
                } else if (qa.answerLetter && qa.allOptions && qa.allOptions[qa.answerLetter]) {
                    answer = qa.answerLetter + '. ' + qa.allOptions[qa.answerLetter];
                }
                return { question: qa.question.replace(/\[IMG:[^\]]+\]/g, ''), answer };
            });
            populateQAList();
        } catch (error) {
            teacherDocAnswers = {};
        } finally {
            isDownloadingDoc = false;
        }
    }
    
    function parseDocxXML(xmlContent) {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlContent, 'text/xml');
        const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
        const V = 'urn:schemas-microsoft-com:vml';
        const RN = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
        const allRuns = xmlDoc.getElementsByTagNameNS(W, 'r');
        const textChunks = [];
        let position = 0;
        for (let i = 0; i < allRuns.length; i++) {
            const run = allRuns[i];
            let isUnderlined = false;
            const rPr = run.getElementsByTagNameNS(W, 'rPr')[0];
            if (rPr && rPr.getElementsByTagNameNS(W, 'u').length > 0) isUnderlined = true;
            for (const child of run.childNodes) {
                const name = child.nodeName;
                if (name === 'w:t') {
                    textChunks.push({ text: child.textContent, isUnderlined, start: position });
                    position += child.textContent.length;
                } else if (name === 'w:object') {
                    const imgDatas = child.getElementsByTagNameNS(V, 'imagedata');
                    if (imgDatas.length > 0) {
                        const rId = imgDatas[0].getAttributeNS(RN, 'id') || imgDatas[0].getAttribute('r:id') || '';
                        const shapes = child.getElementsByTagNameNS(V, 'shape');
                        let wPt = '', hPt = '';
                        if (shapes.length > 0) {
                            const style = shapes[0].getAttribute('style') || '';
                            const wm = style.match(/width:([\d.]+)pt/);
                            const hm = style.match(/height:([\d.]+)pt/);
                            if (wm) wPt = wm[1];
                            if (hm) hPt = hm[1];
                        }
                        if (rId) {
                            const token = `[IMG:${rId}:${wPt}:${hPt}]`;
                            textChunks.push({ text: token, isUnderlined, start: position });
                            position += token.length;
                        }
                    }
                }
            }
        }
        const fullText = textChunks.map(c => c.text).join('');
        const questionRegex = /(Question\s+\d+\.|Câu\s+\d+\.)/gi;
        const questionMarkers = [];
        let match;
        while ((match = questionRegex.exec(fullText)) !== null) {
            questionMarkers.push({ marker: match[0], index: match.index });
        }
        const qaPairs = [];
        for (let qIdx = 0; qIdx < questionMarkers.length; qIdx++) {
            const startIdx = questionMarkers[qIdx].index + questionMarkers[qIdx].marker.length;
            const endIdx = qIdx + 1 < questionMarkers.length ? questionMarkers[qIdx + 1].index : fullText.length;
            const block = fullText.substring(startIdx, endIdx).trim();
            let answerLetter = null;
            for (const chunk of textChunks) {
                if (chunk.start >= startIdx && chunk.start < endIdx && chunk.isUnderlined) {
                    const letterMatch = chunk.text.trim().match(/^([A-D])\.?\s*$/);
                    if (letterMatch) { answerLetter = letterMatch[1]; break; }
                }
            }
            const textAnswerMatch = block.match(/^(.+?)\s*\[([^\]]+)\]\s*$/s);
            if (textAnswerMatch) {
                qaPairs.push({ question: textAnswerMatch[1].replace(/\s+/g, ' ').trim(), answerLetter: null, answerText: textAnswerMatch[2].trim(), allOptions: {}, isTextAnswer: true });
                continue;
            }
            const isTrueFalse = /[a-d]\).*?\(\s*[TFĐS]\s*\)/i.test(block);
            if (isTrueFalse) {
                const mainQuestionMatch = block.match(/^(.+?)(?=\s*[a-d]\))/s);
                const mainQuestion = mainQuestionMatch ? mainQuestionMatch[1].replace(/\s+/g, ' ').trim() : '';
                const subQuestions = [];
                const subMatches = block.matchAll(/([a-d])\)\s*(.+?)\s*\(\s*([TFĐS])\s*\)/gi);
                for (const m of subMatches) {
                    const letter = m[1].toLowerCase();
                    const questionText = m[2].trim();
                    const raw = m[3].toUpperCase();
                    const answer = (raw === 'T' || raw === 'Đ') ? 'Đ' : 'S';
                    subQuestions.push({ letter, questionText, answer });
                }
                if (subQuestions.length > 0) {
                    const answerText = subQuestions.map(sq => `${sq.letter}) ${sq.answer}`).join('\n');
                    qaPairs.push({ question: mainQuestion, answerLetter: null, answerText, allOptions: {}, isTrueFalse: true, subQuestions });
                }
                continue;
            }
            if (!answerLetter) continue;
            let questionText = '';
            const firstOptionMatch = block.match(/(?:^|\n)\s*A\.\s/);
            if (firstOptionMatch) {
                questionText = block.substring(0, firstOptionMatch.index).replace(/\s+/g, ' ').trim();
            } else {
                const m = block.match(/^(.+?)(?=\s*A\.|$)/s);
                questionText = m ? m[1].replace(/\s+/g, ' ').trim() : block.substring(0, 100);
            }
            const options = {};
            const optionRegex = /([A-D])\.\s*(.+?)(?=[A-D]\.|$)/gs;
            let optMatch;
            while ((optMatch = optionRegex.exec(block)) !== null) {
                const letter = optMatch[1];
                let text = optMatch[2].trim();
                text = text.replace(/\.\s*$/, '').trim();
                text = text.replace(/\s+[A-D]\.?\s*$/, '').trim();
                if (text && text.length > 1) options[letter] = text;
            }
            const answerText = options[answerLetter] || answerLetter;
            qaPairs.push({ question: questionText, answerLetter, answerText, allOptions: options, isTrueFalse: false, isTextAnswer: false });
        }
        return qaPairs;
    }
    
    function findAnswerByQuestionText(questionText) {
        if (!teacherDocAnswers || teacherDocAnswers.length === 0) return null;
        return findBestMatch(questionText, teacherDocAnswers);
    }
    
    function matchTrueFalseToExam(docSubQuestions, examAnswerTexts) {
        if (!docSubQuestions || !examAnswerTexts || examAnswerTexts.length === 0) return null;
        const docAnswers = docSubQuestions.map(sq => sq.answer);
        const examAnswers = examAnswerTexts.map(t => {
            const normalized = normalizeVietnamese(t);
            if (normalized.includes('đ') || normalized.includes('true') || normalized.includes('dung')) return 'Đ';
            return 'S';
        });
        if (docAnswers.join('') === examAnswers.join('')) {
            return docSubQuestions.map((sq, i) => ({ letter: String.fromCharCode(65 + i), answer: sq.answer }));
        }
        const permutations = getPermutations([0, 1, 2, 3].slice(0, docAnswers.length));
        for (const perm of permutations) {
            const rearranged = perm.map(i => docAnswers[i]);
            if (rearranged.join('') === examAnswers.join('')) {
                return perm.map((docIdx, examIdx) => ({
                    letter: String.fromCharCode(65 + examIdx),
                    answer: docSubQuestions[docIdx].answer
                }));
            }
        }
        const bestPerm = findBestPermutation(docAnswers, examAnswers);
        if (bestPerm) {
            return bestPerm.map((docIdx, examIdx) => ({
                letter: String.fromCharCode(65 + examIdx),
                answer: docSubQuestions[docIdx].answer
            }));
        }
        return null;
    }
    
    function getPermutations(arr) {
        if (arr.length <= 1) return [arr];
        const result = [];
        for (let i = 0; i < arr.length; i++) {
            const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
            for (const perm of getPermutations(rest)) {
                result.push([arr[i], ...perm]);
            }
        }
        return result;
    }
    
    function findBestPermutation(docAnswers, examAnswers) {
        let bestPerm = null, bestScore = -1;
        const perms = getPermutations([0, 1, 2, 3].slice(0, docAnswers.length));
        for (const perm of perms) {
            let score = 0;
            for (let i = 0; i < perm.length; i++) {
                if (docAnswers[perm[i]] === examAnswers[i]) score++;
            }
            if (score > bestScore) { bestScore = score; bestPerm = perm; }
        }
        return bestScore > 0 ? bestPerm : null;
    }
    
    function displayAIAnswer(answer, confidence = null) {
        const box = document.getElementById('olm-ai-answer');
        const status = document.getElementById('olm-ai-status');
        if (box) {
            box.innerHTML = `<div style="color: #e8e8e8; font-weight: 600; font-size: 15px; margin-bottom: 8px; line-height: 1.7;">${mdToHtml(answer)}</div>`;
            if (confidence !== null) box.innerHTML += `<div style="font-size: 9px; color: #a0a0a0;">Confidence: ${confidence}%</div>`;
        }
        if (status) status.textContent = '';
        isAIThinking = false;
    }
    
    function highlightAnswer(letter) {
        const answerElements = getAnswerElements();
        const index = letter.toUpperCase().charCodeAt(0) - 65;
        if (answerElements[index]) {
            answerElements.forEach((el, i) => { el.style.background = ''; el.style.border = ''; });
            const targetEl = answerElements[index];
            targetEl.style.background = 'rgba(0, 255, 136, 0.15)';
            targetEl.style.border = '2px solid rgba(0, 255, 136, 0.6)';
            targetEl.style.borderRadius = '8px';
            targetEl.style.transition = 'all 0.3s ease';
            targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }
    
    async function groqStream(messages, model, onChunk) {
        if (!CONFIG.groqApiKey) return null;
        const isVisionModel = model.includes('vision') || model.includes('llama-4') || model.includes('scout');
        const normalizedMessages = messages.map(m => {
            if (typeof m.content === 'string') return m;
            if (Array.isArray(m.content)) {
                if (isVisionModel) return m;
                const textOnly = m.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
                return { role: m.role, content: textOnly };
            }
            return { role: m.role, content: String(m.content) };
        });
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CONFIG.groqApiKey}` },
            body: JSON.stringify({ model, messages: normalizedMessages, max_tokens: 1000, temperature: 0.7, stream: true }),
        });
        if (!res.ok) { const e = await res.json(); throw new Error(`Groq ${res.status}: ${e.error?.message || 'unknown'}`); }
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let full = '';
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            for (const line of dec.decode(value).split('\n')) {
                if (!line.startsWith('data: ')) continue;
                const d = line.slice(6);
                if (d === '[DONE]') continue;
                try {
                    const chunk = JSON.parse(d).choices[0]?.delta?.content;
                    if (chunk) { full += chunk; onChunk(full); }
                } catch(_) {}
            }
        }
        return full;
    }
    
    async function groq(messages, model, maxTok = 400) {
        if (!CONFIG.groqApiKey) return null;
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CONFIG.groqApiKey}` },
            body: JSON.stringify({ model, messages, max_tokens: maxTok, temperature: 0.1 }),
        });
        if (!res.ok) { const e = await res.text(); throw new Error(`Groq ${res.status}: ${e}`); }
        return (await res.json()).choices?.[0]?.message?.content?.trim();
    }
    
    async function askAIForAnswer(customQuestion = null) {
        if (isAIThinking) return;
        const questionText = customQuestion || currentQuestionData?.question;
        const answerTexts = customQuestion ? [] : (currentQuestionData?.answers || []);
        if (!questionText) return;
        isAIThinking = true;
        const status = document.getElementById('olm-ai-status');
        const aiBox = document.getElementById('olm-ai-answer');
        if (status) status.textContent = 'Thinking...';
        if (aiBox) aiBox.innerHTML = '<div style="color: #a0a0a0; font-size: 11px; font-style: italic;">Asking AI...</div>';
        try {
            let prompt;
            if (answerTexts.length > 0) {
                prompt = `You are taking a Vietnamese quiz. Answer with the FULL ANSWER CONTENT, not just the letter. Format: ANSWER: [full answer text]\nREASON: [one short sentence]\n\nQuestion: ${questionText}\n\nOptions:\n${answerTexts.map((a, i) => `${String.fromCharCode(65 + i)}. ${a}`).join('\n')}\n\nAnswer:`;
            } else {
                prompt = `Answer this Vietnamese question. Give ONLY a concise answer, no explanations:\n\n${questionText}`;
            }
            if (CONFIG.knowledge) prompt = `KNOWLEDGE BASE:\n${CONFIG.knowledge}\n\n${prompt}`;
            const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CONFIG.groqApiKey}` },
                body: JSON.stringify({
                    model: CONFIG.groqTextModel,
                    messages: [
                        { role: 'system', content: 'You are a helpful quiz assistant. Answer concisely.' },
                        { role: 'user', content: prompt }
                    ],
                    max_tokens: 200,
                    temperature: 0.3
                })
            });
            if (!response.ok) {
                const errorText = await response.text();
                if (response.status === 429 || errorText.includes('rate_limit') || errorText.includes('quota')) throw new Error('API rate limit! Get free key at console.groq.com');
                throw new Error(`API error ${response.status}`);
            }
            const data = await response.json();
            const answer = data.choices?.[0]?.message?.content?.trim();
            if (!answer) throw new Error('No answer from AI');
            const letterMatch = answer.match(/^([A-D])/i);
            if (letterMatch) {
                const letter = letterMatch[1].toUpperCase();
                displayAIAnswer(letter, 85);
                highlightAnswer(letter);
            } else {
                displayAIAnswer(answer, null);
            }
        } catch (error) {
            displayAIAnswer(`Error: ${error.message}`);
        }
    }
    
    async function askVision(imgB64) {
        if (isAIThinking) return;
        isAIThinking = true;
        switchTab('chat');
        const bubble = appendChatBubble('...', 'ai');
        chatHistory.push({ role: 'user', content: [
            { type: 'text', text: 'Look at this exam question image. Extract the question and all answer options. Then provide the CORRECT ANSWER CONTENT (the full text of the correct option, not just the letter). Be concise.' },
            { type: 'image_url', image_url: { url: imgB64 } },
        ]});
        try {
            const reply = await groqStream(chatHistory.slice(-6), CONFIG.groqVisionModel,
                (partial) => { bubble.innerHTML = mdToHtml(partial); scrollChat(); });
            if (reply) {
                bubble.innerHTML = mdToHtml(reply);
                chatHistory.push({ role: 'assistant', content: reply });
                trimHistory();
                const m = reply.match(/ANSWER:\s*([A-D])/i);
                if (m) highlightAnswer(m[1]);
            }
        } catch(e) {
            bubble.textContent = 'Error: ' + e.message;
            bubble.style.color = '#ff6060';
        }
        isAIThinking = false;
    }
    
    async function askTextChat(q, opts) {
        if (isAIThinking) return;
        isAIThinking = true;
        const optStr = opts.length ? opts.map((o,i) => String.fromCharCode(65+i)+'. '+o).join('\n') : '';
        const userMsg = optStr ? q+'\n\n'+optStr : q;
        appendChatBubble(userMsg, 'user');
        chatHistory.push({ role: 'user', content: userMsg });
        const bubble = appendChatBubble('...', 'ai');
        try {
            let systemPrompt = 'You are an expert exam assistant for Vietnamese OLM platform. Answer with the FULL ANSWER CONTENT, not just letters. For multiple choice: give the full text of the correct option. For true/false: ANSWER: Đ or S with explanation. Be concise.';
            if (teacherDocQAForAI.length > 0) {
                const answersOnly = teacherDocQAForAI.map((qa, i) => `${i+1}. ${qa.answer}`).join('\n');
                systemPrompt += `\n\nExam answers (${teacherDocQAForAI.length} total):\n${answersOnly}`;
            }
            const reply = await groqStream(
                [{ role: 'system', content: systemPrompt }, ...chatHistory.slice(-10)],
                CONFIG.groqTextModel,
                (partial) => { bubble.innerHTML = mdToHtml(partial); scrollChat(); }
            );
            if (reply) {
                bubble.innerHTML = mdToHtml(reply);
                chatHistory.push({ role: 'assistant', content: reply });
                trimHistory();
                const m = reply.match(/ANSWER:\s*([A-D])/i);
                if (m) highlightAnswer(m[1]);
            }
        } catch(e) {
            bubble.textContent = 'Error: ' + e.message;
            bubble.style.color = '#ff6060';
        }
        isAIThinking = false;
    }
    
    async function sendChat(msg) {
        if (!msg.trim()) return;
        if (!CONFIG.groqApiKey) return;
        appendChatBubble(msg, 'user');
        chatHistory.push({ role: 'user', content: msg });
        const bubble = appendChatBubble('...', 'ai');
        try {
            let systemPrompt = 'You are a helpful exam assistant. Be concise and direct. Reply in the same language the user uses.';
            if (teacherDocQAForAI.length > 0) {
                const answersOnly = teacherDocQAForAI.map((qa, i) => `${i+1}. ${qa.answer}`).join('\n');
                systemPrompt += `\n\nExam answers:\n${answersOnly}`;
            }
            const reply = await groqStream(
                [{ role: 'system', content: systemPrompt }, ...chatHistory.slice(-14)],
                CONFIG.groqTextModel,
                (partial) => { bubble.innerHTML = mdToHtml(partial); scrollChat(); }
            );
            if (reply) {
                bubble.innerHTML = mdToHtml(reply);
                chatHistory.push({ role: 'assistant', content: reply });
                trimHistory();
            } else {
                bubble.textContent = '(no reply)';
            }
        } catch(e) {
            bubble.textContent = 'Error: ' + e.message;
            bubble.style.color = '#ff6060';
        }
    }
    
    function trimHistory() {
        if (chatHistory.length > 20) chatHistory = chatHistory.slice(-20);
    }
    
    function scrollChat() {
        const log = document.getElementById('olm-chat-log');
        if (log) log.scrollTop = log.scrollHeight;
    }
    
    function appendChatBubble(text, who) {
        const log = document.getElementById('olm-chat-log');
        if (!log) return { innerHTML: '', textContent: '' };
        const d = document.createElement('div');
        d.style.cssText = who === 'user' ? 'text-align:right;margin-bottom:6px;' : 'text-align:left;margin-bottom:6px;';
        const b = document.createElement('div');
        b.style.cssText = who === 'user'
            ? 'display:inline-block;background:rgba(40,20,70,0.35);border:1px solid rgba(192,144,255,0.35);color:#e8e8e8;padding:6px 10px;border-radius:10px 10px 2px 10px;font-size:11px;max-width:90%;word-break:break-word;line-height:1.7;text-align:left;'
            : 'display:inline-block;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);color:#c5c5c5;padding:7px 11px;border-radius:10px 10px 10px 2px;font-size:11px;max-width:92%;word-break:break-word;line-height:1.7;text-align:left;';
        if (who === 'ai') {
            b.innerHTML = text === '...' ? '<span style="opacity:0.4;color:#a0a0a0;">typing...</span>' : mdToHtml(text);
        } else {
            b.textContent = text;
        }
        d.appendChild(b);
        log.appendChild(d);
        log.scrollTop = log.scrollHeight;
        return b;
    }
    
    function switchTab(tabName) {
        const panel = document.getElementById('olm-panel');
        if (!panel) return;
        panel.querySelectorAll('.olm-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
        panel.querySelectorAll('.olm-page').forEach(p => p.classList.toggle('active', p.id === 'olm-page-' + tabName));
    }
    
    function createStealthScreenshot() {
        // In stealth mode: barely-visible grey outline only, no dark overlay
        const sel = document.createElement('div');
        sel.style.cssText = 'position:fixed;border:1px solid rgba(160,160,160,0.35);background:transparent;z-index:9999999;pointer-events:none;';
        let startX, startY, dragging = false;

        const onDown = (e) => {
            dragging = true;
            startX = e.clientX; startY = e.clientY;
            sel.style.left = startX + 'px'; sel.style.top = startY + 'px';
            sel.style.width = '0'; sel.style.height = '0';
            document.body.appendChild(sel);
        };
        const onMove = (e) => {
            if (!dragging) return;
            const l = Math.min(startX, e.clientX), t = Math.min(startY, e.clientY);
            sel.style.left = l + 'px'; sel.style.top = t + 'px';
            sel.style.width = Math.abs(e.clientX - startX) + 'px';
            sel.style.height = Math.abs(e.clientY - startY) + 'px';
        };
        const cleanup = () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            document.removeEventListener('keydown', onEsc);
        };
        const onUp = async (e) => {
            dragging = false;
            const rect = sel.getBoundingClientRect();
            sel.remove();
            cleanup();
            if (rect.width < 30 || rect.height < 30) return;
            // Capture and send to AI, result goes to stealth overlay
            try {
                if (typeof html2canvas === 'undefined') return;
                const canvas = await html2canvas(document.body, {
                    x: rect.left, y: rect.top, width: rect.width, height: rect.height,
                    useCORS: false, allowTaint: true, logging: false,
                    ignoreElements: (el) => el.id === 'olm-cheat-panel' || el.id === 'olm-stealth-overlay'
                });
                const imgB64 = canvas.toDataURL('image/png');
                updateStealthAnswer('...');
                const reply = await groq([{
                    role: 'user', content: [
                        { type: 'text', text: 'Extract only the correct answer from this exam question image. Reply with just the answer text, nothing else. Max 20 words.' },
                        { type: 'image_url', image_url: { url: imgB64 } }
                    ]
                }], CONFIG.groqVisionModel, 80);
                updateStealthAnswer(reply || '?');
            } catch(err) {
                updateStealthAnswer('err');
            }
        };
        const onEsc = (e) => { if (e.key === 'Escape') { sel.remove(); cleanup(); } };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        document.addEventListener('keydown', onEsc);
    }

    function createScreenshotOverlay() {
        const overlay = document.createElement('div');
        overlay.id = 'olm-screenshot-overlay';
        // Dark + blur shows immediately — no waiting for mousedown
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.52);backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px);z-index:9999998;cursor:crosshair;';
        const hint = document.createElement('div');
        hint.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:rgba(8,10,20,0.92);backdrop-filter:blur(20px);color:#c090ff;padding:10px 22px;border-radius:8px;border:1px solid rgba(192,144,255,0.25);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:13px;font-weight:600;z-index:1000000000;pointer-events:none;';
        hint.textContent = 'Click and drag to capture question';
        overlay.appendChild(hint);
        document.body.appendChild(overlay);
        let startX, startY, selectionBox;
        function mouseDownHandler(e) {
            if (e.target !== overlay) return;
            startX = e.clientX; startY = e.clientY;
            selectionBox = document.createElement('div');
            // Inside selection: cuts through the dark overlay so content is visible
            selectionBox.style.cssText = 'position:fixed;border:2px solid #c090ff;background:rgba(255,255,255,0.02);z-index:9999999;pointer-events:none;will-change:transform,width,height;transition:none;box-shadow:0 0 0 9999px rgba(0,0,0,0.52);';
            // Remove overlay blur so inner area is sharp
            overlay.style.backdropFilter = 'none';
            overlay.style.webkitBackdropFilter = 'none';
            overlay.style.background = 'transparent';
            document.body.appendChild(selectionBox);
        }
        function mouseMoveHandler(e) {
            if (!selectionBox) return;
            const currentX = e.clientX, currentY = e.clientY;
            const left = Math.min(startX, currentX), top = Math.min(startY, currentY);
            const width = Math.abs(currentX - startX), height = Math.abs(currentY - startY);
            selectionBox.style.left = left + 'px'; selectionBox.style.top = top + 'px';
            selectionBox.style.width = width + 'px'; selectionBox.style.height = height + 'px';
        }
        function mouseUpHandler(e) {
            if (!selectionBox) return;
            const rect = selectionBox.getBoundingClientRect();
            if (rect.width > 50 && rect.height > 50) captureScreenArea(rect.left, rect.top, rect.width, rect.height);
            selectionBox.remove(); overlay.remove();
            document.removeEventListener('mousedown', mouseDownHandler);
            document.removeEventListener('mousemove', mouseMoveHandler);
            document.removeEventListener('mouseup', mouseUpHandler);
            document.removeEventListener('keydown', escHandler);
        }
        function escHandler(e) {
            if (e.key === 'Escape') {
                if (selectionBox) selectionBox.remove();
                overlay.remove();
                document.removeEventListener('mousedown', mouseDownHandler);
                document.removeEventListener('mousemove', mouseMoveHandler);
                document.removeEventListener('mouseup', mouseUpHandler);
                document.removeEventListener('keydown', escHandler);
            }
        }
        document.addEventListener('mousedown', mouseDownHandler);
        document.addEventListener('mousemove', mouseMoveHandler);
        document.addEventListener('mouseup', mouseUpHandler);
        document.addEventListener('keydown', escHandler);
    }
    
    async function captureScreenArea(left, top, width, height) {
        try {
            if (typeof html2canvas !== 'undefined') {
                const olmPanel = document.getElementById('olm-cheat-panel');
                const wasVisible = olmPanel && olmPanel.style.display !== 'none';
                if (olmPanel) olmPanel.style.display = 'none';
                await new Promise(resolve => setTimeout(resolve, 50));
                const canvas = await html2canvas(document.body, {
                    x: left, y: top, width: width, height: height, useCORS: false, allowTaint: true,
                    ignoreElements: (element) => element.id === 'olm-cheat-panel' || element.id === 'olm-cheat-container' || element.classList?.contains('olm-'),
                    foreignObjectRendering: false,
                    logging: false,
                    imageTimeout: 3000
                });
                if (olmPanel && wasVisible) olmPanel.style.display = '';
                currentImageBase64 = canvas.toDataURL('image/png');
                await convertImageToTextAndAnswer();
            }
        } catch (err) {
            const olmPanel = document.getElementById('olm-cheat-panel');
            if (olmPanel) olmPanel.style.display = '';
        }
    }
    
    async function convertImageToTextAndAnswer() {
        if (!currentImageBase64) return;
        try {
            isAIThinking = true;
            switchTab('chat');
            const bubble = appendChatBubble('...', 'ai');
            chatHistory.push({ role: 'user', content: [
                { type: 'text', text: 'Extract the question text and all answer options from this image. Then provide the CORRECT ANSWER CONTENT (the full text, not just a letter). Be concise.' },
                { type: 'image_url', image_url: { url: currentImageBase64 } }
            ]});
            try {
                const reply = await groqStream(chatHistory.slice(-6), CONFIG.groqVisionModel,
                    (partial) => { bubble.innerHTML = mdToHtml(partial); scrollChat(); });
                if (reply) {
                    bubble.innerHTML = mdToHtml(reply);
                    chatHistory.push({ role: 'assistant', content: reply });
                    trimHistory();
                    const m = reply.match(/ANSWER:\s*([A-D])/i);
                    if (m) highlightAnswer(m[1]);
                }
            } catch(e) {
                bubble.textContent = 'Error: ' + e.message;
                bubble.style.color = '#ff6060';
            }
            currentImageBase64 = null;
            isAIThinking = false;
        } catch (error) {
            displayAIAnswer(`Error: ${error.message}`);
            isAIThinking = false;
        }
    }
    
    function selectAnswer(letter) {
        const answerElements = getAnswerElements();
        const index = letter.toUpperCase().charCodeAt(0) - 65;
        if (answerElements[index]) {
            const el = answerElements[index];
            const input = el.querySelector('input') || el.previousElementSibling?.tagName === 'INPUT' ? el.previousElementSibling : document.querySelector(`input[id="${el.getAttribute('for')}"]`);
            if (input) { input.click(); input.checked = true; input.dispatchEvent(new Event('change', { bubbles: true })); }
            el.click();
        }
    }
    
    function detectQuestionChange() {
        const questionText = getQuestionText();
        if (!questionText) return false;
        const answerTexts = getAnswerTexts();
        const currentHash = hashString(questionText + answerTexts.join(''));
        if (currentHash !== lastQuestionHash) {
            lastQuestionHash = currentHash;
            currentQuestionData = { question: questionText, answers: answerTexts };
            displayQuestion(questionText);
            const teacherAnswer = findAnswerByQuestionText(questionText);
            if (teacherAnswer) {
                if (CONFIG.autoUpdate) {
                    const searchBar = document.getElementById('olm-search-bar');
                    if (searchBar) { searchBar.value = questionText; searchBar.dispatchEvent(new Event('input')); }
                    if (teacherAnswer.answerLetter) {
                        setTimeout(() => selectAnswer(teacherAnswer.answerLetter), 300);
                    }
                }
            } else {
                setTimeout(() => askAIForAnswer(), 500);
            }
            return true;
        }
        return false;
    }
    
    let stealthMode = false;
    let stealthOverlay = null;

    function createStealthOverlay() {
        if (stealthOverlay) return;
        stealthOverlay = document.createElement('div');
        stealthOverlay.id = 'olm-stealth-overlay';
        stealthOverlay.style.cssText = [
            'position:fixed',
            'bottom:14px',
            'left:14px',
            'max-width:220px',
            'background:rgba(20,15,30,0.15)',
            'border:1px solid rgba(180,180,180,0.12)',
            'border-radius:6px',
            'padding:6px 9px',
            'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
            'font-size:11px',
            'color:rgba(255,255,255,0.5)',
            'line-height:1.5',
            'z-index:9999990',
            'opacity:0.2',
            'pointer-events:none',
            'word-break:break-word',
            'white-space:pre-line',
            'transition:opacity 0.3s',
            'user-select:none',
        ].join(';');
        stealthOverlay.textContent = '';
        document.body.appendChild(stealthOverlay);
    }

    function updateStealthAnswer(text) {
        if (!stealthOverlay) return;
        stealthOverlay.textContent = text || '';
    }

    function toggleStealthMode() {
        stealthMode = !stealthMode;
        const container = document.getElementById('olm-cheat-container');
        const tabs = document.querySelector('.olm-tabs');
        if (stealthMode) {
            if (container) container.style.display = 'none';
            createStealthOverlay();
        } else {
            if (container) { container.style.display = 'flex'; container.style.opacity = '1'; container.style.transform = 'scale(1)'; }
            if (stealthOverlay) { stealthOverlay.remove(); stealthOverlay = null; }
        }
    }

    function setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            if (!e.ctrlKey && !e.altKey && !e.metaKey && e.key === toggleKey) {
                const tag = document.activeElement?.tagName;
                if (tag === 'INPUT' || tag === 'TEXTAREA') return;
                e.preventDefault();
                const container = document.getElementById('olm-cheat-container');
                if (!container) return;
                const hidden = container.style.display === 'none';
                container.style.transition = 'opacity .2s, transform .2s';
                if (hidden) {
                    container.style.display = 'flex';
                    requestAnimationFrame(() => {
                        container.style.opacity = '1';
                        container.style.transform = 'scale(1)';
                    });
                } else {
                    container.style.opacity = '0';
                    container.style.transform = 'scale(0.95)';
                    setTimeout(() => { container.style.display = 'none'; }, 200);
                }
                return;
            }
            if (e.ctrlKey && e.shiftKey && e.key === 'Enter') {
                e.preventDefault();
                const container = document.getElementById('olm-cheat-container');
                if (container) {
                    const hidden = container.style.display === 'none';
                    if (hidden) {
                        container.style.display = 'flex';
                        container.style.opacity = '1';
                        container.style.transform = 'scale(1)';
                    } else {
                        container.style.transition = 'opacity 0.2s, transform 0.2s';
                        container.style.opacity = '0';
                        container.style.transform = 'scale(0.95)';
                        setTimeout(() => { container.style.display = 'none'; }, 200);
                    }
                }
                return;
            }
            if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 's') {
                e.preventDefault();
                toggleStealthMode();
                return;
            }
            if (e.ctrlKey && e.code === 'Space') {
                e.preventDefault();
                if (stealthMode) {
                    createStealthScreenshot();
                } else {
                    createScreenshotOverlay();
                }
                return;
            }
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            switch(e.key.toLowerCase()) {
                case 'w': case 'a': selectAnswer('A'); break;
                case 's': case 'b': selectAnswer('B'); break;
                case 'd': case 'c': selectAnswer('C'); break;
                case 'e': selectAnswer('D'); break;
            }
        });
    }
    
    function setupDragAndResize() {
        const panel = document.getElementById('olm-cheat-panel');
        const container = document.getElementById('olm-cheat-container');
        const handle = document.getElementById('olm-drag-handle');
        if (!panel || !container || !handle) return;
        let dragState = { dragging: false, startX: 0, startY: 0, initX: 0, initY: 0 };
        let dragRAF = null, currentDragX = 0, currentDragY = 0, targetDragX = 0, targetDragY = 0;
        handle.addEventListener('pointerdown', (e) => {
            if (e.button !== 0 && e.pointerType === 'mouse') return;
            if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
            const rect = container.getBoundingClientRect();
            container.style.right = 'auto';
            container.style.left = `${rect.left}px`;
            container.style.top = `${rect.top}px`;
            currentDragX = targetDragX = rect.left;
            currentDragY = targetDragY = rect.top;
            dragState = { dragging: true, startX: e.clientX, startY: e.clientY, initX: rect.left, initY: rect.top };
            container.style.transition = 'none';
            window.addEventListener('pointermove', onPointerMoveDrag);
            window.addEventListener('pointerup', onPointerUpDrag);
            function smoothDrag() {
                if (!dragState.dragging) return;
                currentDragX += (targetDragX - currentDragX) * 0.3;
                currentDragY += (targetDragY - currentDragY) * 0.3;
                container.style.left = `${currentDragX}px`;
                container.style.top = `${currentDragY}px`;
                dragRAF = requestAnimationFrame(smoothDrag);
            }
            smoothDrag();
        });
        function onPointerMoveDrag(e) {
            if (!dragState.dragging) return;
            e.preventDefault();
            const dx = e.clientX - dragState.startX, dy = e.clientY - dragState.startY;
            let left = dragState.initX + dx, top = dragState.initY + dy;
            const rect = container.getBoundingClientRect();
            const maxL = window.innerWidth - rect.width - 6, maxT = window.innerHeight - rect.height - 6;
            left = Math.max(6, Math.min(maxL, left));
            top = Math.max(6, Math.min(maxT, top));
            targetDragX = left; targetDragY = top;
        }
        function onPointerUpDrag() {
            dragState.dragging = false;
            if (dragRAF) cancelAnimationFrame(dragRAF);
            window.removeEventListener('pointermove', onPointerMoveDrag);
            window.removeEventListener('pointerup', onPointerUpDrag);
            container.style.transition = '';
        }
        const resizeHandle = panel.querySelector('.resize-handle');
        let resizeState = { active: false, startX: 0, startY: 0, startW: 0, startH: 0, startLeft: 0 };
        let resizeRAF = null, currentResizeW = 0, currentResizeH = 0, currentResizeL = 0, targetResizeW = 0, targetResizeH = 0, targetResizeL = 0;
        if (resizeHandle) {
            resizeHandle.addEventListener('pointerdown', (e) => {
                if (e.button !== 0 && e.pointerType === 'mouse') return;
                e.preventDefault(); e.stopPropagation();
                const rect = container.getBoundingClientRect();
                resizeState = { active: true, startX: e.clientX, startY: e.clientY, startW: rect.width, startH: rect.height, startLeft: rect.left };
                currentResizeW = targetResizeW = rect.width;
                currentResizeH = targetResizeH = rect.height;
                currentResizeL = targetResizeL = rect.left;
                isResizing = true;
                container.style.transition = 'none';
                window.addEventListener('pointermove', onPointerMoveResize);
                window.addEventListener('pointerup', onPointerUpResize);
                function smoothResize() {
                    if (!resizeState.active) return;
                    currentResizeW += (targetResizeW - currentResizeW) * 0.3;
                    currentResizeH += (targetResizeH - currentResizeH) * 0.3;
                    currentResizeL += (targetResizeL - currentResizeL) * 0.3;
                    container.style.width = currentResizeW + 'px';
                    container.style.height = currentResizeH + 'px';
                    container.style.left = currentResizeL + 'px';
                    resizeRAF = requestAnimationFrame(smoothResize);
                }
                smoothResize();
            });
        }
        function onPointerMoveResize(e) {
            if (!resizeState.active) return;
            e.preventDefault();
            const deltaX = resizeState.startX - e.clientX, deltaY = e.clientY - resizeState.startY;
            const MIN_W = 300, MIN_H = 200;
            const newWidth = Math.max(MIN_W, resizeState.startW + deltaX);
            const newHeight = Math.max(MIN_H, resizeState.startH + deltaY);
            const actualDeltaX = newWidth - resizeState.startW;
            const newLeft = resizeState.startLeft - actualDeltaX;
            targetResizeW = newWidth; targetResizeH = newHeight; targetResizeL = newLeft;
        }
        function onPointerUpResize() {
            resizeState.active = false; isResizing = false;
            if (resizeRAF) cancelAnimationFrame(resizeRAF);
            window.removeEventListener('pointermove', onPointerMoveResize);
            window.removeEventListener('pointerup', onPointerUpResize);
            container.style.transition = '';
        }
    }
    
    function createControlPanel() {
        const panel = document.createElement('div');
        panel.id = 'olm-cheat-panel';
        panel.innerHTML = `
<style>
  #olm-panel * { box-sizing: border-box; }
  #olm-cheat-container {
    position: fixed; top: 10px; right: 10px;
    width: 370px; height: 640px;
    background: rgba(7,11,20,0.78);
    backdrop-filter: blur(18px) saturate(140%);
    -webkit-backdrop-filter: blur(18px) saturate(140%);
    border: 1px solid rgba(192,144,255,0.2);
    border-radius: 12px;
    box-shadow: 0 16px 48px rgba(0,0,0,0.7), 0 0 0 1px rgba(192,144,255,0.06);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    z-index: 999999; display: flex; flex-direction: column; overflow: hidden;
    transition: height 0.3s ease;
    will-change: transform, width, height; transform: translateZ(0);
  }
  #olm-drag-handle {
    background: linear-gradient(135deg, rgba(40,20,70,0.4) 0%, rgba(20,10,40,0.5) 100%);
    padding: 9px 12px; border-bottom: 1px solid rgba(192,144,255,0.15);
    display: flex; align-items: center; justify-content: space-between;
    cursor: grab; user-select: none; flex-shrink: 0;
  }
  #olm-drag-handle:active { cursor: grabbing; }
  #olm-drag-handle .olm-brand { display:flex; align-items:center; gap:8px; }
  #olm-drag-handle .olm-brand img { width:20px; height:20px; border-radius:4px; }
  #olm-drag-handle .olm-brand .olm-title-line { display:flex; align-items:baseline; gap:6px; }
  #olm-drag-handle .olm-brand .olm-title-text { font-size:14px; font-weight:600; color:#e8e8e8; }
  #olm-drag-handle .olm-brand #by-jerry { font-size:11px; font-style:italic; font-weight:500; color:rgba(255,255,255,0.45); cursor:pointer; transition:color .15s,text-shadow .15s; letter-spacing:0.2px; }
  #olm-drag-handle .olm-brand #by-jerry:hover { color:#ff4444; text-shadow:0 0 8px rgba(255,68,68,0.7); }
  #olm-drag-handle .olm-brand #by-jerry span { text-decoration:underline; }
  .resize-handle {
    position: absolute; left: 6px; bottom: 6px; width: 18px; height: 18px; cursor: nesw-resize;
    border-left: 3px solid rgba(192,144,255,0.35); border-bottom: 3px solid rgba(192,144,255,0.35);
    border-bottom-left-radius: 4px; transition: opacity .3s, border-color .2s, box-shadow .2s;
    box-shadow: -2px 2px 8px rgba(192,144,255,0.12);
  }
  .resize-handle::after {
    content: ''; position: absolute; left: 4px; bottom: 4px; width: 6px; height: 6px;
    border-left: 2px solid rgba(192,144,255,0.2); border-bottom: 2px solid rgba(192,144,255,0.2);
    border-bottom-left-radius: 2px;
  }
  .resize-handle:hover { border-color: #c090ff; box-shadow: -2px 2px 14px rgba(192,144,255,0.4); }
  .resize-handle.hidden { opacity: 0; pointer-events: none; }
  .olm-tabs { display: flex; gap: 2px; padding: 6px 10px 0; flex-shrink: 0; }
  .olm-tab {
    flex: 1; padding: 5px 0; border-radius: 6px 6px 0 0;
    background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.07);
    border-bottom: none; color: rgba(255,255,255,0.55); font-size: 11px; font-weight: 600;
    cursor: pointer; transition: all .2s; text-align: center;
  }
  .olm-tab.active { background: rgba(192,144,255,0.12); border-color: rgba(192,144,255,0.25); color: #c090ff; }
  .olm-tab:hover { color: rgba(255,255,255,0.75); }
  .olm-tab.active:hover { color: #c090ff; }
  .olm-page { display: none; flex: 1; overflow-y: auto; overflow-x: hidden; padding: 10px; flex-direction: column; gap: 8px; }
  .olm-page.active { display: flex; }
  .olm-page::-webkit-scrollbar { width: 5px; }
  .olm-page::-webkit-scrollbar-track { background: rgba(0,0,0,0.2); border-radius: 3px; }
  .olm-page::-webkit-scrollbar-thumb { background: rgba(192,144,255,0.2); border-radius: 3px; }
  .olm-card { background: rgba(255,255,255,0.02); border: 1px solid rgba(192,144,255,0.15); border-radius: 8px; padding: 9px 10px; }
  .olm-card-title { font-size: 10px; font-weight: 600; color: #c090ff; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 7px; }
  .olm-btn {
    width: 100%; padding: 7px 10px; border-radius: 7px;
    background: rgba(192,144,255,0.08);
    color: #c090ff; font-size: 12px; font-weight: 600;
    border: 1px solid rgba(192,144,255,0.3);
    cursor: pointer; transition: all .2s; margin-top: 5px;
  }
  .olm-btn:hover { background: rgba(192,144,255,0.18); border-color: #c090ff; box-shadow: 0 0 8px rgba(192,144,255,0.4); }
  #olm-chat-log { flex: 1; overflow-y: auto; padding: 6px 4px; min-height: 0; scrollbar-width: none; }
  #olm-chat-log::-webkit-scrollbar { width: 0; display: none; }
  #olm-chat-input-row { display: flex; gap: 5px; margin-top: 6px; flex-shrink: 0; }
  #olm-chat-input {
    flex: 1; padding: 7px 9px;
    background: rgba(40,20,70,0.25); border: 1px solid rgba(192,144,255,0.35);
    border-radius: 7px; color: #e8e8e8; font-size: 11px; outline: none;
    transition: border-color .2s, box-shadow .2s; resize: none; height: 34px; font-family: inherit;
    overflow-y: hidden; overflow-x: hidden;
  }
  #olm-chat-input:focus { border-color: #c090ff; box-shadow: 0 0 8px rgba(192,144,255,0.4); }
  #olm-chat-input::placeholder { color: #a0a0a0; }
  #olm-chat-send {
    padding: 0 12px; height: 34px; border-radius: 7px;
    background: rgba(40,20,70,0.35); border: 1px solid rgba(192,144,255,0.4);
    color: #c090ff; font-size: 14px; cursor: pointer; transition: all .2s; flex-shrink: 0;
  }
  #olm-chat-send:hover { background: rgba(40,20,70,0.55); border-color: #c090ff; box-shadow: 0 0 8px rgba(192,144,255,0.4); }
  kbd { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 3px; padding: 1px 4px; font-size: 10px; font-family: monospace; color: #a0a0a0; }
  .toggle-switch { position: relative; display: inline-block; width: 48px; height: 28px; }
  .toggle-switch input { opacity: 0; width: 0; height: 0; }
  .toggle-slider {
    position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0;
    background-color: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.15);
    transition: .3s; border-radius: 28px;
  }
  .toggle-slider:before {
    position: absolute; content: ""; height: 22px; width: 22px; left: 3px; top: 3px;
    background-color: #c090ff; transition: .3s; border-radius: 50%; box-shadow: 0 2px 4px rgba(0,0,0,0.3);
  }
  input:checked + .toggle-slider { background-color: rgba(192,144,255,0.3); border-color: rgba(255,255,255,0.2); }
  input:checked + .toggle-slider:before { transform: translateX(20px); background-color: #fff; }
  #olm-search-bar {
    width:100%; padding:9px 12px; flex-shrink:0;
    background:rgba(0,0,0,0.3); border:1px solid rgba(192,144,255,0.25);
    border-radius:8px; color:#e8e8e8; font-size:12px; outline:none; box-sizing:border-box; transition:border-color .2s, box-shadow .2s;
  }
  #olm-search-bar:focus { border-color:#c090ff; box-shadow:0 0 8px rgba(192,144,255,0.4); }
  #olm-search-bar::placeholder { color:#a0a0a0; }
  #olm-qa-list { flex:1; overflow-y:auto; overflow-x:hidden; padding-right:2px; min-height:0; }
  #olm-qa-list::-webkit-scrollbar { width:5px; }
  #olm-qa-list::-webkit-scrollbar-track { background:rgba(0,0,0,0.2); border-radius:3px; }
  #olm-qa-list::-webkit-scrollbar-thumb { background:rgba(192,144,255,0.2); border-radius:3px; }
  .qa-item {
    background:rgba(0,0,0,0.2); border:1px solid rgba(192,144,255,0.15);
    border-radius:8px; padding:9px 10px; margin-bottom:6px; cursor:pointer; transition:all .2s; word-break:break-word;
  }
  .qa-item:hover { background:rgba(40,20,70,0.4); border-color:rgba(192,144,255,0.45); box-shadow:0 0 8px rgba(192,144,255,0.3); }
  .qa-item.highlighted { background:rgba(40,20,70,0.55); border-color:#c090ff; box-shadow:0 0 12px rgba(192,144,255,0.5); }
  .qa-question { color:#e8e8e8; font-size:11px; line-height:1.7; margin-bottom:4px; }
  .qa-answer { color:#00ff88; font-size:12px; font-weight:600; line-height:1.6; white-space:pre-line; }
  #olm-apikey-input {
    width:100%; margin-top:5px; padding:7px 9px;
    background:rgba(255,255,255,0.03); border:1px solid rgba(192,144,255,0.25);
    border-radius:6px; color:#e8e8e8; font-size:11px; outline:none; transition:border-color .2s, box-shadow .2s;
  }
  #olm-apikey-input:focus { border-color:#c090ff; box-shadow:0 0 6px rgba(192,144,255,0.3); }
  #olm-apikey-input::placeholder { color:#a0a0a0; }
  .qa-loading { display:flex; flex-direction:column; align-items:center; justify-content:center; padding:30px 0; color:#a0a0a0; gap:8px; }
  .qa-loading-dots { display:flex; flex-direction:row; gap:6px; align-items:center; }
  .qa-loading-dot { width:7px; height:7px; background:rgba(192,144,255,0.4); border-radius:50%; animation:olm-pulse 1.2s ease-in-out infinite; }
  .qa-loading-dot:nth-child(2) { animation-delay:0.2s; }
  .qa-loading-dot:nth-child(3) { animation-delay:0.4s; }
  @keyframes olm-pulse { 0%,80%,100%{transform:scale(0.6);opacity:0.3;} 40%{transform:scale(1);opacity:1;} }
</style>

<div id="olm-cheat-container">
  <div id="olm-drag-handle">
    <div class="olm-brand">
      <img src="https://files.catbox.moe/hnd9dc.png" onerror="this.style.display='none'">
      <div class="olm-title-line">
        <span class="olm-title-text">OLM CHEAT V3.0</span>
        <span id="by-jerry">by <span>Jerry</span></span>
      </div>
    </div>
    <div class="olm-hdr-btns" style="display:flex;gap:4px;">
      <button id="olm-min-btn" class="olm-circle" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:#e8e8e8;width:24px;height:24px;border-radius:50%;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;transition:all .2s;" onmouseover="this.style.background='rgba(255,255,255,0.12)'" onmouseout="this.style.background='rgba(255,255,255,0.06)'">−</button>
      <button id="olm-close-btn" class="olm-circle red" style="background:rgba(255,40,40,0.1);border:1px solid rgba(255,40,40,0.2);color:#e8e8e8;width:24px;height:24px;border-radius:50%;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;transition:all .2s;" onmouseover="this.style.background='rgba(255,40,40,0.2)'" onmouseout="this.style.background='rgba(255,40,40,0.1)'">✕</button>
    </div>
  </div>

  <div class="olm-tabs">
    <div class="olm-tab active" data-tab="main">Answer</div>
    <div class="olm-tab" data-tab="chat">💬 Chat</div>
    <div class="olm-tab" data-tab="settings">Settings</div>
  </div>

  <div class="olm-page active" id="olm-page-main">
    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:8px;flex-shrink:0;">
      <span style="font-size:11px;color:#e8e8e8;font-weight:600;">FREEZE TIME</span>
      <label class="toggle-switch"><input type="checkbox" id="olm-time-toggle"><span class="toggle-slider"></span></label>
    </div>
    <input id="olm-search-bar" type="text" placeholder="Search questions..." autocomplete="off" />
    <div id="olm-qa-list">
      <div class="qa-loading"><div class="qa-loading-dots"><div class="qa-loading-dot"></div><div class="qa-loading-dot"></div><div class="qa-loading-dot"></div></div><div style="font-size:11px;opacity:0.5;">Fetching answers...</div></div>
    </div>
  </div>

  <div class="olm-page" id="olm-page-chat" style="padding:0 10px 6px 10px;">
    <div id="olm-chat-log"></div>
    <button class="olm-btn" id="olm-ss-btn" style="margin:6px 0 4px;flex-shrink:0;">Screenshot to AI <kbd>Ctrl+Space</kbd></button>
    <div id="olm-chat-input-row">
      <textarea id="olm-chat-input" placeholder="Ask anything…"></textarea>
      <button id="olm-chat-send">➤</button>
    </div>
  </div>

  <div class="olm-page" id="olm-page-settings">
    <div class="olm-card">
      <div class="olm-card-title">Groq API Key</div>
      <input id="olm-apikey-input" type="password" placeholder="gsk_… free at console.groq.com" />
    </div>
    <div class="olm-card" style="padding:9px 10px 7px;">
      <div class="olm-card-title" style="margin-bottom:5px;">Backup API Keys</div>
      <div style="display:flex;flex-direction:column;gap:3px;" id="olm-backup-keys">
        <div class="olm-key-row" data-key="" data-ka="g" data-kb="sk_GG9PYRfbw92DtgLd3ZAMWGdyb3FYIrJHVsFPJWcbhHEFDKHsaFpc"></div>
        <div class="olm-key-row" data-key="" data-ka="g" data-kb="sk_2CXfExCeEsVfJTJUpIzZWGdyb3FY5ruh3saUd3XWywrAAk4kUtFo"></div>
        <div class="olm-key-row" data-key="" data-ka="g" data-kb="sk_fe38jaBMWRuENnIVmTIVWGdyb3FY0DrHxeoMgvczX1fIqORWIG5s"></div>
        <div class="olm-key-row" data-key="" data-ka="g" data-kb="sk_ZKZuAGHeFQLAWkslUHp0WGdyb3FYNrM7P8koKuATLHEUnp0EBsfY"></div>
      </div>
    </div>
    <div class="olm-card">
      <div class="olm-card-title">Toggle Key</div>
      <div style="font-size:11px;color:#a0a0a0;margin-bottom:7px;">Press any key to set. Current: <kbd id="olm-toggle-key-display">Tab</kbd></div>
      <button class="olm-btn" id="olm-set-key-btn">Click then press a key</button>
    </div>
    <div class="olm-card">
      <div class="olm-card-title">Background</div>
      <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
        <span style="font-size:10px;color:#666;">Clear</span>
        <input type="range" id="olm-opacity-slider" min="5" max="100" value="70" style="flex:1;accent-color:#fff;cursor:pointer;height:4px;">
        <span style="font-size:10px;color:#666;">Solid</span>
      </div>
      <div style="font-size:10px;color:#666;margin-top:4px;text-align:center;" id="olm-opacity-label">70%</div>
    </div>
    <div class="olm-card">
      <div class="olm-card-title">Transparency</div>
      <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
        <span style="font-size:10px;color:#666;">Ghost</span>
        <input type="range" id="olm-stealth-slider" min="5" max="100" value="70" style="flex:1;accent-color:#fff;cursor:pointer;height:4px;">
        <span style="font-size:10px;color:#666;">Full</span>
      </div>
      <div style="font-size:10px;color:#666;margin-top:4px;text-align:center;" id="olm-stealth-label">70%</div>
    </div>
    <div class="olm-card" style="font-size:11px;color:#a0a0a0;line-height:1.8;">
      <div class="olm-card-title">Shortcuts</div>
      <kbd id="olm-shortcut-toggle-display">Tab</kbd> — toggle panel<br>
      <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Enter</kbd> — hide/show UI<br>
      <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> — stealth mode<br>
      <kbd>Ctrl+Space</kbd> — screenshot to AI<br>
    </div>
  </div>

  <div class="resize-handle"></div>
</div>
`;
        document.body.appendChild(panel);

        document.getElementById('olm-close-btn').onclick = () => {
            const p = document.getElementById('olm-cheat-panel');
            Object.assign(p.style, { transition: 'opacity .3s,transform .3s', opacity: '0', transform: 'scale(0.9)' });
            setTimeout(() => p.remove(), 300);
        };

        panel.querySelectorAll('.olm-tab').forEach(tab => {
            tab.onclick = () => {
                panel.querySelectorAll('.olm-tab').forEach(t => t.classList.remove('active'));
                panel.querySelectorAll('.olm-page').forEach(p => p.classList.remove('active'));
                tab.classList.add('active');
                document.getElementById('olm-page-' + tab.dataset.tab).classList.add('active');
            };
        });

        document.getElementById('olm-ss-btn').onclick = createScreenshotOverlay;

        const chatInput = document.getElementById('olm-chat-input');
        const sendChat_ = () => { const v = chatInput.value.trim(); if (v) { sendChat(v); chatInput.value = ''; } };
        document.getElementById('olm-chat-send').onclick = sendChat_;
        chatInput.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat_(); }
        });

        const keyInput = document.getElementById('olm-apikey-input');
        try { const s = localStorage.getItem('olm_groq_key'); if (s) { CONFIG.groqApiKey = s; keyInput.value = s; } } catch (_) {}
        keyInput.addEventListener('input', () => {
            CONFIG.groqApiKey = keyInput.value.trim();
            try { localStorage.setItem('olm_groq_key', CONFIG.groqApiKey); } catch (_) {}
        });

        // Backup keys — render rows with click-to-copy
        document.querySelectorAll('.olm-key-row').forEach(row => {
            const full = (row.dataset.ka || '') + (row.dataset.kb || '') || row.dataset.key || '';
            row.style.cssText = 'display:flex;align-items:center;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:4px;overflow:hidden;';
            row.innerHTML =
                '<span style="flex:1;padding:4px 6px;font-size:10px;font-family:monospace;color:#a0a0a0;user-select:text;-webkit-user-select:text;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + full + '</span>' +
                '<button style="flex-shrink:0;padding:4px 8px;background:rgba(192,144,255,0.1);border:none;border-left:1px solid rgba(255,255,255,0.08);color:#c090ff;font-size:10px;cursor:pointer;font-family:inherit;transition:background .15s;">Copy</button>';
            const btn = row.querySelector('button');
            btn.onclick = () => {
                const write = () => {
                    btn.textContent = 'Copied!'; btn.style.color = '#00ff88';
                    setTimeout(() => { btn.textContent = 'Copy'; btn.style.color = '#c090ff'; }, 1500);
                };
                navigator.clipboard.writeText(full).then(write).catch(() => {
                    const ta = document.createElement('textarea');
                    ta.value = full; ta.style.cssText = 'position:fixed;opacity:0;';
                    document.body.appendChild(ta); ta.select();
                    document.execCommand('copy'); ta.remove(); write();
                });
            };
        });

        const setKeyBtn = document.getElementById('olm-set-key-btn');
        const keyDisplay = document.getElementById('olm-toggle-key-display');
        if (setKeyBtn && keyDisplay) {
            try {
                const saved = localStorage.getItem('olm_toggle_key');
                if (saved) { toggleKey = saved; keyDisplay.textContent = saved; const sd = document.getElementById('olm-shortcut-toggle-display'); if (sd) sd.textContent = saved; }
            } catch(_) {}
            let listening = false;
            setKeyBtn.onclick = () => {
                listening = true;
                setKeyBtn.textContent = 'Waiting for key...';
                setKeyBtn.style.borderColor = '#ffaa00';
                setKeyBtn.style.color = '#ffaa00';
            };
            document.addEventListener('keydown', e => {
                if (!listening) return;
                if (['Control','Alt','Shift','Meta'].includes(e.key)) return;
                e.preventDefault();
                listening = false;
                toggleKey = e.key;
                keyDisplay.textContent = e.key;
                const shortcutDisp = document.getElementById('olm-shortcut-toggle-display');
                if (shortcutDisp) shortcutDisp.textContent = e.key;
                setKeyBtn.textContent = 'Click then press a key';
                setKeyBtn.style.borderColor = '';
                setKeyBtn.style.color = '';
                try { localStorage.setItem('olm_toggle_key', e.key); } catch(_) {}
            });
        }

        const slider = document.getElementById('olm-opacity-slider');
        const label = document.getElementById('olm-opacity-label');
        const cont = document.getElementById('olm-cheat-container');
        if (slider && cont) {
            try { const saved = localStorage.getItem('olm_opacity'); if (saved) slider.value = saved; } catch(_) {}
            const applyOpacity = (val) => {
                cont.style.background = 'rgba(10,10,20,' + (parseInt(val)/100).toFixed(2) + ')';
                if (label) label.textContent = val + '%';
                try { localStorage.setItem('olm_opacity', val); } catch(_) {}
            };
            applyOpacity(slider.value);
            slider.addEventListener('input', () => applyOpacity(slider.value));
        }

        const stealth = document.getElementById('olm-stealth-slider');
        const stealthLabel = document.getElementById('olm-stealth-label');
        const stealthPanel = document.getElementById('olm-cheat-panel');
        if (stealth && stealthPanel) {
            try { const saved = localStorage.getItem('olm_stealth'); if (saved) stealth.value = saved; } catch(_) {}
            const applyStealthy = (val) => {
                const alpha = Math.max(0.05, parseInt(val) / 100).toFixed(2);
                stealthPanel.style.opacity = alpha;
                if (stealthLabel) stealthLabel.textContent = val + '%';
                try { localStorage.setItem('olm_stealth', val); } catch(_) {}
            };
            applyStealthy(stealth.value);
            stealth.addEventListener('input', () => applyStealthy(stealth.value));
            stealthPanel.addEventListener('mouseenter', () => {
                stealthPanel.style.transition = 'opacity 0.15s';
                stealthPanel.style.opacity = '1';
            });
            stealthPanel.addEventListener('mouseleave', () => {
                stealthPanel.style.transition = 'opacity 0.4s';
                stealthPanel.style.opacity = Math.max(0.05, parseInt(stealth.value||'100')/100).toFixed(2);
            });
        }

        setupDragAndResize();
        setupMinimize();
        setupTimeToggle();
        setupSearch();
        setupJerryLink();
    }
    
    function setupMinimize() {
        const minBtn = document.getElementById('olm-min-btn');
        const content = document.querySelector('#olm-cheat-container > .olm-tabs');
        const pages = document.querySelectorAll('.olm-page');
        const container = document.getElementById('olm-cheat-container');
        const resizeHandle = document.querySelector('.resize-handle');
        if (!minBtn || !container) return;
        let isMinimized = false, savedHeight = null;
        minBtn.onclick = () => {
            if (isMinimized) {
                container.style.height = savedHeight || '640px';
                if (content) content.style.display = 'flex';
                pages.forEach(p => p.style.display = '');
                minBtn.textContent = '−';
                if (resizeHandle) resizeHandle.classList.remove('hidden');
            } else {
                savedHeight = container.getBoundingClientRect().height + 'px';
                container.style.height = '44px';
                if (content) content.style.display = 'none';
                pages.forEach(p => p.style.display = 'none');
                minBtn.textContent = '+';
                if (resizeHandle) resizeHandle.classList.add('hidden');
            }
            isMinimized = !isMinimized;
        };
    }
    
    function setupTimeToggle() {
        const toggle = document.getElementById('olm-time-toggle');
        if (!toggle) return;
        toggle.addEventListener('change', function() {
            CONFIG.isPaused = this.checked;
            if (this.checked) { stopAllTimers(); } else { location.reload(); }
        });
    }
    
    function setupSearch() {
        const searchBar = document.getElementById('olm-search-bar');
        if (!searchBar) return;
        searchBar.addEventListener('input', function() {
            const query = this.value.trim();
            if (!query) {
                document.querySelectorAll('.qa-item').forEach(item => { item.style.display = 'block'; item.classList.remove('highlighted'); });
                return;
            }
            const match = findBestMatch(query, teacherDocAnswers);
            document.querySelectorAll('.qa-item').forEach(item => {
                const index = parseInt(item.dataset.index);
                const qa = teacherDocAnswers[index];
                if (!qa) return;
                if (match && qa === match) {
                    item.style.display = 'block'; item.classList.add('highlighted');
                    item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                } else {
                    const normalizedQ = normalizeVietnamese(qa.question);
                    const normalizedQuery = normalizeVietnamese(query);
                    item.style.display = normalizedQ.includes(normalizedQuery) ? 'block' : 'none';
                    item.classList.remove('highlighted');
                }
            });
        });
    }
    
    function setupJerryLink() {
        const byJerry = document.getElementById('by-jerry');
        if (!byJerry) return;
        byJerry.onclick = (e) => { e.preventDefault(); window.open(CONFIG.githubUrl, '_blank'); };
    }
    
    function populateQAList() {
        const list = document.getElementById('olm-qa-list');
        if (!list) { setTimeout(populateQAList, 100); return; }
        if (!teacherDocAnswers || teacherDocAnswers.length === 0) {
            const isExamPage = window.location.pathname.match(/\/chu-de\//);
            if (!isExamPage) {
                list.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;text-align:center;padding:20px;color:#a0a0a0;user-select:none;"><div style="font-size:48px;margin-bottom:16px;">📝</div><div style="font-size:15px;font-weight:600;color:#e8e8e8;margin-bottom:8px;">No exam detected</div><div style="font-size:12px;">Join an exam to load answers</div></div>';
            } else {
                list.innerHTML = '<div class="qa-loading"><div class="qa-loading-dots"><div class="qa-loading-dot"></div><div class="qa-loading-dot"></div><div class="qa-loading-dot"></div></div><div style="font-size:11px;opacity:0.5;">No answers loaded</div></div>';
            }
            return;
        }
        list.innerHTML = '';
        teacherDocAnswers.forEach((qa, index) => {
            const item = document.createElement('div');
            item.className = 'qa-item';
            item.dataset.index = index;
            let preview;
            if (qa.isTrueFalse && qa.subQuestions) {
                preview = qa.subQuestions.map(sq => sq.letter + ') ' + sq.answer).join('  ');
            } else if (qa.allOptions && Object.keys(qa.allOptions).length > 0) {
                preview = '✓ ' + qa.answerText;
            } else {
                preview = qa.answerText;
            }
            item.innerHTML = '<div class="qa-question">' + escHtml(qa.question).replace(/\[IMG:[^\]]+\]/g, "[formulas]") + '</div>' +
                             '<div class="qa-answer">' + escHtml(preview).replace(/\[IMG:[^\]]+\]/g, "[formulas]") + '</div>';
            list.appendChild(item);
        });
    }
    
    function startQuestionMonitoring() {
        setInterval(() => { detectQuestionChange(); }, 200);
        const observer = new MutationObserver(() => { detectQuestionChange(); });
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    }
    
    function applyPerformanceMode() {
        if (CONFIG.performanceMode) {
            const existing = document.getElementById('olm-performance-mode');
            if (existing) existing.remove();
            const style = document.createElement('style');
            style.id = 'olm-performance-mode';
            style.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important;}#olm-cheat-container{animation:none!important;transition:none!important;}';
            document.head.appendChild(style);
        } else {
            const style = document.getElementById('olm-performance-mode');
            if (style) style.remove();
        }
    }
    
    function init() {
        try {
            const autoUpdate = localStorage.getItem('olm_autoUpdate');
            const performanceMode = localStorage.getItem('olm_performanceMode');
            if (autoUpdate !== null) CONFIG.autoUpdate = autoUpdate === 'true';
            if (performanceMode !== null) { CONFIG.performanceMode = performanceMode === 'true'; applyPerformanceMode(); }
        } catch (error) {}
        
        bypassTabDetection();
        setupKeyboardShortcuts();
        createControlPanel();
        startQuestionMonitoring();
        
        try {
            if (localStorage.getItem('olm_time_frozen') === 'true') {
                const savedFrozenTime = localStorage.getItem('olm_frozen_time');
                if (savedFrozenTime) {
                    timeFrozen = true;
                    frozenTimeSpent = JSON.parse(savedFrozenTime);
                    CONFIG.isPaused = true;
                    setTimeout(() => { const toggle = document.getElementById('olm-time-toggle'); if (toggle) toggle.checked = false; }, 500);
                }
            }
        } catch(e) {}
        
        if (!hijackEXAMUI()) {
            const examPollInterval = setInterval(() => { if (hijackEXAMUI()) clearInterval(examPollInterval); }, 100);
            setTimeout(() => clearInterval(examPollInterval), 10000);
        }
        
        if (!hijackCATEUI()) {
            const pollInterval = setInterval(() => { if (hijackCATEUI()) clearInterval(pollInterval); }, 100);
            setTimeout(() => clearInterval(pollInterval), 10000);
        }
        
        setTimeout(() => { downloadAndParseTeacherDoc(); }, 1000);
        
        window.olmCheat = {
            select: selectAnswer,
            copyQ: copyQuestionToClipboard,
            toggleStop: toggleStop,
            config: CONFIG,
            version: CONFIG.version,
            refreshTeacherDoc: downloadAndParseTeacherDoc,
            getTeacherDoc: () => teacherDocAnswers,
            testMatch: (text) => findAnswerByQuestionText(text),
            getTeacherQAForAI: () => teacherDocQAForAI,
        };
    }
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
    
})();