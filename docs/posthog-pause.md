# PostHog collection pause

The app does not initialize the PostHog browser SDK. Browser event, identity,
exception and reset calls use an inert local facade; nothing is queued for later
submission. Server exception reporting, request tracing, feature-flag evaluation
and build-time source-map uploads are disabled by `lib/posthog-policy.ts`.
Existing environment settings cannot override the pause.

Request deadlines, local operation tracking and platform diagnostic logs still
work. This change concerns PostHog traffic from this repository, not all data
processing performed by the application or its other providers.

## Product effects

- Product events, pageviews, web vitals, autocapture, session replay and browser
  and server error reporting no longer reach PostHog from the updated app.
- Vault is unavailable because its access flag is evaluated through PostHog.
  Existing Vault records remain stored; the pause does not grant access or
  delete records.
- The privacy implementation restores feedback through the first-party feedback
  endpoint. It does not forward submissions or attachments to PostHog.
- PostHog data already collected is unchanged by the collection pause. The privacy
  implementation clears accessible legacy PostHog browser cookies/storage on load
  and provides a separate historical-data erasure workflow. Auth sessions continue
  to work.

## Rollout and follow-up

1. Review, merge and deploy this change using the normal approved release
   process. Creating or merging a PR alone does not update the running app.
   There are no migrations or new secrets.
2. Check a fresh page load, login, navigation and representative server requests
   for PostHog network traffic. Old open tabs or older deployments may continue
   running their previous SDK until replaced or refreshed. Check all live
   deployments that share the project.
3. PostHog's project settings can disable session recording as an additional
   measure. That setting does not replace the application pause for custom
   events, identities, server reporting or flags.
4. Handle historical data review and any deletion separately. This change does
   not certify legal compliance or perform deletion in PostHog.
5. The privacy/consent work in PR #44 preserves this pause. The app dialog offers
   essential storage only. Before any reviewed resumption, implement consent-aware
   browser/server collection, bump the consent version for a fresh opt-in, update
   the notice, and review permitted fields, replay/error settings, provider
   retention and stale browser storage/queues. Vault still needs a replacement for
   its PostHog dependency if it should be restored while collection is paused.

Transport tests explicitly override the policy only inside isolated fixtures
with fake credentials and intercepted HTTP. The default-policy tests and the
Worker smoke test verify zero PostHog delivery with credentials configured.
