-- BodyLog 追加マイグレーション v10（リマインドメールの配信停止設定）
alter table public.profiles add column if not exists mail_opt_out boolean not null default false;
