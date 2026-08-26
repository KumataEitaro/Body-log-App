-- BodyLog migration-19: 無料/ライトの写真解析を「累計5枚」→「1日2枚」へ変更
-- 根拠: 1500人ペルソナ監査（2026-08-26）で全6層共通のペイン1位。
-- 累計制は初日で尽きて看板機能（写真→栄養推定）を体験できないまま離脱を生む。
-- Supabase SQL Editor で実行:
-- https://supabase.com/dashboard/project/rhyfspqxsfpdogzmizic/sql/new
update public.plan_limits set text_day = 5, photo_day = 2, photo_trial_total = 0
  where plan in ('free', 'lite');
