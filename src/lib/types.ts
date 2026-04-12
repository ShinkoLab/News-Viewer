export type Article = {
  id: number;
  summaryTitle: string;
  summaryText: string;
  keywords: string[];
  originalUrl: string | null;
  originalTitle: string;
  groupTopic: string | null;
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
