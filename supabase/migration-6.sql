-- BodyLog 追加マイグレーション v6（チートデイ超過の取り返し方式）
-- null=目標日まで均等 / 7,14,30=チートデイ後N日で取り返す
alter table public.goals add column if not exists absorb_days int;
