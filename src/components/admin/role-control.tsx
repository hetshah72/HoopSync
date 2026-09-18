"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { NativeSelect } from "@/components/ui/native-select";
import { setUserRoleAction } from "@/server/actions/adminActions";
import type { Role } from "@/types/db";

/**
 * Promote or demote one account.
 *
 * Optimistic with a revert on failure, matching how every other mutation in
 * this app behaves (`feed-card.tsx`). The failure that actually happens here
 * is an admin trying to demote themselves, which the service refuses - so the
 * revert has to put the select back rather than leave it showing a role the
 * server rejected.
 */
export function RoleControl({
  userId,
  role,
  label,
}: {
  userId: string;
  role: Role;
  label: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [value, setValue] = useState<Role>(role);

  function handleChange(next: Role) {
    const previous = value;
    setValue(next);

    startTransition(async () => {
      try {
        await setUserRoleAction({ userId, role: next });
        toast.success(
          `${label} is now ${next}. It applies at their next sign-in.`,
        );
        router.refresh();
      } catch (err) {
        setValue(previous);
        toast.error(
          err instanceof Error ? err.message : "Couldn't change that role.",
        );
      }
    });
  }

  return (
    <NativeSelect
      aria-label={`Role for ${label}`}
      value={value}
      disabled={isPending}
      onChange={(event) => handleChange(event.target.value as Role)}
      className="h-8 w-28 text-xs"
    >
      <option value="player">Player</option>
      <option value="admin">Admin</option>
    </NativeSelect>
  );
}
