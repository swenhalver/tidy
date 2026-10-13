import { TermsNotice } from "@tidy/ui/terms-notice";

export const metadata = { title: "Terms of service · Tidy" };

export default function TermsPage() {
  return (
    <TermsNotice
      controller={process.env.PRIVACY_CONTROLLER_NAME ?? "Sean Dowdall"}
      contact={process.env.PRIVACY_CONTACT_EMAIL ?? "seandowdall22@gmail.com"}
    />
  );
}
