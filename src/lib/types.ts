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
};
