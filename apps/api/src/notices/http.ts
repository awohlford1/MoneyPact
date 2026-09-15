/**
 * The subject-self notices routes (PK8-F01 of `INVITATIONS-DESIGN-001`;
 * CBD-234 design section 13; CBD-73 `DR-73-11`, `IC-73-019`; CBD-41-AC10,
 * CBD-8-AC08):
 *
 *   GET  /v1/notices                    the caller's own `account_lifecycle_notice` rows, newest first
 *   POST /v1/notices/{noticeId}/read    marks one of the caller's own rows read (set-once; a repeat answers the row as it is)
 *
 * A notice belongs to a person, never to a budget space (design section 13):
 * the table is identity-scoped, every statement here is predicated on the
 * caller's own `account_subject_id`, and a `noticeId` alone locates nothing
 * -- another person's identifier and an unknown one answer the same
 * `404 notice_not_found` with nothing written. The row is the notice (the
 * prototype has no delivery); it carries a message code and never copy nor
 * another person's state, and this projection adds nothing: `noticeId`,
 * `budgetSpaceId` (null for a space-less notice), `messageCode`, `createdAt`,
 * `readAt`. The event correlation id stays server-side.
 *
 * **The cells** (CBD-236 p6, section 8.9; docs/cbd-236-p6-subject-self-amendment-proposal.md
 * `P6-E04`; `EXEC-P6-RULINGS-001` P6-D01). The list runs on the dedicated
 * `notice.read` subject-self read cell and the mark-read runs on the
 * dedicated `notice.mark_read` subject-self mutate cell, closing `GAPS-F01`
 * / `SEC-GAPS-R1`: the two routes previously shared the released `profile.read`
 * cell (a read `effectClass`), so the mark-read mutation never carried
 * `recheck_at_commit`. The `forbid_account_lifecycle_notice_mutation`
 * trigger stays defense in depth for the one set-once stamp
 * (`read_at`) it always admitted; the policy layer never evaluates a
 * notice's own lifecycle state (`P6-N08`; proposal section 4).
 *
 * Both routes run on the general `ApiTransactionStore`'s serializable
 * transaction and every answer commits: the `404` is a *returned*
 * `RouteFailure` (the interceptor throws it after the transaction), so a
 * miss never records a denial for a request the policy allowed.
 */
import { Controller, Get, HttpCode, Module, Post, Req } from "@nestjs/common";
import type { DynamicModule } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { DataAccessClient } from "@cobudget/data-access";
import { Authorize, Authorization, RouteFailure } from "../authorization/http.js";
import { AuthorizationDenied } from "../authorization/boundary.js";
import type { EffectContext } from "../authorization/boundary.js";
import {
  listAccountLifecycleNotices, markAccountLifecycleNoticeRead, readAccountLifecycleNotice,
} from "../../../../packages/data-access/src/account-lifecycle-notice.ts";
import type { AccountLifecycleNoticeRow } from "../../../../packages/data-access/src/account-lifecycle-notice.ts";

/** The p6 subject-self cells the two routes run on (see the header): the read and the mark-read are separate cells. */
export const NOTICES_READ_ACTION = "notice.read";
export const NOTICES_MARK_READ_ACTION = "notice.mark_read";

/** The customer projection of one row: what `apps/web/src/api/invitations.ts` reads as `WireNotice`. */
export interface NoticeView {
  readonly noticeId: string;
  readonly budgetSpaceId: string | null;
  readonly messageCode: string;
  readonly createdAt: string;
  readonly readAt: string | null;
}

export interface NoticeStatements {
  readonly list: (accountSubjectId: string) => Promise<readonly AccountLifecycleNoticeRow[]>;
  readonly read: (accountSubjectId: string, noticeId: string) => Promise<AccountLifecycleNoticeRow | null>;
  readonly markRead: (accountSubjectId: string, noticeId: string, at: string) => Promise<number>;
}

export interface NoticesHttpDependencies {
  /** The identity-scoped statements on the transaction a route holds; every one is predicated on the caller's subject. */
  readonly within: (transaction: DataAccessClient) => NoticeStatements;
  readonly now: () => Date;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export function noticeView(row: AccountLifecycleNoticeRow): NoticeView {
  return { noticeId: row.notice_id, budgetSpaceId: row.budget_space_id, messageCode: row.message_code, createdAt: row.created_at, readAt: row.read_at };
}

/** Newest first; the identifier breaks a tie so the order is total and stable across reads. */
export function newestFirst(rows: readonly AccountLifecycleNoticeRow[]): readonly AccountLifecycleNoticeRow[] {
  return [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.notice_id.localeCompare(a.notice_id));
}

@Module({})
export class NoticesModule {}

export function noticesHttp(dependencies: NoticesHttpDependencies): { module: DynamicModule } {
  const subjectSelf = () => ({ fieldSet: "default" as const, scope: "subject" as const });
  /** The caller's subject from the decided input and nowhere else; a request naming no subject, or the wrong cell, is refused. */
  const subjectOf = (effect: EffectContext, action: string): string => {
    const subject = effect.input.subject;
    const accountSubjectId = subject && "accountSubjectId" in subject ? subject.accountSubjectId : undefined;
    if (typeof accountSubjectId !== "string" || !accountSubjectId || effect.input.request.action !== action) throw new AuthorizationDenied();
    return accountSubjectId;
  };
  /** The UUID shape is validated before any statement sees it; a malformed identifier names no notice. */
  const noticeOf = (request: FastifyRequest): string | null => {
    const id = (request.params as Record<string, unknown>).noticeId;
    return typeof id === "string" && UUID.test(id) ? id.toLowerCase() : null;
  };

  @Controller("v1/notices")
  class NoticesController {
    @Get()
    @Authorize({ action: NOTICES_READ_ACTION, purpose: "user_delegated", resourceLocator: subjectSelf })
    async list(@Authorization() effect: EffectContext): Promise<unknown> {
      const subject = subjectOf(effect, NOTICES_READ_ACTION);
      const rows = await dependencies.within(effect.transaction as DataAccessClient).list(subject);
      return { notices: newestFirst(rows).map(noticeView) };
    }

    @Post(":noticeId/read")
    @HttpCode(200)
    @Authorize({ action: NOTICES_MARK_READ_ACTION, purpose: "user_delegated", resourceLocator: subjectSelf })
    async markRead(@Req() request: FastifyRequest, @Authorization() effect: EffectContext): Promise<unknown> {
      const subject = subjectOf(effect, NOTICES_MARK_READ_ACTION);
      const noticeId = noticeOf(request);
      if (!noticeId) return new RouteFailure(404, "notice_not_found");
      const statements = dependencies.within(effect.transaction as DataAccessClient);
      const row = await statements.read(subject, noticeId);
      if (!row) return new RouteFailure(404, "notice_not_found");
      // Set-once (the PK-2 trigger raises on a second stamp): an already-read row is answered as it is, nothing written.
      if (row.read_at !== null) return { notice: noticeView(row) };
      const at = dependencies.now().toISOString();
      const stamped = await statements.markRead(subject, noticeId, at);
      if (stamped !== 1) return new RouteFailure(404, "notice_not_found");
      return { notice: noticeView({ ...row, read_at: at }) };
    }
  }

  return { module: { module: NoticesModule, controllers: [NoticesController] } };
}

/** The production statements: the identity-scoped `account_lifecycle_notice` statements on the route's transaction. */
export function dataAccessNoticesDependencies(options: { readonly now: () => Date }): NoticesHttpDependencies {
  return {
    now: options.now,
    within: (transaction) => ({
      list: (subject) => listAccountLifecycleNotices(transaction, subject),
      read: (subject, noticeId) => readAccountLifecycleNotice(transaction, subject, noticeId),
      markRead: (subject, noticeId, at) => markAccountLifecycleNoticeRead(transaction, subject, noticeId, at),
    }),
  };
}
