import type { DesktopAPI } from "../../shared/contracts/desktop";

declare global {
  interface Window {
    tidy?: DesktopAPI;
  }
}
