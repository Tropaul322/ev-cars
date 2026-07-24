alter table public.match_sessions
  add column if not exists tester_registration_id uuid references public.tester_registrations(id) on delete cascade;

create index if not exists match_sessions_tester_idx
  on public.match_sessions (tester_registration_id, created_at desc);

create table if not exists public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  tester_registration_id uuid not null references public.tester_registrations(id) on delete cascade,
  title text,
  latest_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists chat_sessions_tester_latest_idx
  on public.chat_sessions (tester_registration_id, latest_message_at desc);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  chat_session_id uuid not null references public.chat_sessions(id) on delete cascade,
  tester_registration_id uuid not null references public.tester_registrations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_session_created_idx
  on public.chat_messages (chat_session_id, created_at asc);

create index if not exists chat_messages_tester_created_idx
  on public.chat_messages (tester_registration_id, created_at desc);

drop trigger if exists chat_sessions_touch_updated_at on public.chat_sessions;

create trigger chat_sessions_touch_updated_at
before update on public.chat_sessions
for each row
execute function public.touch_updated_at();
