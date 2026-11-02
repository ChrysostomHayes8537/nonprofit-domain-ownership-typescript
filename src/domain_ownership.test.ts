import test from "node:test";
import assert from "node:assert/strict";
import { decideOnboarding } from "./domain_ownership.ts";

test("approves onboarding only after TXT proof and operator lookup succeed", () => {
  assert.equal(decideOnboarding(true, true), "approved");
  assert.equal(decideOnboarding(false, true), "pending");
  assert.equal(decideOnboarding(true, false), "pending");
});
