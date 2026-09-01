import { NextResponse } from 'next/server';
import { getApiAuth } from '@/lib/supabase/apiAuth';
import { todayJST } from '@/lib/calc';

// アプリ内フィードバック（設定 → サポート → ご意見・不具合の報告）の受け口。
//
// crash（/api/crash）と違って**認証必須**にしている。理由は2つ:
//  ・匿名の意見箱は荒らしの的になり、読む側が疲れて結局読まなくなる（＝窓口が死ぬ）
//  ・後から「この人に何が起きていたか」を本人の記録と突き合わせて追える必要がある
// 書き込みはユーザーのトークンで行う（service roleを使わない）。feedbackのRLSは
// insert/selectが本人のみで、update/deleteのポリシーは存在しない＝APIを通しても改ざんできない。
//
// 保存するのはフォームに明示した5つだけ（本文・種別・アプリのバージョン・OS・言語）。
// 記録の中身（体重・食事・写真）はここを一切通らない。
export const preferredRegion = 'hnd1';

const KINDS = ['bug', 'idea', 'other'];
const BODY_MAX = 1000;
/** 同一ユーザーの1日あたり上限（JST基準）。窓口を殺さず、連投だけを止める緩さにしてある */
const DAILY_LIMIT = 10;

export async function POST(req: Request) {
  const [{ supabase, user }, bodyRaw] = await Promise.all([
    getApiAuth(req),
    req.json().catch(() => null),
  ]);
  if (!user) return NextResponse.json({ ok: false, error: 'ログインが必要です。' }, { status: 401 });

  const b = (bodyRaw ?? {}) as {
    kind?: unknown; body?: unknown; appVersion?: unknown; platform?: unknown; locale?: unknown;
  };

  // ===== 検証（種別は3種のみ・本文は1〜1000字） =====
  const kind = String(b.kind ?? '');
  if (!KINDS.includes(kind)) {
    return NextResponse.json({ ok: false, error: '種別を選んでください。' }, { status: 400 });
  }
  const text = String(b.body ?? '').trim();
  if (text.length < 1 || text.length > BODY_MAX) {
    return NextResponse.json({ ok: false, error: '本文は1〜1000字で入力してください。' }, { status: 400 });
  }

  // ===== レート制限（本人の当日件数。ai_usageと同じくJSTの1日で数える） =====
  // 当日の起点はJSTの0時。created_atはtimestamptzなのでオフセット付きの文字列で比較する
  const dayStart = `${todayJST()}T00:00:00+09:00`;
  const { count, error: cErr } = await supabase
    .from('feedback')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .gte('created_at', dayStart);
  // 数えられなかったとき（テーブル未作成など）は止めない。後段のinsertが失敗すれば
  // 「送信できませんでした」として正直に返る。数え損ねで窓口を閉じるほうが害が大きい
  if (!cErr && (count ?? 0) >= DAILY_LIMIT) {
    return NextResponse.json(
      { ok: false, error: '今日はこれ以上送信できません。明日またお願いします。' },
      { status: 429 },
    );
  }

  const { error } = await supabase.from('feedback').insert({
    user_id: user.id,
    kind,
    body: text,
    app_version: String(b.appVersion ?? '').slice(0, 32) || null,
    platform: String(b.platform ?? '').slice(0, 16) || null,
    locale: String(b.locale ?? '').slice(0, 16) || null,
  });
  // migration-29が未適用でもアプリ側は「送信できませんでした」で受け止める。
  // ここで成功を装うと、書いた人の声が消えたことに誰も気づけない
  if (error) {
    return NextResponse.json(
      { ok: false, error: '送信できませんでした。しばらくしてからお試しください。' },
      { status: 500 },
    );
  }

  console.log(`[feedback] uid=${user.id} kind=${kind} len=${text.length}`);
  return NextResponse.json({ ok: true });
}
