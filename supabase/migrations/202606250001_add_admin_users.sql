create table if not exists public.admin_users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  password_hash text not null,
  name text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists admin_users_email_unique_idx
  on public.admin_users (lower(email));

create index if not exists admin_users_active_idx
  on public.admin_users (active);

drop trigger if exists admin_users_touch_updated_at on public.admin_users;

create trigger admin_users_touch_updated_at
before update on public.admin_users
for each row
execute function public.touch_updated_at();
