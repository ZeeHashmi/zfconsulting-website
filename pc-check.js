"use strict";

const runButton = document.querySelector("#run-checks");
const summary = document.querySelector("#run-summary");
const hero = document.querySelector(".hero");
const main = document.querySelector("#main");
const checkingIndicator = document.querySelector("#checking-indicator");

const statusLabels = {
    pass: "Looks OK",
    warning: "Needs attention",
    pending: "Not run",
};

function showResult(name, state, message) {
    const status = document.querySelector(`#${name}-status`);
    const result = document.querySelector(`#${name}-result`);

    status.dataset.state = state;
    status.textContent = statusLabels[state];
    result.textContent = message;
}

function getPlatform() {
    const platform = navigator.userAgentData?.platform;
    if (platform) {
        return platform;
    }

    const agent = navigator.userAgent;
    if (/Windows/i.test(agent)) return "Windows";
    if (/Android/i.test(agent)) return "Android";
    if (/iPhone|iPad|iPod/i.test(agent)) return "iOS";
    if (/Macintosh|Mac OS X/i.test(agent)) return "macOS";
    if (/Linux/i.test(agent)) return "Linux";
    return "Not identified by this browser";
}

function getBrowser() {
    const agent = navigator.userAgent;
    const browsers = [
        ["Microsoft Edge", /Edg(?:A|iOS)?\/([\d.]+)/],
        ["Opera", /OPR\/([\d.]+)/],
        ["Google Chrome", /(?:Chrome|CriOS)\/([\d.]+)/],
        ["Mozilla Firefox", /(?:Firefox|FxiOS)\/([\d.]+)/],
        ["Safari", /Version\/([\d.]+).*Safari/],
    ];

    for (const [name, pattern] of browsers) {
        const match = agent.match(pattern);
        if (match) {
            return `${name} ${match[1]}`;
        }
    }

    return "Browser name not identified";
}

function showDeviceInfo() {
    document.querySelector("#device-platform").textContent = getPlatform();
    document.querySelector("#device-browser").textContent = getBrowser();
    document.querySelector("#device-display").textContent =
        `${window.screen.width} × ${window.screen.height} px screen; ` +
        `${window.innerWidth} × ${window.innerHeight} px page`;
}

async function checkConnection() {
    if (!navigator.onLine) {
        return {
            state: "warning",
            message: "Your browser reports that it is offline.",
        };
    }

    let timeout;
    try {
        const controller = new AbortController();
        timeout = window.setTimeout(() => controller.abort(), 8000);

        const url = new URL(window.location.href);
        url.searchParams.set("pc-check", Date.now().toString());
        const response = await fetch(url, {
            cache: "no-store",
            signal: controller.signal,
        });

        if (!response.ok) {
            return {
                state: "warning",
                message: "This website did not return a successful response.",
            };
        }

        return {
            state: "pass",
            message: "This website responded successfully.",
        };
    } catch (error) {
        return {
            state: "warning",
            message: error.name === "AbortError"
                ? "The request timed out. Try again later."
                : "This website could not be reached from this browser.",
        };
    } finally {
        window.clearTimeout(timeout);
    }
}

function checkHttps() {
    return window.location.protocol === "https:"
        ? {
            state: "pass",
            message: "This page is using HTTPS.",
        }
        : {
            state: "warning",
            message: "This page is not using HTTPS. Do not enter personal information here.",
        };
}

function checkBrowserSupport() {
    const missingFeatures = [];
    if (typeof window.fetch !== "function") missingFeatures.push("fetch");
    if (typeof window.AbortController !== "function") missingFeatures.push("request timeouts");

    return missingFeatures.length === 0
        ? {
            state: "pass",
            message: "The browser supports the features used by this check.",
        }
        : {
            state: "warning",
            message: `This browser is missing: ${missingFeatures.join(", ")}. Update your browser and try again.`,
        };
}

async function runChecks() {
    // Record usage only. Do not send device details or diagnostic results to Analytics.
    if (typeof window.gtag === "function") {
        window.gtag("event", "pc_check_started");
    }

    runButton.disabled = true;
    runButton.textContent = "Checks running...";
    hero.classList.add("is-checking");
    main.setAttribute("aria-busy", "true");
    checkingIndicator.hidden = false;
    summary.textContent = "Running checks. Results are displayed only on this page.";
    showDeviceInfo();

    try {
        const [connection, https, browser] = await Promise.all([
            checkConnection(),
            Promise.resolve(checkHttps()),
            Promise.resolve(checkBrowserSupport()),
            new Promise((resolve) => window.setTimeout(resolve, 600)),
        ]);

        showResult("connection", connection.state, connection.message);
        showResult("https", https.state, https.message);
        showResult("browser", browser.state, browser.message);

        const allPassed = [connection, https, browser].every((result) => result.state === "pass");
        summary.textContent = allPassed
            ? "Checks finished. These basic checks passed; this is not a full PC security scan."
            : "Checks finished. Review the notes above; these results do not diagnose all PC problems.";

        // Send only an aggregate completion outcome, never individual check or device details.
        if (typeof window.gtag === "function") {
            window.gtag("event", "pc_check_completed", {
                check_outcome: allPassed ? "passed" : "needs_attention"
            });
        }
    } finally {
        runButton.disabled = false;
        runButton.textContent = "Run the free check again";
        hero.classList.remove("is-checking");
        main.setAttribute("aria-busy", "false");
        checkingIndicator.hidden = true;
    }
}

runButton.addEventListener("click", runChecks);
