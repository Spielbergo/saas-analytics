export type Network = "facebook" | "instagram" | "linkedin";

export type SocialPost = {
  id: string; // network-prefixed so ids can't collide: "fb:123_456", "ig:178…", "li:<hash>"
  network: Network;
  account: string; // display name, e.g. "NorthBooks"
  postedAt: string; // ISO
  text: string;
  url: string | null;
  type: string; // photo, video, reel, carousel, link, text…
  views: number | null; // impressions / views (what the network calls them)
  reach: number | null;
  reactions: number | null; // likes + other reactions
  comments: number | null;
  shares: number | null; // shares / reposts
  saves: number | null;
  clicks: number | null;
  engagements?: number | null; // a network-supplied total, when it gives one instead of a breakdown
  source: "api" | "import" | "manual";
  fetchedAt: string;
};

export type SocialAccount = {
  key: string; // "fb:<page id>" etc.
  network: Network;
  name: string;
  username: string | null;
  followers: number | null;
  posts: number; // how many we hold
  syncedAt: string | null;
  error: string | null;
  insightsNote: string | null; // e.g. which metrics Meta refused
};

export type SocialData = {
  posts: SocialPost[];
  accounts: SocialAccount[];
  syncedAt: string | null;
  configured: { meta: boolean };
  durable: boolean;
};
