(function () {
  const widget = document.querySelector('[data-zee-ai-widget]');
  if (!widget) return;

  const launcher = widget.querySelector('[data-zee-launcher]');
  const panel = widget.querySelector('[data-zee-panel]');
  const close = widget.querySelector('[data-zee-close]');
  const form = widget.querySelector('[data-zee-form]');
  const input = widget.querySelector('[data-zee-input]');
  const send = widget.querySelector('.zee-ai-send');
  const messages = widget.querySelector('[data-zee-messages]');
  const config = window.ZF_SUPABASE_DEMO;
  const conversation = [];
  const visitorStorageKey = 'zee-ai-demo-visitor-id';
  let accessGranted = false;
  let accessBlocked = false;

  widget.hidden = true;

  async function checkAccess() {
    if (!config || !config.url || !config.publishableKey) return;

    try {
      const response = await fetch(
        config.url + '/functions/v1/zee-ai-demo/access',
        {
          headers: { apikey: config.publishableKey },
          signal: AbortSignal.timeout(6_000),
        },
      );
      const payload = await response.json();
      if (!response.ok || payload.allowed !== true) return;

      accessGranted = true;
      widget.hidden = false;
      if (widget.hasAttribute('data-embedded')) {
        launcher.hidden = true;
        panel.hidden = false;
      }
    } catch {
      widget.hidden = true;
    }
  }

  void checkAccess();

  function addMessage(text, type) {
    const message = document.createElement('div');
    message.className = 'zee-message zee-message-' + type;
    message.textContent = text;
    messages.appendChild(message);
    messages.scrollTop = messages.scrollHeight;
  }

  function getVisitorId() {
    let visitorId = localStorage.getItem(visitorStorageKey);
    if (!visitorId) {
      visitorId = crypto.randomUUID();
      localStorage.setItem(visitorStorageKey, visitorId);
    }
    return visitorId;
  }

  launcher.addEventListener('click', function () {
    if (!accessGranted || accessBlocked) return;
    panel.hidden = false;
    launcher.setAttribute('aria-expanded', 'true');
    input.focus();
  });

  close.addEventListener('click', function () {
    panel.hidden = true;
    launcher.setAttribute('aria-expanded', 'false');
    if (widget.hasAttribute('data-embedded')) {
      launcher.hidden = false;
      launcher.focus();
    }
  });

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    if (!accessGranted || accessBlocked) return;
    const text = input.value.trim();
    if (!text || send.disabled) return;

    if (!config || !config.url || !config.publishableKey) {
      addMessage('The AI demo is not configured yet. Please try again later.', 'assistant');
      return;
    }

    addMessage(text, 'user');
    input.value = '';
    send.disabled = true;
    input.disabled = true;

    try {
      const response = await fetch(config.url + '/functions/v1/zee-ai-demo', {
        method: 'POST',
        headers: {
          apikey: config.publishableKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          visitorId: getVisitorId(),
          history: conversation.slice(-8),
          message: text,
          experience: widget.dataset.zeeAiMode === 'agent' ? 'agent' : 'zee-ai',
        }),
      });

      let payload;
      try {
        payload = await response.json();
      } catch {
        throw new Error('Zee AI is temporarily unavailable. Please try again later.');
      }

      if (!response.ok) {
        if (response.status === 403 && payload && payload.blocked === true) {
          accessBlocked = true;
          panel.hidden = true;
          widget.hidden = true;
          return;
        }
        const errorMessage = payload && typeof payload.error === 'string'
          ? payload.error
          : 'Zee AI is temporarily unavailable. Please try again later.';
        throw new Error(errorMessage);
      }

      if (!payload || typeof payload.reply !== 'string' || payload.reply.trim().length === 0) {
        throw new Error('Zee AI returned an invalid response. Please try again later.');
      }

      conversation.push({ role: 'user', content: text });
      conversation.push({ role: 'assistant', content: payload.reply });
      if (conversation.length > 10) conversation.splice(0, conversation.length - 10);
      addMessage(payload.reply, 'assistant');
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : 'Zee AI is temporarily unavailable. Please try again later.';
      addMessage(message, 'assistant');
    } finally {
      send.disabled = false;
      input.disabled = false;
      input.focus();
    }
  });
}());
