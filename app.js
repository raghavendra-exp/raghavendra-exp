// ==========================================================================
// Constants & State
// ==========================================================================
const OLLAMA_URL = 'http://localhost:11434';
let chatHistory = []; // Current session messages
let isGenerating = false;

// DOM Elements
const elements = {
    form: document.getElementById('chat-form'),
    input: document.getElementById('user-input'),
    sendBtn: document.getElementById('send-btn'),
    micBtn: document.getElementById('mic-btn'),
    messagesContainer: document.getElementById('messages-container'),
    welcomeScreen: document.getElementById('welcome-screen'),
    typingIndicator: document.getElementById('typing-indicator'),
    modelSelector: document.getElementById('model-selector'),
    statusDot: document.querySelector('.status-dot'),
    statusText: document.querySelector('.status-text'),
    setupInstruction: document.getElementById('setup-instruction'),
    mobileMenuBtn: document.getElementById('mobile-menu-btn'),
    sidebar: document.getElementById('sidebar'),
    suggestionChips: document.querySelectorAll('.chip')
};

// ==========================================================================
// Utility: Simple Offline Markdown Parser
// ==========================================================================
function parseMarkdown(text) {
    if (!text) return '';
    
    // Escape HTML to prevent XSS
    let html = text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    
    // Code blocks: ```language\n code \n```
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, code) => {
        return `<pre><code class="language-${lang}">${code}</code></pre>`;
    });
    
    // Inline code: `code`
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    
    // Bold: **text**
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    
    // Italic: *text*
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    
    // Newlines to <br> (outside of logic blocks, basically replace \n with <br>)
    // To avoid breaking <pre> tags, a more robust approach is needed, but for simple chat this works:
    html = html.split('</pre>').map(part => {
        if (!part.includes('<pre>')) {
            return part.replace(/\n/g, '<br>');
        }
        let subparts = part.split('<pre>');
        subparts[0] = subparts[0].replace(/\n/g, '<br>');
        return subparts.join('<pre>');
    }).join('</pre>');

    return html;
}

// ==========================================================================
// Voice & Speech Modules
// ==========================================================================
let recognition;
let isListening = false;
let synthesis = window.speechSynthesis;
let currentVoice = null;

function initVoice() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
        recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = false;
        
        recognition.onstart = () => {
            isListening = true;
            elements.micBtn.classList.add('mic-active');
            elements.input.placeholder = "Listening...";
        };
        
        recognition.onerror = (event) => {
            console.error("Speech recognition error:", event.error);
            stopListening();
        };
        
        recognition.onend = () => {
            stopListening();
        };
        
        recognition.onresult = (event) => {
            let finalTranscript = '';
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    finalTranscript += event.results[i][0].transcript;
                }
            }
            if (finalTranscript) {
                elements.input.value = (elements.input.value + " " + finalTranscript).trim();
                elements.input.dispatchEvent(new Event('input'));
                
                if (elements.input.value.length > 0 && !elements.sendBtn.disabled) {
                    elements.sendBtn.click(); // Safe way to trigger form submit
                }
            }
        };
        
        if (synthesis) {
            const setVoices = () => {
                const voices = synthesis.getVoices();
                currentVoice = voices.find(v => v.name.includes('Google UK English')) || 
                               voices.find(v => v.name.includes('Zira')) || 
                               voices.find(v => v.lang.startsWith('en-')) || voices[0];
            };
            synthesis.onvoiceschanged = setVoices;
            setVoices();
        }
        
        elements.micBtn.addEventListener('click', () => {
            if (isListening) {
                recognition.stop();
            } else {
                recognition.start();
            }
        });
    } else {
        if(elements.micBtn) elements.micBtn.style.display = 'none';
    }
}

function stopListening() {
    isListening = false;
    if (elements.micBtn) elements.micBtn.classList.remove('mic-active');
    elements.input.placeholder = "Message Nexus... (Shift+Enter for newline)";
}

function speakText(text) {
    if (!synthesis) return;
    synthesis.cancel();
    
    // Strip markdown formatting for speech
    const plainText = text.replace(/[*_#`~]+/g, '').replace(/\[(.*?)\]\(.*?\)/g, '$1');
    const utterance = new SpeechSynthesisUtterance(plainText);
    if (currentVoice) utterance.voice = currentVoice;
    
    const toggleOrb = (isSpeaking) => {
        const orb = document.querySelector('.glow-orb');
        if (orb) {
            isSpeaking ? orb.classList.add('orb-speaking') : orb.classList.remove('orb-speaking');
        }
    };
    
    // Attach to window to prevent Chrome garbage collection
    window.currentUtterance = utterance;
    
    utterance.onstart = () => toggleOrb(true);
    utterance.onend = () => { toggleOrb(false); window.currentUtterance = null; };
    utterance.onerror = () => { toggleOrb(false); window.currentUtterance = null; };
    
    synthesis.speak(utterance);
}

// ==========================================================================
// Initialization & Check
// ==========================================================================
async function init() {
    await checkConnection();
    await fetchModels();
    
    initVoice();
    
    // Auto-resize textarea
    elements.input.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
        if (this.value.trim().length > 0 && !isGenerating) {
            elements.sendBtn.disabled = false;
        } else {
            elements.sendBtn.disabled = true;
        }
    });

    // Handle Enter to send (Shift+Enter for newline)
    elements.input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!elements.sendBtn.disabled) {
                elements.form.dispatchEvent(new Event('submit'));
            }
        }
    });

    // Form submit
    elements.form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const msg = elements.input.value.trim();
        if (!msg || isGenerating) return;
        
        await handleSend(msg);
    });

    // Suggestion chips
    elements.suggestionChips.forEach(chip => {
        chip.addEventListener('click', () => {
            elements.input.value = chip.textContent;
            elements.input.dispatchEvent(new Event('input')); // Trigger resize and enable button
            elements.form.dispatchEvent(new Event('submit'));
        });
    });

    // Mobile menu toggle
    elements.mobileMenuBtn.addEventListener('click', () => {
        elements.sidebar.classList.toggle('open');
    });
}

async function checkConnection() {
    try {
        const res = await fetch(OLLAMA_URL, { method: 'GET' });
        if (res.ok) {
            elements.statusDot.className = 'status-dot connected';
            elements.statusText.textContent = 'Engine Online';
            elements.setupInstruction.classList.add('hidden');
            return true;
        }
    } catch (e) {
        elements.statusDot.className = 'status-dot disconnected';
        elements.statusText.textContent = 'Engine Offline';
        elements.setupInstruction.classList.remove('hidden');
        return false;
    }
}

async function fetchModels() {
    try {
        const res = await fetch(`${OLLAMA_URL}/api/tags`);
        if (!res.ok) throw new Error('Failed to fetch models');
        
        const data = await res.json();
        const models = data.models || [];
        
        elements.modelSelector.innerHTML = '';
        if (models.length === 0) {
            elements.modelSelector.innerHTML = '<option>No models installed</option>';
            elements.setupInstruction.classList.remove('hidden');
        } else {
            models.forEach(model => {
                const opt = document.createElement('option');
                opt.value = model.name;
                opt.textContent = model.name;
                elements.modelSelector.appendChild(opt);
            });
        }
    } catch (e) {
        elements.modelSelector.innerHTML = '<option>Offline Mode</option>';
        console.error("Could not fetch models:", e);
    }
}

// ==========================================================================
// Chat Logic
// ==========================================================================
async function handleSend(msg) {
    // 1. UI Updates
    elements.welcomeScreen.style.display = 'none';
    elements.input.value = '';
    elements.input.style.height = 'auto';
    elements.sendBtn.disabled = true;
    isGenerating = true;
    
    // Add User Message
    addMessageToDOM('user', msg);
    chatHistory.push({ role: 'user', content: msg });
    
    // 2. Prepare API Call
    const activeModel = elements.modelSelector.value;
    elements.typingIndicator.classList.remove('hidden');
    scrollToBottom();
    
    // Create assistant message container
    const assistantMsgId = 'msg-' + Date.now();
    const assistantContentEl = addMessageToDOM('assistant', '', assistantMsgId);
    
    try {
        const response = await fetch(`${OLLAMA_URL}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: activeModel,
                messages: chatHistory,
                stream: true
            })
        });

        if (!response.ok) throw new Error('Network response was not ok');

        // 3. Handle Streaming Response
        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let fullResponse = '';

        elements.typingIndicator.classList.add('hidden');

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');
            
            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const parsed = JSON.parse(line);
                    if (parsed.message?.content) {
                        fullResponse += parsed.message.content;
                        // Update DOM incrementally
                        assistantContentEl.innerHTML = parseMarkdown(fullResponse);
                        scrollToBottom();
                    }
                } catch (e) {
                    console.error("Error parsing JSON chunk", e);
                }
            }
        }
        
        // Finalize History
        chatHistory.push({ role: 'assistant', content: fullResponse });
        
        // Speak Response
        speakText(fullResponse);

    } catch (error) {
        console.error("Error:", error);
        elements.typingIndicator.classList.add('hidden');
        assistantContentEl.innerHTML = `<span style="color: #ef4444;">Connection failed. Is Ollama running?</span>`;
    } finally {
        isGenerating = false;
        elements.input.focus();
        if (elements.input.value.trim().length > 0) {
            elements.sendBtn.disabled = false;
        }
    }
}

function addMessageToDOM(role, content, id = null) {
    const wrapper = document.createElement('div');
    wrapper.className = `message ${role}`;
    if (id) wrapper.id = id;

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = role === 'user' ? 'U' : 'AI';

    const msgContent = document.createElement('div');
    msgContent.className = 'msg-content';
    msgContent.innerHTML = parseMarkdown(content);

    wrapper.appendChild(avatar);
    wrapper.appendChild(msgContent);
    elements.messagesContainer.appendChild(wrapper);
    
    scrollToBottom();
    return msgContent; // Return the content element so we can stream into it
}

function scrollToBottom() {
    elements.chatWindow = document.getElementById('chat-window');
    elements.chatWindow.scrollTop = elements.chatWindow.scrollHeight;
}

// Start app
window.addEventListener('DOMContentLoaded', init);
