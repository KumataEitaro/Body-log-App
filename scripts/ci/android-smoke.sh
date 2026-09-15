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
#
# ■ 2026-09-15 に「起動して12秒待つだけ」から拡張した
#   それまでは `am start` → `sleep 12` → `pidof` しか見ておらず、**ログイン画面で止まっていた**。
#   タブ操作も、画面の回転も、ダークモード切替も、前景復帰も一切触っていない。
#   実際 2026-09-07 の全断は `Appearance.setColorScheme(null)`（＝**明暗の切替まわり**）が原因で、
#   いまの構成では ThemeRemount が世代ごとに子ツリーを作り直す。ここは**設定変更で必ず通る道**なので、
#   スモークでも通す。CI に認証情報は置かないのでログインはできないが、
#   ログイン前でも次の4つは通せる:
#     1. 画面が実際に描けているか（白画面・赤箱ではないか）
#     2. ダークモード切替（Appearance → applyPalette → ThemeRemount の経路）
#     3. 画面の回転（Activity の構成変更。Android 特有のクラッシュの定番）
#     4. ホームへ出して戻す（AppState 復帰。resyncSchemeFromOS・オフラインキューの flush が走る）
set +e
set -x

PKG=com.gotcha.bodylog.rn
ALIVE=0
STEPS_FAILED=""

dump_logs() {
  adb logcat -d > logcat-full.txt 2>/dev/null || true
  # 読みやすい抜粋: JS 例外・Java/Kotlin の致命例外・ネイティブクラッシュ・safeBoot の記録
  adb logcat -d "*:S" ReactNative:V ReactNativeJS:V AndroidRuntime:E DEBUG:F libc:F > logcat-app.txt 2>/dev/null || true
  adb logcat -d --buffer=crash > logcat-crash.txt 2>/dev/null || true
  echo "== 致命例外 =="
  grep -n "FATAL EXCEPTION\|Fatal signal\|SIGSEGV\|SIGABRT\|UnsatisfiedLinkError\|NoClassDefFoundError\|NoSuchMethodError\|Process $PKG .* has died" logcat-full.txt | head -40 || true
  echo "== JS 例外 =="
  grep -n "ReactNativeJS" logcat-app.txt | grep -i "error\|exception\|invariant" | head -20 || true
  echo "== crash buffer 先頭 =="
  head -80 logcat-crash.txt || true
  echo "ALIVE=$ALIVE"
  echo "ALIVE=$ALIVE" >> "$GITHUB_ENV"
  echo "STEPS_FAILED=$STEPS_FAILED" >> "$GITHUB_ENV"
  # ジョブサマリー（Actions の Run ページに描かれる）にも抜粋を書く。Public リポジトリなら
  # ログイン無しで読めるので、Claude が直接読んで診断できる（ログ本体・アーティファクトは要ログイン）
  if [ -n "$GITHUB_STEP_SUMMARY" ]; then
    {
      echo "## Android smoke: ALIVE=$ALIVE"
      echo
      if [ -n "$STEPS_FAILED" ]; then
        echo "### ❌ 落ちた操作: $STEPS_FAILED"
      else
        echo "### ✅ 起動・ダークモード切替・回転・前景復帰をすべて通過"
      fi
      echo
      echo "### 致命例外（logcat-full）"
      echo '```'
      grep -nE "FATAL EXCEPTION|Fatal signal|SIGSEGV|SIGABRT|UnsatisfiedLinkError|NoClassDefFoundError|NoSuchMethodError|Process $PKG .* has died" logcat-full.txt | head -40 || true
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
      grep -nE -B5 -A40 "FATAL EXCEPTION|Fatal signal" logcat-full.txt | head -120 || true
      echo '```'
    } >> "$GITHUB_STEP_SUMMARY"
    # ci-logs ブランチへ公開する抜粋（Public リポジトリの raw URL でログイン無しに読める）
    cp "$GITHUB_STEP_SUMMARY" smoke-summary.md 2>/dev/null || true
    # 画面ダンプと前面アプリも公開する（描画の判定が外れたときに、実際に何が出ていたかを読むため）
    { echo "== 前面のアプリ =="; cat focus.txt 2>/dev/null;
      echo; echo "== 画面に出ていたテキスト ==";
      grep -oE 'text="[^"]{1,40}"' ui-dump.xml 2>/dev/null | sort -u | head -40;
    } > ui-summary.txt 2>/dev/null || true
  fi
}
trap dump_logs EXIT

# 生きているか＋直近に致命例外が出ていないかを1つの関数で見る。
# プロセスが生き残っていても ErrorBoundary が拾っただけということがあるので、両方見る。
check() {
  local label="$1"
  if adb shell pidof "$PKG" >/dev/null 2>&1; then
    ALIVE=1
  else
    ALIVE=0
    STEPS_FAILED="$STEPS_FAILED [$label:プロセス死亡]"
    echo "❌ $label のあとプロセスが居ません"
    return 1
  fi
  if adb logcat -d | grep -q "FATAL EXCEPTION"; then
    STEPS_FAILED="$STEPS_FAILED [$label:致命例外]"
    echo "❌ $label のあと FATAL EXCEPTION がログにあります"
    return 1
  fi
  echo "✅ $label"
  return 0
}

APK=$(ls native/android/app/build/outputs/apk/release/*.apk | head -1)
echo "APK=$APK"
adb logcat -c || true
if ! adb install -r "$APK"; then
  echo "❌ adb install に失敗"
  exit 0
fi

# ---- 1) 起動 ----
# -W は起動完了まで待つ。アプリが直後に落ちても am 自体は成功で返る
adb shell am start -W -n "$PKG/.MainActivity" || echo "am start が非0（続行）"
sleep 12
check "起動" || exit 0

# ---- 2) 画面が実際に描けているか ----
# 白画面・赤箱（RedBox）だと pidof は通るのに何も見えない。
#
# 判定は**文言では見ない**（2026-09-15 #19 の教訓）。起動イントロのアニメーション中だったり、
# 言語が日本語以外だったり、React Native のテキストが読み上げツリーに出る形が変わったりすると、
# 特定の文言を探す判定は簡単に誤検知する。代わりに次の2つだけを見る:
#   ・前面のアプリが自分か（dumpsys window の mCurrentFocus）
#   ・画面ダンプに**自分のパッケージのノード**があり、**空でないテキストが1つ以上**ある
# 起動直後はまだ描けていないことがあるので、10秒ぶん数回やり直す。
DRAWN=0
for i in 1 2 3 4 5; do
  adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
  adb pull /sdcard/ui.xml ui-dump.xml >/dev/null 2>&1
  if [ -f ui-dump.xml ] && grep -q "package=\"$PKG\"" ui-dump.xml && grep -qE 'text="[^"]+"' ui-dump.xml; then
    DRAWN=1; break
  fi
  sleep 2
done
adb shell dumpsys window 2>/dev/null | grep -i "mCurrentFocus\|mFocusedApp" | head -3 > focus.txt || true
cat focus.txt || true
if [ "$DRAWN" = "1" ]; then
  echo "✅ 画面が描けている（自分のパッケージのノードとテキストがある）"
  # どの画面だったかは後から読めるように残す（判定には使わない）
  grep -oE 'text="[^"]{1,30}"' ui-dump.xml | sort -u | head -20 || true
else
  STEPS_FAILED="$STEPS_FAILED [描画:自分の画面にテキストが無い]"
  echo "❌ 画面ダンプに自分のパッケージのテキストがありません（白画面／赤箱の疑い）"
  head -c 2000 ui-dump.xml 2>/dev/null || echo "(ダンプが取れていません)"
fi
adb exec-out screencap -p > screen-1-launch.png 2>/dev/null || true

# ---- 3) ダークモード切替 ----
# 2026-09-07 の全断（Appearance.setColorScheme に null）と同じ経路。
# いまは ThemeRemount が世代ごとに子ツリーを作り直すので、その再マウントもここで通る。
adb shell "cmd uimode night yes" || true
sleep 4
check "ダークへ切替" || exit 0
adb exec-out screencap -p > screen-2-dark.png 2>/dev/null || true
adb shell "cmd uimode night no" || true
sleep 4
check "ライトへ戻す" || exit 0

# ---- 4) 画面の回転（Activity の構成変更） ----
adb shell settings put system accelerometer_rotation 0 || true
adb shell settings put system user_rotation 1 || true   # 横
sleep 4
check "横向きへ回転" || exit 0
adb shell settings put system user_rotation 0 || true   # 縦へ戻す
sleep 3
check "縦向きへ戻す" || exit 0

# ---- 5) ホームへ出して前景復帰 ----
# AppState が active に戻る経路。resyncSchemeFromOS とオフラインキューの flush が走る
adb shell input keyevent KEYCODE_HOME || true
sleep 3
adb shell am start -n "$PKG/.MainActivity" || true
sleep 6
check "前景復帰" || exit 0

adb exec-out screencap -p > screen-3-final.png 2>/dev/null || true
echo "全ステップ通過"
exit 0
