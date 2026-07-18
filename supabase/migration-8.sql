-- BodyLog 追加マイグレーション v8（UI翻訳キャッシュ）
create table if not exists public.ui_translations (
  lang text not null,
  src text not null,
  dst text not null,
  created_at timestamptz not null default now(),
  primary key (lang, src)
);
alter table public.ui_translations enable row level security;
-- 読み取りはログインユーザー全員（書き込みはservice roleのみ＝ポリシー無し）
drop policy if exists "ui_translations_read" on public.ui_translations;
create policy "ui_translations_read" on public.ui_translations
  for select using (auth.role() = 'authenticated');
