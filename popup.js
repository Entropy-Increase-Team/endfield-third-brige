var SETTINGS_KEY = "bridgeSettings";
var DEFAULT_BACKEND_BASE_URL = "https://end-api.shallow.ink";

var els = {
  backendBaseUrl: document.getElementById("backendBaseUrl"),
  saveBtn: document.getElementById("saveBtn"),
  clearBtn: document.getElementById("clearBtn"),
  log: document.getElementById("log"),
  version: document.getElementById("version")
};

function normalizeBaseUrl(raw) {
  return String(raw || "").trim().replace(/\/$/, "");
}

function setLog(value) {
  els.log.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

async function loadSettings() {
  var data = await chrome.storage.local.get(SETTINGS_KEY);
  return data[SETTINGS_KEY] || null;
}

function getDefaultSettings() {
  return {
    backendBaseUrl: DEFAULT_BACKEND_BASE_URL,
    savedAt: Date.now()
  };
}

async function saveSettings(settings) {
  var payload = {};
  payload[SETTINGS_KEY] = settings;
  await chrome.storage.local.set(payload);
}

function collectSettings() {
  return {
    backendBaseUrl: normalizeBaseUrl(els.backendBaseUrl.value),
    savedAt: Date.now()
  };
}

function validate(settings) {
  if (!settings.backendBaseUrl) {
    throw new Error("请填写 Backend Base URL");
  }
}

async function hydrate() {
  var settings = await loadSettings();
  var effectiveSettings = settings || getDefaultSettings();

  els.backendBaseUrl.value = effectiveSettings.backendBaseUrl || DEFAULT_BACKEND_BASE_URL;

  if (els.version && chrome && chrome.runtime && chrome.runtime.getManifest) {
    var manifest = chrome.runtime.getManifest();
    els.version.textContent = "v" + manifest.version;
  }

  if (!settings) {
    await saveSettings(effectiveSettings);
    setLog({
      ok: true,
      mode: "auto",
      message: "已写入默认后端地址，可直接使用。",
      settings: {
        backendBaseUrl: effectiveSettings.backendBaseUrl
      }
    });
    return;
  }

  setLog({
    ok: true,
    mode: "auto",
    message: "已启用自动桥接。插件仅捕获回调参数并自动提交后端 complete。",
    settings: {
      backendBaseUrl: settings.backendBaseUrl
    }
  });
}

els.saveBtn.addEventListener("click", function () {
  return (async function () {
    try {
      var settings = collectSettings();
      validate(settings);
      await saveSettings(settings);
      setLog({
        ok: true,
        mode: "auto",
        message: "保存成功。无需用户手动操作插件，回调时自动提交后端。",
        settings: {
          backendBaseUrl: settings.backendBaseUrl
        }
      });
    } catch (error) {
      var errMsg = error && error.message ? error.message : "unknown error";
      setLog({ ok: false, error: errMsg });
    }
  })();
});

els.clearBtn.addEventListener("click", function () {
  return (async function () {
    var defaults = getDefaultSettings();
    await saveSettings(defaults);
    els.backendBaseUrl.value = defaults.backendBaseUrl;
    setLog({
      ok: true,
      mode: "auto",
      message: "已恢复默认后端地址。",
      settings: {
        backendBaseUrl: defaults.backendBaseUrl
      }
    });
  })();
});

hydrate();
