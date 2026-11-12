import { LogOut } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { signOut } from "@/lib/auth/auth";
import { Sidebar } from "@/components/layout/sidebar";
import { TopBar } from "@/components/layout/top-bar";
import { PageTransition } from "@/components/layout/page-transition";

export const dynamic = "force-dynamic";

async function signOutAction() {
  "use server";
  await signOut({ redirectTo: "/login" });
}

export default async function DashboardLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <Sidebar
        email={user.email}
        signOutSlot={
          <form action={signOutAction}>
            <button
              type="submit"
              className="flex items-center gap-2 text-xs text-muted transition-colors hover:text-fg"
            >
              <LogOut className="size-3.5" /> Sign out
            </button>
          </form>
        }
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="mx-auto w-full max-w-[1480px] flex-1 overflow-x-clip px-4 pb-16 pt-5 sm:px-6">
          <PageTransition>{children}</PageTransition>
        </main>
      </div>
    </div>
  );
}
