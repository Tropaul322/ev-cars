"use client";

import Link from "next/link";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import type { AdminTesterRegistration } from "@/lib/repositories/admin-repository";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("de-AT", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

export function UsersTable({ users }: { users: AdminTesterRegistration[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminTesterRegistration | null>(null);

  async function handleDelete() {
    if (!deleteTarget) return;

    setPendingId(deleteTarget.id);
    try {
      const response = await fetch(`/api/admin/users/${deleteTarget.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Failed to delete user");
      toast.success("User deleted.");
      setDeleteTarget(null);
      router.refresh();
    } catch {
      toast.error("Failed to delete user.");
    } finally {
      setPendingId(null);
    }
  }

  if (!users.length) {
    return (
      <div className="rounded-3xl bg-muted px-6 py-10 text-center text-muted-foreground">
        No registered users yet.
      </div>
    );
  }

  return (
    <>
      <div className="overflow-hidden rounded-3xl border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Registered</TableHead>
              <TableHead>Chats</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id}>
                <TableCell>
                  <Link href={`/admin/users/${user.id}`} className="font-medium hover:underline">
                    {user.name}
                  </Link>
                </TableCell>
                <TableCell>{user.email}</TableCell>
                <TableCell>{user.location}</TableCell>
                <TableCell>{formatDate(user.createdAt)}</TableCell>
                <TableCell>{user.chatCount}</TableCell>
                <TableCell>
                  {user.deletionRequestedAt ? (
                    <Badge variant="destructive">Deletion requested</Badge>
                  ) : (
                    <Badge variant="secondary">Active</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={pendingId === user.id}
                    onClick={() => setDeleteTarget(user)}
                  >
                    Delete
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete user?</DialogTitle>
            <DialogDescription>
              This permanently removes {deleteTarget?.name}&apos;s registration, chats, and saved
              cars. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={pendingId === deleteTarget?.id}
              onClick={() => void handleDelete()}
            >
              Delete user
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
