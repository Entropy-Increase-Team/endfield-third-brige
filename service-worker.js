var SETTINGS_KEY = "bridgeSettings";
var DEFAULT_BACKEND_BASE_URL = "https://end-api.shallow.ink";

var PROVIDER_BY_CHANNEL_ID = {
  2: "google",
  3: "facebook",
  4: "apple"
};

var PROVIDER_LABEL = {
  google: "Google",
  facebook: "Facebook",
  apple: "Apple"
};

var CALLBACK_HOST_PATTERNS = [
  /^https:\/\/web-api\.gryphline\.com\/callback\/thirdPartyAuth\.html/i,
  /^https:\/\/as\.gryphline\.com\/third_party\/v1\/google_callback/i,
  /^https:\/\/as\.gryphline\.com\/third_party\/v1\/facebook_callback/i,
  /^https:\/\/as\.gryphline\.com\/third_party\/v1\/apple_callback/i,
  /^https:\/\/www\.skport\.com\/?/i
];

var lastProviderByTab = new Map();

function safeJson(response) {
  return response.json().catch(function () {
    return {};
  });
}

function getPayloadCode(payload) {
  return payload && typeof payload.code !== "undefined" ? payload.code : null;
}

function getPayloadMessage(payload, fallback) {
  if (payload && payload.message) {
    return payload.message;
  }
  return fallback;
}

function matchCallback(url) {
  var normalized = String(url || "").trim();
  if (!normalized) return false;

  var hostMatched = CALLBACK_HOST_PATTERNS.some(function (p) {
    return p.test(normalized);
  });
  if (!hostMatched) return false;

  try {
    var parsed = new URL(normalized);
    var hasToken = parsed.searchParams.has("token");
    var hasChannel = parsed.searchParams.has("channelId");
    var hasStatus = parsed.searchParams.has("status");
    var isSkportAction = parsed.searchParams.get("tpa_action") === "login";
    return (hasToken && hasChannel) || (isSkportAction && hasStatus) || /_callback$/i.test(parsed.pathname);
  } catch (e) {
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
    var parsed = new URL(url);
    var pathname = parsed.pathname.toLowerCase();
    if (pathname.indexOf("google_callback") !== -1) return "google";
    if (pathname.indexOf("facebook_callback") !== -1) return "facebook";
    if (pathname.indexOf("apple_callback") !== -1) return "apple";
    return null;
  } catch (e) {
    return null;
  }
}

function parseCallbackPayload(urlString) {
  var url = new URL(urlString);
  var rawStatus = String(url.searchParams.get("status") || "").trim();
  var status = rawStatus.toLowerCase();
  var channelIdRaw = String(url.searchParams.get("channelId") || "").trim();
  var token = String(url.searchParams.get("token") || "").trim();
  var channelIdParsed = Number.parseInt(channelIdRaw, 10);
  var channelId = Number.isFinite(channelIdParsed) ? channelIdParsed : null;

  var providerByChannel = channelIdToProvider(channelId);
  var providerByPath = inferProviderFromUrl(urlString);
  var provider = providerByChannel || providerByPath || null;

  return {
    rawStatus: rawStatus,
    status: status,
    channelId: channelId,
    token: token,
    provider: provider
  };
}

async function loadSettings() {
  var data = await chrome.storage.local.get(SETTINGS_KEY);
  var saved = data[SETTINGS_KEY] || {};
  return {
    backendBaseUrl: normalizeBaseUrl(saved.backendBaseUrl || DEFAULT_BACKEND_BASE_URL)
  };
}

async function notify(title, message) {
  try {
    await chrome.notifications.create({
      type: "basic",
      iconUrl: "icon.png",
      title: title,
      message: message
    });
  } catch (e) {
    // ignore
  }
}

function completeEndpoint(baseUrl, provider) {
  return normalizeBaseUrl(baseUrl) + "/login/skport/" + provider + "/complete";
}

function statusEndpoint(baseUrl, provider) {
  return normalizeBaseUrl(baseUrl) + "/login/skport/" + provider + "/status";
}

async function completeFlow(baseUrl, provider, channelId, channelToken) {
  var endpoint = completeEndpoint(baseUrl, provider);
  var response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      channel_id: channelId,
      channel_token: channelToken
    })
  });

  var payload = await safeJson(response);
  if (!response.ok || getPayloadCode(payload) !== 0) {
    throw new Error(getPayloadMessage(payload, "complete HTTP " + response.status));
  }

  return payload;
}

async function pollStatus(baseUrl, provider, maxAttempts) {
  var endpoint = statusEndpoint(baseUrl, provider);
  var attempts = typeof maxAttempts === "number" ? maxAttempts : 10;

  for (var i = 0; i < attempts; i += 1) {
    var response = await fetch(endpoint, { method: "GET" });
    var payload = await safeJson(response);
    var data = payload && payload.data ? payload.data : payload;
    var status = String((data && data.status) || "").toLowerCase();

    if (response.ok && getPayloadCode(payload) === 0 && status === "completed") {
      return { ok: true, payload: payload };
    }

    await new Promise(function (resolve) {
      setTimeout(resolve, 2000);
    });
  }

  return { ok: false };
}

function isSkportLanding(url) {
  try {
    var parsed = new URL(url);
    return parsed.searchParams.get("tpa_action") === "login";
  } catch (e) {
    return false;
  }
}

chrome.webNavigation.onCommitted.addListener(function (details) {
  return (async function () {
    if (details.frameId !== 0) return;

    var url = details.url || "";
    if (!matchCallback(url)) return;

    var settings = await loadSettings();
    if (!settings.backendBaseUrl) {
      await notify("SKPORT Bridge", "请先在插件弹窗保存后端地址。");
      return;
    }

    var callbackPayload;
    try {
      callbackPayload = parseCallbackPayload(url);
    } catch (error) {
      var parseErrMsg = error && error.message ? error.message : "unknown error";
      await notify("SKPORT Bridge", "回调解析失败：" + parseErrMsg);
      return;
    }

    if (callbackPayload.provider && details.tabId >= 0) {
      lastProviderByTab.set(details.tabId, callbackPayload.provider);
    }

    var statusValue = callbackPayload.status;
    var isFailureStatus = statusValue !== "" && statusValue !== "success" && statusValue !== "0";
    if (isFailureStatus) {
      var providerText = callbackPayload.provider ? ((PROVIDER_LABEL[callbackPayload.provider] || callbackPayload.provider) + " ") : "";
      await notify("SKPORT Bridge", providerText + "授权状态：" + (callbackPayload.rawStatus || callbackPayload.status));
      return;
    }

    if (callbackPayload.token) {
      if (!callbackPayload.provider || !callbackPayload.channelId) {
        await notify("SKPORT Bridge", "已捕获 token，但无法根据 channelId 判定 provider，已停止自动提交。");
        return;
      }

      try {
        await completeFlow(settings.backendBaseUrl, callbackPayload.provider, callbackPayload.channelId, callbackPayload.token);
        await notify("SKPORT Bridge", PROVIDER_LABEL[callbackPayload.provider] + " 回调已自动提交后端 complete。");
        return;
      } catch (error) {
        var submitErrMsg = error && error.message ? error.message : "unknown error";
        await notify("SKPORT Bridge", PROVIDER_LABEL[callbackPayload.provider] + " 自动提交失败：" + submitErrMsg);
        return;
      }
    }

    if (!isSkportLanding(url)) {
      return;
    }

    var provider = callbackPayload.provider || lastProviderByTab.get(details.tabId) || null;
    if (!provider) {
      await notify("SKPORT Bridge", "已到达回调页，但无法识别 provider（缺少 channelId），未执行状态轮询。");
      return;
    }

    var pollResult = await pollStatus(settings.backendBaseUrl, provider, 10);
    if (pollResult.ok) {
      await notify("SKPORT Bridge", PROVIDER_LABEL[provider] + " 会话已完成，可返回前端继续绑定。");
    } else {
      await notify("SKPORT Bridge", PROVIDER_LABEL[provider] + " 回调已到达，但未完成会话，请检查后端 flow 状态。");
    }
  })();
});
