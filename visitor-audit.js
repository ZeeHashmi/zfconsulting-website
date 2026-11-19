(() => {
  "use strict";
  const byId = (id) => document.getElementById(id);
  const endpoint = window.ZF_SUPABASE_DEMO?.url
    ? window.ZF_SUPABASE_DEMO.url.replace(/\/+$/, "") + "/functions/v1/visitor-audit"
    : "";
  const config = window.ZF_SUPABASE_DEMO || {};
  const status = byId("audit-status");

  function detect() {
    const ua = navigator.userAgent || "";
    const browser = /Edg\//.test(ua) ? "Microsoft Edge"
      : /Firefox\//.test(ua) ? "Firefox"
      : /CriOS|Chrome\//.test(ua) ? "Chrome"
      : /Safari\//.test(ua) && !/Chrome|CriOS/.test(ua) ? "Safari"
      : /OPR\//.test(ua) ? "Opera" : "Other";
    const os = /Windows NT/.test(ua) ? "Windows"
      : /Mac OS X/.test(ua) ? "macOS"
      : /Android/.test(ua) ? "Android"
      : /iPhone|iPad|iPod/.test(ua) ? "iOS"
      : /Linux/.test(ua) ? "Linux" : "Other";
    const device = /iPad|Tablet/.test(ua) ? "Tablet"
      : /Mobile|iPhone|Android/.test(ua) ? "Mobile" : "Desktop";
    return { browser, os, device };
  }

  function visitorId() {
    const key = "zfVisitorAuditId";
    let value = sessionStorage.getItem(key);
    if (!value) {
      value = crypto.randomUUID();
      sessionStorage.setItem(key, value);
    }
    return value;
  }

  function render() {
    const details = detect();
    const id = visitorId();
    byId("visitor-ref").textContent = "ZF-" + id.slice(0, 8).toUpperCase();
    byId("visitor-browser").textContent = details.browser;
    byId("visitor-os").textContent = details.os;
    byId("visitor-device").textContent = details.device;
    byId("visitor-time").textContent = new Intl.DateTimeFormat("en-AU", {
      dateStyle: "long", timeStyle: "medium", timeZoneName: "short"
    }).format(new Date());
  }

  async function record() {
    if (!config.publishableKey || !endpoint) {
      status.textContent = "The visitor audit service has not been configured yet. Your local visitor preview is still available.";
      status.classList.add("error");
      return;
    }
    const button = byId("audit-consent");
    button.disabled = true;
    status.classList.remove("error");
    status.textContent = "Submitting your consented visit record…";
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": config.publishableKey,
          "Authorization": "Bearer " + config.publishableKey
        },
        body: JSON.stringify({ visitorId: visitorId(), path: location.pathname })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "The visit could not be recorded.");
      localStorage.setItem("zfVisitorAuditConsent", "yes");
      status.textContent = "Your visitor record has been created. The private security log retains it for up to 30 days.";
      button.textContent = "Record created";
    } catch (error) {
      status.textContent = error.message || "The visit could not be recorded. Please try again later.";
      status.classList.add("error");
      button.disabled = false;
    }
  }

  byId("audit-consent").addEventListener("click", record);
  byId("audit-refresh").addEventListener("click", () => {
    render();
    status.textContent = "Visitor details refreshed.";
  });
  render();
  if (localStorage.getItem("zfVisitorAuditConsent") === "yes") {
    status.textContent = "You previously consented to visitor audit recording in this browser. This page will not submit another event automatically.";
  }
})();