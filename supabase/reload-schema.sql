-- ============================================================
-- BodyLog: API（PostgREST）のスキーマキャッシュを更新する（2026-09-06）
-- 実行先: https://supabase.com/dashboard/project/rhyfspqxsfpdogzmizic/sql/new
--
-- テーブルや列を SQL で足しても、API 側のキャッシュが古いままだと
--   ・profiles.terms_version が書けない → 起動ごとに規約の再同意画面
--   ・プロフィール保存が失敗 → 「入力がなかったことになる」
--   ・body_photos への insert が失敗 → 体の写真が保存できない
-- が起きる（2026-09-05〜06 に実際に3件同時発生）。DDL を実行したら必ずこれを流す。
-- ============================================================
notify pgrst, 'reload schema';

-- 自動更新の仕組み（DDL を検知して勝手に reload するイベントトリガ）が生きているかの確認。
-- 期待値: pgrst_ddl_watch と pgrst_drop_watch の2行。無ければ、SQL 実行のたびに上の notify が必要
select evtname, evtevent, evtenabled from pg_event_trigger where evtname like 'pgrst%';
