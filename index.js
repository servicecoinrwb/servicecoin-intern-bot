// Intern Bot for Service Coin DAO – Tweets ecosystem stats, live RWA news, and auto-generated charts with dual-layer yield awareness

const { TwitterApi } = require('twitter-api-v2');
const cron = require('node-cron');
const { ethers } = require('ethers');
const Parser = require('rss-parser');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Initialize Twitter client
const client = new TwitterApi({
  appKey: process.env.TWITTER_APP_KEY,
  appSecret: process.env.TWITTER_APP_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_SECRET,
});

// Initialize Ethereum provider for Arbitrum
const provider = new ethers.JsonRpcProvider(process.env.ARBITRUM_RPC_URL, {
  name: 'arbitrum',
  chainId: 42161
});

// Disable ENS resolution (since Arbitrum does not support it)
provider.resolveName = async () => null;
provider.lookupAddress = async () => null;

// ABIs for contract interaction
const stakingVaultAbi = require('./abis/SREVStakingVault.json');
const investorVaultAbi = require('./abis/InvestorVault.json');
const rewardDistributorAbi = require('./abis/TimeBasedRewardDistributor.json');
const yieldVaultAbi = require('./abis/YieldVault.json');
const srvTokenAbi = require('./abis/SRVToken.json');
const srevTokenAbi = require('./abis/SREVToken.json');

// Contract instances
const stakingVault = new ethers.Contract(process.env.SREV_VAULT_ADDRESS, stakingVaultAbi, provider);
const investorVault = new ethers.Contract(process.env.INVESTOR_VAULT_ADDRESS, investorVaultAbi, provider);
const rewardDistributor = new ethers.Contract(process.env.REWARD_DISTRIBUTOR_ADDRESS, rewardDistributorAbi, provider);
const yieldVault = new ethers.Contract(process.env.YIELD_VAULT_ADDRESS, yieldVaultAbi, provider);
const srvToken = new ethers.Contract(process.env.SRV_TOKEN_ADDRESS, srvTokenAbi, provider);
const srevToken = new ethers.Contract(process.env.SREV_TOKEN_ADDRESS, srevTokenAbi, provider);

// RSS Parser instance
const parser = new Parser();

/**
 * Fetches a random RWA (Real World Asset) related headline from rwa.xyz feed.
 * @returns {Promise<string|null>} A formatted headline string or null if an error occurs or no relevant item is found.
 */
async function fetchRwaHeadline() {
  try {
    const feed = await parser.parseURL('https://rwa.xyz/feed.xml');
    // Filter items for RWA or token-related news
    const items = feed.items.filter(i =>
      i.title.toLowerCase().includes('rwa') || i.title.toLowerCase().includes('token')
    );
    if (!items.length) return null;
    // Select a random headline
    const headline = items[Math.floor(Math.random() * items.length)];
    return `RWA news: ${headline.title} (${headline.link})`;
  } catch (err) {
    console.error("Failed to fetch RWA news:", err.message);
    return null;
  }
}

/**
 * Fetches various statistics from the smart contracts.
 * @returns {Promise<object|null>} An object containing formatted stats and raw values, or null on error.
 */
async function fetchStats() {
  try {
    const [vaultTotals, rewardPool, feesAccumulated, srevTotal] = await Promise.all([
      investorVault.getVaultTotals(),
      rewardDistributor.viewRewardPoolBalance(),
      yieldVault.getVaultBalance(),
      srevToken.totalSupply()
    ]);

    // Format numbers for display
    const manualBuybackTotal = parseFloat(process.env.MANUAL_BUYBACK_TOTAL || 0);
    const formattedSrevTotal = ethers.formatUnits(srevTotal, 18);
    const formattedVaultUSDC = ethers.formatUnits(vaultTotals.totalUSDC, 6);
    const formattedRewardPool = ethers.formatUnits(rewardPool, 6);
    const formattedFeesAccumulated = ethers.formatUnits(feesAccumulated, 6);

    return {
      buybackTotal: `$${manualBuybackTotal.toFixed(2)}`,
      srevSupply: `${formattedSrevTotal} SREV in circulation`,
      vaultUSDC: `$${formattedVaultUSDC} in Investor Vault`,
      rewardPoolUSDC: `$${formattedRewardPool} in SREV rewards`,
      rwaFeesUSDC: `$${formattedFeesAccumulated} in Yield Vault`,
      raw: { // Raw numbers for chart generation
        buybacks: manualBuybackTotal,
        vault: parseFloat(formattedVaultUSDC),
        rwa: parseFloat(formattedFeesAccumulated)
      }
    };
  } catch (e) {
    console.error("Error fetching contract data:", e.message);
    return null;
  }
}

/**
 * Generates a tweet message.
 * @param {object} stats - The statistics object from fetchStats.
 * @returns {Promise<object>} An object containing the tweet text and the raw stats.
 */
async function generateTweet(stats) {
  const messages = [
    `SREV supply: ${stats.srevSupply}\n${stats.rewardPoolUSDC} in USDC rewards`,
    `Investor vault now holds ${stats.vaultUSDC}. RWA system streaming ${stats.rwaFeesUSDC}.`,
    `SRV buybacks: ${stats.buybackTotal}. Vaults funded. Yield flowing.`,
    `Service Coin: staking + real world business = ${stats.rewardPoolUSDC} in rewards.`
  ];

  // Occasionally include an RWA news headline
  if (Math.random() < 0.3) { // 30% chance
    const rwaNews = await fetchRwaHeadline();
    if (rwaNews) return { text: rwaNews, stats: stats.raw }; // Pass raw stats along
  }

  const message = messages[Math.floor(Math.random() * messages.length)];
  return { text: message, stats: stats.raw }; // Pass raw stats along
}

/**
 * Generates a chart image using QuickChart.io.
 * @param {object} rawStats - The raw statistics for the chart.
 * @returns {Promise<string|null>} The file path to the generated image, or null on error.
 */
async function generateChartImage(rawStats) {
  const chartConfig = {
    type: 'bar',
    data: {
      labels: ['Buybacks', 'Vault', 'RWA'],
      datasets: [
        {
          label: 'USD Value',
          backgroundColor: ['#F97316', '#FFEBD6', '#000000'], // Orange, Light Orange, Black
          data: [rawStats.buybacks, rawStats.vault, rawStats.rwa]
        }
      ]
    },
    options: {
      plugins: {
        legend: { display: false },
        title: { display: true, text: 'Service Coin Yield Engine' }
      },
      backgroundColor: '#ffffff' // White background for the chart
    }
  };

  const chartUrl = `https://quickchart.io/chart?width=500&height=300&c=${encodeURIComponent(
    JSON.stringify(chartConfig)
  )}`;
  const imageDir = path.resolve(__dirname, 'images');
  const imagePath = path.resolve(imageDir, 'auto_chart.png');

  // Ensure the images directory exists
  if (!fs.existsSync(imageDir)) {
    fs.mkdirSync(imageDir, { recursive: true });
  }

  try {
    const response = await axios.get(chartUrl, { responseType: 'stream' });
    const writer = fs.createWriteStream(imagePath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => resolve(imagePath));
      writer.on('error', (err) => {
        console.error("Chart image stream writer error:", err.message);
        reject(err);
      });
    });
  } catch (e) {
    console.error("Chart image generation failed:", e.message);
    return null;
  }
}

/**
 * Main function to fetch stats, generate content, and tweet.
 */
const tweet = async () => {
  console.log("Fetching stats...");
  const stats = await fetchStats();
  if (!stats) {
    console.log("Failed to fetch stats. Skipping tweet.");
    return;
  }

  console.log("Generating tweet content...");
  // generateTweet now returns an object { text: "tweet text", stats: rawStatsObject }
  const tweetContent = await generateTweet(stats);
  const textToTweet = tweetContent.text;
  const rawStatsForChart = tweetContent.stats; // Use the raw stats returned by generateTweet

  let mediaId = null;
  console.log("Generating chart image...");
  const imagePath = await generateChartImage(rawStatsForChart);

  if (imagePath) {
    console.log("Uploading chart image to Twitter...");
    try {
      mediaId = await client.v1.uploadMedia(imagePath);
      console.log("Chart image uploaded, Media ID:", mediaId);
    } catch (err) {
      console.error("Failed to upload chart image:", err.message);
    }
  } else {
    console.log("No chart image generated or an error occurred.");
  }

  console.log("Sending tweet...");
  try {
    if (mediaId) {
      await client.v2.tweet({ text: textToTweet, media: { media_ids: [mediaId] } });
    } else {
      await client.v2.tweet(textToTweet);
    }
    console.log("✅ Tweeted:", textToTweet);
  } catch (e) {
    console.error("❌ Tweet failed:", e.message); // Using e.message for a cleaner log
  }
};

// Schedule the tweet function to run every 8 hours
cron.schedule('0 */8 * * *', () => {
  console.log("🔁 Running scheduled tweet...");
  tweet();
});

// Run the tweet function once on startup
tweet();

console.log("✅ Intern bot started and cron is scheduled.");
