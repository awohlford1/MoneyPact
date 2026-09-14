import { SignIn } from "../sign-in-view";
export const metadata = { title: "Sign in" };
export default async function Page({ searchParams }: { searchParams: Promise<{ outcome?: string }> }) {
  const { outcome } = await searchParams;
  return <SignIn returned={Boolean(outcome)} />;
}
