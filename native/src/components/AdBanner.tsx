// 互換シム: 食事タブ（log.tsx）が使う <AdBanner /> を AdSlot（placement='log'）へ流す。
//
// 2026-09-02 に広告枠を全タブへ広げた際、表示可否・畳んで消えるアニメは AdSlot に、
// バナー本体は AdBannerView に分けた。log.tsx は別担当が改修中のため既存の
// <AdBanner /> 呼び出しをそのまま生かす（食事タブも同じ「きれいに消える」挙動になる）。
// 新しい設置は <AdSlot placement="..." /> を直接使うこと。
import AdSlot from '@/components/AdSlot';

export default function AdBanner() {
  return <AdSlot placement="log" />;
}
