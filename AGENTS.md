<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# AI ニュースビューア — プロジェクトガイド

## 概要

AI が収集・要約したニュース記事を閲覧するための Next.js 製 Web アプリ。
バッチごとにニュース要約が蓄積され、カテゴリ別カード一覧 + ダイジェストとして表示する。

## 技術スタック

| レイヤー | ライブラリ / バージョン |
|---|---|
| フレームワーク | Next.js 16.2.3（App Router） |
| UI | MUI v9（Material Design）+ Emotion |
| DB | Firestore（`@google-cloud/firestore` を直接利用。ORM は無し） |
| 言語 | TypeScript 5 / React 19 |
| ビルド | `output: "standalone"`、Turbopack 有効 |
| 環境管理 | mise（`.mise.toml`） |
| コンテナ | Docker / docker-compose |

## ディレクトリ構成

```
src/
  app/
    layout.tsx          # ルートレイアウト（ThemeRegistry をマウント）
    page.tsx            # バッチのフィード（カテゴリ・期間で絞り込み可）
    globals.css         # html/body に height:100% を付与（100vh レイアウト用）
    batches/[id]/
      page.tsx          # バッチ詳細ページ（Server Component）
    search/
      page.tsx          # 検索結果ページ（Server Component、関連度順）
    error.tsx           # エラーバウンダリ
    not-found.tsx       # 404 ページ
  components/
    ThemeRegistry.tsx   # MUI + Emotion SSR セットアップ（Client Component）
    SidebarLayout.tsx   # 2ペインレイアウト（アプリバー + ナビゲーションドロワー）
    BatchSidebar.tsx    # バッチ履歴リスト（ナビゲーションドロワー内容）
    BatchFeed.tsx       # トップの無限スクロール（Client Component）
    BatchExpansionPanel.tsx # フィード内の折りたたみバッチ
    DigestSection.tsx   # ダイジェスト表示カード
    CategoryList.tsx    # カテゴリ一覧 + 一括展開/折りたたみツールバー
    CategorySection.tsx # カテゴリ別カードグリッド
    CategorySortProvider.tsx # 並び順の Context と切り替え UI
    ArticleCard.tsx     # 個別記事カード
    SearchBar.tsx       # アプリバーの検索入力（検索ページ）
    SearchLaunchButton.tsx  # 検索ページへの導線（一覧・詳細ページ）
    SearchResultGrid.tsx    # 検索結果のカードグリッド
    BackButton.tsx      # 戻るボタン（未使用の可能性あり）
    BatchListItem.tsx   # バッチリストアイテム（未使用の可能性あり）
  lib/
    db.ts               # Firestore クライアントと取得・整形ロジック
    search.ts           # ハイブリッド検索（ベクトル kNN + キーワード一致）
    embedding.ts        # 検索語のベクトル化とキャッシュ
    categorySort.ts     # カテゴリ並び順の純粋関数（サーバ/クライアント共用）
    categorySortServer.ts # Cookie と env から並び順を解決（サーバ専用）
    types.ts            # 画面へ渡すデータ型
    theme.ts            # MUI テーマ定義（Indigo 500 プライマリカラー）
    format.ts           # 日付フォーマットユーティリティ
```

## データストア

Firestore を `@google-cloud/firestore` で直接読む（ORM は挟まない）。書き込みは
サマライザ側だけが行い、Viewer は読み取り専用。

| コレクション | 主なフィールド |
|---|---|
| `batches` | `id` / `executed_at` / `total_articles` / `digest_text` |
| `articleSummaries` | `id` / `batch_id` / `category` / `group_id` / `group_topic` / `summary_title` / `summary_text` / `keywords` / `original_url` / `original_title` / `feed_title` |

- `keywords` は配列だが、移行前のデータは JSON 文字列。`mapArticle()` が両方を
  受けて try/catch で空配列にフォールバックする
- `feed_title` は後から追加。持たない記事は URL のホスト名にフォールバックする
- `group_id` / `group_topic` の使い方は「類似記事の統合表示」を参照
- `batches` は `executed_at` で `orderBy` するが、`articleSummaries` には
  `orderBy` を付けず取得後にクライアント側で整列する

## 環境変数

`.env.local`（`.env.local.example` を参照）に設定する。

| 変数 | 説明 |
|---|---|
| `GOOGLE_CLOUD_PROJECT` | Firestore のあるプロジェクト |
| `FIRESTORE_DATABASE` | データベース ID（既定 `(default)`） |
| `FIRESTORE_EMULATOR_HOST` | エミュレータ利用時のみ |
| `CATEGORY_ORDER` | カテゴリの既定表示順（カンマ区切り）。「カテゴリの表示順」を参照 |
| `EMBEDDING_BASE_URL` | 検索語を embedding する OpenAI 互換エンドポイント |
| `LLM_EMBEDDING_MODEL` | embedding モデル ID。**サマライザと一致必須** |
| `EMBEDDING_DIMENSION` | 期待する次元数（既定 1536）。不一致を検知するためだけに使う |
| `EMBEDDING_API_KEY` | 上記エンドポイントの API キー |

`EMBEDDING_*` が未設定でも壊れない。意味検索だけが無効になり、キーワード一致に縮退する。

## 重要な設計上の注意

### Server Component / Client Component の境界

- **データフェッチは Server Component で行う**。`batches/[id]/page.tsx` が Firestore を読み、props としてデータを子コンポーネントへ渡す。
- **MUI コンポーネントに関数を props として渡す場合は `"use client"` が必要**。`<Box component={Link}>` のように MUI Client Component に Next.js の `Link` 関数を渡すと "Functions cannot be passed directly to Client Components" エラーになる。該当コンポーネントに `"use client"` を付与して解決する。

### Firestore クライアント

- `src/lib/db.ts` でシングルトンを管理。開発時は `globalThis` に載せて HMR での再生成を防ぐ。
- Route Handler と Server Component で `@google-cloud/firestore` が別バンドルとして
  重複ロードされ、`Timestamp` の `instanceof` が false になることがある。日付判定は
  `asDate()` のように `toDate` の有無で行う（dual package hazard 対策）。

### カテゴリの表示順

**定義元は `News-Summarizer/categories.yaml` ただ1つ。Viewer にカテゴリ名を書かないこと。**
本番では `News-Summarizer/infra/main.tf` が同ファイルを `yamldecode` し、Viewer の
Cloud Run サービスへ `CATEGORY_ORDER`（カンマ区切り）として注入する。

- `src/lib/categorySort.ts` — `sortCategories()` と純粋関数群。サーバとクライアントが
  **同じ比較関数**を使うので、初回描画でハイドレーション不整合が起きない
- `src/lib/categorySortServer.ts` — Cookie（`category_sort`）と `CATEGORY_ORDER` から
  `CategorySort` を解決する。`next/headers` を import しているためサーバ専用
- 並び順は `definition`（既定・定義順）/ `count`（実記事数の多い順）/ `name`（名前順）。
  定義順で未定義のカテゴリ（`未分類` 等）は末尾に回す。これはサマライザ側の
  ダイジェスト生成（`summarizer/digest.py`）と同じ規則
- `CATEGORY_ORDER` 未設定なら定義順は名前順へ縮退する。ローカル開発でも壊れない
- ユーザーの選択は **Cookie** に持つ。サーバ側で並べ替えてから返せるので初回描画の
  ちらつきが出ない（`localStorage` は SSR 時に読めないため不可）。書き込みは
  `CategorySortProvider` がクライアントで `document.cookie` に行う
- 切り替え UI は**1ページに1つだけ**。バッチ詳細は `CategoryList` の
  `showSortControl`、フィードは `BatchFeed` がページ単位で持つ。フィードには
  `CategoryList` がバッチの数だけ並ぶため、状態は Context で共有する
- **ダイジェスト本文は並べ替えられない**。`digest_text` はサマライザが定義順で生成した
  一枚のテキストなので、`count` / `name` を選ぶと上のダイジェストと下のカードの並びが
  食い違う。既定を `definition` にすることで通常時は一致する

### 類似記事の統合表示

サマライザは取得ソースの違う同じニュースを embedding でクラスタリングし、
`group_id` / `group_topic` を各記事に振って保存する。**記事レコード自体は統合されない**ので、
Viewer が畳まないと同じニュースが記事の数だけカードとして並ぶ。

- `hydrateBatches()`（`src/lib/db.ts`）が `(batchId, category, groupId)` 単位で
  `ArticleRecord[]` にまとめ、`collapseCluster()` が1件の `Article` に畳む。
  `sources` に全メンバーの出典が入る（代表が先頭、単独記事なら要素1）
- **`groupId === null` は畳まない**。グルーピング失敗時のフォールバック値であり、
  null どうしは無関係な記事。キーに記事 id を混ぜて必ず単独クラスタにする
- 代表は要約本文が最も長いもの、同点は id 昇順。実行ごとに表示が入れ替わらないよう決定的にする
- `ArticleCard` は `sources.length === 1` のとき従来の見た目を保ち、
  複数のときだけ折りたたみのソース一覧に切り替える
- `feedTitle` は後から追加したフィールド。持たない記事は URL のホスト名にフォールバックする
- `CategorySection` の件数バッジはカード枚数ではなく**実記事数**（`sources.length` の合計）

クラスタは「カテゴリ → group」で階層化されるため、カテゴリが割れているとクラスタも割れる。
これはサマライザ側の `unify_group_categories()` が揃えている前提で、Viewer では補正しない。

### セマンティック検索

`keywords` は LLM が自由に生成するので表記ゆれが避けられず、完全一致だけでは検索にならない。
サマライザが保存した記事ベクトル（`articleSummaries.embedding`）に対する kNN と、
キーワード完全一致を合流させたハイブリッドで引く。

- **`embedding` は Firestore の `Vector` 型でなければならない。** 素の `array<double>` の
  ドキュメントは `findNearest` から**エラーなしで黙って除外される**。サマライザ側の
  `outputs/firestore_database.py` が `Vector()` で包み、既存データは
  `scripts/backfill_embedding_vectors.py` で変換済み
- **embedding モデルはサマライザと一致していなければならない。** ズレてもAPIは成功し
  kNN も結果を返すが、中身は無関係な記事になる（例外もログも出ない）。定義元は
  `News-Summarizer/infra/variables.tf` ただ1つで、Job と Viewer の両方へ同じ変数から
  注入される。`CATEGORY_ORDER` と同じ単一定義元の考え方
- 距離は **COSINE**。サマライザのクラスタリング（`grouper.py` の `metric="cosine"`）と
  同じ単位にして、`1 - distance` をそのまま「一致度」として表示できるようにする
- **期間は事後フィルタ**。`findNearest` は不等式の事前フィルタを受け付けない。
  加えて `batch_id` は epoch ミリ秒だが、SQLite から移行した過去バッチだけは連番なので
  範囲比較に使えない。バッチを結合してから `executed_at` で絞る
- **カテゴリは事前フィルタ**（等価なので可）。`category ASC + embedding VECTOR` の
  複合ベクトルインデックスが要る
- **部分一致はサーバ側でできない**。Firestore の文字列検索は前方一致の範囲クエリだけで、
  語が文中に現れる日本語では役に立たない。ベクトル脚とキーワード脚で集めた
  **候補集合に対してのみ**メモリ上で評価するので、候補の外にある部分一致は拾えない
- **エミュレータは `findNearest` 非対応**。`FIRESTORE_EMULATOR_HOST` が設定されていれば
  直近500件を読んで JS でコサイン距離を計算する総当たり経路に落ちる。本番では通らない
- インデックス作成中やキー未設定でもページを落とさない。各脚は個別に try/catch して
  縮退し、UI には「キーワード一致のみ」と出す
- 並び順の切り替え UI は載せない。結果は関連度順のフラットな並びで、
  カテゴリ単位の並べ替えという概念が無い

### テーマ（Android L / Material Design 1 スタイル）

- プライマリカラー: Indigo 500 (`#3F51B5`)、ダーク: `#303F9F`
- セカンダリカラー: Pink A200 (`#FF4081`)
- コンテンツ背景: Grey 100 (`#F5F5F5`)
- `shape.borderRadius: 2`（カードの角丸を最小限に）
- カードの影: elevation 1 = `0 1px 3px rgba(0,0,0,0.12)...`

### レスポンシブグリッド

記事カードは MUI `sx` のブレークポイントオブジェクトで制御する:

```tsx
gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", lg: "1fr 1fr 1fr" }
```

### ナビゲーションドロワー

`SidebarLayout` がハンバーガーボタンの開閉状態を管理。デフォルトは **閉じた状態**。
幅は `width: open ? 240 : 0` の CSS transition でアニメーション。

## 開発コマンド

```bash
npm run dev      # 開発サーバー起動（Turbopack）
npm run build    # プロダクションビルド
npx tsc --noEmit # 型チェック
```

## コーディング規約

- コンポーネントの props 型は `type Props = {...}` で定義（interface は使わない）
- Server Component はデフォルト。インタラクションや MUI Client Component への関数 props が必要な場合のみ `"use client"` を付与する
- スタイリングは MUI `sx` prop のみ使用。CSS Modules や別途 CSS ファイルは使わない
- 日本語 UI テキストはコンポーネント内にハードコード（i18n ライブラリなし）
