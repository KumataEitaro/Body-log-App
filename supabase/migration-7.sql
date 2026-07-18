-- BodyLog 追加マイグレーション v7（マイ食品の「よく使う量」）
alter table public.my_foods add column if not exists serving_label text not null default '';
alter table public.my_foods add column if not exists serving_ratio numeric;
