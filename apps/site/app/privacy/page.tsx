export const metadata = { title: "Privacy and cookies · Tidy" };
import { PrivacyNotice } from "@tidy/ui/privacy-notice";
export default function PrivacyPage() {
  return (
    <PrivacyNotice
      controller={process.env.PRIVACY_CONTROLLER_NAME ?? "Sean Dowdall"}
      contact={process.env.PRIVACY_CONTACT_EMAIL ?? "seandowdall22@gmail.com"}
      accountUrl={`${process.env.NEXT_PUBLIC_APP_URL ?? "https://app.tidydesign.co"}/account/privacy`}
    />
  );
}
