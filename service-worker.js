const SETTINGS_KEY = "bridgeSettings";
const DEFAULT_BACKEND_BASE_URL = "https://end-api.shallow.ink";

const PROVIDER_BY_CHANNEL_ID = {
  2: "google",
  3: "facebook",
  4: "apple",
};

const PROVIDER_LABEL = {
  google: "Google",
  facebook: "Facebook",
  apple: "Apple",
};

const CALLBACK_HOST_PATTERNS = [
  /^https:\/\/web-api\.gryphline\.com\/callback\/thirdPartyAuth\.html/i,
  /^https:\/\/as\.gryphline\.com\/third_party\/v1\/google_callback/i,
  /^https:\/\/as\.gryphline\.com\/third_party\/v1\/facebook_callback/i,
  /^https:\/\/as\.gryphline\.com\/third_party\/v1\/apple_callback/i,
  /^https:\/\/www\.skport\.com\/?/i,
];

const lastProviderByTab = new Map();

function matchCallback(url) {
  const normalized = String(url || "").trim();
  if (!normalized) return false;

  const hostMatched = CALLBACK_HOST_PATTERNS.some((p) => p.test(normalized));
  if (!hostMatched) return false;

  try {
    const parsed = new URL(normalized);
    const hasToken = parsed.searchParams.has("token");
    const hasChannel = parsed.searchParams.has("channelId");
    const hasStatus = parsed.searchParams.has("status");
    const isSkportAction = parsed.searchParams.get("tpa_action") === "login";
    return (hasToken && hasChannel) || (isSkportAction && hasStatus) || /_callback$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function normalizeBaseUrl(raw) {
  return String(raw || "").trim().replace(/\/$/, "");
}

function channelIdToProvider(channelId) {
  return PROVIDER_BY_CHANNEL_ID[channelId] || null;
}

function inferProviderFromUrl(url) {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.toLowerCase();
    if (pathname.includes("google_callback")) return "google";
    if (pathname.includes("facebook_callback")) return "facebook";
    if (pathname.includes("apple_callback")) return "apple";
    return null;
  } catch {
    return null;
  }
}

function parseCallbackPayload(urlString) {
  const url = new URL(urlString);
  const rawStatus = (url.searchParams.get("status") || "").trim();
  const status = rawStatus.toLowerCase();
  const channelIdRaw = (url.searchParams.get("channelId") || "").trim();
  const token = (url.searchParams.get("token") || "").trim();
  const channelIdParsed = Number.parseInt(channelIdRaw, 10);
  const channelId = Number.isFinite(channelIdParsed) ? channelIdParsed : null;

  const providerByChannel = channelIdToProvider(channelId);
  const providerByPath = inferProviderFromUrl(urlString);
  const provider = providerByChannel || providerByPath || null;

  return {
    rawStatus,
    status,
    channelId,
    token,
    provider,
  };
}

async function loadSettings() {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  const saved = data[SETTINGS_KEY] || {};
  return {
    backendBaseUrl: normalizeBaseUrl(saved.backendBaseUrl || DEFAULT_BACKEND_BASE_URL),
  };
}

async function notify(title, message) {
  try {
    await chrome.notifications.create({
      type: "basic",
      iconUrl: "icon.png",
      title,
      message,
    });
  } catch (_) {
    // ignore
  }
}

function completeEndpoint(baseUrl, provider) {
  return `${normalizeBaseUrl(baseUrl)}/login/skport/${provider}/complete`;
}

function statusEndpoint(baseUrl, provider) {
  return `${normalizeBaseUrl(baseUrl)}/login/skport/${provider}/status`;
}

async function completeFlow(baseUrl, provider, channelId, channelToken) {
  const endpoint = completeEndpoint(baseUrl, provider);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel_id: channelId,
      channel_token: channelToken,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.code !== 0) {
    throw new Error(payload?.message || `complete HTTP ${response.status}`);
  }

  return payload;
}

async function pollStatus(baseUrl, provider, maxAttempts = 10) {
  const endpoint = statusEndpoint(baseUrl, provider);
  for (let i = 0; i < maxAttempts; i += 1) {
    const response = await fetch(endpoint, { method: "GET" });
    const payload = await response.json().catch(() => ({}));
    const data = payload?.data || payload;
    const status = String(data?.status || "").toLowerCase();

    if (response.ok && payload?.code === 0 && status === "completed") {
      return { ok: true, payload };
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  return { ok: false };
}

chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (details.frameId !== 0) return;

  const url = details.url || "";
  if (!matchCallback(url)) return;

  const settings = await loadSettings();
  if (!settings.backendBaseUrl) {
    await notify("SKPORT Bridge", "请先在插件弹窗保存后端地址。");
    return;
  }

  let callbackPayload;
  try {
    callbackPayload = parseCallbackPayload(url);
  } catch (error) {
    await notify("SKPORT Bridge", `回调解析失败：${error.message}`);
    return;
  }

  if (callbackPayload.provider && details.tabId >= 0) {
    lastProviderByTab.set(details.tabId, callbackPayload.provider);
  }

  const isFailureStatus = callbackPayload.status !== "" && callbackPayload.status !== "success" && callbackPayload.status !== "0";
  if (isFailureStatus) {
    const providerText = callbackPayload.provider ? `${PROVIDER_LABEL[callbackPayload.provider] || callbackPayload.provider} ` : "";
    await notify("SKPORT Bridge", `${providerText}授权状态：${callbackPayload.rawStatus || callbackPayload.status}`);
    return;
  }

  if (callbackPayload.token) {
    if (!callbackPayload.provider || !callbackPayload.channelId) {
      await notify("SKPORT Bridge", "已捕获 token，但无法根据 channelId 判定 provider，已停止自动提交。");
      return;
    }

    try {
      await completeFlow(settings.backendBaseUrl, callbackPayload.provider, callbackPayload.channelId, callbackPayload.token);
      await notify("SKPORT Bridge", `${PROVIDER_LABEL[callbackPayload.provider]} 回调已自动提交后端 complete。`);
      return;
    } catch (error) {
      await notify("SKPORT Bridge", `${PROVIDER_LABEL[callbackPayload.provider]} 自动提交失败：${error.message}`);
      return;
    }
  }

  const isSkportLanding = (() => {
    try {
      const parsed = new URL(url);
      return parsed.searchParams.get("tpa_action") === "login";
    } catch {
      return false;
    }
  })();

  if (!isSkportLanding) {
    return;
  }

  const provider = callbackPayload.provider || lastProviderByTab.get(details.tabId) || null;
  if (!provider) {
    await notify("SKPORT Bridge", "已到达回调页，但无法识别 provider（缺少 channelId），未执行状态轮询。");
    return;
  }

  const pollResult = await pollStatus(settings.backendBaseUrl, provider, 10);
  if (pollResult.ok) {
    await notify("SKPORT Bridge", `${PROVIDER_LABEL[provider]} 会话已完成，可返回前端继续绑定。`);
  } else {
    await notify("SKPORT Bridge", `${PROVIDER_LABEL[provider]} 回调已到达，但未完成会话，请检查后端 flow 状态。`);
  }
});
