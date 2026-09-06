# BodyLoger アプリアイコン戦略（ICON.md）

- 作成: 2026-09-06 ／ 正本: 本ファイル（アイコンに関する決定はここに集約）
- 前提: 戦略の中心命題は docs/STRATEGY.md「ユーザーに記録させるのではなく、迷う時間を減らす」（Logging App → Decision App → Companion）。アイコンはこの命題を、名前（BodyLoger）の横で1秒・60px・単色で言い切る記号でなければならない。
- 用途: 画像生成AIに渡すときの北極星（§1）→ 制約（§2–3）→ 戦略（§4）→ そのまま貼れるプロンプト（§5）→ 評価（§6）→ 取り込み（§7）→ 禁止事項（§8）。
- 本ドキュメントは提案であり、コード・画像はまだ変更していない。取り込み手順は §7。

---

## 1. 調査のエッセンス（北極星・10行）

1. **主形状は1つだけ。** 黒1色のシルエットにしても「BodyLogerだ」と分かる形にする。60pxで読めない細部は削る。 / One hero shape, legible as a solid black silhouette at 60px.
2. **「記録・採点」の物体ではなく「迷いが晴れて落ち着いた状態」を描く。** 食材・食器・体重計・ゲージ・炎・矢印・コンパスは全部捨て、点・器・石のような「据わる」抽象形で言う。 / Express settledness, not logging or scoring.
3. **伴走者は「顔」ではなく「気配」で。** 受け止める器、点けておいてくれた灯り、隣にある小さな塊。 / Companion as presence, never a mascot face.
4. **色を1つ所有する。** Health & Fitness に支配色はない。飽和した緑・橙・青・純黒を避け、ブランド固有の1色（ダスティティール／砂色／Navy）を地に敷き、前景は白または Electric 系の1色。 / Own one proprietary muted color.
5. **2層で考える。** 前景（不透明グリフ）と背景（単色〜穏やかな上明→下暗グラデ）を分離し、前景だけで意味が通ること。 / Foreground glyph + plain background, separable.
6. **素材はフラット・不透明・ハードエッジ。** 影・光沢・ぼかし・ベベル・グロー・角丸はOSが付ける。焼き込まない。 / Flat, opaque, hard-edged; the OS adds glass and shadow.
7. **線は太く、角は丸く。** 線幅はキャンバスの8%以上（本命は14%）、極細線・鋭角・写実3D・パースは禁止。 / Bold strokes (≥8%), rounded, frontal, no thin lines.
8. **主形状はキャンバス中央の60〜66%に収め、視覚重心をわずかに下（52〜55%）へ。** iOS角丸マスクと Android 66dp 安全域の共通解。 / Center within ~60–66%, weight slightly low.
9. **Default / Dark / Mono で形を変えない。** 変えてよいのは地色とグリフの色・明度だけ。単色化しても階調（100%／60〜65%）で形が残る設計。 / Same silhouette across all appearances.
10. **生成AIは「素材と比率確認」のためだけに使う。** 完成品は必ずベクター（Figma/Illustrator）で数値どおり描き直し、Icon Composer と adaptive icon で組む。 / AI output is reference; final is hand-drawn vector.

---

## 2. プラットフォーム要件の要点と、デザインへの制約

### 2.1 iOS 26 系（Liquid Glass / Icon Composer）

| 要件 | 内容 | デザインへの制約 |
|---|---|---|
| レイヤー構造 | 背景1層＋前景1層以上。システムが鏡面・屈折・半透明を動的付与 | 前景は不透明・エッジ明確。背景は Icon Composer の単色/グラデ機能で作る（画像を入れない） |
| 外観 | Default / Dark / Mono の3設計 → light・dark・clear light・clear dark・tinted light・tinted dark の6外観を自動生成 | Mono で「最も認識される要素＝白100%、副要素＝白60〜65%」に指定。形は全外観で同一 |
| Icon Composer | キャンバス1024px、グループ最大4（奥行き段数）、グループ単位で Specular / Blur / Translucency / Shadow、レイヤー単位で Glass ON/OFF | 幅・厚さがキャンバスの12%未満の要素は Glass/Specular OFF（pillowy 化防止）。大きな凸形だけ Glass ON |
| 形・マスク | 正方形で納品、角丸はシステムが適用。事前マスクはハイライトを壊す | 角丸・影・グロー・ベベルを画像に焼き込まない。主形状は中央寄せで角のマスクに掛けない |
| 推奨様式 | 背景＋前景1層が最も単純（Messages）。丸い角・太い線幅。写実3D・パース禁止。背景は純白/純黒を避け色付きグラデ | 前景は正面視フラット。背景は「上明→下暗」の2ストップ |
| 禁止 | 文字（頭文字1字を除き不可）、写真、UI複製、極細線、Apple製品の描写 | アイコン内に文字・数字・「AI」表記を置かない（11言語対応の観点でも） |
| サイズ | 1024px の1本を提出。実機描画はホーム 120/180px、Spotlight 80/120px、設定 58/87px、通知 40/60px | 60px と 29px の縮小確認を必須工程にする |
| Expo | SDK 54以降は `ios.icon` に Icon Composer の `.icon` ディレクトリを直接渡せる（native/ は SDK 57） | PNG 3枚（light/dark/tinted）方式ではなく `.icon` 方式を採る |

### 2.2 Android（adaptive icon / themed icon / Play）

| 要件 | 内容 | デザインへの制約 |
|---|---|---|
| adaptive icon | 全レイヤー 108dp（1024px canvas 換算で前景は中央66%＝直径約676px の円が安全域） | 前景 bbox は 1024px 中の 205〜819px（60%）に収める。背景タイルを前景に重ねない（現行の「タイルの中にタイル」を廃止） |
| background | backgroundColor または backgroundImage | 単色 backgroundColor を基本にし、グラデが要る場合だけ 1024 全面の backgroundImage |
| monochrome | Android 13+ のテーマアイコン用。黒1色（アルファ2値）のシルエット。Android 16 QPR2 以降は未提供でも自動グレースケール化される | 前景と同形の「1色・2値アルファ」を必ず自前で用意する（現行の写真マスク型は不可）。通知アイコン（expo-notifications）にも同じ素材を流用 |
| Play ストア | 512px・32bit PNG・フルスクエア・角丸/影は Play が付与・透過を避ける | 生成/納品とも正方形フルブリード。透過 PNG を Play 用に使わない |

### 2.3 両OS共通の最大公約数

- 前景1グリフ＋背景1面。前景だけで意味が通る（テーマ化で背景が差し替わるため）。
- 単色シルエットで成立する形（iOS Mono → clear/tinted、Android monochrome → themed icon を同時に満たす）。
- 主形状はキャンバス中央 60〜66%。角丸・影・光沢・ぼかしは素材に入れない。
- iOS Mono と Android monochrome は**同一シルエット**にする（片方だけ要素を足さない）。

---

## 3. カテゴリの記号地図

### 3.1 飽和している色 × 記号（避ける領域）

| クラスタ | 色 | 記号 | 代表 | 読まれ方 |
|---|---|---|---|---|
| 自然・食 | 飽和グリーン | 葉・リンゴ・野菜・栄養士キャラ | あすけん、Lifesum（旧）、旧Yazio | 「健康食・オーガニック・記録」 |
| 活力・達成 | 飽和オレンジ | 炎・上向き矢印・シェブロン・目盛り・「!」 | Strava、Lose It!、Cronometer、旧Noom | 「燃焼・競争・やり切る」 |
| 信頼・データ | 飽和ブルー | 皿・フォーク・スプーン・モノグラム | MyFitnessPal、カロミル | 「食事記録ツール・管理」 |
| 科学・計測 | 純黒 × 白 | モノグラム・リング・ステンシル文字 | MacroFactor、Whoop、Oura、Apple Fitness、NTC | 「アスリート向け・冷たいプロ用具」 |
| OS標準 | 白地 | ハート（右上寄せ） | Apple ヘルスケア（米ヘルス系商標の約97%がハート） | 「OSの器・中立」 |
| ナビゲーション | 自然色 | コンパス・道 | Noom | 「選択を案内する」＝**「迷いを減らす」の直訳がここに落ちるので回避** |
| 伴走の人格化 | ターコイズ／ピンク | マスコットの顔・欠けた円 | Yazio（Yettie）、FiNC（フィンクちゃん） | 「かわいい伴走者」。小サイズで顔が潰れる |
| 達成ゲージ | 黒 × 発光 | 閉じるリング・円グラフ | Apple Fitness | 「採点・達成率」＝Non-Judging に反する |
| 睡眠・天気 | 藍 × 黄橙 | 日の出・月・星・地平線 | Rise、Sleep Cycle、天気アプリ | 「アラーム・天気」への誤認 |

### 3.2 空いている余白（BodyLoger が取れる領域）

| 軸 | 余白 | BodyLoger での使い方 |
|---|---|---|
| 色 | 暖かく彩度の低い中間色（砂色／オートミール、ダスティティール／セージ、温かいグレー、夜明け前の淡い群青）。純白・純黒・飽和原色のどれでもない | 地色として1色を所有。前景は白または Electric 系（アプリのUIと同一ブランドに見せる） |
| 記号 | 「達成」でも「案内」でもなく「決まった／落ち着いた」状態：広い余白の中の一点、受け止める器、据わった石、点けておいてくれた灯り | 器（Cradle）／石（Settled Stone）／面の器（Quiet Vessel）＋ダークだけ暖色の点（灯） |
| 構図 | 余白 70% 以上、要素1つ、重心わずかに下。非対称は控えめに | Apple ヘルスケアの「白地＋一点」の静けさを第三者アプリで取る |
| 人格 | 顔ではなく気配（受ける・待つ・隣にいる） | 器の中の点、石に寄り添う小石、夜の暖色の点 |
| 質感 | フラット一辺倒の中で、Liquid Glass が乗る「面と形」 | 前景は大きな凸形1つ。Glass の屈折が素材感を担う |
| 性格軸 | Oura の「冷たい静けさ（黒×高級）」と Yazio/Noom の「キャラ・コンパスの伴走」の間＝**暖かい静けさ** | 金融アプリの落ち着きと Headspace の温度感の中間 |

---

## 4. BodyLoger のアイコン戦略

### 4.1 宣言（1文）

> **BodyLoger のアイコンは、「迷いが晴れて、今日の一手が静かに据わった瞬間」を、受け止める器と一点の幾何で描く。記録も採点も達成も描かず、ブランド固有の低彩度の地色を所有し、60px・単色でも同じ形で読める。**

### 4.2 伝える性格

- 知識のある、静かな伴走者（Non-Judging Companion）。トレーナーでも監視者でもない。
- Streak より Comeback：「昨日崩れても、今日また戻ってこられる場所」＝**器**。
- Decision App：「今日どうすればいいか BodyLoger に聞こう」＝器の中に**据わった一点**。
- 暖かい静けさ：興奮ではなく安心。光沢ではなく面。

### 4.3 所有する色（hex・すべて theme.ts の基準10色または派生）

| 役割 | Light（Default） | Dark | 備考 |
|---|---|---|---|
| 地色（本命・Cradle-Aqua） | #C7F5F6 → #8FD0D5（Aqua を上端に、下端はダスティ寄りにくすませる） | #173A40 → #0B1220（dark aqua → Navy） | 現行アイコンの「淡いアクア地」を色相で継承。下端をくすませて飽和青緑クラスタから距離を取る |
| 地色（差別化・Cradle-Sand） | #F4EEE4 → #E9DFCF（砂色／オートミール） | #111827 → #0B1220（Card Gray → Navy） | 新トークン `sand` を追加。競合のどこにも無い暖かい低彩度 |
| 地色（対抗・Settled Stone） | #2FA3AA → #1B7C84（ダスティティール） | #173A40 → #0F262A | Aqua と同色相で明度を落とした「BodyLoger Teal」 |
| 主グリフ（明地の上） | Navy #0B1220 または Electric Ink #2F5FE6 | Aqua #C7F5F6 または #628CFF | 明地では #4D7CFF を主色に使わない（3:1級に落ちる） |
| 主グリフ（暗地の上） | Clean White #FFFFFF | #E6EBF2 | 白は暗地専用 |
| 副要素（点） | Electric Ink #2F5FE6 | **Citrus #FFA62B**（「夜に点けておいてくれた灯り」＝案『灯』の移植） | Dark だけ暖色。形は不変・色だけ差し替え |
| 通知アイコン color | #4D7CFF | — | 現行 #059669（旧グリーン）から更新 |

Electric #4D7CFF はアイコンの中では「面の色」としてではなく、点や Dark の #628CFF として控えめに現れる。ブランドの地色（Aqua/Teal/Sand）と UI アクセント（Electric）の役割分担を theme.ts のコメントで明文化する。

### 4.4 避けること（要約。詳細は §8）

食材・食器・カトラリー・写実／炎・閉じるリング・矢印・シェブロン・コンパス・ハート・葉・リンゴ・体重計・グラフ軸／文字・モノグラム・数字／純黒地／マスコットの顔／日の出・月・星・地平線の風景／焼き込みの影・光沢・グロー・角丸／細線（8%未満）／iOS と Android で違うシルエット。

### 4.5 現行からの「見慣れ」をどこまで残すか

- 現行アイコン（v1.1.0・2026-09-02 導入）は歴史が数日〜数週間。ユーザー数も少なく、NN/g の「大幅刷新が許される例外」に該当する。**今回で「一生使うシルエットと主色」を確定し、以後は形と色を固定、外観（default/dark/clear/tinted）と質感だけを更新する運用に切り替える。**
- 継承するのは2つだけ：**「淡いアクア〜ティール系の地色」と「白い器＝円弧のモチーフ」**。器・食材・カトラリー・写実・フォトリアルは捨てる。
- 継承度の目安：Cradle-Aqua＝高（地色＋器）、Cradle-Sand＝中（器のみ）、Settled Stone＝中（色相のみ）、Quiet Vessel＝高（地色を Electric に変えるが白い器を残す）。
- ホーム画面・通知・ウィジェット・favicon・Web の app-icon・スプラッシュ・LaunchIntro を**同一コミット**で差し替える（別アプリ感の防止）。

---

## 5. 具体的な方向性（審査上位を統合・veto と graft を反映）

審査3名の合計上位は 案7（Cradle・Aqua）42／案1（静点）42／案3（受け皿・Sand）41／案4（Quiet Vessel）39。案7・案3・案4 は同一グリフ族（器＋一点）のため **方向性A「受け皿 Cradle」として1本の制作トラックに統合し、地色のカラーウェイで並走**させる。案1 は **方向性B「静点 Settled Stone」** として別軸の対抗案に残し、案5・案8 の graft（monochrome 用の支え・寄り添う小石）を取り込む。案4 の「面の器」は **方向性C「静かな器 Quiet Vessel」** として保険に残す。案2『灯』は独立案ではなく、**全方向性の Dark 外観に「点＝Citrus」として移植**する。案6・案9 は不採用（§8 参照。案6 の「線が静まる」動きはスプラッシュ演出に移植）。

生成の共通ルール（全方向性）:

- 前景と背景は**別プロンプト**で生成する。合成（COMPOSITE）プロンプトは構図レビュー専用で納品に使わない。
- 濃色グリフ（Navy / Electric Ink）は**純白地**で、白・淡色グリフは**マゼンタ #FF00FF 地**で生成する（キー抜きのフリンジを最小化）。
- 生成物の HEX・％・角度は守られない前提。比率は寸法で再計測し、色はトークン値で塗り直す。
- 幾何プリミティブ（円弧・円・角丸長方形）はラスターからトレースせず、Figma で数値どおり描く。オートトレースは有機形（石）だけに限定し、アンカーを8〜10点に間引く。

### 5.A 方向性A『受け皿』— The Cradle（本命・案7＋案3＋案4 統合）

**コンセプト**
太い一本の U 弧（受け皿・ゆりかご）の底に、一つの丸（今日のあなた／今日の一手）が静かに据わる。器＝「昨日崩れても今日また戻ってこられる場所」（Comeback）、点＝「迷いが一点に落ち着いた」（Decision）。叱らない・採点しないという性格を「落ちてきたものを受ける形」で言う。現行の「白い器」を食材もカトラリーも捨てて幾何に還元するので「サラダアプリ」には見えないが、器の記憶は残る。FiNC の欠けた円とは、開口の大きさ（真上に大きく開く U）・線幅（14%）・内側の点の存在で区別。Noom のコンパス、達成系の矢印・リングとも重ならない。

**形の言語**
- U 弧：外径 = キャンバス幅の 60%、線幅 14%、両端は完全な半円キャップ、左右対称、開口は真上。両端は水平中心線のやや上で止める（掃引角 約160°。150〜180°の範囲で3秒テストにより決定）。
- 点：直径 13%（器の幅の 1/5 以下を厳守。顔に読まれたら 11% まで縮める）。U の内側の底に「置く」。点の下端と U 内側の隙間はキャンバスの 4%（Liquid Glass の膨らみで結合しない距離）。点を弧の上方に浮かせない・2つ以上置かない。
- 配置：U の円中心は (50%, 42%)、外側底は 72%、点の中心は (50%, 約47.5%)。グリフ bbox は幅 20〜80%、視覚重心は 55% 付近（据わり）。余白比 約72%。
- 輪郭線なし・面のみ。ハードエッジ。

**色と光**
| カラーウェイ | 地（上→下） | U | 点 |
|---|---|---|---|
| A-1 Aqua（再認優先） Light | #C7F5F6 → #8FD0D5 | Navy #0B1220 | Electric Ink #2F5FE6 |
| A-1 Dark | #173A40 → #0B1220 | Aqua #C7F5F6 | Citrus #FFA62B（灯） |
| A-2 Sand（差別化優先） Light | #F4EEE4 → #E9DFCF | Electric Ink #2F5FE6 | Electric Ink #2F5FE6（1色グリフ） |
| A-2 Dark | #111827 → #0B1220 | #628CFF | Citrus #FFA62B（灯） |
| Mono（共通） | 透明 | 白 100% | 白 65% |

光は描かない。Icon Composer の Specular Automatic を U に、点（13%）は Glass OFF で平面に置く。

**iOS 4バリアント / Android レイヤー**
- Icon Composer（3層・2グループ）: Group1 = 背景（Fill: Gradient を Icon Composer 内で作成、画像なし）。Group2 = `01_cradle.svg`（U）＋`02_dot.svg`（点）。Group2 は Specular Automatic・Shadow neutral・Blur 0・Translucency Off。点レイヤーのみ Glass OFF。Dark 注釈で地と色を差し替え、Mono 注釈で 01=白100% / 02=白65%。
- Android adaptive: `foregroundImage` = U＋点のみの透過 PNG/ベクター（bbox 614px、安全円 676px 内）。`backgroundColor` = #A9E4E8（A-1）または #EFE7DA（A-2）の単色。`monochromeImage` = U＋点を白1色・アルファ2値（階調なし）。通知アイコン = 同一素材、color #4D7CFF。
- Android circle マスクで U の両端が欠けないことを Image Asset Studio でプレビュー確認。

**60px / 29px での見え方**
- 60px：地に濃い U（線幅約8px）と点（約8px）。「器に収まった一点」として明確。3明度（暗U／中点／明地）がグレースケールでも保たれる。
- 29px：U は約4px の弧、点は約4px。隙間は溶けて「点が器に触れた」形になるが「u̇」記号として読める。
- 黒シルエット：U＋点の一塊。馬蹄・磁石・笑顔の誤読は真上開口・内側の点・点を底に置くことで回避。
- 失うもの：特になし（3要素以下の幾何）。

**英語プロンプト（そのまま貼れる完成形）**

```
[A-FG] FOREGROUND — glyph only, for extraction (dark glyph on white)
Flat vector app icon glyph, front orthographic view, 1024x1024 square, full-bleed, no rounded corners. Exactly one symbol in exactly one solid color, deep navy #0B1220, on a plain flat pure white #FFFFFF background with nothing else. The symbol is a thick U-shaped arc like a shallow cradle or an empty bowl seen from the front: the lower part of a ring, outer diameter about 60% of the canvas width, stroke thickness about 14% of the canvas, perfectly symmetrical left and right, opening straight upward, both ends capped with full semicircles, the two ends stopping slightly above the horizontal center line so the arc sweeps about 160 degrees. Inside the arc, one solid filled circle about 13% of the canvas wide rests at the bottom, centered horizontally, floating just above the inner edge of the arc with a small visible gap of about 4% of the canvas, not touching it, not floating high, not an eye. The whole glyph is centered with its visual weight slightly below the middle of the canvas and occupies about 60% of the width, generous empty margin all around. Style: minimal geometric vector like a paper cut-out sticker, crisp hard edges, matte, opaque flat fill, constant stroke width, no outline stroke, no gradient, no shadow, no highlight, no texture, no 3D, no perspective, no text, no letters, no numbers. Not a smiley face, not a magnet, not a horseshoe, not a cup with a handle, not a spoon, not a closed ring, not a bowl with food.

[A-BG-1] BACKGROUND — Aqua colorway
Plain smooth vertical gradient background only, pale aqua #C7F5F6 at the top flowing evenly to dusty teal #8FD0D5 at the bottom, completely empty, no objects, no shapes, no texture, no noise, no vignette, no light rays, no text. 1024x1024 square, full-bleed, no rounded corners.

[A-BG-2] BACKGROUND — Sand colorway
Plain smooth vertical gradient background only, warm pale sand #F4EEE4 at the top flowing evenly to soft oatmeal #E9DFCF at the bottom, matte, completely empty, no objects, no paper grain, no texture, no noise, no vignette, no text. 1024x1024 square, full-bleed, no rounded corners.

[A-PREVIEW] COMPOSITE — review only, never for delivery
Minimal flat vector app icon, a thick deep-navy U-shaped cradle arc opening upward with one small electric-blue #2F5FE6 dot resting inside at its bottom, the glyph centered at about 60% of the canvas on a smooth pale-aqua-to-dusty-teal vertical gradient, calm and quiet, generous negative space, geometric, opaque flat fills, hard clean edges, no text, no shadows, no gloss, no rounded-corner mask, 1024x1024 square, full-bleed.
```

**ネガティブプロンプト**
```
text, letters, words, typography, logo, numbers, watermark, signature, smiley face, eyes, mouth, nose, face, emoji, character, mascot, cup handle, mug, teacup, spoon, ladle, bowl with food, food, salad, fruit, vegetables, fork, knife, plate, leaf, apple, heart, full circle, closed ring, activity ring, progress bar, compass, needle, arrow, chevron, checkmark, magnet, horseshoe, hook, multiple dots, second arc, hands, outline stroke, thin lines, sharp corners, tapered stroke, gradient on the glyph, drop shadow, cast shadow, inner shadow, glow, neon, gloss, bevel, emboss, reflection, 3D render, photorealistic, photo, texture, paper grain, noise, pattern, vignette, rounded corners, rounded square frame, border, checkerboard transparency, blurry feathered edges
```

**バリエーションの振り方（3つ）**
1. 色相：A-1 Aqua 地 × Navy U × Electric Ink 点（再認優先）／A-2 Sand 地 × Electric Ink 1色グリフ（差別化優先）／Sage 地 #DDF3EC → #8FCDB9 × ダスティティール U #1F4F55（最も暖かい低彩度。緑系で「自然」に寄らないか確認）。地色以外は同一グリフで、60px・29px の3秒テストにより地色だけを決める。
2. 抽象度：点あり U（本命）／点なし U のみ（線幅16%・最小。ただし「u」や磁石に読まれやすい）／U を浅い皿の断面（横長・掃引角130°）にして点を大きく（器の記憶最大・案3寄り）。
3. 光（Icon Composer 上でのみ）：Specular Automatic（本命）／背景を放射グラデ（点の真上だけ明るい）にして「朝の光」を地側で表現（前景は不変）／点を U より1段明るくして Mono 階調差を 100/65 → 100/60 に広げる。

### 5.B 方向性B『静点』— The Settled Stone（対抗・案1＋案5/案8 graft）

**コンセプト**
迷いが晴れた後の状態を「水面に置かれ、動きを止めた一つの丸石」で表す。石は何も指さず、何も測らず、ただそこに据わっている＝採点も催促もしない伴走者の在り方。Body（身体＝有機的な一塊）と Log（水面に置かれた一点）を1つの形で言う。競合との距離は「ダスティティール地 × 白い不定形の丸石」という色相と形の両方で取る（Headspace の橙の完全円、Apple ヘルスケアの白地ハートとは別領域）。器系が3秒テストで「笑顔／磁石」を越えられない場合の保険。Liquid Glass の屈折が最も美しく乗る大きな凸形。

**形の言語**
- 石：上下にわずかに扁平な丸石（縦横比 約0.86 の「平たい卵形をさらに崩した」連続曲率。右側がやや張る左右非対称。完全円・完全楕円にしない）。幅はキャンバスの 56%、中心は (50%, 52%)。下辺をわずかに平らにして「置かれている」感を出す。
- 支え（水面）：石の直下に幅 50%・厚さ 5% の短い太いバー（両端は半円）。**iOS Mono と Android monochrome の両方に同じバーを入れ、同一シルエットにする**（案5 graft。石単体は卵・豆・雲に読まれるため、これが識別子）。半透明の楕円は使わない（キー抜きでアルファが復元できないため）。
- 石の中に模様・ハイライト・テクスチャは描かない。輪郭線なし。余白比 約70%。
- ベクター化：オートトレース1回 → アンカー8〜10点に間引き → 縦横比 0.86・右張りを数値で整える。

**色と光**
| 外観 | 地（上→下） | 石 | バー |
|---|---|---|---|
| Light | #2FA3AA → #1B7C84（ダスティティール） | #FFFFFF | #EAF7F7 |
| Dark | #173A40 → #0F262A | #E6EBF2 | #C7F5F6 |
| Dark 派生（灯） | 同上 | #FFE0A8（Citrus 系の淡い暖色） | #C7F5F6 |
| Mono | 透明 | 白 100% | 白 60% |

光は描かない。石は Glass ON・Specular Automatic・Shadow neutral。バー（厚さ5%）は Glass OFF。

**iOS 4バリアント / Android レイヤー**
- Icon Composer（3層・2グループ）: Group1 = 背景 Gradient。Group2 = `01_bar.svg`（Glass OFF）、`02_stone.svg`（Glass ON・Specular Automatic）。Dark 注釈で地と石の色を差し替え。Mono 注釈で 02=白100% / 01=白60%。
- Android adaptive: `foregroundImage` = 石＋バー（bbox 幅 約574px、安全円内）。`backgroundColor` = #237F87 単色（backgroundImage 廃止）。`monochromeImage` = 石＋バーを白1色・アルファ2値。通知アイコン = 同一素材、color #237F87（またはアプリ規約どおり #4D7CFF）。
- アプリ側: theme.ts の `aqua`（#C7F5F6・背景トーン用）とは別に、アイコン主色 `teal` #237F87 を追加し、役割をコメントで分離する。

**60px / 29px での見え方**
- 60px：深いティール地に白い塊がひとつ＋足元の短いバー。高明度差で輪郭が立ち、多色アイコンの中で「静かな1点」として最も目に入る。
- 29px：ティールの四角に白い楕円点と細い線。非対称のニュアンスは消えるが「ティール × 白点」の色の所有で識別。
- 黒シルエット：丸石＋バー。「何かに置かれた石」として読め、卵・雲との区別がつく。
- 誤読リスク：卵／餅／錠剤／スパの石 → 縦横比 0.86・右張り・下辺平ら・石は1つだけ（積まない）で回避。

**英語プロンプト（そのまま貼れる完成形）**

```
[B-FG] FOREGROUND — glyph only, for extraction (light glyph on magenta key)
Flat vector app icon glyph, front orthographic view, 1024x1024 square, full-bleed, no rounded corners. One single smooth pebble shape drawn as a flat paper cut-out sticker in a single solid color, pure white #FFFFFF, on a plain flat uniform magenta #FF00FF background with nothing else. The pebble is an organic, slightly asymmetric rounded oval, wider than tall (about 0.86 height-to-width), the right side slightly fuller than the left, the bottom edge very gently flattened as if resting on a surface, no corners, no points, not an egg, not a pill, not a perfect circle, not a stack of stones. It is about 56% of the canvas wide, centered horizontally, its center slightly below the vertical middle. Directly beneath the pebble, with a small gap, one short thick horizontal bar with fully rounded ends, about 50% of the canvas wide and 5% tall, in very pale aqua-white #EAF7F7, like a still water surface. Style: minimal geometric vector, opaque flat fills, hard clean edges, matte, no outline stroke, no texture, no speckles, no shading, no highlight, no shadow, no gradient, no 3D, no perspective, no text, no letters.

[B-BG] BACKGROUND
Plain smooth vertical gradient background only, dusty teal #2FA3AA at the top flowing evenly to deep teal #1B7C84 at the bottom, completely empty, no objects, no texture, no noise, no vignette, no water ripples, no horizon, no text. 1024x1024 square, full-bleed, no rounded corners.

[B-PREVIEW] COMPOSITE — review only, never for delivery
Minimal flat vector app icon, one single smooth white pebble, slightly asymmetric and wider than tall, resting perfectly still above a short pale horizontal bar, centered on a smooth dusty-teal vertical gradient, about 70% negative space, calm and quiet, geometric minimalism, opaque flat fills, hard clean edges, no text, no shadow, no glow, no rounded-corner mask, 1024x1024 square, full-bleed.
```

**ネガティブプロンプト**
```
text, letters, words, typography, logo, numbers, watermark, signature, egg, pill, capsule, bean, cloud, perfect circle, stacked stones, cairn, zen garden, spa, candle, moon, sun, stars, multiple stones, hands, stone texture, cracks, speckles, marble veins, grain, noise, shading, gradient on the stone, specular highlight, reflection, gloss, bevel, emboss, drop shadow, cast shadow, glow, bloom, lens flare, 3D render, photorealistic, photo, realistic, water ripples, waves, splash, horizon line, landscape, sky, outline stroke, thin lines, rounded corners, rounded square frame, border, checkerboard transparency, blurry feathered edges, vignette, pattern, food, bowl, plate, fork, spoon, leaf, apple, heart, ring, arrow, compass, flame, scale, chart, character, face, eyes
```

**バリエーションの振り方（3つ）**
1. 色相：ダスティティール #237F87（本命）／スレートブルー #3B5BA5 → #2A4480（Electric 系との親和性を上げ、UI アクセントと同族に見せる）／セージ #6F9A8A → #557C6E（最も暖かい低彩度。緑系で「自然・オーガニック」に寄らないか要確認）。
2. 抽象度：石1つ＋バー（本命）／石の右下に直径 20% の小石を1つ「触れて重ならない」距離で寄り添わせる「二つ石」（案8 graft・伴走者＝もう一人を最小限に示す。小石は明度差を確保するため Aqua ではなく #EAF7F7 より暗い #BFE3E6 にし、29px で一塊に見えないか確認）／バーなしの石単体（最も抽象。Mono/テーマ化で卵に見える場合は不採用）。
3. 光（Icon Composer 上でのみ）：Specular Automatic の均一光（本命）／Specular Inside＋Translucency 中で「磨りガラスの石」／背景を対角グラデ（左上明→右下暗）にして光の向きだけを地側で変える（前景は不変）。

### 5.C 方向性C『静かな器』— The Quiet Vessel（保険・案4 改）

**コンセプト**
現行アイコン唯一の資産「白い器の円弧」を、面（ソリッド）の浅い半楕円だけに抽象化し、その上辺の真上に小さな一点を浮かせる。器＝戻ってこられる場所、一点＝朝に1問だけ聞く「今日の一手」。器の上に昇る朝日にも読め、サラダボウルの記憶を「戻る場所」へ意味変換する。方向性A（線の器）が3秒テストで文字「u」や磁石に読まれた場合の、同じ意味を「面」で言う代替。白い大面は Liquid Glass に最も適する。ただし飽和 Electric の地は MyFitnessPal 系「青×白」クラスタに近いことを踏まえ、カラーウェイ C-2（Sand 地）を必ず併走させる。

**形の言語**
- 器：幅 60%、高さ 26% の浅い半楕円（上辺はまっすぐ、下は完全な丸み＝D 字を横に寝かせた形）。
- 点：直径 11%（器幅の 1/5 以下）。器の上辺中央から 4% の隙間を空けて浮く。1つだけ。
- 全体 bbox：幅 60% × 高さ 41%、垂直中心 52%。余白比 約80%。鋭角・細線ゼロ。

**色と光**
| カラーウェイ | 地（上→下） | 器 | 点 |
|---|---|---|---|
| C-1 Electric Light | #6AA3FF → #2F5FE6 | #FFFFFF | Citrus #FFA62B |
| C-1 Dark | #1B2A5C → #0B1220 | #E6EBF2 | Citrus #FFA62B |
| C-2 Sand Light | #F4EEE4 → #E9DFCF | Electric Ink #2F5FE6 | Citrus #FFA62B |
| C-2 Dark | #111827 → #0B1220 | #628CFF | Citrus #FFA62B |
| Mono | 透明 | 白 100% | 白 60% |

**iOS 4バリアント / Android レイヤー**
- Icon Composer（3層・2グループ）: Group1 = 背景 Gradient。Group2 = `01_vessel.svg`（Glass ON・Specular Automatic・Shadow neutral）、`02_dot.svg`（11% なので Glass OFF）。Mono 注釈 01=白100% / 02=白60%。
- Android adaptive: `foregroundImage` = 器＋点（bbox 614px）。`backgroundColor` = #4D7CFF（C-1）または #EFE7DA（C-2）。`monochromeImage` = 器＋点を白1色・アルファ2値。通知アイコン color #4D7CFF。

**60px / 29px での見え方**
- 60px：白い「おわん形の面」と、その上の橙の点（約6〜7px）。写実版で起きた斑は原理的に出ない。
- 29px：白い下半分の丸い面が「ボウルの記憶」として残り、点は約3px の橙の粒（補色関係で消えない）。
- 黒シルエット：上辺が平らな半楕円＋離れた点＝一筆の形。点を大きくすると「顔」に読まれるため器幅の 1/5 以下を厳守。
- 誤読リスク：日の出／カップと球 → 器に厚みや縁を描かない・点を黄色にしない。

**英語プロンプト（そのまま貼れる完成形）**

```
[C-FG] FOREGROUND — glyph only, for extraction (light glyph on magenta key)
Flat vector app icon glyph, front orthographic view, 1024x1024 square, full-bleed, no rounded corners. Two flat shapes forming one symbol on a plain flat uniform magenta #FF00FF background with nothing else. Shape one: a single shallow vessel drawn as a wide half-ellipse with a perfectly straight horizontal top edge and a fully rounded bottom, like a capital letter D rotated to lie flat on its straight side facing up, solid pure white #FFFFFF, about 60% of the canvas wide and 26% tall, centered horizontally, its center slightly below the vertical middle. Shape two: one small solid filled circle in warm citrus orange #FFA62B, about 11% of the canvas wide, floating centered just above the flat top edge with a small visible gap of about 4% of the canvas, like a quiet morning sun resting above an empty bowl, not touching it. Style: minimal geometric vector like a paper cut-out sticker, opaque solid fills, hard clean edges, matte, no rim thickness, no inner shading, no outline stroke, no gradient on the shapes, no shadow, no highlight, no texture, no 3D, no perspective, no text, no letters, no food, no cutlery, not a face.

[C-BG-1] BACKGROUND — Electric colorway
Plain smooth vertical gradient background only, light electric blue #6AA3FF at the top flowing evenly to deeper blue #2F5FE6 at the bottom, completely empty, no objects, no texture, no noise, no vignette, no light rays, no text. 1024x1024 square, full-bleed, no rounded corners.

[C-BG-2] BACKGROUND — Sand colorway
Plain smooth vertical gradient background only, warm pale sand #F4EEE4 at the top flowing evenly to soft oatmeal #E9DFCF at the bottom, matte, completely empty, no objects, no paper grain, no texture, no noise, no vignette, no text. 1024x1024 square, full-bleed, no rounded corners.

[C-PREVIEW] COMPOSITE — review only, never for delivery
Minimal flat vector app icon, a solid white shallow bowl-shaped half-ellipse with a straight top edge, centered slightly low, with a single small citrus-orange circle floating just above its rim, on a smooth electric-blue vertical gradient (light top, deeper bottom), calm and quiet like a morning, generous negative space, geometric, opaque flat fills, hard clean edges, no text, no shadows, no gloss, no rounded-corner mask, 1024x1024 square, full-bleed.
```

**ネガティブプロンプト**
```
text, letters, words, typography, logo, numbers, watermark, signature, food, salad, vegetables, fruit, leaves, fork, spoon, knife, plate rim, bowl rim thickness, cutlery, face, eyes, smile, emoji, character, mascot, heart, apple, flame, ring, arrow, compass, chart, scale, sun rays, sunbeams, yellow sun, clouds, sea, water reflection, horizon line, photo, photorealistic, 3D render, perspective, isometric, drop shadow, inner shadow, glow, bloom, bevel, emboss, gloss, glass reflection, highlight, texture, noise, grain, pattern, gradient on the shapes, outline stroke, thin lines, sharp corners, rounded corners, rounded square frame, border, checkerboard transparency, blurry feathered edges, vignette, multiple dots, multiple objects, cluttered
```

**バリエーションの振り方（3つ）**
1. 色相：C-1 Electric 地 × 白器 × Citrus 点（UI と最も一体化・青クラスタ隣接）／C-2 Sand 地 × Electric Ink 器 × Citrus 点（差別化）／Navy 地 #0B1220 → #1B2A5C × Aqua 器 #C7F5F6 × Citrus 点（ダーク先行・プレミアム寄り。純黒ではなく Navy を維持）。
2. 抽象度：半楕円（本命）／厳密な半円（より幾何的・Apple グリッド寄り）／上辺を微かに凹ませて「受け皿」の含みを強める（点が器に納まる読みが増す）。
3. 光（Icon Composer 上でのみ）：Specular Automatic（本命）／器のみ Translucency を上げて中の点が透ける「磨りガラスの器」／背景を放射グラデ（点の真上だけ明るい）で朝の気配を地側だけに持たせる。

### 5.D 全方向性への移植（graft）

- **Dark ＝ 灯**：Dark 外観だけ点（または石）を Citrus #FFA62B 系の暖色にし、「夜に点けておいてくれた灯り＝Comeback」を1点に担わせる。形は不変、色だけ差し替え。tinted で点が地に溶けないかを必ず確認。
- **Mono 階調規律**：主要素＝白100%、副要素＝白60〜65%。不透明度差 35% 以上。25% 以下の要素は識別要素として数えない。
- **Glass 判定**：幅・厚さがキャンバスの 12% 未満の要素は Glass/Specular OFF。大きな凸形のみ ON。境界（13〜18%）は実機 60px で膨らみを見て決める。
- **据わり**：グリフの垂直中心は 52〜55%。上を軽く、下を重く。
- **点の上限則**：点は器・石の幅の 1/5 以下、必ず1つ、器の底に置く。
- **明地の色規律**：白・砂色・淡アクアの上では Electric Ink #2F5FE6（または Navy）。#4D7CFF は使わない。Dark では #628CFF / #6AA3FF に反転。
- **スプラッシュ演出**：案6「揺れていた線が水平に落ち着く」の動きを LaunchIntro.tsx に移植（器の中で点がわずかに揺れて底に据わる 0.6秒 ease-out）。静止アイコンには何も足さない。
- **splash light/dark 2枚**：ダーク利用者向けに #0B1220 地のスプラッシュも用意し、起動→ホーム遷移の継ぎ目を消す。

### 5.E 生成ツール別メモ（2026-09 時点）

- Midjourney v7：`--ar 1:1 --style raw --no text,shadows,gradients,3d` を付け、上のネガティブを `--no` に圧縮して渡す。透過は出ないのでキー抜き前提。
- gpt-image-2 / Ideogram 4.0 / Recraft V3-V4 SVG：透過（またはネイティブ SVG）出力が可能。ただし透過出力でも幾何プリミティブはトレースせず Figma で再描画する。
- Imagen 4 / Nano Banana：RGB のみ。キー抜き前提。
- 「transparent background」とプロンプトに書かない（チェッカーボードを描く）。透過が要る場合は対応モデルの API パラメータか後工程の背景除去を使う。

---

## 6. 生成後の評価チェックリスト

生成した1024px を単体で見て採否を決めない。以下のコンタクトシートを作ってから Figma 本制作へ進む。

- [ ] **3秒テスト**：未認知者に3秒見せて「このアプリは何をすると思う？」。「食事記録／レシピ／宅配」「顔・笑顔」「磁石・馬蹄」「天気・アラーム」「グラフ・心電図」と答えられたら形を修正。30人以上・成功率 80% が目標。
- [ ] **60px 縮小**：ホーム画面相当。主形状が1つの塊として残り、点が確認できるか。
- [ ] **29px 縮小**：設定・通知相当。「地色 × 1形」の組み合わせで識別できるか。細部が消えても意味が保たれるか。
- [ ] **黒シルエット**：形だけで「楕円だけ／バーだけ」になっていないか。iOS Mono と Android monochrome が同一シルエットか。
- [ ] **グレースケール**：3明度（地／主／副）が保たれるか。
- [ ] **スクイントテスト**：目を細めて色塊と形だけで判別できるか。
- [ ] **ダーク壁紙／ライト壁紙**：両方の上で 60px・29px を並べて溶けないか（中間トーンだけの配色になっていないか）。
- [ ] **4外観（Default / Dark / Clear / Tinted）**：Icon Composer のプレビューで形が全外観で同一か。tinted で階調が形を補っているか。
- [ ] **Android circle / squircle / rounded square**：Image Asset Studio でプレビューし、前景が欠けないか。themed icon で単色化した形が読めるか。
- [ ] **競合との距離**：あすけん・カロミル・MyFitnessPal・Noom・Yazio・FiNC・Apple ヘルスケア・Apple フィットネス・Oura・Whoop と同じホーム画面に並べ、どのクラスタにも吸われないか。特に FiNC の欠けた円、Noom のコンパス、Apple ヘルスケアの白地一点との距離。
- [ ] **不気味の谷**：写実・光沢・過飽和・完璧対称の「AI 生成っぽさ」が残っていないか。
- [ ] **色の実測**：生成物の色は信用せず、theme.ts のトークン値で塗り直したか。明地上の主色が #2F5FE6 以上の濃さか（3:1 未満なら不可）。
- [ ] **ストア A/B（採用後）**：Apple PPO で3案まで同時テスト。検索経由とブラウズ経由の CVR を分けて読み、D7 継続まで見る（見かけの CVR 上昇だけで判断しない）。

---

## 7. アプリへの取り込み手順

対象: C:/Users/hashi/Downloads/bodylog/native（Expo SDK 57）。**以下はすべて同一コミットで行う**（起動→ホーム・通知・タブでのブランド不一致を作らない）。

### 7.1 素材の確定（Figma / Illustrator）

1. 生成画像は比率確認用に置き、前景は 1024 グリッド上でプリミティブから描き直す（U = Ellipse → Arc → Stroke 14% → Outline Stroke、点 = Circle、バー = 角丸長方形 半径=高さ/2。石だけオートトレース→アンカー 8〜10 点に間引き）。
2. レイヤー名は奥から `01_cradle`, `02_dot` のように番号付き。背景は書き出さない（Icon Composer / Android 側で作る）。
3. 書き出し：前景を SVG（レイヤー別・塗りのみ・マスクなし・影なし）。Android 用に 1024px 透過 PNG（前景のみ、bbox 205〜819px）と monochrome（白1色・アルファ2値）PNG。スプラッシュ用にグリフのみの透過 PNG（角丸タイル・落ち影を含めない）。favicon 48px・Web 用 256px PNG（地色の角丸を含む合成版）。

### 7.2 iOS: Icon Composer で `.icon` を作る

1. Icon Composer で新規（iPhone/iPad 1024）。Group1 に Fill: Gradient で地色を作成（A-1: #C7F5F6 → #8FD0D5）。
2. Group2 に `01_cradle.svg`・`02_dot.svg` を読み込み、Specular Automatic・Shadow neutral・Blur 0・Translucency Off。点のレイヤーは Glass OFF。
3. Dark 注釈：Group1 を #173A40 → #0B1220、U を #C7F5F6、点を #FFA62B。Mono 注釈：01=白100%、02=白65%。
4. 6外観をプレビューし §6 を通す。`BodyLoger.icon` として保存。
5. app.json の `expo.ios.icon` に `./assets/icons/BodyLoger.icon`（ディレクトリ）を指定。旧 `expo.icon`（icon.png）は Android 旧端末・Web 用に合成版 PNG を残す。

### 7.3 Android: adaptive icon

app.json `expo.android.adaptiveIcon` を次の構成に変更する。

- `foregroundImage`: `./assets/images/android-icon-foreground.png`（新・グリフのみ・背景タイルなし）
- `backgroundColor`: `#A9E4E8`（A-1）／`#EFE7DA`（A-2）／`#237F87`（B）。`backgroundImage` は削除（タイル二重化の廃止）
- `monochromeImage`: `./assets/images/android-icon-monochrome.png`（新・白1色・アルファ2値・前景と同形）
- `expo-notifications` プラグインの `icon` は同じ monochrome を指し、`color` を `#059669` → `#4D7CFF` に更新。
- Image Asset Studio の circle/squircle プレビューで欠けを確認。Play 用 512px は合成版（透過なし・角丸なし）を別途書き出す。

### 7.4 スプラッシュ（docs/TODO.md B3「起動画面アイコンの四角が見える」を同時に根治）

根本原因は「アクア地と角丸タイルを含む icon.png をそのままスプラッシュ画像に使っている」こと。対策は「背景を含まない透過のグリフ」を別素材にすること。

1. `native/assets/images/splash-icon.png` を、グリフのみの透過 PNG（角丸タイル・落ち影を含まない）に差し替える。icon.png との同一バイト共有をやめる。
2. app.json `expo-splash-screen` の `backgroundColor` を採用カラーウェイの地色（A-1: `#C7F5F6`、A-2: `#EFE7DA`、B: `#237F87`）に変更。`imageWidth` 160 は維持。
3. `native/src/components/LaunchIntro.tsx` の背景色 `'#C8FAFB'` を **同じ値** に変更（コメント「ここを変えるときは app.json の splash.backgroundColor も必ず一緒に変える」に従う）。オーバーレイ画像も同じ透過グリフを使う。
4. 演出：現行の scale 1.12＋フェードを「点が器の底に据わる」0.6秒 ease-out に置き換える（任意・§5.D）。
5. ダーク利用者向けに `dark` スプラッシュ（`backgroundColor: '#0B1220'`、グリフは Dark 配色）を追加し、LaunchIntro もテーマに応じて切り替える。
6. 実機で #C7F5F6 地に 160px で表示し、角丸タイルのエッジや影が浮いていないことを確認して B3 をクローズ。

### 7.5 Web / favicon / LP

- `native/assets/images/favicon.png`（48px）と Web の `public/icons/app-icon.png`（256px）を合成版で差し替え。
- 招待 LP（/invite）のアイコン表示、App Store 検索 URL（apps.apple.com/search?term=BodyLoger）の結果と見比べて「同じアイコン」に見えることを確認。

### 7.6 トークン・ドキュメントの整合

- `native/src/lib/theme.ts` / `ui.ts`：`aqua`（#C7F5F6）は「背景トーン'アクア'用」として残し、アイコン地色は新トークン（`sand` #EFE7DA または `teal` #237F87、A-1 なら `aqua` のまま）として分離。「新アイコン（アクア地・白い皿・鮮やかな食材）に合わせて刷新」のコメントを「新アイコン（受け皿グリフ）」に更新。
- スウォッチ先頭5色の「アクア」名・PFC プリセット「アイコン調」の名前と値が矛盾しないよう確認（Electric / Leaf / Citrus / Berry / Navy / Aqua の体系は引き継ぐ）。
- docs/FEATURES.md・docs/PLATFORM.md のアイコン記述（「モノクロアイコン設定済み」「iOS の新アイコン形式を監視」）を本ファイル参照に更新。docs/BACKLOG.md「アイコン刷新・黒縁除去」と docs/TODO.md B3 をクローズ。
- リリース：docs/RELEASE.md の運用どおりパッチバージョンを上げ、ストアのアイコン更新と同時に配信。

---

## 8. やらないこと（veto）と理由

| やらないこと | 理由 |
|---|---|
| 食材・カトラリー・皿の縁・写実・写真風レンダを残す | 現行の「サラダアプリ」誤認の根源。AI 写実食品は不気味の谷帯域で汎用テンプレートに埋没する |
| 文字・頭文字（B / BL）・モノグラム・数字・「AI」表記をアイコンに置く | App Store 名との二重表記、11言語対応で不可、tinted で潰れる、黒×白モノグラムは競合飽和領域、Play のメタデータポリシー |
| 炎・閉じるリング・欠けた円・上向き矢印・シェブロン・コンパス・ハート・葉・リンゴ・体重計・グラフ軸/目盛り | 達成・採点・監視・案内の記号は「採点しない伴走者」「Streak より Comeback」に反し、かつ Apple Fitness / FiNC / Strava / Noom / Apple ヘルスケアが所有 |
| 日の出・月・星・地平線の風景、光条・レンズフレア・焼き込みグロー（案9 不採用） | 天気・アラーム・睡眠アプリへの誤認。tinted で崩壊 |
| 一山ある線1本のような「バー」に劣化する形（案6 不採用） | 29px・単色化で識別子を失う。ECG・体重グラフの飽和記号に隣接。生成AIも守れない。動きだけをスプラッシュに移植 |
| 半透明ハローや同心ディスクをキー背景付きの生成画像から抽出する（案2 を独立案にしない） | キー色が混ざりアルファが復元できない。生成AIは光源に必ずブルームを乗せる。「灯」は Dark の点の色として移植 |
| 純黒 #000000 の背景 | HIG は色付き暗背景を推奨。MacroFactor / Whoop / Oura の黒クラスタに入り「冷たい計測器」に読まれる |
| 明地の上で #4D7CFF を主色に使う | 白・砂色・淡アクア地で 3:1 級に落ちる。明地は #2F5FE6 / Navy、暗地は #628CFF / #6AA3FF |
| 白と Aqua #C7F5F6 のように明度差の無い2要素を別要素として並べる（案8 の欠陥） | 小サイズで融合し「吹き出し・雲」になる |
| 淡色グリフを淡色地に置く | 現行の低コントラスト問題（白い皿 × 淡アクア）の再発 |
| 線幅 8% 未満の細線・輪郭線・極細ストローク | Liquid Glass で pillowy に潰れ、29px で消える |
| 点を器の上方に浮かせる・2つ以上置く・器幅の 1/5 より大きくする・取っ手を付ける | 笑顔・片目の顔・カップへの誤読 |
| 石を完全な真円・完全な左右対称楕円にする、2つ以上積む | 卵・錠剤・Headspace の点との混同、スパ・禅の石庭記号化 |
| 角丸・影・光沢・ベベル・グロー・透過を画像に焼き込む | iOS はハイライトが崩れエッジがギザつく。Play は二重角丸・二重影。Clear/Tinted/Dark で破綻 |
| 生成AIの合成画像をそのまま納品する | 前景/背景を分離できず Icon Composer / adaptive icon の恩恵を失う。合成は構図レビュー専用 |
| 幾何プリミティブをラスターからトレースする | 微細アンカーで Liquid Glass のスペキュラが波打つ。Figma で数値どおり描く |
| マゼンタキーを濃色グリフに使う、「transparent background」を生成AIに要求する | 縁が紫に汚れる／チェッカーボードを描く。濃色は白地、淡色はマゼンタ地、抜いた後は内側へ1〜2px オフセットしてトークン色で塗り直す |
| Android の前景に背景タイルを重ねる、monochrome を写真マスクにする、monochrome を省略して自動生成に任せる | 円形マスクでタイルの角が欠ける（B3 と同種）。テーマアイコン・通知アイコンで形が崩れる。自動生成は品質保証なし |
| iOS Mono と Android monochrome で異なるシルエットを用意する | プラットフォーム間でブランドが揺れる。前景＝monochrome＝通知アイコンは1ソース |
| Default / Dark / Mono で形を変える、Dark だけ要素を足す | HIG「全外観でコア特徴を同一に」。再認の崩壊 |
| アイコン・splash.backgroundColor・LaunchIntro.tsx・通知 color・favicon・Web アイコン・theme.ts コメントを別コミットで更新する | 起動→ホーム・通知・タブでのブランド不一致（別アプリ感） |
| 一度確定したシルエットと主色を頻繁に変える | Snapchat / Instagram / Creator Studio 型の再認崩壊。以後は外観と質感だけを更新 |
| ストアテストの見かけの CVR 上昇だけで採否を決める | Azur Games 型：広告経由は上がり検索経由は下がる。検索/ブラウズを分け D7 継続まで見る |
| 1024px 単体・1枚の PNG で採否を決めて出荷する | 60px・29px・黒シルエット・グレースケール・4外観・Android マスクのコンタクトシートを作ってから確定 |
