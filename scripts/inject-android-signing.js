#!/usr/bin/env node
/**
 * Android のリリース署名を build.gradle に注入する（Codemagic の rn-android ワークフローで使う）。
 *
 * なぜ必要か:
 *   `expo prebuild --platform android` が生成する android/app/build.gradle は、
 *   buildTypes.release でも `signingConfig signingConfigs.debug` を指しており、
 *   **リリースビルドがデバッグ鍵で署名される**。この .aab を Play にあげると
 *   「アップロードされた Android App Bundle がデバッグモードで署名されています」で
 *   受け付けられない（2026-09-03 のアップロード失敗の原因）。
 *   android/ はリポジトリに入れていない（毎回 prebuild する）ため、
 *   build.gradle を手で直すのではなく **ビルド時に注入**する。
 *
 * 鍵の受け取り方:
 *   codemagic.yaml の `android_signing: [bodylog_keystore]` により、Codemagic が
 *   CM_KEYSTORE_PATH / CM_KEYSTORE_PASSWORD / CM_KEY_ALIAS / CM_KEY_PASSWORD を用意する。
 *   値は build.gradle に焼き込まず、Gradle 実行時に System.getenv で読む
 *   （＝生成物やログにパスワードが残らない）。
 *
 * 使い方: node scripts/inject-android-signing.js native/android/app/build.gradle
 * 冪等（すでに release 署名があれば何もしない）。
 */
const fs = require('fs');

const target = process.argv[2] || 'native/android/app/build.gradle';
if (!fs.existsSync(target)) {
  console.error('build.gradle が見つかりません: ' + target);
  process.exit(1);
}

// CI 上で鍵が渡っていないまま黙って進むと、またデバッグ署名の .aab ができてしまう。
// ローカル実行（CI 以外）では警告だけにして、CI では明確に失敗させる。
const onCI = process.env.CI === 'true' || process.env.CI === '1';
if (!process.env.CM_KEYSTORE_PATH) {
  const msg = 'CM_KEYSTORE_PATH が未設定です（Codemagic の android_signing / キーストア登録を確認）';
  if (onCI) { console.error(msg); process.exit(1); }
  console.warn('警告: ' + msg + ' — ローカル実行なので注入だけ行います');
}

let src = fs.readFileSync(target, 'utf8');

if (/signingConfigs\.release/.test(src)) {
  console.log('すでに release 署名が入っています（何もしません）');
  process.exit(0);
}

// 1) signingConfigs { ... } に release を足す
const RELEASE_BLOCK = `signingConfigs {
        // Codemagic が用意する環境変数から読む（値をファイルに焼き込まない）
        release {
            storeFile file(System.getenv("CM_KEYSTORE_PATH"))
            storePassword System.getenv("CM_KEYSTORE_PASSWORD")
            keyAlias System.getenv("CM_KEY_ALIAS")
            keyPassword System.getenv("CM_KEY_PASSWORD")
        }`;
if (!/signingConfigs\s*\{/.test(src)) {
  console.error('signingConfigs ブロックが見つかりません（prebuild の出力が変わった可能性）');
  process.exit(1);
}
src = src.replace(/signingConfigs\s*\{/, RELEASE_BLOCK);

// 2) buildTypes の release が debug 鍵を指しているのを release に向け直す
const before = src;
src = src.replace(
  /(buildTypes\s*\{[\s\S]*?\brelease\s*\{[\s\S]*?)signingConfig\s+signingConfigs\.debug/,
  '$1signingConfig signingConfigs.release',
);
if (src === before) {
  console.error('buildTypes.release の signingConfig を差し替えられませんでした');
  process.exit(1);
}

fs.writeFileSync(target, src);

// 3) 確認（パスワードは出力しない）
const lines = src.split(/\r?\n/);
console.log('注入しました。signingConfig の行:');
lines.forEach((l, i) => {
  if (/signingConfig\b|storeFile|keyAlias/.test(l)) console.log('  ' + (i + 1) + ': ' + l.trim());
});
