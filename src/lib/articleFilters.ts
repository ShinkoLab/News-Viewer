export const ARTICLE_PERIODS = ["all", "1d", "3d", "7d", "30d"] as const;

export type ArticlePeriod = (typeof ARTICLE_PERIODS)[number];

export type ArticleFilters = {
  category: string | null;
  period: ArticlePeriod;
};

export const DEFAULT_ARTICLE_FILTERS: ArticleFilters = {
  category: null,
  period: "all",
};

const PERIOD_DAYS: Partial<Record<ArticlePeriod, number>> = {
  "1d": 1,
  "3d": 3,
  "7d": 7,
  "30d": 30,
};

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function parseArticleFilters(params: {
  category?: string | string[];
  period?: string | string[];
}): ArticleFilters {
  const rawCategory = firstValue(params.category)?.trim();
  const rawPeriod = firstValue(params.period);

  return {
    category: rawCategory || null,
    period: ARTICLE_PERIODS.includes(rawPeriod as ArticlePeriod)
      ? (rawPeriod as ArticlePeriod)
      : DEFAULT_ARTICLE_FILTERS.period,
  };
}

export function periodStart(period: ArticlePeriod, now = new Date()): Date | undefined {
  const days = PERIOD_DAYS[period];
  if (!days) return undefined;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

/** 検索ページの状態。`q` が主題で、カテゴリ・期間はその絞り込み。 */
export type SearchFilters = ArticleFilters & { q: string };

export function parseSearchParams(params: {
  q?: string | string[];
  category?: string | string[];
  period?: string | string[];
}): SearchFilters {
  return {
    ...parseArticleFilters(params),
    q: (firstValue(params.q) ?? "").trim(),
  };
}
