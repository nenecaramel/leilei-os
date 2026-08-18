type IOSNavigator = Navigator & {
  standalone?: boolean;
};

export function isStandaloneWebApp(): boolean {
  const displayModeStandalone =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(display-mode: standalone)").matches;

  const iosStandalone =
    typeof navigator !== "undefined" &&
    Boolean((navigator as IOSNavigator).standalone);

  return displayModeStandalone || iosStandalone;
}
