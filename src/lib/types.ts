/** クラスタに属する1記事分の出典。統合カードのソース一覧に並ぶ。 */
export type ArticleSource = {
  id: string;
  originalTitle: string;
  originalUrl: string | null;
  feedTitle: string | null;
};

export type Article = {
  id: string;
  summaryTitle: string;
  summaryText: string;
  keywords: string[];
  /** 代表記事のもの。共有機能が参照する */
  originalUrl: string | null;
  originalTitle: string;
  groupTopic: string | null;
  /**
   * 同じニュースを報じた記事の出典。代表が先頭。
   * 単独記事なら要素1で、カードの見た目も従来どおりになる。
   */
  sources: ArticleSource[];
};

export type CategoryEntry = {
  category: string;
  articles: Article[];
};

export type BatchWithArticles = {
  id: number;
  executedAt: string; // ISO 8601 string — JSON境界を越えるため Date ではなく string
  totalArticles: number;
  digestText: string | null;
  categories: CategoryEntry[];
};

export type BatchesApiResponse = {
  batches: BatchWithArticles[];
  hasMore: boolean;
  nextBefore: string | null;
};

/** 検索結果1件。記事はフィードと同じクラスタ畳み込み済みの形。 */
export type SearchResult = {
  article: Article;
  category: string;
  batchId: number;
  /** 表示と期間絞り込みに使うバッチの実行日時。ISO 8601（JSON境界を越えるため string）。 */
  batchExecutedAt: string;
  /** 0〜1。コサイン類似度にキーワード一致の加点を乗せてクランプした値。 */
  score: number;
  /** keywords の完全一致でヒットしたか。バッジ表示に使う。 */
  matchedKeyword: boolean;
};

export type SearchApiResponse = {
  query: string;
  results: SearchResult[];
  /** ベクトル検索が使えず、キーワード一致だけで返したか。 */
  degraded: boolean;
  /**
   * 結果が不完全な可能性があるか。原因は複数ある:
   * 候補の上限に当たった / キーワード脚が索引未作成で順序を諦めた /
   * バッチ情報を引けなかった。いずれもユーザーには「取りこぼしたかも」としか言えない。
   */
  truncated: boolean;
};
