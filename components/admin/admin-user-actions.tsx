"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import type { AdminTesterRegistration } from "@/lib/repositories/admin-repository";

function formatDate(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("de-AT", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

export function AdminUserActions({ user }: { user: AdminTesterRegistration }) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleDelete() {
    setPending(true);
    try {
      const response = await fetch(`/api/admin/users/${user.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Failed to delete user");
      toast.success("User deleted.");
      router.push("/admin/users");
      router.refresh();
    } catch {
      toast.error("Failed to delete user.");
    } finally {
      setPending(false);
      setConfirmOpen(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {user.deletionRequestedAt ? (
        <Badge variant="destructive">
          Deletion requested {formatDate(user.deletionRequestedAt)}
        </Badge>
      ) : (
        <Badge variant="secondary">Active</Badge>
      )}
      <Button variant="destructive" size="sm" onClick={() => setConfirmOpen(true)}>
        Delete user
      </Button>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete user?</DialogTitle>
            <DialogDescription>
              This permanently removes {user.name}&apos;s registration, chats, and saved cars. This
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={pending} onClick={() => void handleDelete()}>
              Delete user
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
