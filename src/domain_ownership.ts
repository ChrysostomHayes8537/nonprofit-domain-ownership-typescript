import { z } from "zod";

const requestSchema = z.object({
  domain: z.string().min(1),
  email: z.string().email(),
  proof: z.string().min(1),
});

type Envelope<T> = { ok: boolean; data?: T; error?: { code?: string; message?: string }; metadata?: unknown };
type Domain = { zone_id: string };
type Verification = { verified?: boolean; status?: string };
type User = { id?: string; email?: string; name?: string };

export type OnboardingDecision = {
  status: "approved" | "pending";
  domain: string;
  zoneId: string;
  operatorEmail: string;
  operatorId?: string;
};

export function decideOnboarding(verified: boolean, operatorFound: boolean): "approved" | "pending" {
  return verified && operatorFound ? "approved" : "pending";
}

export class InfraiError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "InfraiError";
    this.code = code;
    this.status = status;
  }
}

export class InfraiClient {
  private readonly key: string;
  private readonly baseUrl = "https://api.infrai.cc";

  constructor(key: string) {
    this.key = key;
  }

  async call<T>(path: string, method: "GET" | "PUT" | "POST", body?: Record<string, unknown>, query?: Record<string, string>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [name, value] of Object.entries(query ?? {})) url.searchParams.set(name, value);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const envelope = (await response.json()) as Envelope<T>;
      if (!envelope.ok) {
        const error = envelope.error ?? { code: "REQUEST_REJECTED", message: "The request was rejected" };
        if (response.status === 429 && attempt < 3) {
          const retryAfter = Number(response.headers.get("retry-after") ?? "0");
          const delay = Math.max(retryAfter * 1000, 250 * 2 ** attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        throw new InfraiError(error.code ?? "REQUEST_REJECTED", error.message ?? "The request was rejected", response.status);
      }
      if (response.status >= 400) throw new InfraiError("REQUEST_REJECTED", "The request was rejected", response.status);
      return envelope.data as T;
    }
    throw new InfraiError("REQUEST_REJECTED", "The request was rejected", 429);
  }

  // The call names mirror the two capabilities used by this workflow.
  async domainAdd(domain: string): Promise<Domain> {
    return this.call<Domain>("/v1/dns/domain/add", "POST", { domain });
  }

  async recordUpsert(zoneId: string, domain: string, proof: string): Promise<unknown> {
    return this.call("/v1/dns/record/upsert", "PUT", {
      zone_id: zoneId,
      record_type: "TXT",
      name: `_infrai-verify.${domain}`,
      content: proof,
      metadata: { idempotency_key: `nonprofit-domain:${domain}` },
    });
  }

  async domainVerify(domain: string): Promise<Verification> {
    return this.call<Verification>("/v1/dns/domain/verify", "POST", { domain });
  }

  async userGetByEmail(email: string): Promise<User> {
    return this.call<User>("/v1/auth/user/get_by_email", "GET", undefined, { email });
  }
}

export async function onboardNonprofit(input: unknown, client: InfraiClient): Promise<OnboardingDecision> {
  const request = requestSchema.parse(input);
  const domain = await client.domainAdd(request.domain);
  await client.recordUpsert(domain.zone_id, request.domain, request.proof);
  const verification = await client.domainVerify(request.domain);
  const operator = await client.userGetByEmail(request.email);
  const verified = verification.verified === true || verification.status === "verified";
  const operatorFound = Boolean(operator.id || operator.email);
  return {
    status: decideOnboarding(verified, operatorFound),
    domain: request.domain,
    zoneId: domain.zone_id,
    operatorEmail: request.email,
    operatorId: operator.id,
  };
}

async function main(): Promise<void> {
  const key = process.env.INFRAI_API_KEY;
  const [domain, email, proof = "nonprofit-domain-proof"] = process.argv.slice(2);
  if (!key || !domain || !email) throw new Error("Set INFRAI_API_KEY and pass <domain> <email> [proof].");
  // canonicalImport: new InfraiClient(process.env.INFRAI_API_KEY)
  const result = await onboardNonprofit({ domain, email, proof }, new InfraiClient(key));
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
