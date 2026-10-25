type Rectangle = { x: number; y: number; width: number; height: number };
type Display = { id: number; label: string; workArea: Rectangle };

/**
 * The display requested at launch, from `--display=<value>`, `--display <value>`
 * or `TIDY_DISPLAY`. Values match a display name (such as "S-Space"), a
 * 1-based position in the display list, a display ID, or "main".
 */
export function requestedDisplay(argv: readonly string[], env: Record<string, string | undefined>) {
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument.startsWith("--display="))
      return argument.slice("--display=".length).trim() || null;
    if (argument === "--display") return argv[index + 1]?.trim() || null;
  }
  return env.TIDY_DISPLAY?.trim() || null;
}

/** Find the requested display; unknown names return null so the window opens normally. */
export function findDisplay(displays: readonly Display[], primary: Display, request: string) {
  const value = request.toLowerCase();
  if (value === "main" || value === "primary") return primary;
  const named = displays.find((display) => display.label.trim().toLowerCase() === value);
  if (named) return named;
  if (/^\d+$/.test(value)) {
    // Positions win: "2" means the second display even if some display has ID 2.
    const position = Number(value);
    if (position >= 1 && position <= displays.length) return displays[position - 1];
    return displays.find((display) => display.id === position) ?? null;
  }
  return null;
}

/** Center a window of the preferred size in the display's usable area. */
export function centeredBounds(display: Display, width: number, height: number): Rectangle {
  const area = display.workArea;
  const fitted = { width: Math.min(width, area.width), height: Math.min(height, area.height) };
  return {
    x: Math.round(area.x + (area.width - fitted.width) / 2),
    y: Math.round(area.y + (area.height - fitted.height) / 2),
    ...fitted,
  };
}
