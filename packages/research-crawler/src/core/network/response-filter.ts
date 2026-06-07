const INSTAGRAM_RESPONSE_MARKERS = [
  "/graphql/query",
  "/api/graphql",
  "/api/v1/",
  "query_hash",
  "doc_id",
  "shortcode",
  "media",
  "user",
  "profile"
];

export function isLikelyInstagramDataResponse(url: string, mimeType = ""): boolean {
  const lowerUrl = url.toLowerCase();
  const lowerMime = mimeType.toLowerCase();
  if (!lowerUrl.includes("instagram.com")) return false;
  if (lowerMime && !lowerMime.includes("json") && !lowerMime.includes("javascript") && !lowerMime.includes("text/plain")) {
    return false;
  }
  return INSTAGRAM_RESPONSE_MARKERS.some((marker) => lowerUrl.includes(marker));
}

export function isLikelyChatGPTDataResponse(url: string, mimeType = ""): boolean {
  const lowerUrl = url.toLowerCase();
  if (!lowerUrl.includes("chatgpt.com") && !lowerUrl.includes("openai.com")) return false;
  return lowerUrl.includes("/backend-api/conversation");
}
