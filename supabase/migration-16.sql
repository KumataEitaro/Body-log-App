-- BodyLog 追加マイグレーション v16（ダイエット目的）
-- オンボーディングで選ぶ目的（cut_lean / cut_std / easy / bulk）。
-- PFC係数の既定値と、AI相談の前提（目的に沿った提案）に使う。
alter table public.profiles add column if not exists purpose text;
