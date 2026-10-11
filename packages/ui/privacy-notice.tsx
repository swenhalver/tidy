export function PrivacyNotice({
  controller,
  contact,
  accountUrl,
}: {
  controller?: string;
  contact?: string;
  accountUrl: string;
}) {
  return (
    <main className="tidy-privacy-notice">
      <a href="/">Back to Tidy</a>
      <h1>Privacy and cookies</h1>
      <p>
        {controller || "The operator of this Tidy service"} processes account information to provide
        the service, secure your account and support your workspaces.
      </p>
      {contact && (
        <p>
          For privacy requests, contact <a href={`mailto:${contact}`}>{contact}</a>.
        </p>
      )}
      <h2>Your choices and rights</h2>
      <p>
        You can correct your profile in Settings and{" "}
        <a href={accountUrl}>export your data or delete your account</a>. You may also request
        access, correction, erasure, restriction, portability or object to processing by contacting
        the service operator. You can complain to your local data protection authority.
      </p>
      <h2>Information we use</h2>
      <p>
        Account details, workspace membership, designs, comments and connected accounts are used to
        provide the service you request. Authentication, session and security records protect the
        service. Optional usage analytics uses your consent; declining it does not prevent using the
        app.
      </p>
      <p>
        Workspace content is visible to authorized members. Hosting, email and storage providers
        process data to operate the service. Connected providers receive the information needed for
        actions you request. Payment providers handle billing where enabled.
      </p>
      <h2>Cookies and browser storage</h2>
      <p>
        Essential cookies keep you signed in, secure sign-in flows and remember your cookie choice.
        Local preferences remember your theme and editor layout. The tidy_consent cookie lasts six
        months and is limited to the site where you make the choice.
      </p>
      <p>
        The marketing website does not use optional analytics. In the app, accepting analytics
        allows PostHog cookies and local storage beginning with ph_ to measure usage and diagnose
        problems. Session recording and automatic interaction capture are disabled. Use Cookie
        settings to withdraw permission at any time; this stops analytics and clears its browser
        storage.
      </p>
      <h2>Export and deletion</h2>
      <p>
        Your JSON export contains personal account records and accessible designs you created.
        Authentication secrets and vault credentials are excluded. Export complete designs with
        images from the editor. Contact the operator for a complete access request covering
        historical analytics, feedback, billing or other processor records.
      </p>
      <p>
        Deleting your account removes personal records and credentials and revokes access. Shared
        designs remain under anonymous attribution. Transfer ownership or delete organizations where
        you are the last owner before closing your account. Uploaded personal images, runner data
        and historical analytics are queued for removal; provider processing may take additional
        time.
      </p>
      <p>
        Backup copies, billing records required by law and security logs may remain under the
        operator’s retention rules. Ask the operator about applicable retention periods, hosting
        locations, international transfer safeguards or removal of personal information embedded in
        shared content.
      </p>
    </main>
  );
}
