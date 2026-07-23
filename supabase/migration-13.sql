-- BodyLog 追加マイグレーション v13（ウエスト記録）
-- 体重と同じく logs（1記録ごと）と entries（日次サマリー）に waist(cm) を持たせる。
alter table public.logs add column if not exists waist numeric;
alter table public.entries add column if not exists waist numeric;
