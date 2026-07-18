-- BodyLog 追加マイグレーション v12（脂質の1日上限g）
alter table public.goals add column if not exists fat_max_g numeric;
