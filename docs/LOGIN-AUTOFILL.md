# ログインのパスワード自動入力（iOS AutoFill）

βフィードバック（2026-09-02）で挙がった3件への対応記録と、**熊田さんが手で埋める設定手順**。

| 症状 | 原因 | 対応 |
|---|---|---|
| ①いつものアカウントが候補に出ない。一度だけ入れた別アカウントだけ出る | ログイン時の `autoComplete="password"` はReactNativeのiOSマッピング表に載っておらず、`textContentType` が **undefined** のままだった。新規登録時の `'new-password'` だけが `newPassword` に変換されていた | メール欄=`username` / パスワード欄=`password`・`newPassword` を**明示** |
| ②FaceIDで複数アカウントを選びたい | 切替導線が無かった（ログアウトするしかない） | ログイン画面に「保存済みのアカウントから選ぶ」、設定に「アカウントを切り替える」を追加 |
| ③打鍵のたびに自動入力バーが点滅する | フィールドの意味が未確定だとiOSが本文の変化ごとに種別を再判定してアクセサリを作り直す。加えて同一インスタンスの `autoComplete` をモードで出し分けていた | `textContentType` 明示＋モードごとに `key` を分けた別インスタンス＋入力欄を memo 化 |

---

## 根拠（React Native 0.86 のソース）

`node_modules/react-native/Libraries/Components/TextInput/TextInput.js` の
`autoCompleteWebToTextContentTypeMap` に **`'password'` というキーは存在しない**。

```
'current-password': 'password',
'new-password': 'newPassword',
```

そして `textContentType` は次の式で決まる。

```js
textContentType={
  textContentType != null ? textContentType
  : Platform.OS === 'ios' && autoComplete && autoComplete in autoCompleteWebToTextContentTypeMap
    ? autoCompleteWebToTextContentTypeMap[autoComplete]
    : textContentType   // ← 未ヒットなら undefined のまま
}
```

つまり修正前のコード `autoComplete={isLogin ? 'password' : 'new-password'}` は、
**ログイン時だけ iOS にフィールドの意味が伝わっていなかった**。
iOSは「username欄とpassword欄の対」を見つけて初めて保存を提案するので、
ログインで入れた資格情報は一度も保存されず、候補にも出なかった。
新規登録で作った `bodylog.review@gmail.com` だけが候補に出ていたのは、この経路の違いによる。

---

## 熊田さんの作業（この3つをやらないと ① は完治しません）

コード側（`app.json` / AASAファイル / proxy / next.config）は対応済み。
残るのは **Apple Developer とファイルのTeam ID** で、これは人手が要る。

### 手順1. Team ID を調べる

1. https://developer.apple.com/account → 右上の「Membership details」
2. **Team ID**（10文字の英数字。例 `A1B2C3D4E5`）を控える

### 手順2. AASAファイルの `TEAMID` を置き換える

`public/.well-known/apple-app-site-association` を開き、`TEAMID` を実際のTeam IDに書き換える。

```json
{
  "webcredentials": {
    "apps": [
      "TEAMID.com.gotcha.bodylog.rn"
    ]
  }
}
```

置き換え後（例）: `"A1B2C3D4E5.com.gotcha.bodylog.rn"`

書き換えたら Vercel にデプロイする（`main` へpushで自動）。

> 注意: このファイルは **拡張子なし**。リネームしない。
> `next.config.ts` で `Content-Type: application/json` を明示済み（サイト全体に `nosniff` を付けているため必須）。
> `proxy.ts` の matcher からも `/.well-known/` を除外済み（認証リダイレクトで弾かれると機能しない）。

### 手順3. Apple Developer で Associated Domains を有効化する

1. https://developer.apple.com/account/resources/identifiers → App ID `com.gotcha.bodylog.rn`
2. Capabilities の **Associated Domains** にチェック → Save
3. Codemagic は自動署名（ASC APIキー）なので、**再ビルドするだけ**でプロファイルは作り直される
   （手動プロファイルの作成・ダウンロードは不要）

---

## 確認方法

### AASAが正しく配信されているか

```bash
curl -sI https://bodylog-orcin.vercel.app/.well-known/apple-app-site-association
# → HTTP/2 200 ／ content-type: application/json であること（302や401ならproxyで弾かれている）

curl -s https://bodylog-orcin.vercel.app/.well-known/apple-app-site-association
# → TEAMIDが実際の値に置き換わっていること
```

Appleのキャッシュ（CDN）経由の確認:

```bash
curl -s "https://app-site-association.cdn-apple.com/a/v1/bodylog-orcin.vercel.app"
```

反映まで最大24時間かかることがある。

### 実機での確認

1. Associated Domains 有効化後の**新しいビルド**を実機に入れる
2. ログイン画面でメール欄をタップ → キーボード上部に**鍵アイコン／保存済みアカウント**が出る
3. 手で入力してログイン成功 → iOSが「パスワードを保存しますか？」を出す
4. 「設定」→「一般」→「自動入力とパスワード」に `bodylog-orcin.vercel.app` の項目ができる
5. 複数アカウントを保存すると、鍵アイコンから選べる（＝②のFaceID切替体験）

出てこない場合のチェックリスト:

- 「設定」→「一般」→「自動入力とパスワード」→ 自動入力がONか
- Associated Domains 有効化**後**にビルドしたか（前のビルドでは効かない）
- AASAのTeam IDとバンドルID（`com.gotcha.bodylog.rn`）が一致しているか

---

## 独自にパスワードを保存しない理由（設計判断）

「アプリ内に保存済みアカウント一覧を持ち、FaceIDで選ばせる」実装は**採らなかった**。

- アプリがパスワードを持った時点で、漏洩面（バックアップ・ログ・クラッシュレポート・メモリダンプ）が増える。
  OSのキーチェーンはSecure Enclaveと連動しており、自前実装がこれを上回ることはない
- 自前のFaceIDゲートは「生体認証が通ったらアプリ内の保存値を出す」だけで、
  保存値そのものの保護強度は上がらない（鍵はアプリが握ったまま）
- 資格情報の管理はOSの責務。ユーザーは「設定 > 自動入力とパスワード」で
  一元的に確認・削除でき、他アプリ・Safariとも共有できる
- App Store審査でも、独自の資格情報保管は説明責任が重くなる

したがってアプリ側の実装は「**OSに正しくフィールドの意味を伝え、適切なタイミングで
自動入力を促す**」までに留めている。`pickSavedAccount()` がやっているのも
「入力欄を空にしてフォーカスし直す」だけで、パスワードには一切触れていない。


## ビルドの点灯スイッチ（2026-09-02追記）

Codemagicの自動署名は既存プロファイルを再利用するため、App IDにAssociated Domainsを付ける前に宣言だけ残すと「Provisioning profile doesn't include the Associated Domains capability」で必ず落ちる。そのため codemagic.yaml は **ENABLE_ASSOCIATED_DOMAINS=true が無い限り entitlement を除去**する。

手順（この順）: ①App ID で Associated Domains にチェック→Save ②Apple Developer → Profiles で「bodylog rn appstore 2」を削除（自動署名が新規作成する） ③AASAの TEAMID を実値に置換→デプロイ ④Codemagic の環境変数グループ rc に ENABLE_ASSOCIATED_DOMAINS=true を追加 → 再ビルド。
