(function () {
  const widget = document.querySelector('[data-zee-ai-widget]');
  if (!widget) return;
  const launcher = widget.querySelector('[data-zee-launcher]');
  const panel = widget.querySelector('[data-zee-panel]');
  const close = widget.querySelector('[data-zee-close]');
  const form = widget.querySelector('[data-zee-form]');
  const input = widget.querySelector('[data-zee-input]');
  const messages = widget.querySelector('[data-zee-messages]');
  function addMessage(text, type) { const message = document.createElement('div'); message.className = 'zee-message zee-message-' + type; message.textContent = text; messages.appendChild(message); messages.scrollTop = messages.scrollHeight; }
  function replyTo(text) { const value = text.toLowerCase(); if (value.includes('security') || value.includes('cyber')) return 'ZF Consulting can discuss authorised security assessments, AI security testing and practical remediation recommendations.'; if (value.includes('test') || value.includes('quality')) return 'We can help with test strategy, Playwright, Selenium, API testing, JMeter performance testing and quality engineering.'; if (value.includes('automation') || value.includes('workflow')) return 'Zee AI can support knowledge work, document generation and workflow automation. Tell us what process you want to improve.'; if (value.includes('price') || value.includes('cost') || value.includes('quote')) return 'Project pricing depends on scope and integrations. Email info@zfconsulting.com.au to discuss your requirements.'; return 'Thanks for your message. This is the Zee AI website demonstration. For a detailed response, email info@zfconsulting.com.au.'; }
  launcher.addEventListener('click', function () { panel.hidden = false; launcher.setAttribute('aria-expanded', 'true'); input.focus(); });
  close.addEventListener('click', function () { panel.hidden = true; launcher.setAttribute('aria-expanded', 'false'); });
  form.addEventListener('submit', function (event) { event.preventDefault(); const text = input.value.trim(); if (!text) return; addMessage(text, 'user'); input.value = ''; window.setTimeout(function () { addMessage(replyTo(text), 'assistant'); }, 250); });
}());
