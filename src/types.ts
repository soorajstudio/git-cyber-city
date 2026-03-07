// src/types.ts
export interface ContributionDay {
  date: string;
  count: number;
  level: number;
}

export interface GitHubData {
  total: {
    [year: string]: number;
    lastYear: number;
  };
  contributions: ContributionDay[];
}