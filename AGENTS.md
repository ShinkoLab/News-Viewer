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
| ORM | Prisma 7.x + `@prisma/adapter-better-sqlite3` |
| DB | SQLite（`better-sqlite3` 経由） |
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
    DigestSection.tsx   # ダイジェスト表示カード
    CategorySection.tsx # カテゴリ別カードグリッド
    ArticleCard.tsx     # 個別記事カード
    BackButton.tsx      # 戻るボタン（未使用の可能性あり）
    BatchListItem.tsx   # バッチリストアイテム（未使用の可能性あり）
  lib/
    db.ts               # Prisma クライアントシングルトン
    theme.ts            # MUI テーマ定義（Indigo 500 プライマリカラー）
    format.ts           # 日付フォーマットユーティリティ
  generated/
    prisma/             # Prisma 自動生成クライアント（コミット対象外）
prisma/
  schema.prisma         # DB スキーマ定義
```

## データベーススキーマ

```prisma
model batches {
  id             Int                 @id
  executed_at    DateTime
  total_articles Int
  digest_text    String?
  article_summaries article_summaries[]
}

model article_summaries {
  id             Int      @id
  batch_id       Int
  category       String
  group_id       Int?
  group_topic    String?
  summary_title  String
  summary_text   String
  keywords       String   // JSON 文字列（string[]）
  original_url   String?
  original_title String
  ...
}
```

`keywords` は JSON 文字列。パース時は try/catch で空配列にフォールバックすること。

## 環境変数

`.env.local`（`.env.local.example` を参照）に設定する。

| 変数 | 説明 |
|---|---|
| `DATABASE_URL` | SQLite ファイルパス（例: `file:/data/news.db`） |

## 重要な設計上の注意

### Server Component / Client Component の境界

- **データフェッチは Server Component で行う**。`batches/[id]/page.tsx` が Prisma クエリを実行し、props としてデータを子コンポーネントへ渡す。
- **MUI コンポーネントに関数を props として渡す場合は `"use client"` が必要**。`<Box component={Link}>` のように MUI Client Component に Next.js の `Link` 関数を渡すと "Functions cannot be passed directly to Client Components" エラーになる。該当コンポーネントに `"use client"` を付与して解決する。

### Prisma クライアント

- `src/lib/db.ts` でシングルトンを管理。`DATABASE_URL` 環境変数が必須。
- `better-sqlite3` アダプター経由のため `DATABASE_URL` の `file:` プレフィックスを除去して渡す。

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
