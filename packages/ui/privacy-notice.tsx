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
      <a href="/" className="tidy-legal-back">
        Back to Tidy
      </a>
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
        service. Optional PostHog analytics is currently paused. Using the app does not require
        agreement to optional tracking.
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
        The marketing website does not use optional analytics. PostHog collection in the app is
        currently paused, including usage events, session recordings, error reports and feature-flag
        requests. Cookie settings currently offers essential storage only; an earlier analytics
        preference cannot restart collection. The app removes accessible legacy PostHog cookies and
        browser storage when an updated page loads. Any future optional analytics will require a new
        explicit choice and an updated notice before collection starts.
      </p>
      <p>
        Pausing collection does not itself delete data previously sent to PostHog. Where historical
        data remains, deletion requests are handled through the account cleanup process and the
        privacy contact above. Publishing this notice or creating an account does not opt you into
        analytics.
      </p>
      <h2>Export and deletion</h2>
      <p>
        Your JSON export contains personal account records, feedback stored in Tidy and accessible
        designs you created. Authentication secrets and vault credentials are excluded. Export
        complete designs with images from the editor. Contact the operator for a complete access
        request covering historical analytics, feedback, billing or other processor records.
      </p>
      <p>
        Deleting your account removes personal records and credentials and revokes access. Shared
        designs remain attributed to “Deleted user”; their content may still contain information
        supplied by workspace members. Transfer ownership or delete organizations where you are the
        last owner before closing your account. Uploaded avatars, feedback attachments, runner data
        and historical analytics are queued for removal; provider processing may take additional
        time. The operator must verify completion of historical analytics deletion.
      </p>
      <p>
        Backup copies, billing records required by law and security logs may remain under the
        operator’s retention rules. Ask the operator about applicable retention periods, hosting
        locations, international transfer safeguards or removal of personal information embedded in
        shared content.
      </p>
      <p>
        <a href="/terms">Terms of service</a>
      </p>
    </main>
  );
}
