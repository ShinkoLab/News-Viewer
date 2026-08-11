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
    page.tsx            # 最新バッチへリダイレクト
    globals.css         # html/body に height:100% を付与（100vh レイアウト用）
    batches/[id]/
      page.tsx          # バッチ詳細ページ（Server Component）
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
    BackButton.tsx      # 戻るボタン（未使用の可能性あり）
    BatchListItem.tsx   # バッチリストアイテム（未使用の可能性あり）
  lib/
    db.ts               # Firestore クライアントと取得・整形ロジック
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
