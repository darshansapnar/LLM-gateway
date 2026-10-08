// Programming languages, frameworks, and common product/platform names.
// Used by cacheVerifier.service.js's entity check: if the words that differ
// between two prompts include one of these, the pair always goes to the
// LLM judge, even when embedding similarity is high enough to otherwise
// skip it (e.g. "install React" vs "install Vue" can score 0.95+ despite
// needing a completely different answer).
// Lowercase - matching is case-insensitive.
export const TECH_TERMS = new Set([
  // Languages
  "python", "java", "javascript", "typescript", "ruby", "php", "go", "golang",
  "rust", "kotlin", "swift", "c++", "c#", "scala", "perl", "haskell", "elixir",
  "dart", "r", "matlab", "lua", "clojure",
  // Frontend frameworks/libraries
  "react", "vue", "angular", "svelte", "jquery", "nextjs", "next.js", "nuxt",
  "tailwind", "bootstrap",
  // Backend frameworks
  "express", "django", "flask", "rails", "spring", "laravel", "fastapi", "nestjs",
  // Databases
  "mysql", "postgresql", "postgres", "mongodb", "redis", "sqlite", "oracle",
  "cassandra", "dynamodb", "elasticsearch",
  // Platforms/infra
  "docker", "kubernetes", "aws", "azure", "gcp", "heroku", "vercel", "netlify",
  "linux", "windows", "macos", "ubuntu",
  // Dev tools
  "git", "github", "gitlab", "bitbucket", "npm", "yarn", "webpack", "vite",
]);
