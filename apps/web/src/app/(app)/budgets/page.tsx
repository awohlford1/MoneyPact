import NextLink from "next/link";
import { BudgetList } from "../journey";
export const metadata = { title: "Your budgets" };
// PK-8: the ordinary sign-in destination. The invitation ceremony and the Primary-transfer step-up each carry
// their own destination now (CBD-190 identity amendments proposal §3.5) and no longer land here at all.
export default function Page() {
  return <>
    <BudgetList />
    <NextLink className="text-interactive underline" href="/notices">Notices</NextLink>
  </>;
}
