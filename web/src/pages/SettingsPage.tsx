import { useEffect, useState } from "react";
import { SettingsIcon } from "../components/icons";
import {
  DEFAULT_SETTINGS,
  useSettings,
} from "../settings/SettingsProvider";
import { PageHeader } from "./PageHeader";

const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

export function SettingsPage() {
  const {
    clearAccentPreview,
    previewAccentColor,
    reloadSettings,
    resetSettings,
    saveSettings,
    settings,
    status,
  } = useSettings();

  const [accentColor, setAccentColor] = useState(
    DEFAULT_SETTINGS.accent_color,
  );
  const [homeTitle, setHomeTitle] = useState("");
  const [homeSubtitle, setHomeSubtitle] = useState("");
  const [preferredName, setPreferredName] = useState("");

  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [message, setMessage] = useState("");
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    setAccentColor(settings.accent_color);
    setHomeTitle(settings.home_title ?? "");
    setHomeSubtitle(settings.home_subtitle ?? "");
    setPreferredName(settings.preferred_name ?? "");
  }, [settings]);

  useEffect(() => {
    return () => {
      clearAccentPreview();
    };
  }, [clearAccentPreview]);

  const busy = saving || resetting;
  const accentColorValid =
    HEX_COLOR_PATTERN.test(accentColor);

  function clearMessages() {
    setMessage("");
    setActionError("");
  }

  function updateAccentColor(value: string) {
    setAccentColor(value);
    clearMessages();

    if (HEX_COLOR_PATTERN.test(value)) {
      previewAccentColor(value);
    } else {
      clearAccentPreview();
    }
  }

  async function handleSave() {
    if (busy) {
      return;
    }

    if (!accentColorValid) {
      setActionError(
        "强调色必须使用完整的六位十六进制格式，例如 #405f4d。",
      );
      return;
    }

    setSaving(true);
    clearMessages();

    try {
      await saveSettings({
        accent_color: accentColor,
        home_title: homeTitle.trim() || null,
        home_subtitle: homeSubtitle.trim() || null,
        preferred_name: preferredName.trim() || null,
      });

      setMessage("个性化设置已保存。");
    } catch {
      setActionError("保存设置失败，请稍后重试。");
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    if (busy) {
      return;
    }

    const confirmed = window.confirm(
      "确定恢复默认设置吗？自定义颜色、首页文字和称呼都会被清除。",
    );

    if (!confirmed) {
      return;
    }

    setResetting(true);
    clearMessages();

    try {
      await resetSettings();
      setMessage("已恢复默认设置。");
    } catch {
      setActionError("恢复默认设置失败，请稍后重试。");
    } finally {
      setResetting(false);
    }
  }

  if (status === "loading") {
    return (
      <div className="page settings-page">
        <PageHeader
          eyebrow="Personal preferences"
          title="Settings"
          description="调整 Leilei OS 的颜色、首页文字与个人称呼。"
        />

        <SettingsMessage
          title="正在读取设置"
          description="正在同步你的个性化配置。"
        />
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="page settings-page">
        <PageHeader
          eyebrow="Personal preferences"
          title="Settings"
          description="调整 Leilei OS 的颜色、首页文字与个人称呼。"
        />

        <SettingsMessage
          title="暂时无法读取设置"
          description="连接没有完成，请稍后重试。"
          action={
            <button
              className="secondary-button"
              onClick={reloadSettings}
            >
              重新加载
            </button>
          }
        />
      </div>
    );
  }

  return (
    <div className="page settings-page">
      <PageHeader
        eyebrow="Personal preferences"
        title="Settings"
        description="调整 Leilei OS 的颜色、首页文字与个人称呼，并在不同设备之间同步。"
      />

      {actionError && (
        <section className="memory-message settings-status-message">
          <h2>操作没有完成</h2>
          <p>{actionError}</p>
        </section>
      )}

      {message && (
        <section className="memory-message settings-status-message">
          <h2>设置已更新</h2>
          <p>{message}</p>
        </section>
      )}

      <section className="settings-form">
        <div className="settings-section-heading">
          <div>
            <p className="eyebrow">Appearance</p>
            <h2>界面颜色</h2>
          </div>

          <div
            className="settings-color-preview"
            style={{
              backgroundColor: accentColorValid
                ? accentColor
                : DEFAULT_SETTINGS.accent_color,
            }}
            aria-hidden="true"
          />
        </div>

        <label className="settings-field">
          <span>强调色</span>
          <small>
            用于按钮、选中状态与主要视觉元素。
          </small>

          <div className="settings-color-control">
            <input
              type="color"
              value={
                accentColorValid
                  ? accentColor
                  : DEFAULT_SETTINGS.accent_color
              }
              disabled={busy}
              onChange={(event) =>
                updateAccentColor(event.target.value)
              }
            />

            <input
              type="text"
              value={accentColor}
              maxLength={7}
              disabled={busy}
              placeholder="#405f4d"
              onChange={(event) =>
                updateAccentColor(event.target.value)
              }
            />
          </div>
        </label>

        <div className="settings-divider" />

        <div className="settings-section-heading">
          <div>
            <p className="eyebrow">Dashboard identity</p>
            <h2>首页内容</h2>
          </div>
        </div>

        <label className="settings-field">
          <span>首页标题</span>
          <small>留空时使用系统默认标题。</small>

          <input
            type="text"
            value={homeTitle}
            maxLength={120}
            disabled={busy}
            placeholder="例如：欢迎回家"
            onChange={(event) => {
              setHomeTitle(event.target.value);
              clearMessages();
            }}
          />
        </label>

        <label className="settings-field">
          <span>首页副标题</span>
          <small>
            用一句话描述这个空间对你的意义。
          </small>

          <textarea
            value={homeSubtitle}
            maxLength={240}
            disabled={busy}
            placeholder="例如：记录、整理与继续前进"
            onChange={(event) => {
              setHomeSubtitle(event.target.value);
              clearMessages();
            }}
          />
        </label>

        <label className="settings-field">
          <span>偏好称呼</span>
          <small>
            首页和账户区域将优先使用这个名字。
          </small>

          <input
            type="text"
            value={preferredName}
            maxLength={80}
            disabled={busy}
            placeholder="例如：蕾蕾"
            onChange={(event) => {
              setPreferredName(event.target.value);
              clearMessages();
            }}
          />
        </label>

        <div className="settings-actions">
          <button
            className="secondary-button"
            disabled={busy || !accentColorValid}
            onClick={handleSave}
          >
            {saving ? "保存中…" : "保存设置"}
          </button>

          <button
            className="text-button settings-reset-button"
            disabled={busy}
            onClick={handleReset}
          >
            {resetting
              ? "恢复中…"
              : "恢复默认设置"}
          </button>
        </div>
      </section>
    </div>
  );
}

function SettingsMessage({
  action,
  description,
  title,
}: {
  action?: React.ReactNode;
  description: string;
  title: string;
}) {
  return (
    <section className="memory-message">
      <div className="placeholder-icon">
        <SettingsIcon />
      </div>

      <h2>{title}</h2>
      <p>{description}</p>

      {action}
    </section>
  );
}