import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminUserActions } from "@/components/admin/admin-user-actions";
import { AdminShell } from "@/components/admin/admin-shell";
import { UserChatsList } from "@/components/admin/user-chats-list";
import {
  getTesterRegistrationAdmin,
  listChatSessionsForUserAdmin
} from "@/lib/repositories/admin-repository";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function AdminUserDetailPage({ params }: PageProps) {
  const { id } = await params;
  const [user, chats] = await Promise.all([
    getTesterRegistrationAdmin(id),
    listChatSessionsForUserAdmin(id)
  ]);

  if (!user) notFound();

  return (
    <AdminShell>
      <div className="flex flex-col gap-2">
        <Link href="/admin/users" className="text-sm text-muted-foreground hover:underline">
          Back to users
        </Link>
        <h1 className="font-display text-3xl font-extrabold">{user.name}</h1>
        <p className="text-muted-foreground">
          {user.email} · {user.location}
        </p>
        <AdminUserActions user={user} />
      </div>
      <UserChatsList userId={user.id} chats={chats} />
    </AdminShell>
  );
}
