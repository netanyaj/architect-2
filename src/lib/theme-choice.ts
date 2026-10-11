/** Shows a theme choice at once, before the page catches up: System follows the device. Client only. */
export function applyTheme(choice: "system" | "light" | "dark") {
  const root = document.documentElement;
  root.dataset.themeChoice = choice;
  root.dataset.theme = choice === "system" ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : choice;
}
