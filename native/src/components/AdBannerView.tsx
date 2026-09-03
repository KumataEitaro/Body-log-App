// バナー広告の「中身」（AdMob・アンカー型アダプティブバナー＋ラベル＋ペイウォール導線）。
//
// 表示可否・畳んで消えるアニメは持たない（それは AdSlot の仕事）。ここは
// 「マウントされたら読み込み、結果をコールバックで返す」だけの薄い層。
//
// 方針:
// - ATTダイアログは出さない。初回リリースは非パーソナライズ広告（NPA）固定
//   （requestNonPersonalizedAdsOnly: true）。パーソナライズ化は将来の改善
// - インタースティシャル・リワード等は使わない。広告は静かに（触覚・アニメなし）
// - ラベルと導線は読み込み完了後だけ描く（枠だけの空白を見せない）
//
// Expo Goにはネイティブモジュールが無いため、health.tsと同じ流儀の動的requireで
// 存在しない環境でもアプリ全体を落とさない。
import { View, Text, Pressable, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { C, themed } from '@/lib/ui';
import { t } from '@/lib/i18n';
import { type AdPlacement } from '@/lib/ads';

type AdsModule = typeof import('react-native-google-mobile-ads');

const ads: AdsModule | null = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('react-native-google-mobile-ads') as AdsModule;
  } catch {
    return null; // Expo Go等・モジュール未リンク
  }
})();

/** AdMob のネイティブモジュールが使える環境か（Expo Go・未リンクでは false） */
export function adsAvailable(): boolean {
  return !!ads;
}

// SDK初期化は「実際に広告を出す端末」で1回だけ（無料プラン以外の端末では走らせない）
let initialized = false;
export function ensureAdsInit(): void {
  if (!ads || initialized) return;
  initialized = true;
  try { ads.default().initialize().catch(() => {}); } catch { /* 初期化失敗でも落とさない */ }
}

// 本番のバナーユニットID（2026-09-02発行・banner-ios/banner-android）。
// ユニットIDは公開クライアントに埋め込まれる識別子で秘密ではない。
// 環境変数があれば上書き可（差し替え実験用）。__DEV__ではGoogle公式テストIDを使い、
// 開発中の自己表示が実ユニットの無効トラフィックに数えられないようにする。
//
// placement（食事/運動/相談/概要）ごとのユニット分割は当面しない＝全枠で同じIDを使う。
// 分けたくなったら bannerUnitId(m, placement) でここを出し分けるだけ（docs/ADS.md 参照）。
const PROD_BANNER = {
  ios: 'ca-app-pub-3319916143033433/6775266640',
  android: 'ca-app-pub-3319916143033433/4738084646',
} as const;

export function bannerUnitId(m: AdsModule, _placement: AdPlacement): string {
  if (__DEV__) return m.TestIds.ADAPTIVE_BANNER;
  const env = Platform.OS === 'ios'
    ? process.env.EXPO_PUBLIC_ADMOB_BANNER_IOS
    : process.env.EXPO_PUBLIC_ADMOB_BANNER_ANDROID;
  return env || (Platform.OS === 'ios' ? PROD_BANNER.ios : PROD_BANNER.android);
}

type Props = {
  placement: AdPlacement;
  /** 読み込み完了（ラベルと導線はこれ以降だけ描く） */
  loaded: boolean;
  onLoaded: () => void;
  onFailed: () => void;
};

export default function AdBannerView({ placement, loaded, onLoaded, onFailed }: Props) {
  const router = useRouter();
  if (!ads) return null;
  const { BannerAd, BannerAdSize } = ads;
  return (
    <View style={s.inner}>
      {/* ===== 広告の「上」の行（＝広告ビューの外側）=====
          ここは BannerAd の外なので、AdMobポリシー上の「広告に重ねる」には当たらない。
          逆に **広告ビューの上に × や閉じるボタンを置くことは絶対にしない**:
          - 広告の閉じるボタンを模倣するUIはポリシー違反（配信停止のリスク）
          - 押しても消えない偽の×はユーザーへの裏切りでもある
          消す手段は「課金する」だけで、その導線をこのリンク1本に集約する。
          2026-09-04: 文言を「スタンダードプランで広告を消せます」→「広告を消す →」に短縮し、
          色を C.faint → C.accentInk に変更（リンクだと分かる＝押せることが伝わる）。
          「広告」ラベルは faint のまま＝広告であることの表示より導線を目立たせない */}
      {loaded && (
        <View style={s.head}>
          <Text style={s.label}>{t('広告')}</Text>
          {/* 「広告なし」の最安はスタンダード（ライト廃止・2026-09）。src=ads で文脈つきペイウォールへ */}
          <Pressable onPress={() => router.push('/paywall?src=ads' as never)} hitSlop={8}
                     accessibilityRole="button" accessibilityLabel={t('広告を消す →')}>
            <Text style={s.removeLink}>{t('広告を消す →')}</Text>
          </Pressable>
        </View>
      )}
      <BannerAd
        unitId={bannerUnitId(ads, placement)}
        size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
        requestOptions={{ requestNonPersonalizedAdsOnly: true }}
        onAdLoaded={onLoaded}
        onAdFailedToLoad={onFailed}
      />
    </View>
  );
}

const s = themed(() => ({
  inner: { borderRadius: 12, overflow: 'hidden' },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3, paddingHorizontal: 2 },
  label: { fontSize: 11, color: C.faint },
  // 押せることが伝わる見た目（アクセント色＋下線）。ただし大きくはしない＝
  // 記録の邪魔にならない範囲で「消す方法がある」ことだけを知らせる
  removeLink: { fontSize: 11.5, fontWeight: '700', color: C.accentInk, textDecorationLine: 'underline' },
}));
