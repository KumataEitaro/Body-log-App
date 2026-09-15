# LLM API コスト調査 — BodyLoger 移行先・多重化検討

**調査日: 2026年9月15日**（全データを当日に各社公式ページで確認）

---

## 0. 検証ポリシーと読み方

- 価格はすべて **USD / 100万トークン (per 1M tokens)** に統一。公式が `$/1K tokens` や CNY 表記の場合は元表記も併記した。
- **公式の一次情報（各社の pricing / docs ページ）でしか数字を書いていない。** 裏が取れなかった項目は **`未確認`** と明記した。
- 第三者まとめ・ベンチマークサイト・ブログの数字は原則不採用。例外は 1 件（Amazon Nova）で、その旨を明示している。
- 「公式に載っていない」＝「存在しない」ではない。コンソールにログインしないと見えない項目（Gemini の対話用レート制限、Mistral の無料枠数値など）は `未確認（要ログイン）` とした。

### BodyLoger の必須要件

| # | 要件 | 判定基準 |
|---|---|---|
| 1 | 日本語の理解・生成が実用水準 | 公式の多言語対応表明。**実測は本調査の範囲外**（下記の所見は推定と明記） |
| 2 | 画像入力 (vision)、**1リクエスト最大5枚**、長辺1280px JPEG q0.72 | 公式ドキュメントで image input 対応かつ **枚数上限 ≥5** |
| 3 | JSON 強制出力 | `json_schema`（スキーマ強制）or 最低限 `json_object` |
| 4 | 安い | 入出力 $/1M と **画像込みの実効単価** |
| 5 | HTTP API・日本から低遅延 | 日本リージョン／グローバルエンドポイントの有無 |

> ⚠️ **調査で判明した重要事項**: 要件2の「5枚」で **Groq が脱落** します（vision モデルは1リクエスト最大3枚）。詳細は §1-B。

---

## 1. 価格表

### 1-A. 候補（要件1〜4を満たすもの）— 入力単価の安い順

| # | プロバイダ | モデル (API ID) | 入力 $/1M | 出力 $/1M | 画像の課金方式 | vision | JSON強制の方式 | コンテキスト | 無料枠 | 出典 |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **Z.ai / Zhipu** | `glm-4.6v-flash` | **$0** | **$0** | **未確認** | ✅ 画像+動画 | ⚠️ vision での対応は**未確認** | 128K | **完全無料** | [pricing](https://docs.z.ai/guides/overview/pricing) |
| 2 | Z.ai / Zhipu | `glm-4.6v-flashx` | **$0.04** | $0.40 | **未確認** | ✅ | ⚠️ 同上 | 128K | キャッシュ保管が期間限定無料 | [pricing](https://docs.z.ai/guides/overview/pricing) |
| 3 | **OpenAI** | `gpt-5-nano` | **$0.05** | **$0.40** | パッチ課金 `⌈w/32⌉×⌈h/32⌉` × **1.5** | ✅ | ✅ `json_schema` strict | 400K | なし | [pricing](https://developers.openai.com/api/docs/pricing) / [model](https://developers.openai.com/api/docs/models/gpt-5-nano) |
| 4 | Alibaba Qwen | `qwen3-vl-flash` | **$0.05**(≤32K) / $0.075 / $0.12 | $0.40 / $0.60 / $0.96 | **`h×w/(32×32) + 2` トークン** | ✅ | ⚠️ `json_object` のみ（**`json_schema` strict は非対応**） | 未確認（≥256K と推定） | 1Mトークン/90日 | [pricing](https://www.alibabacloud.com/help/en/model-studio/model-pricing) |
| 5 | **Google Gemini** | `gemini-2.5-flash-lite` | **$0.10** (t/i/v) / $0.30 (audio) | **$0.40** | タイル課金（§2に式） | ✅ | ✅ `responseSchema` | 1M | ✅ あり | [pricing](https://ai.google.dev/gemini-api/docs/pricing) |
| 6 | OpenAI | `gpt-4.1-nano` | $0.10 | $0.40 | パッチ課金（係数未確認） | ✅ | ✅ | 1M | なし | [pricing](https://developers.openai.com/api/docs/pricing) |
| 7 | **Mistral** | `ministral-3b-2512` (Ministral 3 3B) | **$0.10** | **$0.10** | **未確認** | ✅「robust language and vision」 | ✅ `json_schema` | 256K | あり（数値は未確認） | [pricing](https://mistral.ai/pricing/api/) |
| 8 | **DeepSeek** | `deepseek-flash` | **$0.15**(off-peak) / **$0.30**(peak) | **$0.60** / $1.20 | **1枚あたり上限1024トークン** | ✅ | ✅ JSON mode | 1M | なし | [pricing](https://api-docs.deepseek.com/quick_start/pricing) |
| 9 | **Mistral** | `ministral-8b-2512` (Ministral 3 8B) | **$0.15** | **$0.15** | **未確認** | ✅「best-in-class text and vision」 | ✅ `json_schema`（カードに明記） | 256K | あり | [pricing](https://mistral.ai/pricing/api/) |
| 10 | Fireworks AI | `accounts/fireworks/models/glm-5p3-flash` | $0.15（キャッシュ $0.03） | $0.50 | **未確認** | ✅ | ✅ `json_schema` + BNF文法 | 1.04M | なし | [pricing](https://docs.fireworks.ai/serverless/pricing) |
| 11 | OpenAI | `gpt-4o-mini` | $0.15 | $0.60 | タイル課金（旧方式） | ✅ | ✅ | 128K | なし | [pricing](https://developers.openai.com/api/docs/pricing) |
| 12 | Mistral | `mistral-small-2603` (Small 4) | $0.15 | $0.60 | 未確認 | ⚠️ **公式内で矛盾** | ✅ | 256K | あり | [pricing](https://mistral.ai/pricing/api/) |
| 13 | Together AI | `Qwen/Qwen3.5-9B` | $0.17 | **$0.25** | **タイル課金 1,601トークン/タイル（最大2×2=6,404）** | ✅ text+image+video | ✅ `response_format` | 262K | なし | [models](https://docs.together.ai/docs/serverless-models) |
| 14 | **OpenAI** | `gpt-5.6-luna` | $0.20 | $1.20 | パッチ課金 | ✅ | ✅ | **1.05M** | なし | [model](https://developers.openai.com/api/docs/models/gpt-5.6-luna) |
| 15 | OpenAI | `gpt-5.4-nano` | $0.20 | $1.25 | パッチ課金 | ✅ | ✅ | 400K | なし | [model](https://developers.openai.com/api/docs/models/gpt-5.4-nano) |
| 16 | Alibaba Qwen | `qwen3-vl-plus` | $0.20(≤32K) / $0.30 / $0.60 | $1.60 / $2.40 / $4.80 | `h×w/1024 + 2` | ✅ | ⚠️ `json_object` のみ | 未確認 | 1M/90日 | [pricing](https://www.alibabacloud.com/help/en/model-studio/model-pricing) |
| 17 | Alibaba Qwen | `qwen-vl-plus` | $0.21 | $0.63 | `h×w/1024 + 2` | ✅ | ⚠️ `json_object` のみ | 未確認 | 1M/90日 | 同上 |
| 18 | Fireworks AI | `…/deepseek-v4-flash-vision-exp` | $0.22（キャッシュ **$0.007**） | $0.66 | 未確認 | ✅ | ✅ | 1.04M | なし | [pricing](https://docs.fireworks.ai/serverless/pricing) |
| 19 | OpenAI | `gpt-5-mini` | $0.25 | $2.00 | パッチ課金 | ✅ | ✅ | 400K | なし | [pricing](https://developers.openai.com/api/docs/pricing) |
| 20 | Google Gemini | `gemini-3.1-flash-lite` | $0.25 (t/i/v) / $0.50 (audio) | $1.50 | `media_resolution` 280/560/1120/2240 | ✅ | ✅ | 未確認 | ✅ | [pricing](https://ai.google.dev/gemini-api/docs/pricing) |
| 21 | Z.ai / Zhipu | `glm-4.6v` | $0.30（キャッシュ $0.05） | $0.90 | 未確認 | ✅ | ⚠️ 未確認 | 128K | — | [pricing](https://docs.z.ai/guides/overview/pricing) |
| 22 | Google Gemini | `gemini-2.5-flash` | $0.30 (t/i/v) / $1.00 (audio) | $2.50 | タイル課金 | ✅ | ✅ | 1M | ✅ | [pricing](https://ai.google.dev/gemini-api/docs/pricing) |
| 23 | Google Gemini | `gemini-3.5-flash-lite` | $0.30 | $2.50 | `media_resolution` | ✅ | ✅ | 未確認 | ✅ | [pricing](https://ai.google.dev/gemini-api/docs/pricing) |
| 24 | Together AI | `MiniMaxAI/MiniMax-M3` | $0.30（キャッシュ $0.06） | $1.20 | 1,601/タイル（最大6,404） | ✅ | ✅ | 524K | なし | [models](https://docs.together.ai/docs/serverless-models) |
| 25 | OpenAI | `gpt-4.1-mini` | $0.40 | $1.60 | パッチ課金 × **1.62** | ✅ | ✅ | 1M | なし | [pricing](https://developers.openai.com/api/docs/pricing) |
| 26 | Mistral | `mistral-large-2512` (Large 3) | $0.50 | $1.50 | 未確認 | ✅ | ✅ | 256K | あり | [pricing](https://mistral.ai/pricing/api/) |
| 27 | Z.ai / Zhipu | `glm-4.5v` | $0.60（キャッシュ $0.11） | $1.80 | 未確認 | ✅ | ⚠️ 未確認 | 未確認（出力16K） | — | [pricing](https://docs.z.ai/guides/overview/pricing) |
| 28 | Google Gemini | `gemini-3.8/3.7/3.6-flash` | **$0.75**（2026-12-31まで）→ **$1.50**（2027-01-01〜） | **$3.75** → **$7.50** | `media_resolution` | ✅ | ✅ | 未確認 | ✅ | [pricing](https://ai.google.dev/gemini-api/docs/pricing) |
| 29 | OpenAI | `gpt-5.4-mini` | $0.75 | $4.50 | パッチ課金 | ✅ | ✅ | 未確認 | なし | [pricing](https://developers.openai.com/api/docs/pricing) |
| 30 | Alibaba Qwen | `qwen-vl-max` | $0.80 | $3.20 | `h×w/1024 + 2` | ✅ | ⚠️ `json_object` のみ | 未確認 | 1M/90日 | [pricing](https://www.alibabacloud.com/help/en/model-studio/model-pricing) |
| 31 | Moonshot / Kimi | `kimi-k2.6` | $0.95（キャッシュヒット **$0.16**） | $4.00 | **公式の式なし**（estimate-tokens API で事前計算） | ✅ | ✅ `json_schema`（ただし複雑スキーマで不安定） | 262K | **なし** | [pricing](https://platform.kimi.ai/docs/pricing/chat) |
| 32 | **Anthropic** | `claude-haiku-4-5-20251001` | **$1.00** | **$5.00** | `⌈w/28⌉×⌈h/28⌉`（上限1,568） | ✅ | ✅ `output_config.format` (GA) | 200K | なし | [pricing](https://claude.com/pricing) |
| 33 | Mistral | `mistral-medium-3505` (Medium 3.5) | $1.50 | $7.50 | 未確認 | ✅ | ✅ | 256K | あり | [pricing](https://mistral.ai/pricing/api/) |
| 34 | Google Gemini | `gemini-3.5-flash` | $1.50 | $9.00 | `media_resolution` | ✅ | ✅ | 未確認 | ✅ | [pricing](https://ai.google.dev/gemini-api/docs/pricing) |
| 35 | xAI | `grok-4.6` | $2.00(<200k) / $4.00(≥200k) | $6.00 / $12.00 | **未確認** | ✅ | ✅ `json_schema` | 500K | 未確認 | [models](https://docs.x.ai/docs/models) |
| 36 | Anthropic | `claude-sonnet-5` | $2.00 | $10.00 | 同上 | ✅ | ✅ | 200K+ | なし | [pricing](https://claude.com/pricing) |
| 37 | Moonshot / Kimi | `kimi-k3` | $3.00（キャッシュヒット **$0.30**） | $15.00 | 公式の式なし | ✅ | ✅（最も安定） | 1.05M | なし | [pricing](https://platform.kimi.ai/docs/pricing/chat) |

> **単位について**: すべて **$/1M tokens**。Alibaba / Z.ai の国際版ページは USD 建てで直接掲載されているため、CNY からの換算は行っていない。Kimi は USD ページと CNY ページの両方が公式にあり、両者は ¥6.667/USD の固定レートで整合している（市場為替レートは未確認）。Amazon Nova のみ AWS が `$/1,000 tokens` 表記なので 1000倍して 1M 換算した。

### 1-B. 候補外（要件を満たさないもの）

| プロバイダ / モデル | 単価 | 落とした理由 |
|---|---|---|
| **Groq** `qwen/qwen3.8-27b` | $0.80 / $4.00 | ⚠️ **要件2で失格: 1リクエスト最大3枚**（BodyLoger は5枚必要）。加えて Groq の vision モデルは**プロンプトキャッシュ割引の対象外**（gpt-oss 系のみ対象）、コンテキストも131Kと最小。画像課金は 1枚2,048トークン固定で予測しやすい点は評価できる |
| **Groq** `qwen/qwen3.6-27b` | 未確認 | 5枚まで可だが `/docs/models.md` に載らず**価格が公表されていない**。プレビュー扱いと判断 |
| **DeepSeek** `deepseek-v4-pro` | $0.66〜1.32 / $1.98〜3.96 | **vision 非対応**（公式が「vision は deepseek-flash のみ」と明記） |
| **Amazon Bedrock** `amazon.nova-2-lite-v1:0` | **未確認** | **Structured outputs が公式モデルカードで「Not Supported」**。OpenAI 互換 Chat Completions も非対応。公式 pricing ページから単価を取得できず。→ ただし**唯一「日本国内完結の推論 geo」がある**ので §5 で別途評価 |
| **Amazon Bedrock** `amazon.nova-lite-v1:0` | $0.06 / $0.24 ※**公式価格表では未確認** | 上記に加え、単価の出典が [AWSブログの計算例](https://aws.amazon.com/blogs/machine-learning/demystifying-amazon-bedrock-pricing-for-a-chatbot-assistant/) のみ。公式 pricing ページで裏が取れなかった |
| **Google Gemini** `gemini-3.6/3.7/3.8-flash` | $0.75→$1.50 / $3.75→$7.50 | **2027-01-01 に単価が2倍になることが公式に確定告知済み**。かつ `gemini-2.5-flash-lite` の7.5倍高い |
| **xAI** Grok 全般 | $1.25〜 | **画像の課金方式（トークン換算式）が公式ドキュメントに一切記載なし** → コスト見積もり不能。無料枠・レート制限も未確認 |
| **Fireworks** `qwen3-vl-235b-a22b-*` | GPU時間課金 | **サーバーレス非対応**。専用GPUデプロイのみ＝トークン課金ではない |
| **Moonshot** `moonshot-v1-*` / `kimi-k2` / `kimi-latest` | — | **すでに廃止済み**（v1系 2026-08-31、k2系 2026-05-25、kimi-latest 2026-01-28） |
| **Mistral** `pixtral-12b` / `magistral-small` | — | **廃止済み**。現行ラインナップは Medium 3.5 / Small 4 / Large 3 / Ministral 3 (3B/8B/14B) |
| Llama 4 Scout/Maverick, Llama 3.2 Vision, Gemma 3, Mistral Small 3.x | — | **Groq / Together / Fireworks のサーバーレスカタログのいずれからも消えている**（2026-09-15時点） |

---

## 2. 画像の課金方式（詳細）と実効コスト試算

BodyLoger の想定: **長辺1280px / JPEG q0.72 / 1リクエスト最大5枚**。以下は 1280×960 を前提とする。

### 各社の課金式（公式）

| プロバイダ | 式 | 1280×960 = 1枚あたり | 枚数上限/req | 出典 |
|---|---|---|---|---|
| **Gemini 2.5系** | 両辺≤384px → 258トークン固定。超えたら 768×768 タイルに分割し 1タイル258トークン。切り出し単位 ≈ `floor(min(w,h)/1.5)` | `floor(960/1.5)=640` → `⌈1280/640⌉×⌈960/640⌉=2×2=4タイル` = **1,032トークン** ※当方計算 | **3,600枚** | [image-understanding](https://ai.google.dev/gemini-api/docs/image-understanding) |
| **Gemini 3.x系** | `media_resolution` で直接指定 | low 280 / medium 560 / **既定1,120** / ultra_high 2,240 | 3,600枚 | [media-resolution](https://ai.google.dev/gemini-api/docs/media-resolution) |
| **OpenAI** | `patches = ⌈w/32⌉×⌈h/32⌉` → モデル係数を乗算（`gpt-4.1-mini`=1.62×、`gpt-5-nano`=1.5×） | `40×30=1,200` × 1.5 = **1,800トークン** ※当方計算 | **1,500枚** | [images-vision](https://developers.openai.com/api/docs/guides/images-vision) |
| **Anthropic** | `⌈w/28⌉×⌈h/28⌉` ビジュアルトークン。標準ティア上限 = 長辺1,568px / 1,568トークン | `46×35=1,610` → 上限で **1,568トークン** ※当方計算 | 100枚（200Kモデル） | [vision](https://platform.claude.com/docs/en/build-with-claude/vision) |
| **DeepSeek** | 自動リサイズ後の画素数で決定、**1枚上限1,024トークン** | **≤1,024トークン** | 600枚 | [vision](https://api-docs.deepseek.com/guides/vision) |
| **Alibaba Qwen** | **`tokens = h×w/(32×32) + 2`**（Qwen3-VL / qwen-vl-max/plus）。旧 Qwen2.5-VL 系は 28×28 | `1280×960/1024+2` = **1,202トークン** ※当方計算 | 最大1,600万画素/枚 | [vision-model](https://www.alibabacloud.com/help/en/model-studio/vision-model/) |
| **Together AI** | **560pxタイルのグリッド、最大2×2、1タイル1,601トークン** | 両辺>560 → 4タイル = **6,404トークン** | 未確認 | [vision-overview](https://docs.together.ai/docs/vision-overview) |
| **Groq** | **1枚 = 2,048入力トークン固定**（解像度不問） | **2,048トークン** | **3枚**（要件2で失格） | [vision](https://console.groq.com/docs/vision) |
| **Fireworks** | **未確認**（公式に換算式の記載なし） | 未確認 | 30枚 | [vision guide](https://docs.fireworks.ai/guides/querying-vision-language-models) |
| **Moonshot / Kimi** | **公式の式なし。** 「estimate tokens API で事前に取得せよ」 | 未確認 | 上限なし（body ≤100MB） | [vision](https://platform.kimi.ai/docs/guide/use-kimi-vision-model) |
| **Z.ai / GLM** | **未確認** | 未確認 | 未確認 | — |
| **Mistral** | **未確認** | 未確認 | 未確認 | — |
| **xAI** | **未確認** | 未確認 | 上限なし（1枚≤20MiB） | [image-understanding](https://docs.x.ai/docs/guides/image-understanding) |

### 1リクエストあたりの実効コスト試算 ⭐

**前提**（当方の計算。太字の数字のみ公式、計算は当方）:
- 共通システムプロンプト **3,000トークン**（キャッシュ対象）
- ユーザーテキスト 200トークン
- 食事写真 **5枚**（1280×960）
- 出力 **500トークン**

| モデル | 画像トークン計 | キャッシュ効いた入力コスト | 出力コスト | **合計 / リクエスト** | Gemini比 |
|---|---|---|---|---|---|
| **`gpt-5-nano`** | 9,000 | $0.000015 + $0.000460 | $0.000200 | **$0.00068** | **0.88×** |
| **`gemini-2.5-flash-lite`** | 5,160 | $0.000030 + $0.000536 | $0.000200 | **$0.00077** | **1.00×**（基準） |
| `gpt-4.1-nano` | 9,000 | $0.000075 + $0.000920 | $0.000200 | $0.00120 | 1.6× |
| `deepseek-flash`（off-peak） | 5,120 | $0.000009 + $0.000798 | $0.000300 | $0.00111 | 1.4× |
| `deepseek-flash`（**peak / JST昼夕**） | 5,120 | $0.000018 + $0.001596 | $0.000600 | **$0.00221** | 2.9× |
| `qwen3-vl-flash`（≤32K） | 6,010 | キャッシュ未確認 → $0.000311 | $0.000200 | $0.00051〜 | **0.66×** |
| `Qwen/Qwen3.5-9B` (Together) | **32,020** | キャッシュなし → $0.005987 | $0.000125 | **$0.00611** | **8.0×** ⚠️ |
| `claude-haiku-4-5` | 7,840 | $0.000300 + $0.008040 | $0.002500 | **$0.01084** | **14.1×** |

**この試算から分かること**

1. **単価表の安さと実効コストは一致しない。** Together の `Qwen3.5-9B` は入力 $0.17/1M と安く見えるが、**タイル課金が1枚6,404トークン**と極端に重いため、実効では Gemini の **8倍**になる。画像を主役にするアプリでは**画像の課金方式が単価より支配的**。
2. **`gpt-5-nano` が Gemini 2.5 Flash-Lite をわずかに下回る。** 画像トークンは1.7倍重いが、入力単価が半分なので相殺され、むしろ安い。
3. **DeepSeek は時間帯でコストが2.9倍まで振れる。** peak = UTC 01-04時 / 06-10時（平日）= **JST 10:00-13:00 と 15:00-19:00**。食事記録アプリの**ピーク利用時間とほぼ完全に重なる**ため、実効単価は peak 側で見積もるべき。
4. **Claude Haiku 4.5 は Gemini の14倍。** 品質で選ぶモデルであって、コストで選ぶモデルではない。
5. **Gemini 3.x に移るなら `media_resolution: "medium"`（560トークン/枚）を必ず指定する。** 既定の 1,120 のままだと画像コストが倍になる。

---

## 3. キャッシュ割引 (prompt caching)

BodyLoger は**共通の長いシステムプロンプト（数千トークン）を毎回送る**ため、ここが効く。

| プロバイダ / モデル | 方式 | 最小トークン | キャッシュ読み単価 | 割引率 | 書き込みコスト | TTL |
|---|---|---|---|---|---|---|
| **DeepSeek** `deepseek-flash` | 自動 | 未確認 | **$0.003**(off-peak) / $0.006(peak) | **1/50** 🏆 | 追加料金なし | 未確認 |
| **Fireworks** `deepseek-v4-flash-vision-exp` | 自動 | 未確認 | **$0.007**（通常$0.22） | **約97%引** 🏆 | — | 未確認 |
| **OpenAI** `gpt-5-nano` | 自動（既定ON） | GPT-5.6以降=1,024可視トークン | **$0.005**（通常$0.05） | 1/10 | GPT-5.6以降は **1.25×** | **30分**（利用のたび延長）／旧世代5〜10分 |
| **OpenAI** `gpt-5.6-luna` | 同上 | 1,024 | $0.02（通常$0.20） | 1/10 | 1.25× | 30分 |
| **Gemini** `2.5-flash-lite` | **暗黙（既定ON）**＋明示 | 2.5系=**2,048** / 3.x系=**4,096** | **$0.01**（通常$0.10） | 1/10 | — | — |
| Gemini `3.1-flash-lite` | 同上 | 4,096 | $0.025（通常$0.25） | 1/10 | — | — |
| Gemini 明示キャッシュの保管料 | — | — | — | — | **$1.00 / 1M tokens / 時間** | — |
| **Fireworks** `glm-5p3-flash` | 自動 | 未確認 | $0.03（通常$0.15） | 1/5 | — | 未確認 |
| **Together** `MiniMax-M3` | 自動 | 未確認 | $0.06（通常$0.30） | 80%引 | — | 未確認 |
| **Together** `Qwen3.5-9B` | **なし**（キャッシュ単価の公表なし） | — | — | — | — | — |
| **Z.ai** `glm-4.6v-flashx` | あり | 未確認 | $0.004（通常$0.04） | 1/10 | 保管は期間限定無料 | 未確認 |
| **Z.ai** `glm-4.6v` | あり | 未確認 | $0.05（通常$0.30） | 約1/6 | 同上 | 未確認 |
| **Moonshot** `kimi-k2.6` | あり | 未確認 | $0.16（通常$0.95） | 約1/6 | — | 未確認 |
| **Anthropic** `claude-haiku-4-5` | **明示（`cache_control`）** | — | **$0.10**（通常$1.00） | 1/10 | **$1.25（1.25×）** | — |
| **Mistral** 全般 | あり | 未確認 | 「入力コストを最大90%削減」 | 最大90%引 | 未確認 | 未確認 |
| **Groq** gpt-oss系のみ | 自動 | — | 50%引 | 1/2 | なし | 約2時間 |
| **Groq** vision モデル | **対象外** | — | — | — | — | — |
| **xAI** `grok-4.3` / `4.6` | あり | 未確認 | $0.20 / $0.50 | 約1/4 | 未確認 | 未確認 |

### 実装上の注意

- **OpenAI と Gemini は自動キャッシュ**。コード変更なしで効く。ただし**プロンプト先頭からの前方一致**が条件なので、**システムプロンプトを必ず先頭に固定し、日付・体重などユーザー固有の可変値は後ろに置く**こと。ここを間違えるとキャッシュが一切効かない。
- **Gemini 2.5系の暗黙キャッシュ最小は 2,048トークン**。システムプロンプトが数千トークンあるなら条件を満たす。
- **Anthropic は明示的に `cache_control` を打つ必要がある**上に**書き込みが1.25倍課金**。1日数リクエストのユーザーではむしろ割高になる。
- **Anthropic はキャッシュ読みトークンを ITPM レート制限にカウントしない**（Haiku 3.5 を除く）。実効スループットが上がる副次効果。
- **Anthropic: structured outputs のスキーマを変更するとプロンプトキャッシュが無効化される。**
- **OpenAI はキャッシュ対象に画像も含む**が、毎回異なる食事写真なので本アプリでは効かない。

---

## 4. OpenAI 互換エンドポイント一覧（移行容易性の決め手）

| プロバイダ | 互換 | base_url | 画像入力 | `response_format` | 備考 |
|---|---|---|---|---|---|
| **Google Gemini** | ✅ | `https://generativelanguage.googleapis.com/v1beta/openai/` | ✅ `image_url` | ✅ structured outputs | **現行 BodyLoger と同一ホスト。移行コストほぼゼロ**。[出典](https://ai.google.dev/gemini-api/docs/openai) |
| **OpenAI** | ✅ 本家 | `https://api.openai.com/v1/`（日本: `https://jp.api.openai.com/v1/`） | ✅ | ✅ `json_schema` strict | 日本リージョンあり（§5） |
| **DeepSeek** | ✅ | `https://api.deepseek.com` | ✅ | ✅ JSON mode | 公式が「OpenAI/Anthropic 互換フォーマット」と明記 |
| **Mistral** | ✅ | `https://api.mistral.ai/v1` | ✅ | ✅ | 「OpenAI と同じリクエスト構造」。**非対応パラメータの一覧は公式に未記載＝未確認** |
| **xAI** | ✅ | `https://api.x.ai/v1` | ✅ | ✅ `json_schema` / `json_object` | OpenAI SDK をそのまま利用可 |
| **Groq** | ✅ | `https://api.groq.com/openai/v1` | ✅ | ✅ | 非対応: `logprobs`, `logit_bias`, `top_logprobs`, `messages[].name`。`n` は1固定。`temperature=0` は黙って `1e-8` に変換される |
| **Together AI** | ✅ | `https://api.together.ai/v1` | ✅ | ✅ | 非実装: assistants / threads / batch・files API |
| **Fireworks AI** | ✅ | `https://api.fireworks.ai/inference/v1` | ✅ | ✅ `json_object` / `json_schema` / BNF文法 | モデルID形式 `accounts/fireworks/models/<slug>` |
| **OpenRouter** | ✅ | `https://openrouter.ai/api/v1` | ✅ | ⚠️ **プロバイダごとに対応がばらつく**（§10） | ヘッダ `Authorization: Bearer <key>` |
| **Alibaba Qwen** | ✅ | `https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1`（シンガポール） | ✅ | ✅（別ページで確認） | **WorkspaceId がURLに埋まる独特な形式**。素の `dashscope-intl.aliyuncs.com` 形式は未確認 |
| **Moonshot / Kimi** | ✅ | `https://api.moonshot.ai/v1` | ✅ | ✅ | 中国側 `api.moonshot.cn` は未確認 |
| **Z.ai / GLM** | ⚠️ SDK互換 | `https://api.z.ai/api/paas/v4/` → `/chat/completions` | ✅ | ✅（テキストモデルのみ確認） | **パスが `/v1/` ではない**。ただし OpenAI SDK で `base_url` 差し替えのみで動くと公式が明記。非互換: `do_sample=False`(temperature=0) |
| **Anthropic** | ⚠️ **部分的・本番非推奨** | `https://api.anthropic.com/v1/` | ✅ | ❌ **無視される** | 下記 ⚠️ |
| **Amazon Bedrock** (Nova) | ❌ | — | ✅ | ❌ | Chat Completions / Structured outputs ともに「Not Supported」 |

### ⚠️ Anthropic の落とし穴（重要）

OpenAI 互換レイヤーでは以下が**エラーにならず黙って無視される**:

- **`response_format` → JSON が保証されない**（要件3を満たせない）
- `strict`（function calling）→ スキーマ準拠が保証されない
- **prompt caching 非対応** → キャッシュ割引が効かない
- `seed` / `logprobs` / `presence_penalty` / `frequency_penalty` / `reasoning_effort` なども無視

公式自身が「**テスト・比較用であり、ほとんどのユースケースで長期的・本番向けの解ではない**」と明記している。
→ **Anthropic をフォールバック先に入れるなら、OpenAI 互換ではなくネイティブ SDK で別実装が必要。多重化コストが一段高い。**

---

## 5. 可用性・存続リスクの所見

### Google Gemini（現行の依存先）

| 観点 | 所見 |
|---|---|
| 提供形態 | 無料枠 + 従量課金。**残高切れで即全断した実績**（今回の検討の発端） |
| モデル廃止の頻度 | **高い。** `gemini-2.0-flash` / `gemini-2.0-flash-lite` が **2026-06-01 shutdown**、`gemini-3.1-flash-lite-preview` が 2026-05-25。ラインナップも 3.5→3.6→3.7→3.8 Flash と**短期間で4世代**回転 |
| 現行モデルの寿命 | `gemini-2.5-flash` / `gemini-2.5-flash-lite` は **2026-09-15時点で廃止日の告知なし**。当面安全 |
| 告知ポリシー | 「表の日付は**最短の廃止日**であり、実際の日付は事前告知する」。**具体的な告知日数のコミットなし**（Anthropic の60日のような数値保証がない） |
| ⚠️ **無料枠の学習利用** | **公式規約に「無料枠のコンテンツは Google の製品・サービスの提供・改善・開発に利用される」と明記。有料枠は利用されない。** ヘルスケアアプリで**食事写真という個人データを扱う以上、無料枠の本番利用は不可**と判断すべき |
| エンドポイント消失リスク | `generativelanguage.googleapis.com` 自体の廃止告知は**確認できず**。ただし Google Cloud 側は "Gemini Enterprise Agent Platform" へのリブランドが進行中でドキュメントURLが移動している |

出典: [deprecations](https://ai.google.dev/gemini-api/docs/deprecations) / [terms](https://ai.google.dev/gemini-api/terms)

### OpenAI
- 従量課金のみ（**API に無料枠なし**）。Tier は累計支払額で自動昇格。
- モデル数が非常に多く（`gpt-4o-mini` から `gpt-6-astra` まで併存）、**旧モデルを長く残す傾向**。安定性は最高クラス。
- **日本のデータレジデンシーあり**: `jp.api.openai.com`、`/v1/chat/completions` 含む主要エンドポイント対応。ただし **regional *storage* のみで regional *processing* は非対応**（処理自体は国外で行われうる）。[出典](https://developers.openai.com/api/docs/guides/your-data)

### Anthropic
- 従量課金のみ、無料枠なし。**廃止ポリシーが最も明文化: 「公開モデルは最低60日前に通知」**。廃止履歴・予定日が全件一覧化。
- ⚠️ `claude-haiku-4-5-20251001` の tentative retirement が **"Not sooner than October 15, 2026"（本調査日の1ヶ月後）**。実際の廃止通知はまだだが世代交代が近い可能性。
- 廃止頻度自体は Gemini と同程度に速いが、**告知が丁寧で予見可能性が高い**。

### DeepSeek
- 従量課金のみ、無料枠なし。**vision付きで最安クラス**。
- **レート制限が RPM/TPM ではなく「同時接続数」**: `deepseek-flash` = **2,500同時接続**。増枠申請は**無料**。個人アプリなら実質無制限。
- リスク: ①**peak/off-peak で単価2倍**（JSTの食事時間帯が peak 直撃）②中国企業へのヘルスケア個人データ送信の是非は**技術ではなくデータガバナンス判断** ③モデルIDの改名が発生済み（`deepseek-v4-flash` → `deepseek-flash`、旧名は互換受付）

### Alibaba Qwen (Model Studio 国際版)
- **1Mトークン/モデル・90日間の無料枠**（シンガポールリージョン限定、モデルIDごとに独立、未使用でも失効）。
- レート制限が明確: VL系 **1,200 RPM / 1,000,000 TPM**、課金状態と独立にアカウント単位で設定。
- ⚠️ `qwen-vl-max` / `qwen-vl-plus` / `qwen3-vl-*` は**「Legacy models」に分類済み**。廃止スケジュールは未確認。
- ⚠️ **vision モデルは `json_schema` strict 非対応**（`json_object` のみ）。かつ `json_object` 利用時は**システム/ユーザーメッセージに "JSON" という単語を含めることが必須**。

### Z.ai / Zhipu GLM
- **`glm-4.6v-flash` が完全無料**（入力・出力・キャッシュすべて $0）。`glm-4.7-flash` / `glm-4.5-flash` も無料（テキスト）。
- ⚠️ **無料モデルの日次上限の有無が公式に記載なし = 未確認**。本番依存は危険。
- ⚠️ **レート制限がすべて未確認**（ドキュメントがログイン必須ページへリダイレクト）。
- ⚠️ **vision モデルの JSON 対応が未確認**。structured output ページに列挙されているのは `glm-5`/`4.7`/`4.6`/`4.5`（いずれもテキストモデル）のみ。
- パス形式が `/api/paas/v4/` と OpenAI 標準から外れる。

### Moonshot / Kimi
- **無料枠なし。**「累計$5チャージで$5バウチャー」のみ（バウチャーは Tier 昇格に算入されない）。
- ⚠️ **廃止が非常に激しい**: `moonshot-v1-*` 8種が 2026-08-31、`kimi-k2` 系4種が 2026-05-25、`kimi-latest` が 2026-01-28 に廃止済み。**今回調査した全プロバイダ中で最も回転が速い。**
- Tier制（累計チャージ$1〜$3,000）で同時接続数・RPM・TPM が段階的に増加。Tier 0 は **3 RPM / 同時接続1** と実用に耐えない。
- 単価も高い（k2.6 で $0.95/$4.00）。**存続リスク・価格・無料枠すべてで劣後。**

### xAI (Grok)
- 価格は中位。**画像の課金方式が公式に未記載**なのが見積もり上の致命的リスク。無料枠・レート制限も未確認。

### Groq / Together AI / Fireworks AI（ホスティング事業者）

| 項目 | Groq | Together AI | Fireworks AI |
|---|---|---|---|
| vision モデル数 | 2（実質1） | 3 | 5（サーバーレス） |
| 最安 vision | `qwen/qwen3.8-27b` $0.80/$4.00 | `Qwen/Qwen3.5-9B` $0.17/$0.25 | `glm-5p3-flash` $0.15/$0.50 |
| **画像枚数上限** | ⚠️ **3枚（要件2で失格）** | 未確認 | 30枚 |
| 画像課金 | 1枚2,048トークン固定（最も予測しやすい） | ⚠️ 最大6,404トークン/枚（最も高い） | **未確認** |
| 無料枠 | ✅ **30 RPM / 1K RPD / 8K TPM / 200K TPD** | 無料モデル1本のみ（`Prism-ML/Ternary-Bonsai-27B`） | **なし** |
| 有料レート制限 | Developer tier 数値は部分的に未確認 | **公表なし**（「動的に変動」） | **10 RPM**（支払方法未登録）→ **6,000 RPM がアカウント上限**。支出Tierを上げても RPM は上がらない。TPM の公表なし |
| batch 割引 | — | **50%引** | **50%引** |
| キャッシュ | gpt-oss系のみ50%引（**vision は対象外**） | モデル次第（Qwen3.5-9B は**なし**） | **最大97%引**（最良） |
| モデル廃止 | `llama-3.1-8b-instant` / `llama-3.3-70b-versatile` が **2026-06-17 に廃止告知**され "Contact Sales" 化 | — | — |

**共通所見**: ホスティング事業者は**オープンモデルの入れ替わりが激しく、同じモデル名でもホストごとに vision 対応の記載が食い違う**（例: GLM-5.3-Flash を Fireworks は「image input: Yes」、Together は「vision なし」と記載）。**採用するホストの記載を必ず個別に確認し、実測すること。**

### Amazon Bedrock (Nova)
- **唯一「日本国内で推論が完結する geo」が公式にある**: `jp.amazon.nova-2-lite-v1:0` → ap-northeast-1 (東京) / ap-northeast-3 (大阪) に限定ルーティング。**レイテンシとデータレジデンシーの両面で最強。**
- ただし **Structured outputs 非対応・OpenAI互換なし・公式単価が取得できず**。
- モデル寿命が明示: Nova 2 Lite は **"EOL no sooner than 2026-12-02" + legacy period 6ヶ月以上**。

---

## 6. レート制限（公式に数値記載があるもののみ）

### OpenAI（モデルページに明記）
`gpt-5-nano` / `gpt-5.4-nano`:

| Tier | RPM | TPM |
|---|---|---|
| Tier 1 ($5) | 500 | 200,000 |
| Tier 2 ($50) | 5,000 | 2,000,000 |
| Tier 3 ($100) | 5,000 | 4,000,000 |
| Tier 4 ($250) | 10,000 | 10,000,000 |
| Tier 5 ($1,000) | 30,000 | 180,000,000 |

`gpt-5.6-luna` は Tier1 が **500 RPM / 500,000 TPM**、以降同じ。Free ティアは地域要件のみ・月上限$100。

### Anthropic（全ティア明記）
`claude-haiku-4-5`:

| Tier | RPM | 入力TPM | 出力TPM | 月間支出上限 |
|---|---|---|---|---|
| Start | 1,000 | 2,000,000 | 400,000 | $500 |
| Build | 5,000 | 5,000,000 | 1,000,000 | $1,000 |
| Scale | 10,000 | 10,000,000 | 2,000,000 | $200,000 |

**キャッシュ読みトークンは ITPM にカウントされない**ため実効スループットはさらに高い。

### Alibaba Qwen（シンガポール）

| モデル | RPM | TPM |
|---|---|---|
| `qwen-vl-max` / `qwen-vl-plus` / `qwen3-vl-plus` / `qwen3-vl-flash` | 1,200 | 1,000,000 |
| `qwen-flash` / `qwen-turbo` | 600 | 5,000,000 |
| `qwen-plus` | 600 | 1,000,000 |

アカウント単位・**課金状態とは独立**（無料枠でも同じ）。

### Moonshot / Kimi

| Tier | 累計チャージ | 同時接続 | RPM | TPM | TPD |
|---|---|---|---|---|---|
| 0 | $1 | 1 | 3 | 500,000 | 1,500,000 |
| 1 | $10 | 15 | 100 | 2,000,000 | 無制限 |
| 3 | $100 | 50 | 200 | 3,000,000 | 無制限 |
| 5 | $3,000 | 100 | 300 | 5,000,000 | 無制限 |

### Groq（無料枠）

| モデル | RPM | RPD | TPM | TPD |
|---|---|---|---|---|
| `qwen/qwen3.8-27b` | 30 | 1,000 | 8,000 | 200,000 |
| `openai/gpt-oss-120b` / `-20b` | 30 | 1,000 | 8,000 | 200,000 |

有料 Developer tier の数値は部分的に未確認。Flex Processing で同単価のまま10倍のレート制限。

### DeepSeek
RPM/TPM ではなく**同時接続数**: `deepseek-flash` = 2,500、`deepseek-v4-pro` = 500。超過で 429。**増枠申請は無料**。

### Fireworks AI
支払方法未登録 = **10 RPM**。登録＋クレジットありで **6,000 RPM がアカウント全体の上限**（支出 Tier を上げても上がらない固定天井）。**TPM の公表なし。**

### OpenRouter（無料枠）
- 生涯購入額 $0: **20 RPM / 50 RPD**
- 生涯購入額 $10以上: **20 RPM / 1,000 RPD**
- → **50 req/day は本番には使えない。1,000/day でも開発・ステージング止まり。**

### 未確認
- **Google Gemini**: ⚠️ **公式ドキュメントに RPM/TPM/RPD の数値表が存在しない。**「AI Studio で自分の有効レート制限を見よ」という案内のみ。判明しているのは Tier 昇格条件（Free / Tier1=課金紐付け・月$250 / Tier2=$100支払+3日・月$2,000 / Tier3=$1,000支払+30日・月$20,000〜）と Batch API の enqueued token 上限のみ。
- **Mistral**: 無料枠の数値・Tier ごとの RPS/TPM ともに**ログイン必須**（`admin.mistral.ai/plateforme/limits`）。制限軸は RPS / tokens per minute / tokens per month の3軸。Tier 閾値は累計課金額 €20 / €100 / €500 / €2,000。
- **Z.ai / xAI / Together AI**: 未確認（Together は「動的に変動するため固定値は公表しない」と明言）。

---

## 7. JSON 強制出力の方式

| プロバイダ | パラメータ | スキーマ強制 | 制約・注意 |
|---|---|---|---|
| **Gemini** | `response_format` に `mime_type: "application/json"` + `schema`（旧 `responseMimeType`/`responseSchema`） | ✅ | 対応型は string/number/integer/boolean/object/array/null のみ。**大きすぎる・深すぎるスキーマは拒否される**。ツール併用時の structured output は **Gemini 3 系のみ** |
| **OpenAI** | `response_format: {type:"json_schema", strict:true, schema:...}` | ✅ | 簡易版 `json_object` もあるがスキーマ準拠は非保証。`gpt-4o-mini` 以降対応 |
| **Anthropic** | `output_config.format` に `type:"json_schema"`（旧 beta の `output_format` も当面受付） | ✅ GA | **非対応**: 再帰スキーマ、`minimum`/`maximum`、`minLength`/`maxLength`、外部 `$ref`。`additionalProperties:false` 必須。**初回スキーマ利用時に文法コンパイルの追加レイテンシ**（24時間キャッシュ）。**スキーマ変更はプロンプトキャッシュを無効化** |
| **xAI** | `response_format` に `json_schema` / `json_object` | ✅ | Draft 2020-12 / Draft-07。循環参照不可、`maxLength`≤2,048、`maxItems`≤256。`not`・条件分岐は best-effort |
| **DeepSeek** | JSON mode | ✅（両モデル対応と公式明記） | `json_schema` strict 相当かは未確認 |
| **Mistral** | `json_object` / `json_schema`。SDK に `client.chat.parse()`（Pydantic） | ✅ | `json_object` 時は**プロンプト側でも JSON を指示する必要あり**。公式推奨は `json_schema`。**対応モデル一覧は未確認**（Ministral 3 8B のカードには明記あり） |
| **Alibaba Qwen** | `json_object` / `json_schema` | ⚠️ **vision モデルは `json_object` のみ** | `json_object` 使用時は**メッセージ内に "JSON" という単語が必須**。`json_schema` strict は Qwen3.7/3.8 系テキストモデルのみ |
| **Moonshot / Kimi** | `json_object`（全モデル）/ `json_schema` | ✅ | `strict:true` 時は独自の **MFJS**(Moonshot Flavored JSON Schema) 準拠が必要。安定度は k2.7-code > k3 > **k2.6（複雑スキーマで不安定）** |
| **Z.ai / GLM** | `json_object` | ⚠️ | 明示対応が確認できたのは `glm-5`/`4.7`/`4.6`/`4.5`（**テキストモデルのみ**）。**`json_schema` と vision モデルの対応は未確認** |
| **Fireworks** | `json_object` / `json_schema`（Draft 2020-12、再帰`$ref`・`anyOf`/`allOf`/`oneOf` 可）+ **BNF文法モード** | ✅ 最も柔軟 | 公式警告: プロンプトでも JSON を指示しないと**トークン上限まで空白を吐き続けることがある** |
| **Together AI** | `response_format` | ✅ | — |
| **Groq** | JSON Object Mode + JSON Schema Mode | ✅ | — |
| **Amazon Bedrock** (Nova 2 Lite) | ❌ | — | モデルカードで「Not Supported」。tool calling による誘導は可能 |

---

## 8. 推奨順位 — 「日本語 × 画像 × JSON × 安い」

> 日本語品質については**実測していない**ため、以下は公式の多言語対応表明と一般的評価に基づく**推定**であることを明記する。本番採用前に、実際の食事写真50〜100枚で品目・カロリー推定の精度比較を行うべき。

### 🥇 第1位: `gemini-2.5-flash-lite`（現状維持＋有料枠化）— $0.10 / $0.40

**根拠**
- **実効コスト $0.00077/req** と最安クラス。画像トークンも 1,032/枚と効率的（Together の1/6）。
- **コード変更ゼロ。** 現行 BodyLoger がすでにこのエンドポイントを使用。
- キャッシュ読み **$0.01/1M（1/10）が暗黙的に自動で効く**。最小2,048トークンの条件も満たす。
- **JSON強制がスキーマレベルで効く**（`responseSchema`）。
- 廃止アナウンスなし（2026-09-15時点）。画像は**1リクエスト3,600枚**まで対応で要件2に余裕。
- 日本語は Gemini の実績どおり実用水準。

**ただし必須の対応**
1. ⚠️ **無料枠から有料枠へ切り替える。** 規約上、無料枠のデータは Google の製品改善に利用される。ヘルスケアアプリで食事写真を扱うなら**不可**。
2. **残高切れ対策**（今回の全断の直接原因）。請求アラート＋自動チャージ＋§9のフォールバック。
3. **Gemini 3.x への移行は急がない。** 3.6/3.7/3.8 Flash は **2027-01-01 に2倍値上げ確定**で、2.5-flash-lite の7.5〜15倍。移るなら `gemini-3.1-flash-lite` + `media_resolution:"medium"`。

---

### 🥈 第2位: `gpt-5-nano`（フォールバック本命）— $0.05 / $0.40

**根拠**
- **実効コストで Gemini をわずかに下回る（$0.00068/req、0.88×）。** 入力単価 $0.05 は今回の調査で最安クラス。
- vision ✅ / Structured Outputs (`json_schema` strict) ✅ / 400Kコンテキスト を公式モデルページで確認済み。**1リクエスト1,500枚**まで。
- **OpenAI 互換の本家**なので、Gemini の OpenAI 互換エンドポイントから **`baseURL` と `model` を差し替えるだけ**で切り替わる。**多重化の実装コストが最小。**
- キャッシュ $0.005/1M（1/10）が自動。最小1,024トークン。
- **日本リージョン `jp.api.openai.com` が使える**（regional storage）。
- 企業安定性・モデル維持期間ともに最も安心。レート制限も Tier1 で 500 RPM / 200K TPM と十分。

**留意点**: 画像パッチ課金が Gemini の1.7倍重い（単価が半分なので相殺）。API 無料枠がないので切替テストにも課金が発生。

---

### 🥉 第3位: `ministral-8b-2512`（Mistral / 欧州系の第3極）— $0.15 / $0.15

**根拠**
- **入出力が同額 $0.15** という珍しい価格設計。**出力が多いワークロードで極めて有利**（Gemini の出力$0.40 より安い）。
- モデルカードに **vision と structured outputs の両方が明記**されている（Mistral のラインナップ中で最も記載が明確）。
- 256Kコンテキスト。OpenAI 互換 `https://api.mistral.ai/v1`。
- **欧州企業**。中国系を避けたい場合の現実的な第3極。無料枠あり、batch -50%、キャッシュ最大90%引。
- さらに安い `ministral-3b-2512`（$0.10/$0.10、vision ✅）もある。

**ただし降格要因**
- ⚠️ **画像のトークン換算式が公式に未記載** → 実効コストが見積もれない。
- ⚠️ **無料枠・レート制限の数値がログイン必須**で公開されていない。
- ⚠️ 公式ドキュメント間の矛盾が多い（`capabilities/vision` ページが旧世代のまま更新されていない、Small 4 と Ministral 14B の vision 対応がページ間で食い違う）。
- **採用前に実測必須**: 日本語の食品名精度、画像トークン数、レート制限。

---

### 4位: `deepseek-flash` — $0.15〜0.30 / $0.60〜1.20

**根拠**: キャッシュヒット **$0.003/1M**（他社の10〜50分の1）。同時接続2,500で実質レート制限なし。1Mコンテキスト、600枚/req。画像は1枚1,024トークン上限で予測しやすい。

**降格要因**
- ⚠️ **JST の食事時間帯（10-13時、15-19時）がちょうど peak 課金**に重なり、実効単価は $0.30/$1.20 で見るべき → **Gemini の2.9倍**になる。
- ⚠️ **中国企業にヘルスケアの個人データ（食事写真）を送る**判断が必要。**技術ではなく社内データガバナンスの問題**。ここが NG なら即候補外。
- 日本からのレイテンシ実測は未確認。

---

### 5位: `claude-haiku-4-5`（品質重視の保険）— $1.00 / $5.00

**根拠**: 日本語品質は候補中おそらく最上位。曖昧な食材記述の解釈で差が出る可能性。Structured Outputs が GA、**廃止告知が最低60日前と明文化**されており運用の予見可能性が最高。

**降格要因**
- **実効コストが Gemini の14倍**（$0.01084/req）。画像も1,568トークン/枚と重い。
- ⚠️ **OpenAI 互換で `response_format` が無視される** → JSON強制にネイティブSDKの別実装が必要。**多重化コストが一段高い。**
- `claude-haiku-4-5-20251001` の最短廃止日が 2026-10-15（1ヶ月後）。

---

### 注意が必要な「安すぎる」候補

| モデル | 単価 | なぜ第一候補にしないか |
|---|---|---|
| `glm-4.6v-flash`（Z.ai） | **$0 / $0** | **無料は魅力だが**: ①vision での JSON 対応が未確認 ②**日次上限の有無が未確認** ③レート制限が全て未確認 ④画像トークン換算式が未確認 ⑤中国企業。**本番の主系統には据えられないが、「全社ダウン時の最後の受け皿」としては検討価値あり**（無料なので保持コストゼロ） |
| `qwen3-vl-flash`（Alibaba） | $0.05 / $0.40 | 実効コストは最安レベル（0.66×）だが、⚠️ **vision モデルは `json_schema` strict 非対応、`json_object` のみ**。かつ `json_object` 使用時は**メッセージに "JSON" の単語が必須**という独自制約。さらに「Legacy models」分類。**JSON をスキーマで縛りたい本アプリには不向き** |
| `Qwen/Qwen3.5-9B`（Together） | $0.17 / $0.25 | 単価は安いが**タイル課金で1枚6,404トークン** → **実効コストが Gemini の8倍**。Together 自身が「迷ったらこれ」と推奨しているが、**画像が主役のアプリでは選んではいけない典型例** |
| `glm-5p3-flash`（Fireworks） | $0.15 / $0.50 | 1.04Mコンテキスト・キャッシュ5分の1・30枚/req・`json_schema`+BNF と条件は良い。⚠️ **画像のトークン換算式が未公開**で実効コストが読めない。**無料枠なし**、**6,000 RPM のアカウント固定天井**。Together は同じ GLM-5.3-Flash を「vision なし」と記載しており**ホスト間で情報が食い違う** |

---

## 9. 多重化の実装方針（所見）

```
1次:  gemini-2.5-flash-lite   (Google AI Studio・有料枠)
        ↓ 429 / 5xx / 残高切れ / タイムアウト
2次:  gpt-5-nano              (OpenAI 本家、jp.api.openai.com)
        ↓
3次:  ministral-8b-2512       (Mistral・欧州)  ※または deepseek-flash（ガバナンスOKなら）
        ↓
最終: OpenRouter              (§10)
```

**この4つはすべて OpenAI 互換の `/v1/chat/completions`**。したがって

```js
const PROVIDERS = [
  { baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/", model: "gemini-2.5-flash-lite", key: GEMINI_KEY },
  { baseURL: "https://jp.api.openai.com/v1/",                            model: "gpt-5-nano",           key: OPENAI_KEY },
  { baseURL: "https://api.mistral.ai/v1",                                model: "ministral-8b-2512",    key: MISTRAL_KEY },
  { baseURL: "https://openrouter.ai/api/v1",                             model: "...",                  key: OR_KEY },
];
```

のような配列を順に試す**薄いラッパー1つ**で多重化できる。

**実装時の注意**
1. **`response_format` の書式差はアダプタで吸収する。** Gemini/OpenAI/Mistral はほぼ同形だが、Qwen は "JSON" の単語混入が必須、Anthropic は別パラメータ。
2. **キャッシュを効かせるためプロンプト構造を固定する。** システムプロンプトを必ず先頭に、可変値（日付・体重）は末尾に。これを守らないと全プロバイダでキャッシュが効かない。
3. **Anthropic を入れる場合は `@anthropic-ai/sdk` で別経路を用意**（OpenAI互換では JSON 強制が効かない）。
4. **フォールバック時にモデルごとの画像トークン差を考慮する。** 同じ5枚でも Gemini 5,160 / OpenAI 9,000 / Together 32,020 とコストが跳ねる。フォールバック先のコスト上限を監視すること。
5. **リトライ条件**: 429（レート制限）、5xx、タイムアウト、**そして「残高不足エラー」**。今回の全断は残高切れなので、**402/403 系の課金エラーもフォールバック対象に含める**こと。

---

## 10. OpenRouter（自動フォールバック層として）

| 項目 | 内容 | 出典 |
|---|---|---|
| **トークン単価の上乗せ** | **なし。**「各プロバイダの価格をマークアップなしでパススルーしており、直接使うのと同じレートを払う」 | [faq](https://openrouter.ai/docs/faq) |
| **クレジット購入手数料** | **カード 5.5%（最低$0.80）/ 暗号資産 5%** | 同上 |
| リクエスト単位の手数料 | **未確認**（「ない」と明言する記述も見つからず） | — |
| **BYOK 手数料** | **5%**。従量プランは月$25,000相当まで無料、Enterprise は月$200,000まで無料。対応: OpenAI, Anthropic, Amazon Bedrock, Google Vertex AI, Azure, Mistral AI | [byok](https://openrouter.ai/docs/use-cases/byok) |
| **base URL** | `https://openrouter.ai/api/v1/chat/completions` | [api-reference](https://openrouter.ai/docs/api-reference/overview) |
| **モデル単位のフォールバック** | `models: ["a", "b", ...]` 配列 + `route: "fallback"` | [model-fallbacks](https://openrouter.ai/docs/guides/model-fallbacks) |
| **フォールバックの発火条件** | 公式明記: **「コンテキスト長の検証エラー」「モデレーションフラグ」「レート制限」「ダウンタイム」** | 同上 |
| **課金** | **実際に使われたモデルの単価**で課金され、レスポンスの `model` 属性に返る | 同上 |
| **プロバイダ単位のフォールバック** | `provider.order`（順序指定）、**`provider.allow_fallbacks` 既定 `true`**、`provider.sort`（`price`/`throughput`/`latency`）、`provider.ignore`/`only`、`provider.max_price`、`provider.require_parameters`、`provider.data_collection`、`provider.zdr` | [provider-routing](https://openrouter.ai/docs/features/provider-routing) |
| **既定の挙動** | ①直近30秒に障害のないプロバイダを優先 ②残りを**価格の2乗に反比例**する重みで選択 ③優先度を下げたものを自動フォールバックに使用 | 同上 |
| **可用性の公開** | ✅ **プロバイダ別の稼働率を公開。** 応答時間・エラー率・可用性をリアルタイム監視し、モデルページのグラフと **Endpoints API** で取得可能 | [uptime-optimization](https://openrouter.ai/docs/features/uptime-optimization) |
| ステータスページ | **未確認**（docs に URL の記載なし） | — |
| **無料枠** | 生涯購入$0 → **20 RPM / 50 RPD**。$10以上購入 → **20 RPM / 1,000 RPD** | [limits](https://openrouter.ai/docs/api-reference/limits) |

### ⚠️ 採用前に必ず対処すべき2点

**(1) structured outputs の非均一性トラップ**
`response_format: json_schema` の対応は **「モデル単位ではなくプロバイダのエンドポイント単位」で変わる**。同じモデルでもプロバイダAでは通り、プロバイダBでは 400 になる。
→ **`provider.require_parameters: true` を必ず併用する。** これを忘れると、**フォールバックが「スキーマを拒否するエンドポイント」に静かに流れる**という、フォールバック層を入れた目的そのものを裏切る事故が起きる。
対応モデルの絞り込み: `openrouter.ai/models?supported_parameters=structured_outputs`

**(2) プライバシーの既定値**
**`provider.data_collection` の既定は `"allow"`。** ヘルスケアアプリの食事写真を扱う以上、**明示的に `data_collection: "deny"` を設定**し、必要なら `zdr: true`（Zero Data Retention エンドポイント限定）も指定すること。

### 評価

**メリット**: トークン単価にマークアップがないのが最大の利点（実質コストはチャージ時の5〜5.5%のみ）。`allow_fallbacks: true` が既定で**プロバイダ障害時の自動切替が標準装備**。プロバイダ別稼働率が公開されている。

**デメリット**: **OpenRouter 自体が新たな単一障害点になる。** 1社依存を解消するために別の1社に依存する構図。無料枠（50 RPD）は本番に使えない。

**推奨**: **主系統は自前で2〜3社を直接叩く構成にし、OpenRouter は「その先の最終フォールバック」として使う。** 単一障害点を増やさずに可用性だけ上げられる。

---

## 11. 日本からのレイテンシ / 日本リージョン

| プロバイダ | 日本リージョン | 備考 |
|---|---|---|
| **Amazon Bedrock** | ✅ **最強**。`jp.amazon.nova-2-lite-v1:0` が ap-northeast-1(東京) / ap-northeast-3(大阪) に限定ルーティング | ただし Structured outputs 非対応 |
| **OpenAI** | ✅ `jp.api.openai.com`。`/v1/chat/completions` 対応 | **regional storage のみ。regional processing は非対応**＝処理自体は国外で行われうる |
| **Alibaba Qwen** | △ シンガポール (`ap-southeast-1`) が最寄り | 日本リージョンは未確認 |
| **Google Gemini (AI Studio)** | ❌ グローバルエンドポイントのみ | 現状 BodyLoger が使っている構成 |
| **Google Vertex AI** | **未確認**（pricing/locations ページが取得できず） | 要追加調査 |
| Anthropic / DeepSeek / Mistral / xAI / Moonshot / Z.ai / Groq / Together / Fireworks | **未確認** | 公式に日本リージョンの記載を確認できず |

⚠️ **p50 レイテンシは全社について公式データが存在しない。実測が必要。** 要件5（p50で数秒以内）の検証は、候補を2〜3に絞ったうえで**日本国内から実際に叩いて計測する**しかない。

---

## 12. 未確認事項の一覧（要フォロー）

| 項目 | 状況 | 確認方法 |
|---|---|---|
| **Gemini の対話用レート制限**（RPM/TPM/RPD、無料・有料とも） | 公式 docs に数値表なし | AI Studio にログイン（[aistudio.google.com/rate-limit](https://aistudio.google.com/rate-limit)） |
| **Vertex AI の Gemini 単価** / AI Studio と同額か | pricing ページが長大で取得できず | ブラウザで直接確認 |
| **Vertex AI の日本リージョン**（asia-northeast1/2）対応 | 未確認 | 同上 |
| Gemini 3.5 / 3.1 Flash-Lite のコンテキスト長 | pricing ページに記載なし | models ページ |
| **xAI の画像課金方式** | 公式に記載を確認できず | 実測（token usage を見る） |
| xAI の無料枠・レート制限 | 未確認 | — |
| **Amazon Nova / Nova 2 Lite の公式単価** | Bedrock pricing ページから取得できず | AWS コンソール / 料金計算ツール |
| **Mistral の無料枠・レート制限の数値** | ログイン必須 | `admin.mistral.ai/plateforme/limits` |
| **Mistral の画像トークン換算式** | 公式に記載なし | 実測 |
| Mistral Small 4 / Ministral 3 14B の vision 対応 | **公式ページ間で矛盾** | 実測 |
| Mistral の `json_schema` 対応モデル一覧 | FAQ の回答がレンダリングされず | 実測 |
| **Z.ai の全レート制限・`json_schema` 対応・画像換算式・無料モデルの日次上限** | ログイン必須 or 記載なし | `z.ai/manage-apikey/rate-limits` |
| Qwen の各 vision モデルのコンテキスト長 | pricing 表に列がない | — |
| Kimi の画像トークン換算式 | 公式に「estimate tokens API を使え」とのみ | estimate tokens API |
| Kimi `kimi-k2.7-code` 系の vision 対応 | **公式ページ間で矛盾** | 実測 |
| **Fireworks の画像トークン換算式** | 公式に記載なし | 実測 |
| Fireworks の無料クレジット | ブログ記載のみ、公式 quotas ページには無料枠なし | — |
| Groq Developer tier の RPM/TPM | JSレンダリングで取得できず | console.groq.com |
| Together の無料枠 RPM/TPM | 公式に「動的、公表しない」 | — |
| **OpenRouter のモデル別実価格** | 公式 JSON カタログ (`/api/v1/models`) が本環境のフィルタでブロック、openrouter.ai が組織のブラウザポリシーでブロック | **制限のない端末から再取得が必要** |
| OpenRouter の vision リクエスト形式 | docs の該当ページが画像*生成*の説明だった | `/docs/features/multimodal/overview` を要確認 |
| OpenRouter のステータスページ | docs に URL なし | — |
| **各社の日本からの実測 p50 レイテンシ** | **全社未計測**（公式データなし） | **実測必須** |
| **各社の日本語・食品名の精度** | 本調査の範囲外 | **実測必須**（食事写真50〜100枚で比較） |

---

## 付録: 出典URL一覧（すべて 2026-09-15 確認）

**Google Gemini**
- https://ai.google.dev/gemini-api/docs/pricing
- https://ai.google.dev/gemini-api/docs/image-understanding
- https://ai.google.dev/gemini-api/docs/media-resolution
- https://ai.google.dev/gemini-api/docs/openai
- https://ai.google.dev/gemini-api/docs/structured-output
- https://ai.google.dev/gemini-api/docs/caching
- https://ai.google.dev/gemini-api/docs/rate-limits
- https://ai.google.dev/gemini-api/docs/deprecations
- https://ai.google.dev/gemini-api/terms

**OpenAI**
- https://developers.openai.com/api/docs/pricing
- https://developers.openai.com/api/docs/guides/images-vision
- https://developers.openai.com/api/docs/guides/structured-outputs
- https://developers.openai.com/api/docs/guides/prompt-caching
- https://developers.openai.com/api/docs/guides/rate-limits
- https://developers.openai.com/api/docs/guides/your-data
- https://developers.openai.com/api/docs/models/gpt-5-nano
- https://developers.openai.com/api/docs/models/gpt-5.6-luna
- https://developers.openai.com/api/docs/models/gpt-5.4-nano

**Anthropic**
- https://claude.com/pricing
- https://platform.claude.com/docs/en/build-with-claude/vision
- https://platform.claude.com/docs/en/build-with-claude/structured-outputs
- https://platform.claude.com/docs/en/cli-sdks-libraries/libraries/openai-sdk
- https://platform.claude.com/docs/en/api/rate-limits
- https://platform.claude.com/docs/en/about-claude/model-deprecations

**DeepSeek**
- https://api-docs.deepseek.com/quick_start/pricing
- https://api-docs.deepseek.com/
- https://api-docs.deepseek.com/guides/vision
- https://api-docs.deepseek.com/quick_start/rate_limit

**Alibaba Qwen / Model Studio**
- https://www.alibabacloud.com/help/en/model-studio/model-pricing
- https://www.alibabacloud.com/help/en/model-studio/vision-model/
- https://www.alibabacloud.com/help/en/model-studio/qwen-structured-output
- https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope
- https://www.alibabacloud.com/help/en/model-studio/rate-limit
- https://www.alibabacloud.com/help/en/model-studio/new-free-quota

**Moonshot / Kimi**
- https://platform.kimi.ai/docs/pricing/chat （USD）/ https://platform.kimi.com/docs/pricing/chat （CNY）
- https://platform.kimi.ai/docs/models
- https://platform.kimi.ai/docs/guide/use-kimi-vision-model
- https://platform.kimi.ai/docs/guide/response_format
- https://platform.kimi.ai/docs/api/overview
- https://platform.kimi.ai/docs/pricing/limits

**Z.ai / Zhipu GLM**
- https://docs.z.ai/guides/overview/pricing
- https://docs.z.ai/guides/develop/http/introduction
- https://docs.z.ai/guides/develop/openai/python
- https://docs.z.ai/guides/capabilities/struct-output
- https://docs.z.ai/guides/vlm/glm-4.6v

**Mistral**
- https://mistral.ai/pricing/api/
- https://docs.mistral.ai/capabilities/structured_output/custom
- https://docs.mistral.ai/resources/migration-guides
- https://docs.mistral.ai/admin/user-management-finops/tier

**xAI**
- https://docs.x.ai/docs/models
- https://docs.x.ai/docs/guides/image-understanding
- https://docs.x.ai/docs/guides/structured-outputs

**Groq**
- https://console.groq.com/docs/vision
- https://console.groq.com/docs/models
- https://console.groq.com/docs/rate-limits
- https://console.groq.com/docs/prompt-caching
- https://console.groq.com/docs/openai
- https://console.groq.com/docs/deprecations

**Together AI**
- https://docs.together.ai/docs/serverless-models
- https://docs.together.ai/docs/vision-overview
- https://docs.together.ai/docs/rate-limits
- https://docs.together.ai/docs/openai-api-compatibility
- https://www.together.ai/pricing

**Fireworks AI**
- https://docs.fireworks.ai/serverless/pricing
- https://docs.fireworks.ai/guides/querying-vision-language-models
- https://docs.fireworks.ai/guides/quotas_usage/account-quotas
- https://docs.fireworks.ai/structured-responses/structured-response-formatting
- https://docs.fireworks.ai/tools-sdks/openai-compatibility

**OpenRouter**
- https://openrouter.ai/docs/faq
- https://openrouter.ai/docs/features/provider-routing
- https://openrouter.ai/docs/features/model-routing
- https://openrouter.ai/docs/guides/model-fallbacks
- https://openrouter.ai/docs/api-reference/overview
- https://openrouter.ai/docs/api-reference/limits
- https://openrouter.ai/docs/features/uptime-optimization
- https://openrouter.ai/docs/features/structured-outputs
- https://openrouter.ai/docs/use-cases/byok

**Amazon Bedrock**
- https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-2-lite.html
- https://aws.amazon.com/bedrock/pricing/
