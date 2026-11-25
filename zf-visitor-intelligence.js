(function () {
  const config = window.ZF_SUPABASE_DEMO;
  if (!config || !config.url || !config.publishableKey) return;

  const trackedPages = new Set([
    'index.html',
    'ai-agent.html',
    'ai-automation.html',
    'ai-security-governance.html',
    'api-security-testing.html',
    'contact.html',
    'cyber-security-pricing.html',
    'cyber-security.html',
    'cybersecurity.html',
    'free-performance-testing.html',
    'penetration-testing.html',
    'software-testing.html',
    'zee-ai.html',
  ]);

  const page = (window.location.pathname.split('/').pop() || 'index.html').toLowerCase();
  if (!trackedPages.has(page)) return;

  const sessionKey = 'zf-visitor-intelligence-session';
  let sessionId = sessionStorage.getItem(sessionKey);
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    sessionStorage.setItem(sessionKey, sessionId);
  }

  const params = new URLSearchParams(window.location.search);
  const endpoint = config.url + '/functions/v1/zf-visitor-intelligence';

  function cleanCampaign(value) {
    return (value || '').trim().slice(0, 80).replace(/[\u0000-\u001f\u007f]/g, '');
  }

  function referrerDomain() {
    if (!document.referrer) return null;
    try {
      const referrer = new URL(document.referrer);
      if (referrer.origin === window.location.origin) return null;
      return referrer.hostname.toLowerCase().slice(0, 160);
    } catch {
      return null;
    }
  }

  function eventPayload(eventType, signal) {
    const payload = {
      sessionId,
      eventType,
      page,
      referrerDomain: referrerDomain(),
      utmSource: cleanCampaign(params.get('utm_source')) || null,
      utmMedium: cleanCampaign(params.get('utm_medium')) || null,
      utmCampaign: cleanCampaign(params.get('utm_campaign')) || null,
    };
    if (signal) payload.signal = signal;
    return payload;
  }

  function send(payload) {
    fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: config.publishableKey,
      },
      body: JSON.stringify(payload),
      keepalive: true,
      credentials: 'omit',
      signal: AbortSignal.timeout(4_000),
    }).catch(function () {});
  }

  send(eventPayload('page_view'));

  document.addEventListener('click', function (event) {
    const link = event.target.closest('a[href]');
    if (!link) return;

    const href = (link.getAttribute('href') || '').trim();
    let signal = null;
    if (/^mailto:/i.test(href)) signal = 'email';
    else if (/^tel:/i.test(href)) signal = 'phone';
    else if (/pricing\.html(?:[?#]|$)/i.test(href)) signal = 'pricing';
    else if (/^contact\.html(?:[?#]|$)/i.test(href)) signal = 'contact';
    if (!signal) return;

    send(eventPayload('interest_click', signal));
  });
}());
