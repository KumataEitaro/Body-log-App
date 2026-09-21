-- migration-35（2026-09-21）: 食べすぎ・少なすぎの「繰り越し調整」（carry-over）
--
-- events に「種類」と「取り返す日数」を足す。
--   kind        : 'plan'  … 先の予定・チートデイ・リカバリー枠（既存の行はすべてこれ）
--                 'carry' … 食べすぎ／少なすぎのずれを翌日から数日に分けて目標に織り込む調整
--   absorb_days : carry 行を何日に分けるか（承認した時点で固定。null なら端末の既定日数で割る）
-- extra_kcal は numeric で符号の制約が無いので、不足（負の値）もそのまま入る。
-- アプリ側は select('*') で読み、列が無い旧DBでも先の予定だけは動く（調整の登録は失敗する）。
alter table public.events add column if not exists kind text not null default 'plan';
alter table public.events add column if not exists absorb_days int;

alter table public.events drop constraint if exists events_kind_check;
alter table public.events add constraint events_kind_check check (kind in ('plan', 'carry'));

alter table public.events drop constraint if exists events_absorb_days_check;
alter table public.events add constraint events_absorb_days_check check (absorb_days is null or absorb_days between 1 and 60);

-- 1日に carry 行は1本（アプリは delete→insert で保っているが、二重タップの取りこぼしを DB でも塞ぐ）
create unique index if not exists events_carry_one_per_day on public.events (user_id, date) where kind = 'carry';

notify pgrst, 'reload schema';
