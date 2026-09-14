import { SignIn } from "../../sign-in-view";
export const metadata = { title: "Sign-in result" };
// All public failure outcomes use non-enumerating recovery copy; never echo query text.
export default function Page() {
  return <SignIn returned />;
}
