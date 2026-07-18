import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { callGemini, parseJsonLoose } from '@/lib/gemini';
import { findLang } from '@/lib/langs';

// UI文字列の翻訳（AIで一度だけ翻訳→DBキャッシュ→以後は即返す）
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'auth' }, { status: 401 });

  let lang = '';
  let texts: string[] = [];
  try {
    const body = await req.json();
    lang = String(body.lang || '');
    const rawTexts: string[] = Array.isArray(body.texts)
      ? (body.texts as unknown[]).map((t) => String(t).trim()).filter((t) => t.length > 0 && t.length <= 80)
      : [];
    texts = Array.from(new Set(rawTexts)).slice(0, 80);
  } catch {
    return NextResponse.json({ ok: false, error: 'bad request' }, { status: 400 });
  }
  const langDef = findLang(lang);
  if (!langDef || lang === 'ja' || texts.length === 0) {
    return NextResponse.json({ ok: true, map: {} });
  }

  // キャッシュ参照（RLSで読めるので通常クライアントでOK）
  const { data: cached } = await supabase.from('ui_translations')
    .select('src,dst').eq('lang', lang).in('src', texts);
  const map: Record<string, string> = {};
  for (const row of cached || []) map[row.src] = row.dst;
  const missing = texts.filter((t) => !(t in map));
  if (missing.length === 0) return NextResponse.json({ ok: true, map });

  // 未翻訳分をAIでまとめて翻訳
  const key = process.env.GEMINI_API_KEY;
  if (!key) return NextResponse.json({ ok: true, map }); // キー無しでもキャッシュ分は返す
  const prompt =
    `あなたはUI翻訳者です。次の日本語UI文字列を${langDef.name}（${langDef.native}）に翻訳してください。\n` +
    'ルール: 数値・単位(kcal,kg,g,%)・絵文字・記号はそのまま保持。簡潔なUI向けの訳語。意味不明な断片はそのまま返す。\n' +
    '必ず入力と同じ順序・同じ件数のJSON文字列配列のみを返す。\n\n' +
    JSON.stringify(missing);
  const r = await callGemini(key, [{ text: prompt }], 0);
  if (!r.ok) {
    // キャッシュ分だけでも返しつつ、失敗理由を伝える
    return NextResponse.json({ ok: Object.keys(map).length > 0, map, error: r.error });
  }
  try {
    let arr: unknown = parseJsonLoose(r.text);
    // {"translations":[...]} のようにオブジェクトで返る場合の救済
    if (!Array.isArray(arr) && arr && typeof arr === 'object') {
      const v = Object.values(arr as Record<string, unknown>).find((x) => Array.isArray(x));
      if (v) arr = v;
    }
    if (Array.isArray(arr) && arr.length > 0) {
      const n = Math.min(arr.length, missing.length); // 件数ズレは対応できる分だけ使う
      const rows = missing.slice(0, n).map((src, i) => ({ lang, src, dst: String(arr[i]).slice(0, 300) }));
      rows.forEach((row) => { map[row.src] = row.dst; });
      const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (svcKey && rows.length) {
        const svc = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, svcKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        await svc.from('ui_translations').upsert(rows, { onConflict: 'lang,src' });
      }
      return NextResponse.json({ ok: true, map });
    }
    return NextResponse.json({ ok: Object.keys(map).length > 0, map, error: 'AI応答が配列形式ではありませんでした' });
  } catch {
    return NextResponse.json({ ok: Object.keys(map).length > 0, map, error: 'AI応答の解釈に失敗しました' });
  }
}
