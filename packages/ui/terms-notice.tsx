export function TermsNotice({ controller, contact }: { controller: string; contact: string }) {
  return (
    <main className="tidy-privacy-notice">
      <a href="/" className="tidy-legal-back">
        Back to Tidy
      </a>
      <h1>Terms of service</h1>
      <p>These terms apply to the Tidy service operated by {controller}.</p>
      <h2>Your account</h2>
      <p>
        Provide accurate account information and protect your sign-in credentials. Only use accounts
        and connected services you are authorized to access. Tell us if you believe your account has
        been compromised.
      </p>
      <h2>Your work and sharing</h2>
      <p>
        You retain your rights in the content you provide. You allow us to store, process and
        display it as needed to provide the service and the sharing or connected actions you
        request. Workspace members can access content according to their permissions. Upload and
        share content only when you have the necessary rights.
      </p>
      <h2>Using Tidy</h2>
      <p>
        Do not use Tidy for unlawful activity, infringe others’ rights, access another person’s data
        without authorization, distribute malicious software or deliberately disrupt the service.
        Review AI-generated work before relying on it or sharing it.
      </p>
      <h2>Connected services and billing</h2>
      <p>
        Connecting a third-party account or using an AI provider is optional. Those services have
        their own terms and privacy policies. Review the access you grant before connecting them.
        Any paid plan’s price and billing interval are shown before checkout. Manage subscriptions
        through the billing controls in Settings; account deletion and subscription cancellation are
        separate actions.
      </p>
      <h2>Exporting and leaving</h2>
      <p>
        You can export designs from the editor and personal account records from Account privacy and
        data. Before deleting your account, transfer ownership or delete organizations where you are
        the last owner. Shared designs remain with the organization. Our{" "}
        <a href="/privacy">privacy notice</a> explains the scope of exports and deletion, including
        external cleanup and retained records.
      </p>
      <h2>Open-source software</h2>
      <p>
        Tidy’s source code is available under Apache License 2.0. That software license is separate
        from these terms for using the hosted service.
      </p>
      <h2>Contact</h2>
      <p>
        Contact <a href={`mailto:${contact}`}>{contact}</a> about these terms or your account.
      </p>
    </main>
  );
}
