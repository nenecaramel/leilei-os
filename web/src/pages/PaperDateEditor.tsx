/** The same native date hit area for Diary and Memory papers. */
export function PaperDateEditor({
  value,
  disabled,
  label,
  display,
  type = "date",
  onChange,
}: {
  value: string;
  disabled: boolean;
  label: string;
  display: string;
  type?: "date" | "datetime-local";
  onChange(value: string): void;
}) {
  function open(input: HTMLInputElement) {
    if (disabled) return;
    // Keep native input interaction as the fallback in browsers without showPicker.
    try {
      input.showPicker?.();
    } catch {
      input.focus();
    }
  }
  return (
    <label className="diary-paper-date-editor">
      <span>{display || "选择日期"}</span>
      <input
        type={type}
        aria-label={label}
        value={value}
        disabled={disabled}
        onClick={(event) => open(event.currentTarget)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            open(event.currentTarget);
          }
        }}
        onInput={(event) => onChange(event.currentTarget.value)}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
