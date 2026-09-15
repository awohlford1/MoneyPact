import NextLink from "next/link";
import { BudgetList } from "../journey";
import { ResumeAfterCeremony } from "../invitations-shared";
export const metadata = { title: "Your budgets" };
// PK-8: the provider hops (the invitee's sign-in, the Primary Owner's step-up) land here; ResumeAfterCeremony follows
// the return marker the ceremony or transfer page left, and the notices link is the person's own list.
export default function Page() {
  return <>
    <ResumeAfterCeremony />
    <BudgetList />
    <NextLink className="text-interactive underline" href="/notices">Notices</NextLink>
  </>;
}
