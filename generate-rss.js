const fs = require("fs");
const axios = require("axios");
const cheerio = require("cheerio");
const RSS = require("rss");

const baseURL = "https://observerbd.com";
const flareSolverrURL = process.env.FLARESOLVERR_URL || "http://localhost:8191";

const FEEDS = [
  {
    url: "https://observerbd.com/menu/246",
    title: "The Daily Observer – Opinion",
    description: "Latest opinion pieces from The Daily Observer",
    filename: "observer_opinion.xml",
  },
  {
    url: "https://observerbd.com/menu/199",
    title: "The Daily Observer – Editorial",
    description: "Latest editorials from The Daily Observer",
    filename: "observer_editorial.xml",
  },
];

fs.mkdirSync("./feeds", { recursive: true });

// ===== DATE PARSING =====
function parseItemDate(raw) {
  if (!raw || !raw.trim()) return new Date();
  const trimmed = raw.trim();

  const relMatch = trimmed.match(/^(\d+)\s+(minute|hour|day)s?\s+ago$/i);
  if (relMatch) {
    const n    = parseInt(relMatch[1], 10);
    const unit = relMatch[2].toLowerCase();
    const ms   = unit === "minute" ? n * 60_000
               : unit === "hour"   ? n * 3_600_000
               :                     n * 86_400_000;
    return new Date(Date.now() - ms);
  }

  const d = new Date(trimmed);
  if (!isNaN(d.getTime())) return d;

  console.warn(`⚠️  Could not parse date: "${trimmed}" — using now()`);
  return new Date();
}

// ===== FLARESOLVERR =====
async function fetchWithFlareSolverr(url) {
  console.log(`Fetching ${url} via FlareSolverr...`);
  const response = await axios.post(
    `${flareSolverrURL}/v1`,
    { cmd: "request.get", url, maxTimeout: 60000 },
    { headers: { "Content-Type": "application/json" }, timeout: 65000 }
  );
  if (response.data?.solution) {
    console.log("✅ FlareSolverr successfully bypassed protection");
    return response.data.solution.response;
  }
  throw new Error("FlareSolverr did not return a solution");
}

// ===== SCRAPE OBSERVER =====
// Selectors confirmed from live HTML:
//   container : div.inner
//   title+link: div.title_inner a
//   thumbnail : img.iborder   (first img inside each div.inner)
//   intro     : span[style*="color: #222"]   (teaser text)
//   author    : div.credit span i a
function scrapeObserver($) {
  const items = [];

  $("div.inner").each((_, el) => {
    const $el = $(el);

    const $titleLink = $el.find("div.title_inner a").first();
    const title = $titleLink.text().trim();
    const href  = $titleLink.attr("href");
    if (!title || !href) return;

    const link = href.startsWith("http") ? href : baseURL + href;

    const rawThumb = $el.find("img.iborder").first().attr("src") || "";
    const thumbnail = rawThumb.startsWith("http") ? rawThumb
                    : rawThumb ? baseURL + rawThumb
                    : "";

    const author = $el.find("div.credit span i a").text().trim();
    const intro  = $el.find("span[style*='color: #222']").first().text().trim()
                || $el.find("span[style*='color:#222']").first().text().trim();

    items.push({ title, link, thumbnail, author, intro, date: new Date() });
  });

  return items;
}

// ===== GENERATE ONE FEED =====
async function generateFeed({ url, title, description, filename }) {
  try {
    const html  = await fetchWithFlareSolverr(url);
    const $     = cheerio.load(html);
    const items = scrapeObserver($);

    console.log(`Found ${items.length} articles for ${filename}`);

    const feed = new RSS({
      title,
      description,
      feed_url: url,
      site_url: baseURL,
      language: "en",
      pubDate:  new Date().toUTCString(),
    });

    const list = items.length > 0 ? items : [{
      title:     "No articles found",
      link:      url,
      intro:     "RSS feed could not scrape any articles.",
      author:    "",
      date:      new Date(),
      thumbnail: "",
    }];

    list.slice(0, 20).forEach(item => {
      const isPlaceholder = item.thumbnail.includes("no-image") || !item.thumbnail;
      feed.item({
        title:       item.title,
        url:         item.link,
        description: item.intro || (item.author ? `By ${item.author}` : ""),
        author:      item.author || undefined,
        date:        item.date,
        ...(isPlaceholder ? {} : { enclosure: { url: item.thumbnail, type: "image/jpeg" } }),
      });
    });

    fs.writeFileSync(`./feeds/${filename}`, feed.xml({ indent: true }));
    console.log(`✅ ${filename} written with ${list.length} items.`);

  } catch (err) {
    console.error(`❌ Error generating ${filename}:`, err.message);

    const feed = new RSS({
      title:       `${title} (error fallback)`,
      description: "RSS feed could not scrape, showing placeholder",
      feed_url:    url,
      site_url:    baseURL,
      language:    "en",
      pubDate:     new Date().toUTCString(),
    });
    feed.item({
      title:       "Feed generation failed",
      url:         baseURL,
      description: "An error occurred during scraping.",
      date:        new Date(),
    });
    fs.writeFileSync(`./feeds/${filename}`, feed.xml({ indent: true }));
  }
}

// ===== MAIN =====
async function main() {
  for (const feedConfig of FEEDS) {
    await generateFeed(feedConfig);
  }
}

main();
