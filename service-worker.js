const SETTINGS_KEY = "bridgeSettings";
const DEFAULT_BACKEND_BASE_URL = "https://end-api.shallow.ink";
const CALLBACK_HOST_PATTERNS = [
  /^https:\/\/web-api\.gryphline\.com\/callback\/thirdPartyAuth\.html/i,
  /^https:\/\/as\.gryphline\.com\/third_party\/v1\/google_callback/i,
  /^https:\/\/www\.skport\.com\/?/i,
];

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
    return (hasToken && hasChannel) || (isSkportAction && hasStatus);
  } catch {
    return false;
  }
}

function normalizeBaseUrl(raw) {
  return String(raw || "").trim().replace(/\/$/, "");
}

function parseCallbackPayload(urlString) {
  const url = new URL(urlString);
  const rawStatus = (url.searchParams.get("status") || "").trim();
  const status = rawStatus.toLowerCase();
  const channelIdRaw = (url.searchParams.get("channelId") || "").trim();
  const token = (url.searchParams.get("token") || "").trim();
  const channelId = Number.parseInt(channelIdRaw, 10);

  return {
    rawStatus,
    status,
    channelId: Number.isFinite(channelId) ? channelId : 2,
    token,
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

async function completeFlow(baseUrl, channelId, channelToken) {
  const endpoint = `${normalizeBaseUrl(baseUrl)}/login/skport/google/complete`;
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

async function pollStatus(baseUrl, maxAttempts = 10) {
  const endpoint = `${normalizeBaseUrl(baseUrl)}/login/skport/google/status`;
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
    await notify("Google Bridge", "请先在插件弹窗保存后端地址。 ");
    return;
  }

  let callbackPayload;
  try {
    callbackPayload = parseCallbackPayload(url);
  } catch (error) {
    await notify("Google Bridge", `回调解析失败：${error.message}`);
    return;
  }

  const isFailureStatus = callbackPayload.status !== "" && callbackPayload.status !== "success" && callbackPayload.status !== "0";
  if (isFailureStatus) {
    await notify("Google Bridge", `Google 授权状态：${callbackPayload.rawStatus || callbackPayload.status}`);
    return;
  }

  if (callbackPayload.token) {
    try {
      await completeFlow(settings.backendBaseUrl, callbackPayload.channelId, callbackPayload.token);
      await notify("Google Bridge", "已自动提交后端 complete，可返回前端继续绑定。 ");
      return;
    } catch (error) {
      await notify("Google Bridge", `自动提交失败：${error.message}`);
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

  if (isSkportLanding) {
    const pollResult = await pollStatus(settings.backendBaseUrl, 10);
    if (pollResult.ok) {
      await notify("Google Bridge", "检测到后端会话已完成，可返回前端继续绑定。 ");
    } else {
      await notify("Google Bridge", "已到达回调页，但未捕获 token。请检查回调链路是否包含 token 参数。 ");
    }
  }
});
