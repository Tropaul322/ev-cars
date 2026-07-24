import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminChatViewer } from "@/components/admin/admin-chat-viewer";
import { AdminShell } from "@/components/admin/admin-shell";
import {
  getChatWithMessagesAdmin,
  getTesterRegistrationAdmin
} from "@/lib/repositories/admin-repository";

type PageProps = {
  params: Promise<{ id: string; chatId: string }>;
};

export default async function AdminUserChatPage({ params }: PageProps) {
  const { id, chatId } = await params;
  const [user, chat] = await Promise.all([
    getTesterRegistrationAdmin(id),
    getChatWithMessagesAdmin(chatId)
  ]);

  if (!user || !chat || chat.testerRegistrationId !== id) notFound();

  return (
    <AdminShell>
      <div className="flex flex-col gap-2">
        <Link href={`/admin/users/${id}`} className="text-sm text-muted-foreground hover:underline">
          Back to {user.name}
        </Link>
        <p className="text-sm text-muted-foreground">
          {user.email} · {user.location}
        </p>
      </div>
      <AdminChatViewer title={chat.title} messages={chat.messages} />
    </AdminShell>
  );
}
