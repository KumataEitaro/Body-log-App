-- BodyLog migration-21: 妊娠・授乳フラグ（安全ガードG3）
-- 妊娠・授乳中のユーザーに減量目標・減量提案を出さないためのフラグ。
-- ONの間: アプリは減量方向の体重目標を保存不可にし、AI相談は
-- 「減量提案禁止・付加量込みの維持・注意食材への言及」ルールで答える。
-- アプリ側はこの列が無くても壊れない（select('*')で読み・update失敗時は列なしで再実行）。
-- Supabase SQL Editor で実行:
-- https://supabase.com/dashboard/project/rhyfspqxsfpdogzmizic/sql/new
alter table public.profiles add column if not exists maternity boolean default false;
