// ガイドツアーの章立てデータ（GuideTour.tsx から分離）
// - 5章×6〜9ステップ。アプリの強み（docs/FEATURES.md）をMECEに章へ割り付ける
//   ①入力のきほん（入力の摩擦ゼロ） ②食べる前に分かる ③あなたの法則（分析）
//   ④筋トレは全部無料 ⑤つづく仕組み
// - kind:'spot' は実UIへのスポットライト（対象が無ければ自動で次へ）
// - kind:'sketch' は紙芝居カード（対象が画面に無い機能をイラスト的なモックで見せる）
// - 文言はこのアプリの声で書く: 責めない・一人称の価値・「〜できます」より「〜でいい」
import type { LucideIcon } from 'lucide-react-native';
import { Pencil, Eye, BookOpen, Dumbbell, Flame } from 'lucide-react-native';
import { t } from '@/lib/i18n';

/** 紙芝居カードのミニ図解の種類（実装は components/GuideArt.tsx） */
export type GuideArtId =
  | 'myfood' | 'redo' | 'menu' | 'tray' | 'quick'
  | 'pfc' | 'alert'
  | 'law' | 'heatmap' | 'timeslot' | 'trigger' | 'digest'
  | 'rm' | 'volume' | 'plates' | 'offline' | 'sticker'
  | 'flame' | 'week' | 'badges' | 'checklist' | 'notify' | 'comeback' | 'bulk';

export type GuideStep =
  | { kind: 'spot'; route: string; target: string; title: string; text: string; demo?: 'coach' }
  | { kind: 'sketch'; art: GuideArtId; title: string; text: string };

export type GuideChapterId = 'basics' | 'foresee' | 'laws' | 'lifting' | 'habit';

export type GuideChapter = {
  id: GuideChapterId;
  Icon: LucideIcon;
  title: string;
  sub: string;        // 章選択画面に出す1行（この章で何が分かるか）
  steps: GuideStep[];
};

/** 初回に自動再生する章（長い強制ツアーは離脱を生むため、この1章だけ） */
export const FIRST_CHAPTER: GuideChapterId = 'basics';

// t()は言語切替に追従させたいので、毎回組み立てる（既存STEPS()と同じ流儀）
export const GUIDE_CHAPTERS = (): GuideChapter[] => [
  {
    id: 'basics',
    Icon: Pencil,
    title: t('入力のきほん'),
    sub: t('つぶやき・写真・成分表示。記録は数秒でいい'),
    steps: [
      { kind: 'spot', route: '/log', target: 'hero', title: t('あと食べられる量'),
        text: t('残りカロリーとP/F/Cの残りが、いつもここに出ています。計算はぜんぶアプリの仕事。あなたは見るだけでいいです。') },
      { kind: 'spot', route: '/log', target: 'dock', title: t('文字だけで、カロリーとPFCが出る'),
        text: t('「バナナと卵2個」と打って↑。写真がなくても、この一言だけでAIがカロリー・たんぱく質・脂質・炭水化物まで計算します。これがこのアプリのいちばんの発明です。量があいまいなら、AIのほうから聞き返してくれます。') },
      { kind: 'sketch', art: 'tray', title: t('保存はあなたが決める'),
        text: t('AIの結果はまずトレイに載ります。違う品目は×で消して、✓で保存。勝手に記録されることはありません。') },
      { kind: 'spot', route: '/log', target: 'dockCamera', title: t('カメラは1つで2役'),
        text: t('料理を撮れば見た目から推定、パッケージ裏の栄養成分表示を撮れば表記どおりの正確な数値。同じカメラボタンでAIが読み分けます。長押しでバーコード読み取りも。') },
      { kind: 'sketch', art: 'myfood', title: t('マイ食品は1タップ'),
        text: t('よく食べるものは登録しておくと、タップでトレイへ・長押しで即記録。定食のような組み合わせも1つのマイ食品（セット）にできます。AIを待つ時間すらいりません。') },
      { kind: 'sketch', art: 'redo', title: t('前の食事をもう一度'),
        text: t('昨日と同じ朝ごはんなら、↺を押すだけ。記録済みの栄養値をそのまま使うので、解析待ちもゼロです。') },
      { kind: 'sketch', art: 'menu', title: t('注文の前に相談できる'),
        text: t('外食ではメニュー表を撮ると、今日の残りカロリーとタンパク質から「この中ならどれがいいか」をAIが選びます。食べたあとの後悔より、食べる前のひと押し。') },
      { kind: 'sketch', art: 'quick', title: t('体重と気分も、ついでに'),
        text: t('体重は数字を入れるだけ。気分は顔を1タップ。聞かれたくない日は「今日は聞かないで」でいいんです。') },
    ],
  },
  {
    id: 'foresee',
    Icon: Eye,
    title: t('食べる前に分かる'),
    sub: t('我慢じゃなく、見えているから選べる'),
    steps: [
      { kind: 'spot', route: '/log', target: 'hero', title: t('残りは常に見えている'),
        text: t('記録した瞬間に残りが減って見えます。夜になって「食べすぎてた」と気づくのではなく、食べる前に分かるのがこのアプリの芯です。') },
      { kind: 'sketch', art: 'pfc', title: t('P/F/Cはグラムで残っている'),
        text: t('タンパク質はあと何g、脂質はあと何g。バーの白い区切りは食事1回ぶんなので、どの食事が効いたかも見えます。') },
      { kind: 'spot', route: '/log', target: 'dock', title: t('入力欄の上にも残量'),
        text: t('書いている途中から「追加後の残り」が出ます。保存する前に結果が分かるから、量の調整はトレイの上でできます。') },
      { kind: 'spot', route: '/training', target: 'trainInput', title: t('動いたぶんは食べていい'),
        text: t('犬の散歩でもOK。運動を記録すると、そのぶん「あと食べられる量」が増えます。食べると動くは、ひとつの財布です。') },
      { kind: 'spot', route: '/training', target: 'moveCard', title: t('あと何歩で帳尻が合う？'),
        text: t('食べすぎた日は「あと約4,000歩（はや歩き35分）」のように、歩ける形に言い換えます。数字で責めずに、次の一手を出します。') },
      { kind: 'sketch', art: 'alert', title: t('過食は当日に予報できる'),
        text: t('あなたの記録からリスクが高い日を先回りして知らせます。「今日は+200kcal緩める」を1タップ。我慢を増やすのではなく、決壊を防ぐ考え方です。') },
    ],
  },
  {
    id: 'laws',
    Icon: BookOpen,
    title: t('あなたの法則'),
    sub: t('記録が「体の取扱説明書」になっていく'),
    steps: [
      { kind: 'sketch', art: 'law', title: t('あなただけの法則が貯まる'),
        text: t('記録が貯まると「あなただけの法則」がカードになって図鑑に集まります。一般論ではなく、あなたの実測から見つけた法則。分析はぜんぶ端末の中だけで行い、サーバーには送りません。') },
      { kind: 'sketch', art: 'heatmap', title: t('崩れやすい曜日が分かる'),
        text: t('直近8週間を曜日×週で色分けして、「金曜日に崩れやすい（平均+320kcal）」まで言語化します。分かっていれば、先回りできます。') },
      { kind: 'sketch', art: 'timeslot', title: t('食べる時間帯のクセ'),
        text: t('朝・昼・夕・夜のどこにカロリーが寄っているか。夜に寄りすぎていたら、そっと教えます。') },
      { kind: 'sketch', art: 'trigger', title: t('過食の引き金を探す'),
        text: t('食べすぎた日の前に多かったことを数えて、上位を見せます。犯人探しではなく、パターン探し。分かれば避けられます。') },
      { kind: 'spot', route: '/changes', target: 'chart', title: t('体の変化は文章で'),
        text: t('概要タブはメニュー式。「体の記録」を開くと、体重のトレンドを「3週間で下向き」のような文章で教えます。グラフを読む力はいりません。') },
      { kind: 'sketch', art: 'digest', title: t('週のふりかえり'),
        text: t('今週の記録日数・平均収支・体重の変化を、責めない言葉でまとめます。できなかった日を数える週報にはしません。') },
      { kind: 'spot', route: '/coach', target: 'welcome', title: t('迷ったらAIコーチへ'),
        text: t('あなたの記録データを根拠に答えます。提案が気に入ったら、目標や献立への反映もあなたの承認ひとつで。'), demo: 'coach' },
    ],
  },
  {
    id: 'lifting',
    Icon: Dumbbell,
    title: t('筋トレは全部無料'),
    sub: t('本気で挙げる人の道具も、ぜんぶ無料'),
    steps: [
      { kind: 'spot', route: '/training', target: 'liftInput', title: t('筋トレを記録する'),
        text: t('専用の記録画面でレストを見ながらセットを積めます。重量と回数はダイアルをくるくる。前回の重量が最初から出ているので、思い出す手間がありません。') },
      { kind: 'sketch', art: 'rm', title: t('目標は1RM換算で追える'),
        text: t('「ベンチ90kg」を目標にすると、75kg×6回の日もRM換算で進捗に数えます。5×5の日もマックス挑戦の日も、同じものさしで。') },
      { kind: 'sketch', art: 'volume', title: t('ボリュームで管理する'),
        text: t('週ごとの総挙上量を部位別に集計。「先週より脚が+12%」のように、言葉でも教えます。') },
      { kind: 'spot', route: '/training', target: 'restTimer', title: t('レストタイマー'),
        text: t('記録画面でセットを決めると自動で走り出します。0秒でブルッと震えて「次のセットへ！」。長さはダイアルで15秒刻みに選べます。') },
      { kind: 'sketch', art: 'plates', title: t('プレート計算機'),
        text: t('「97.5kgって片側何枚？」に即答。バー重量を選ぶと、片側のプレート構成を大きい順に並べます。') },
      { kind: 'sketch', art: 'offline', title: t('ジムの地下でも大丈夫'),
        text: t('圏外で保存に失敗しても、端末に貯めて電波が戻ったら自動で送ります。レストタイマーもそのまま動きます。') },
      { kind: 'sketch', art: 'sticker', title: t('自己ベストは自慢していい'),
        text: t('PRが出たら透過ステッカーに。ストーリーに貼って、堂々と自慢してください。') },
    ],
  },
  {
    id: 'habit',
    Icon: Flame,
    title: t('つづく仕組み'),
    sub: t('意志の力に頼らない設計'),
    steps: [
      { kind: 'sketch', art: 'flame', title: t('ストリークとお守り'),
        text: t('連続記録の炎は、週に1回まで自動のお守りが守ります。1日忘れたくらいで、積み上げは消えません。') },
      { kind: 'sketch', art: 'week', title: t('毎日じゃなくていい'),
        text: t('週の記録目標は「週3日」からでも選べます。自分と決めた約束を守れたら、それは立派な1週間です。') },
      { kind: 'sketch', art: 'badges', title: t('バッジは30種類'),
        text: t('続けた日数だけではなく、「一度離れて、また戻ってきた」ことを称えるバッジもあります。') },
      { kind: 'sketch', art: 'checklist', title: t('最初の1週間の道しるべ'),
        text: t('スタートチェックリストが最初の6歩を案内します。ぜんぶ自動判定なので、チェックを付ける作業すらいりません。') },
      { kind: 'sketch', art: 'notify', title: t('通知は空気を読む'),
        text: t('リマインダーの基本は「記録がない日だけ」。記録した日は鳴りません。「あとで」も「今日は聞かないで」も通知から選べます。') },
      { kind: 'sketch', art: 'comeback', title: t('空白は失敗じゃない'),
        text: t('しばらく離れても、責める言葉はひとつも出ません。「おかえりなさい。記録はぜんぶ残っています」から再開できます。') },
      { kind: 'sketch', art: 'bulk', title: t('増やしたい人も主役'),
        text: t('目的を増量にすると残量の意味が反転して、「あと820kcal食べる」がノルマになります。食間が空いたら教えるリマインドも。') },
      { kind: 'spot', route: '/changes', target: 'gear', title: t('設定はここ'),
        text: t('テーマ12色・11言語・単位・通知・ヘルスケア連携。プロフィールやマイ食品の管理も、この⚙からいつでも。') },
    ],
  },
];
