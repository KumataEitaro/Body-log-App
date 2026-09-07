#!/usr/bin/env bash
# Android 起動スモークテストの本体（.github/workflows/android-smoke.yml から呼ぶ）。
#
# なぜ別ファイルか:
#   reactivecircus/android-emulator-runner の `script:` は **1行ずつ別々の `sh -c` で実行**される。
#   関数定義・if ブロック・変数の引き継ぎが全部切れる（2026-09-05 #3〜#5 が
#   「Syntax error: end of file unexpected (expecting "}")」で落ちた真因）。
#   ここに置いて `bash scripts/ci/android-smoke.sh` の1行で呼べば、普通のシェルスクリプトとして動く。
#
# 方針: **どこで失敗しても logcat を残して exit 0** で抜ける。判定は Verdict ステップが行う。
set +e
set -x

PKG=com.gotcha.bodylog.rn
ALIVE=0

dump_logs() {
  adb logcat -d > logcat-full.txt 2>/dev/null || true
  # 読みやすい抜粋: JS 例外・Java/Kotlin の致命例外・ネイティブクラッシュ・safeBoot の記録
  adb logcat -d "*:S" ReactNative:V ReactNativeJS:V AndroidRuntime:E DEBUG:F libc:F > logcat-app.txt 2>/dev/null || true
  adb logcat -d --buffer=crash > logcat-crash.txt 2>/dev/null || true
  echo "== 致命例外 =="
  grep -n "FATAL EXCEPTION\|Fatal signal\|SIGSEGV\|SIGABRT\|UnsatisfiedLinkError\|NoClassDefFoundError\|NoSuchMethodError\|Process .* has died" logcat-full.txt | head -40 || true
  echo "== JS 例外 =="
  grep -n "ReactNativeJS" logcat-app.txt | grep -i "error\|exception\|invariant" | head -20 || true
  echo "== crash buffer 先頭 =="
  head -80 logcat-crash.txt || true
  echo "ALIVE=$ALIVE"
  echo "ALIVE=$ALIVE" >> "$GITHUB_ENV"
  # ジョブサマリー（Actions の Run ページに描かれる）にも抜粋を書く。Public リポジトリなら
  # ログイン無しで読めるので、Claude が直接読んで診断できる（ログ本体・アーティファクトは要ログイン）
  if [ -n "$GITHUB_STEP_SUMMARY" ]; then
    {
      echo "## Android smoke: ALIVE=$ALIVE"
      echo
      echo "### 致命例外（logcat-full）"
      echo '```'
      grep -n "FATAL EXCEPTION|Fatal signal|SIGSEGV|SIGABRT|UnsatisfiedLinkError|NoClassDefFoundError|NoSuchMethodError|Process .* has died" logcat-full.txt | head -40 || true
      echo '```'
      echo "### JS 例外（ReactNativeJS）"
      echo '```'
      grep -n "ReactNativeJS" logcat-app.txt | head -40 || true
      echo '```'
      echo "### crash buffer 先頭 120 行"
      echo '```'
      head -120 logcat-crash.txt || true
      echo '```'
      echo "### AndroidRuntime / FATAL の前後（logcat-full から 60 行）"
      echo '```'
      grep -n -B5 -A40 "FATAL EXCEPTION|Fatal signal" logcat-full.txt | head -120 || true
      echo '```'
    } >> "$GITHUB_STEP_SUMMARY"
  fi
}
trap dump_logs EXIT

APK=$(ls native/android/app/build/outputs/apk/release/*.apk | head -1)
echo "APK=$APK"
adb logcat -c || true
if ! adb install -r "$APK"; then
  echo "❌ adb install に失敗"
  exit 0
fi
# -W は起動完了まで待つ。アプリが直後に落ちても am 自体は成功で返る
adb shell am start -W -n "$PKG/.MainActivity" || echo "am start が非0（続行）"
sleep 12
# プロセスが生きているか
if adb shell pidof "$PKG" >/dev/null 2>&1; then ALIVE=1; else ALIVE=0; fi
exit 0
