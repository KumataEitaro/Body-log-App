// BodyLog 結合テスト（認証不要シナリオの自動実行）
// 実行: node tests/integration.mjs [BASE_URL]
// 本番のNext.jsアプリとSupabase(REST)に対して、外部から観測できる振る舞いを検証する。

const BASE = process.argv[2] || 'https://bodylog-orcin.vercel.app';
const SUPA = 'https://rhyfspqxsfpdogzmizic.supabase.co';
const ANON = 'sb_publishable_pBMF6abwB7G2P6EUkniV-A_OSZOw2oD'; // 公開キー（クライアントに埋め込まれる前提の値）

let pass = 0, fail = 0;
const results = [];
async function t(id, name, fn) {
  try {
    await fn();
    pass++; results.push(`✅ ${id} ${name}`);
  } catch (e) {
    fail++; results.push(`❌ ${id} ${name} — ${e.message}`);
  }
}
const eq = (a, b, label) => { if (a !== b) throw new Error(`${label}: expected ${b}, got ${a}`); };
const ok = (cond, label) => { if (!cond) throw new Error(label); };

// ===== A. ルーティング/認証ガード =====
await t('A-1', 'トップ(/)は未ログインなら/loginへリダイレクト', async () => {
  const r = await fetch(`${BASE}/`, { redirect: 'manual' });
  ok([301, 302, 307, 308].includes(r.status), `status=${r.status}`);
  ok((r.headers.get('location') || '').includes('/login'), `location=${r.headers.get('location')}`);
});
await t('A-2', '/dashboardは未ログインなら/loginへリダイレクト', async () => {
  const r = await fetch(`${BASE}/dashboard`, { redirect: 'manual' });
  ok([301, 302, 307, 308].includes(r.status), `status=${r.status}`);
  ok((r.headers.get('location') || '').includes('/login'), 'not redirected to /login');
});
await t('A-3', '/logは未ログインなら/loginへリダイレクト', async () => {
  const r = await fetch(`${BASE}/log`, { redirect: 'manual' });
  ok([301, 302, 307, 308].includes(r.status), `status=${r.status}`);
});
await t('A-4', '/loginは200でアプリ名を含む', async () => {
  const r = await fetch(`${BASE}/login`);
  eq(r.status, 200, 'status');
  const html = await r.text();
  ok(html.includes('BodyLog'), 'BodyLog not in HTML');
});

// ===== B. AI解析API（認証・入力チェック） =====
await t('B-1', '/api/parse-food 未ログインは401', async () => {
  const r = await fetch(`${BASE}/api/parse-food`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'ごはん' }),
  });
  eq(r.status, 401, 'status');
  const j = await r.json();
  eq(j.ok, false, 'ok');
});
await t('B-2', '/api/parse-food 不正ボディでも認証が先(401)', async () => {
  const r = await fetch(`${BASE}/api/parse-food`, { method: 'POST', body: 'not-json' });
  eq(r.status, 401, 'status');
});

// ===== C. DB: 匿名アクセスからのデータ保護（RLS） =====
const rest = (path) => fetch(`${SUPA}/rest/v1/${path}`, { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } });
await t('C-1', '匿名でentriesを読んでも0件（RLSで他人のデータが見えない）', async () => {
  const r = await rest('entries?select=date&limit=10');
  eq(r.status, 200, 'status');
  const j = await r.json();
  eq(j.length, 0, 'visible rows');
});
await t('C-2', '匿名でprofilesを読んでも0件', async () => {
  const r = await rest('profiles?select=display_name&limit=10');
  eq(r.status, 200, 'status');
  eq((await r.json()).length, 0, 'visible rows');
});
await t('C-3', '匿名でentriesにinsertできない', async () => {
  const r = await fetch(`${SUPA}/rest/v1/entries`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: '00000000-0000-0000-0000-000000000000', date: '2026-01-01' }),
  });
  ok(r.status === 401 || r.status === 403, `insert allowed?! status=${r.status}`);
});

// ===== D. スキーマ: migration-2の反映確認 =====
await t('D-1', 'entriesにphoto_urls列が存在する', async () => {
  const r = await rest('entries?select=photo_urls&limit=0');
  eq(r.status, 200, `status=${r.status}（400なら列が無い＝migration-2未実行）`);
});
await t('D-2', 'ai_usageテーブルが存在する', async () => {
  const r = await rest('ai_usage?select=count&limit=0');
  eq(r.status, 200, `status=${r.status}（404なら未作成＝migration-2未実行）`);
});
await t('D-3', '匿名でai_usageは読めない(0件)', async () => {
  const r = await rest('ai_usage?select=count&limit=10');
  if (r.status !== 200) throw new Error('table missing');
  eq((await r.json()).length, 0, 'visible rows');
});

await t('D-4', 'my_foodsテーブルが存在する', async () => {
  const r = await rest('my_foods?select=name&limit=0');
  eq(r.status, 200, `status=${r.status}（404なら未作成＝migration-3未実行）`);
});
await t('D-5', '匿名でmy_foodsは読めない(0件)', async () => {
  const r = await rest('my_foods?select=name&limit=10');
  if (r.status !== 200) throw new Error('table missing');
  eq((await r.json()).length, 0, 'visible rows');
});

await t('D-6', 'logsテーブルが存在する', async () => {
  const r = await rest('logs?select=id&limit=0');
  eq(r.status, 200, `status=${r.status}（404なら未作成＝migration-4未実行）`);
});
await t('D-7', '匿名でlogsは読めない(0件)', async () => {
  const r = await rest('logs?select=id&limit=10');
  if (r.status !== 200) throw new Error('table missing');
  eq((await r.json()).length, 0, 'visible rows');
});

for (const [id, table] of [['D-8', 'goals'], ['D-9', 'events'], ['D-10', 'body_photos']]) {
  await t(id, `${table}テーブルが存在し匿名では読めない`, async () => {
    const r = await rest(`${table}?select=user_id&limit=10`);
    eq(r.status, 200, `status=${r.status}（404なら未作成）`);
    eq((await r.json()).length, 0, 'visible rows');
  });
}

// ===== E. ストレージ: 匿名アクセス防止 =====
await t('E-1', '匿名でmealsバケットの写真一覧は取得できない', async () => {
  const r = await fetch(`${SUPA}/storage/v1/object/list/meals`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix: '' }),
  });
  const j = await r.json().catch(() => []);
  ok(r.status !== 200 || (Array.isArray(j) && j.length === 0), `anon can list?! status=${r.status}`);
});

console.log(results.join('\n'));
console.log(`\n結果: ${pass} passed / ${fail} failed`);
process.exit(fail ? 1 : 0);
