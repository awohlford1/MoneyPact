/** SM-212-01 compile-time negative fixtures for required subject scope and API-only role exposure. */
import { test } from "node:test";
import type { createApiClient, createWorkerClient } from "./client.ts";
import type { ProfileInsertQuery, ProfileSelectQuery, ProfileUpdateQuery } from "./profile.ts";

void test("SM-212-01 negative fixture: accountSubjectId cannot be omitted from a profile select", () => {
  // @ts-expect-error SM-212-01: every profile statement requires accountSubjectId.
  const missingSubject: ProfileSelectQuery = { table: "financial_profiles" };
  void missingSubject;
});

void test("SM-212-01 negative fixture: accountSubjectId cannot be omitted from a profile insert", () => {
  // @ts-expect-error SM-212-01: every profile statement requires accountSubjectId.
  const missingSubject: ProfileInsertQuery = { table: "financial_profiles", values: {} };
  void missingSubject;
});

void test("SM-212-01 negative fixture: accountSubjectId cannot be omitted from a profile update", () => {
  // @ts-expect-error SM-212-01: every profile statement requires accountSubjectId.
  const missingSubject: ProfileUpdateQuery = { table: "financial_profiles", set: { profile_state: "deleted" } };
  void missingSubject;
});

void test("SM-212-01: the worker role has no subject-scoped profile path", () => {
  const worker = {} as ReturnType<typeof createWorkerClient>;
  // @ts-expect-error SM-212-01 is exposed only to the API role.
  void worker.profileSelect;
});

void test("SM-212-01: DataAccessClient exposes the subject-scoped profile path to the API role", () => {
  const api = {} as ReturnType<typeof createApiClient>;
  void api.profileSelect;
  void api.profileInsert;
  void api.profileUpdate;
  void api.profileDelete;
});
