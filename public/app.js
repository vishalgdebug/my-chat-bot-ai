// ============================================================
// CHAT FRONTEND
// ============================================================
// Sends each user message + the running history to /api/chat,
// reads the streamed Server-Sent Events response, and types
// the AI reply into the page chunk-by-chunk.
// ============================================================

const messagesEl = document.getElementById('messages');
const formEl = document.getElementById('composer');
const inputEl = document.getElementById('composer-input');
const sendBtn = document.getElementById('composer-send');
const onboardModal = document.getElementById('onboard-modal');
const onboardClose = document.getElementById('onboard-close');
const onboardStart = document.getElementById('onboard-start');
const actionButtons = document.querySelectorAll('.action-card');

const confidenceValue = document.getElementById('confidence-value');
const confidenceFill = document.getElementById('confidence-fill');
const streakValue = document.getElementById('streak-value');
const streakFill = document.getElementById('streak-fill');
const xpValue = document.getElementById('xp-value');
const xpFill = document.getElementById('xp-fill');
const ptsValue = document.getElementById('pts-value');
const rebValue = document.getElementById('reb-value');
const astValue = document.getElementById('ast-value');

const history = [];
const onboardKey = 'knicksRookieOnboardSeen';
const statsKey = 'knicksRookieStats';
const maxXp = 2500;

const defaultStats = {
  confidence: 0,
  streak: 0,
  xp: 0,
  pts: 0,
  reb: 0,
  ast: 0,
};

let stats = loadStats();
renderStats();

formEl.addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = inputEl.value.trim();
  if (!text) return;

  await sendPrompt(text);
});

actionButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const prompt = button.dataset.prompt;
    if (!prompt || sendBtn.disabled) return;
    inputEl.value = prompt;
    formEl.requestSubmit();
  });
});

onboardClose.addEventListener('click', hideOnboard);
onboardStart.addEventListener('click', () => {
  localStorage.setItem(onboardKey, 'true');
  hideOnboard();
  inputEl.focus();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && event.target === inputEl && !event.shiftKey) {
    if (!sendBtn.disabled) {
      event.preventDefault();
      formEl.requestSubmit();
    }
  }
});

window.addEventListener('load', () => {
  if (!localStorage.getItem(onboardKey)) {
    showOnboard();
  }
});

async function sendPrompt(text) {
  inputEl.value = '';
  setBusy(true);

  appendMessage('user', text);
  history.push({ role: 'user', text });

  applyProgress();

  const aiBubble = appendMessage('assistant', '', { streaming: true });

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: history }),
    });

    if (!response.ok || !response.body) {
      const errText = await response.text().catch(() => '');
      throw new Error(errText || `Request failed (${response.status})`);
    }

    let assistantText = '';
    for await (const event of readSseStream(response.body)) {
      if (event === '[DONE]') break;
      let payload;
      try {
        payload = JSON.parse(event);
      } catch {
        continue;
      }
      if (payload.error) throw new Error(payload.error);
      if (payload.text) {
        assistantText += payload.text;
        aiBubble.textContent = assistantText;
        scrollToBottom();
      }
    }

    history.push({ role: 'assistant', text: assistantText });
  } catch (err) {
    aiBubble.textContent = `⚠️ ${err.message}`;
  } finally {
    aiBubble.parentElement.classList.remove('is-streaming');
    setBusy(false);
    inputEl.focus();
  }
}

function applyProgress() {
  stats.xp = Math.min(maxXp, stats.xp + 50);
  stats.confidence = Math.min(100, stats.confidence + 3);
  stats.streak += 1;

  stats.pts = Math.min(12, Math.floor(stats.xp / 200));
  stats.reb = Math.min(6, Math.floor(stats.xp / 350));
  stats.ast = Math.min(5, Math.floor(stats.xp / 500));

  saveStats();
  renderStats();
}

function renderStats() {
  confidenceValue.textContent = `${stats.confidence}%`;
  confidenceFill.style.width = `${stats.confidence}%`;

  streakValue.textContent = `${stats.streak} days`;
  streakFill.style.width = `${Math.min(100, stats.streak * 10)}%`;

  xpValue.textContent = `${stats.xp} / ${maxXp}`;
  xpFill.style.width = `${(stats.xp / maxXp) * 100}%`;

  ptsValue.textContent = stats.pts;
  rebValue.textContent = stats.reb;
  astValue.textContent = stats.ast;
}

function loadStats() {
  try {
    const stored = JSON.parse(localStorage.getItem(statsKey));
    if (stored && typeof stored === 'object') {
      return { ...defaultStats, ...stored };
    }
  } catch {
    // ignore invalid saved data
  }
  localStorage.setItem(statsKey, JSON.stringify(defaultStats));
  return { ...defaultStats };
}

function saveStats() {
  localStorage.setItem(statsKey, JSON.stringify(stats));
}

function setBusy(busy) {
  inputEl.disabled = busy;
  sendBtn.disabled = busy;
  sendBtn.textContent = busy ? '...' : 'Send';
}

function appendMessage(role, text, { streaming = false } = {}) {
  const wrapper = document.createElement('div');
  wrapper.className = `message message-${role === 'assistant' ? 'ai' : 'user'}`;
  if (streaming) wrapper.classList.add('is-streaming');

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.textContent = text;
  wrapper.appendChild(bubble);

  messagesEl.appendChild(wrapper);
  scrollToBottom();
  return bubble;
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function showOnboard() {
  onboardModal.style.display = 'flex';
}

function hideOnboard() {
  onboardModal.style.display = 'none';
}

async function* readSseStream(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sep;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const dataLine = frame
        .split('\n')
        .find((l) => l.startsWith('data: '));
      if (dataLine) yield dataLine.slice(6);
    }
  }
}
