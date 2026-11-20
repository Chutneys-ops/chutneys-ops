import type { Metadata } from "next";
import { BackLink } from "@/components/back-link";
import { InstallGuide } from "./install-guide";

export const metadata: Metadata = { title: "Install the app · Chutneys Ops" };

// How to put Chutneys Ops on your home screen. The steps depend on the
// phone, so the guide itself runs in the browser.
export default function InstallPage() {
  return (
    <main className="mx-auto w-full max-w-md px-4 pt-2 pb-6">
      <BackLink href="/home" label="Home" />
      <h1 className="text-3xl font-bold">Install the app</h1>
      <p className="mt-1 text-sm text-muted">
        Add Chutneys Ops to your home screen so it opens full screen with one tap. No app store needed.
      </p>
      <InstallGuide />
    </main>
  );
}
