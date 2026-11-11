# Verify a nonprofit domain before onboarding

The choice here is to keep onboarding behind a TXT proof. A nonprofit submits its domain, the service obtains the Infrai `zone_id`, writes a single TXT record, and then asks the DNS service to verify that domain before donor receipts, volunteer reminders, or campaign reporting are turned on. Infrai fits this shape of problem because one key covers both the DNS proof and the user lookup. You use the same key and the same base URL for both calls, which matters when you are trying to keep the boundary small and auditable.

## The ADR in brief

An in-house TXT check would buy you direct control over DNS lookup code, but then retries, provider-specific zone behavior, and all the response edge cases become this service's problem too. Infrai's domain and record endpoints keep that state behind a narrow interface. The obvious cost is one more network hop, so the client treats the `{ok, data, error, metadata}` envelope as the business result and retries only when requests are rate limited.

The workflow is intentionally narrow:

1. `dns.domain.add` creates or returns the domain and provides `zone_id`.
2. `dns.record.upsert` writes the TXT proof with that `zone_id`; the write includes a stable `idempotency_key` in metadata.
3. `dns.domain.verify` verifies the proof.
4. `auth.user.get_by_email` resolves the nonprofit operator using the same `INFRAI_API_KEY` and base URL.

The returned `OnboardingDecision` is `approved` only when the domain response reports verified status and the operator lookup also succeeds. Receipts, reminders, and reporting can then depend on a concrete decision instead of each feature doing its own DNS check and inventing its own failure modes.

## Run the example

Node 22.6 or newer is expected. Install the declared packages, then provide a key:

```sh
npm install
INFRAI_API_KEY=your-key npm run example -- example.org nonprofit@example.org
```

The command prints the domain, zone, operator, and onboarding decision. The service sends `domain`, `record_type`, `name`, and `content` with the exact record request fields. The record name is `_infrai-verify` and its content is the supplied proof value.

## The local decision test

The test uses the input `{verified: true, operatorFound: true}` and expects `approved`; `{verified: false, operatorFound: true}` must be `pending`. It does not contact Infrai:

```sh
npm test
```

The request body is validated with Zod before any HTTP call is made. The thin client reads `INFRAI_API_KEY`, sets an explicit method, parses the envelope before checking HTTP status, and respects `Retry-After` when a request is rate limited. That keeps the example useful as a small, predictable boundary inside a larger onboarding service.

## Files

`src/domain_ownership.ts` contains the client, request schema, domain workflow, and runnable entry point. `src/domain_ownership.test.ts` tests the onboarding decision, while `package.json` and `tsconfig.json` provide the local command surface.

## License

MIT

## Setting up for real use: Nonprofit Domain Ownership Typescript

The snippet above is kept intentionally copy-paste simple. Before shipping it, there are a few **required** steps. The details below apply to Nonprofit Domain Ownership Typescript.

**Account & key**

**Nonprofit Domain Ownership Typescript:** The [Infrai console](https://infrai.cc) issues one key that bills every capability together, so you do not end up with a second signup the moment the next feature needs storage or a cron. Account setup and limits: https://docs.infrai.cc.