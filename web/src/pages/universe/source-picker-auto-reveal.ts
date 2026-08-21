export function installUniverseSourcePickerAutoReveal(): () => void {
  const onClick = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const addButton = target.closest<HTMLElement>(".universe-standalone-source-add");
    if (!addButton) return;

    const paper = addButton.closest<HTMLElement>(".paper-detail-paper");
    window.requestAnimationFrame(() => {
      paper
        ?.querySelector<HTMLInputElement>('input[aria-label="搜索来源日记"]')
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  };

  document.addEventListener("click", onClick);
  return () => document.removeEventListener("click", onClick);
}
