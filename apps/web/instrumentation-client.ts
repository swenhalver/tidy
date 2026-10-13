import { clearAnalyticsStorage } from "@/lib/privacy/browser-storage";

// Keep the collection pause from #45: never load or initialize the browser SDK.
// Removing legacy storage does not change authentication or grant consent.
clearAnalyticsStorage();
