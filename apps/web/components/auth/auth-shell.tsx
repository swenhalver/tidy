import type { ReactNode } from "react";
import { TidyLogo } from "@/components/ui/tidy-logo";
import { NavigationLink } from "@/components/ui/navigation-link";

type AuthShellProps = {
  title: string;
  description: string;
  children: ReactNode;
};

export function AuthShell({ title, description, children }: AuthShellProps) {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <TidyLogo />
        <div className="mt-14">
          <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-2 text-sm text-primary-black/70">{description}</p>
        </div>
        {children}
        <nav
          aria-label="Legal"
          className="mt-6 flex justify-center gap-5 text-xs text-secondary-ink"
        >
          <NavigationLink
            href="/privacy"
            className="rounded-sm hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-4"
          >
            Privacy and cookies
          </NavigationLink>
          <NavigationLink
            href="/terms"
            className="rounded-sm hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-4"
          >
            Terms of service
          </NavigationLink>
        </nav>
      </div>
    </main>
  );
}
