-- BodyLog 追加マイグレーション v15（プレミアム課金）
alter table public.profiles add column if not exists premium_until timestamptz;
