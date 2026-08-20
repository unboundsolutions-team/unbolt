"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <Button
      variant="ghost"
      size="sm"
      loading={busy}
      onClick={async () => {
        setBusy(true);
        await signOut();
        // refresh() clears the cached RSC payload, so the portal cannot flash
        // the previous user's data before the redirect lands.
        router.replace("/login");
        router.refresh();
      }}
    >
      Sign out
    </Button>
  );
}
