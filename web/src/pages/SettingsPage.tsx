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
  const [memorySubtitle, setMemorySubtitle] = useState("");
  const [diarySubtitle, setDiarySubtitle] = useState("");
  const [taskSubtitle, setTaskSubtitle] = useState("");
  const [settingsSubtitle, setSettingsSubtitle] = useState("");
  const [homeHeroEyebrow, setHomeHeroEyebrow] = useState("");
  const [homeHeroTitleMode, setHomeHeroTitleMode] = useState<"auto" | "custom">("auto");
  const [homeHeroTitle, setHomeHeroTitle] = useState("");
  const [homeHeroDescriptionMode, setHomeHeroDescriptionMode] = useState<"auto" | "custom">("auto");
  const [homeHeroDescription, setHomeHeroDescription] = useState("");

  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [message, setMessage] = useState("");
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    setAccentColor(settings.accent_color);
    setHomeTitle(settings.home_title ?? "");
    setHomeSubtitle(settings.home_subtitle ?? "");
    setPreferredName(settings.preferred_name ?? "");
    setMemorySubtitle(settings.page_copy.memory_subtitle ?? "");
    setDiarySubtitle(settings.page_copy.diary_subtitle ?? "");
    setTaskSubtitle(settings.page_copy.task_subtitle ?? "");
    setSettingsSubtitle(settings.page_copy.settings_subtitle ?? "");
    setHomeHeroEyebrow(settings.page_copy.home_hero_eyebrow ?? "");
    setHomeHeroTitleMode(settings.page_copy.home_hero_title_mode);
    setHomeHeroTitle(settings.page_copy.home_hero_title ?? "");
    setHomeHeroDescriptionMode(settings.page_copy.home_hero_description_mode);
    setHomeHeroDescription(settings.page_copy.home_hero_description ?? "");
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
        "主题色必须使用完整的六位十六进制格式，例如 #405f4d。",
      );
      return;
    }

    if (
      homeHeroTitleMode === "custom" &&
      !homeHeroTitle.trim()
    ) {
      setActionError("自定义首页大框标题不能为空。");
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
        page_copy: {
          memory_subtitle: memorySubtitle.trim() || null,
          diary_subtitle: diarySubtitle.trim() || null,
          task_subtitle: taskSubtitle.trim() || null,
          settings_subtitle: settingsSubtitle.trim() || null,
          home_hero_eyebrow: homeHeroEyebrow.trim() || null,
          home_hero_title_mode: homeHeroTitleMode,
          home_hero_title: homeHeroTitle.trim() || null,
          home_hero_description_mode: homeHeroDescriptionMode,
          home_hero_description: homeHeroDescription.trim() || null,
        },
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
          description={settings.page_copy.settings_subtitle ?? "调整 Leilei OS 的主题、页面文案与个人称呼。"}
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
          description={settings.page_copy.settings_subtitle ?? "调整 Leilei OS 的主题、页面文案与个人称呼。"}
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
        description={settings.page_copy.settings_subtitle ?? "调整 Leilei OS 的主题、页面文案与个人称呼，并在不同设备之间同步。"}
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
            <h2>整套界面主题</h2>
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
          <span>主题色</span>
          <small>
            系统会根据这个颜色生成页面背景、侧栏、卡片、按钮和状态元素。
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

        <label className="settings-field">
          <span>首页大框小标题</span>
          <small>显示在首页主标题上方，留空时不显示。</small>

          <input
            type="text"
            value={homeHeroEyebrow}
            maxLength={120}
            disabled={busy}
            placeholder="例如：Personal command center"
            onChange={(event) => {
              setHomeHeroEyebrow(event.target.value);
              clearMessages();
            }}
          />
        </label>

        <label className="settings-field">
          <span>首页大框描述</span>
          <small>选择自动生成或固定显示自定义文字。</small>

          <select
            value={homeHeroDescriptionMode}
            disabled={busy}
            onChange={(event) => {
              setHomeHeroDescriptionMode(
                event.target.value as "auto" | "custom",
              );
              clearMessages();
            }}
          >
            <option value="auto">跟随系统自动更新</option>
            <option value="custom">使用自定义描述</option>
          </select>

          {homeHeroDescriptionMode === "custom" && (
            <textarea
              value={homeHeroDescription}
              maxLength={240}
              disabled={busy}
              placeholder="例如：记录记忆、整理任务、连接未来。"
              onChange={(event) => {
                setHomeHeroDescription(event.target.value);
                clearMessages();
              }}
            />
          )}
        </label>

        <label className="settings-field">
          <span>首页大框主标题</span>
          <small>自动模式会跟随系统叙事；切换回自动不会清除自定义标题。</small>

          <select
            value={homeHeroTitleMode}
            disabled={busy}
            onChange={(event) => {
              setHomeHeroTitleMode(
                event.target.value as "auto" | "custom",
              );
              clearMessages();
            }}
          >
            <option value="auto">跟随系统自动更新</option>
            <option value="custom">使用自定义标题</option>
          </select>

          {homeHeroTitleMode === "custom" && (
            <input
              type="text"
              value={homeHeroTitle}
              maxLength={240}
              disabled={busy}
              placeholder="例如：让生活重新回到自己的节奏"
              onChange={(event) => {
                setHomeHeroTitle(event.target.value);
                clearMessages();
              }}
            />
          )}
        </label>

        <div className="settings-divider" />

        <div className="settings-section-heading">
          <div>
            <p className="eyebrow">Page copy</p>
            <h2>页面文案</h2>
          </div>
        </div>

        <label className="settings-field">
          <span>Memory 页副标题</span>
          <small>留空时使用系统默认文案。</small>

          <textarea
            value={memorySubtitle}
            maxLength={240}
            disabled={busy}
            placeholder="由 Leilei OS 安全保存的核心信息、稳定偏好、长期目标与当前项目。"
            onChange={(event) => {
              setMemorySubtitle(event.target.value);
              clearMessages();
            }}
          />
        </label>

        <label className="settings-field">
          <span>Diary 页副标题</span>
          <small>留空时使用系统默认文案。</small>

          <textarea
            value={diarySubtitle}
            maxLength={240}
            disabled={busy}
            placeholder="按时间记录、查看和整理属于蕾蕾的日常。"
            onChange={(event) => {
              setDiarySubtitle(event.target.value);
              clearMessages();
            }}
          />
        </label>

        <label className="settings-field">
          <span>Task 页副标题</span>
          <small>留空时使用系统默认文案。</small>

          <textarea
            value={taskSubtitle}
            maxLength={240}
            disabled={busy}
            placeholder="管理待办事项、截止时间、优先级与完成状态。"
            onChange={(event) => {
              setTaskSubtitle(event.target.value);
              clearMessages();
            }}
          />
        </label>

        <label className="settings-field">
          <span>Settings 页副标题</span>
          <small>留空时使用系统默认文案。</small>

          <textarea
            value={settingsSubtitle}
            maxLength={240}
            disabled={busy}
            placeholder="调整 Leilei OS 的主题、页面文案与个人称呼。"
            onChange={(event) => {
              setSettingsSubtitle(event.target.value);
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
