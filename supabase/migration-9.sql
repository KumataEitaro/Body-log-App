-- BodyLog 追加マイグレーション v9（未入力アラートの送信記録）
alter table public.profiles add column if not exists last_inactivity_mail date;
