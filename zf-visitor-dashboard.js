(function () {
  const config = window.ZF_SUPABASE_DEMO;
  const sessionKey = 'zf-visitor-dashboard-session';
  const loginView = document.querySelector('[data-login-view]');
  const dashboardView = document.querySelector('[data-dashboard-view]');
  const form = document.querySelector('[data-login-form]');
  const loginButton = document.querySelector('[data-login-button]');
  const loginError = document.querySelector('[data-login-error]');
  const dashboardError = document.querySelector('[data-dashboard-error]');
  const dashboardContent = document.querySelector('[data-dashboard-content]');
  const loading = document.querySelector('[data-loading]');
  const status = document.querySelector('[data-status]');
  const range = document.querySelector('[data-range]');
  const periodLabel = document.querySelector('[data-period-label]');
  let session = null;

  function show(element, visible) {
    element.hidden = !visible;
  }

  function setStatus(text, state) {
    status.className = 'connection-status' + (state ? ' is-' + state : '');
    status.lastChild.textContent = text;
  }

  function setLoginError(message) {
    loginError.textContent = message;
    show(loginError, Boolean(message));
  }

  function setDashboardError(message) {
    dashboardError.textContent = message;
    show(dashboardError, Boolean(message));
  }

  function saveSession(value) {
    session = value;
    if (value) sessionStorage.setItem(sessionKey, JSON.stringify(value));
    else sessionStorage.removeItem(sessionKey);
  }

  function loadSession() {
    try {
      return JSON.parse(sessionStorage.getItem(sessionKey) || 'null');
    } catch {
      return null;
    }
  }

  async function authRequest(path, body) {
    const response = await fetch(config.url + path, {
      method: 'POST',
      headers: {
        apikey: config.publishableKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      credentials: 'omit',
      signal: AbortSignal.timeout(10_000),
    });
    const payload = await response.json().catch(function () { return {}; });
    if (!response.ok) {
      throw new Error(payload.error_description || payload.msg || 'Authentication failed.');
    }
    return payload;
  }

  async function refreshSession() {
    const refreshed = await authRequest('/auth/v1/token?grant_type=refresh_token', {
      refresh_token: session.refresh_token,
    });
    saveSession(refreshed);
  }

  async function fetchReport() {
    let response = await fetch(config.url + '/rest/v1/rpc/get_zf_visitor_dashboard', {
      method: 'POST',
      headers: {
        apikey: config.publishableKey,
        Authorization: 'Bearer ' + session.access_token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_days: Number(range.value) }),
      credentials: 'omit',
      signal: AbortSignal.timeout(12_000),
    });

    if (response.status === 401 && session.refresh_token) {
      await refreshSession();
      response = await fetch(config.url + '/rest/v1/rpc/get_zf_visitor_dashboard', {
        method: 'POST',
        headers: {
          apikey: config.publishableKey,
          Authorization: 'Bearer ' + session.access_token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ p_days: Number(range.value) }),
        credentials: 'omit',
        signal: AbortSignal.timeout(12_000),
      });
    }

    const payload = await response.json().catch(function () { return {}; });
    if (!response.ok) {
      const detail = payload.message || payload.msg || 'The report could not be loaded.';
      const error = new Error(detail);
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function number(value) {
    return new Intl.NumberFormat('en-AU').format(Number(value) || 0);
  }

  function shortDate(value) {
    return new Date(value + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
  }

  function sum(items, key) {
    return items.reduce(function (total, item) { return total + (Number(item[key]) || 0); }, 0);
  }

  function setMetric(name, value) {
    document.querySelector('[data-metric="' + name + '"]').textContent = value;
  }

  function renderMetrics(report) {
    const daily = report.daily || [];
    const pageViews = sum(daily, 'page_views');
    const sessions = sum(daily, 'anonymous_sessions');
    const actions = sum(daily, 'interest_actions');
    const interestedSessions = sum(daily, 'interested_sessions');
    setMetric('page_views', number(pageViews));
    setMetric('anonymous_sessions', number(sessions));
    setMetric('interest_actions', number(actions));
    setMetric('interest_rate', sessions ? ((interestedSessions / sessions) * 100).toFixed(1) + '%' : '0%');
  }

  function renderTrend(report) {
    const chart = document.querySelector('[data-trend-chart]');
    const daily = report.daily || [];
    chart.replaceChildren();
    if (!daily.length) {
      const empty = document.createElement('div');
      empty.className = 'chart-empty';
      empty.textContent = 'No page activity has been recorded for this period.';
      chart.appendChild(empty);
      return;
    }

    const visible = daily.slice(-30);
    const max = Math.max(1, ...visible.map(function (item) { return Number(item.page_views) || 0; }));
    const plot = document.createElement('div');
    const labels = document.createElement('div');
    plot.className = 'chart-plot';
    labels.className = 'chart-labels';
    plot.style.setProperty('--columns', visible.length);
    labels.style.setProperty('--columns', visible.length);

    visible.forEach(function (item, index) {
      const pair = document.createElement('div');
      const views = document.createElement('i');
      const interest = document.createElement('i');
      pair.className = 'bar-pair';
      pair.title = shortDate(item.visit_date) + ': ' + number(item.page_views) + ' views, ' + number(item.interest_actions) + ' actions';
      views.className = 'chart-bar views';
      interest.className = 'chart-bar interest';
      views.style.height = Math.max(1, (Number(item.page_views) / max) * 100) + '%';
      interest.style.height = Math.max(1, (Number(item.interest_actions) / max) * 100) + '%';
      pair.append(views, interest);
      plot.appendChild(pair);

      const label = document.createElement('span');
      const showLabel = visible.length <= 14 || index % Math.ceil(visible.length / 10) === 0;
      label.textContent = showLabel ? shortDate(item.visit_date) : '';
      labels.appendChild(label);
    });

    chart.append(plot, labels);
  }

  function renderPages(report) {
    const target = document.querySelector('[data-pages]');
    target.replaceChildren();
    const pages = report.pages || [];
    if (!pages.length) {
      const row = target.insertRow();
      const cell = row.insertCell();
      cell.colSpan = 5;
      cell.className = 'table-empty';
      cell.textContent = 'No page data yet.';
      return;
    }

    pages.forEach(function (page) {
      const row = target.insertRow();
      const pageCell = row.insertCell();
      pageCell.className = 'page-name';
      pageCell.textContent = page.page_path;
      row.insertCell().textContent = number(page.page_views);
      row.insertCell().textContent = number(page.anonymous_sessions);
      row.insertCell().textContent = number(page.interest_actions);
      const sessions = Number(page.anonymous_sessions) || 0;
      row.insertCell().textContent = sessions ? ((Number(page.interest_actions) / sessions) * 100).toFixed(1) + '%' : '0%';
    });
  }

  function renderRanks(selector, items, labelKey) {
    const target = document.querySelector(selector);
    target.replaceChildren();
    if (!items.length) {
      const empty = document.createElement('p');
      empty.className = 'list-empty';
      empty.textContent = 'No data yet.';
      target.appendChild(empty);
      return;
    }
    const maximum = Math.max(1, ...items.map(function (item) { return Number(item.page_views) || 0; }));
    items.slice(0, 8).forEach(function (item) {
      const row = document.createElement('div');
      const name = document.createElement('strong');
      const value = document.createElement('span');
      const track = document.createElement('div');
      const fill = document.createElement('i');
      row.className = 'rank-item';
      name.textContent = item[labelKey] === 'ZZ' ? 'Unknown' : item[labelKey];
      value.textContent = number(item.page_views) + ' views · ' + number(item.interest_actions) + ' actions';
      track.className = 'rank-track';
      fill.style.width = Math.max(3, (Number(item.page_views) / maximum) * 100) + '%';
      track.appendChild(fill);
      row.append(name, value, track);
      target.appendChild(row);
    });
  }

  function renderSignals(report) {
    const target = document.querySelector('[data-signals]');
    const totals = (report.pages || []).reduce(function (result, page) {
      ['pricing_clicks', 'contact_clicks', 'email_clicks', 'phone_clicks'].forEach(function (key) {
        result[key] += Number(page[key]) || 0;
      });
      return result;
    }, { pricing_clicks: 0, contact_clicks: 0, email_clicks: 0, phone_clicks: 0 });
    const signals = [
      ['Email', totals.email_clicks],
      ['Contact page', totals.contact_clicks],
      ['Pricing page', totals.pricing_clicks],
      ['Phone', totals.phone_clicks],
    ].sort(function (a, b) { return b[1] - a[1]; });
    const maximum = Math.max(1, ...signals.map(function (item) { return item[1]; }));
    target.replaceChildren();
    signals.forEach(function (item) {
      const row = document.createElement('div');
      const label = document.createElement('strong');
      const value = document.createElement('span');
      const track = document.createElement('div');
      const fill = document.createElement('i');
      row.className = 'signal-row';
      label.textContent = item[0];
      value.textContent = number(item[1]);
      track.className = 'signal-track';
      fill.style.width = Math.max(2, (item[1] / maximum) * 100) + '%';
      track.appendChild(fill);
      row.append(label, value, track);
      target.appendChild(row);
    });
  }

  function renderReport(report) {
    renderMetrics(report);
    renderTrend(report);
    renderPages(report);
    renderRanks('[data-sources]', report.sources || [], 'source');
    renderRanks('[data-countries]', report.countries || [], 'country_code');
    renderSignals(report);
    const generated = new Date(report.generated_at).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });
    periodLabel.textContent = range.value + ' days · Updated ' + generated;
  }

  async function loadReport() {
    if (!session) return;
    setStatus('Loading', 'loading');
    setDashboardError('');
    show(loading, true);
    show(dashboardContent, false);
    try {
      const report = await fetchReport();
      renderReport(report);
      show(dashboardContent, true);
      setStatus('Updated', '');
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        saveSession(null);
        showDashboard(false);
        setLoginError('Your session is not authorised for this dashboard.');
        return;
      }
      setDashboardError(error.message || 'The report could not be loaded.');
      setStatus('Error', 'error');
    } finally {
      show(loading, false);
    }
  }

  function showDashboard(visible) {
    show(loginView, !visible);
    show(dashboardView, visible);
    if (visible) void loadReport();
  }

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    setLoginError('');
    if (!config || !config.url || !config.publishableKey) {
      setLoginError('Supabase configuration is missing. Set the local publishable key before signing in.');
      return;
    }
    loginButton.disabled = true;
    loginButton.textContent = 'Signing in...';
    try {
      const authenticated = await authRequest('/auth/v1/token?grant_type=password', {
        email: form.email.value.trim(),
        password: form.password.value,
        gotrue_meta_security: {},
      });
      saveSession(authenticated);
      form.password.value = '';
      showDashboard(true);
    } catch (error) {
      setLoginError(error.message || 'Email or password was not accepted.');
    } finally {
      loginButton.disabled = false;
      loginButton.textContent = 'Sign in';
    }
  });

  document.querySelector('[data-refresh]').addEventListener('click', loadReport);
  range.addEventListener('change', loadReport);
  document.querySelector('[data-logout]').addEventListener('click', async function () {
    if (session && config) {
      try {
        await fetch(config.url + '/auth/v1/logout', {
          method: 'POST',
          headers: { apikey: config.publishableKey, Authorization: 'Bearer ' + session.access_token },
          credentials: 'omit',
        });
      } catch { /* Local session revocation still completes. */ }
    }
    saveSession(null);
    setLoginError('');
    showDashboard(false);
    form.email.focus();
  });

  session = loadSession();
  if (session && session.access_token) showDashboard(true);
  else showDashboard(false);
}());
