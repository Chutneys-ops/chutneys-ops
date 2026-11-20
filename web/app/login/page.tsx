import { Suspense } from "react";
import { LoginForm } from "./login-form";

// Messages other pages can show here with /login?notice=...
const NOTICES: Record<string, string> = {
  deactivated: "Your account has been turned off. Talk to your manager.",
  link: "That link has expired or was already used. Use Forgot password to get a new one.",
};

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      {/* Reading ?notice= waits for the request, so it sits in Suspense; the
          form without a notice shows meanwhile. */}
      <Suspense fallback={<LoginForm notice={null} />}>
        <LoginWithNotice searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function LoginWithNotice({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const { notice } = await searchParams;
  const key = Array.isArray(notice) ? notice[0] : notice;
  return <LoginForm notice={(key && NOTICES[key]) || null} />;
}
