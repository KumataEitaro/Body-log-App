-- BodyLog 追加マイグレーション v11（PFC目標: 体重1kgあたりのたんぱく質・脂質）
alter table public.goals add column if not exists protein_per_kg numeric;
alter table public.goals add column if not exists fat_per_kg numeric;
