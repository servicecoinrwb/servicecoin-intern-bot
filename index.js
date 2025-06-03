// Intern Bot for Service Coin DAO – Tweets ecosystem stats, live RWA news, and auto-generated charts with dual-layer yield awareness

const { TwitterApi } = require('twitter-api-v2');
const cron = require('node-cron');
const { ethers } = require('ethers');
const Parser = require('rss-parser');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Twitter client setup
const client = new TwitterApi({
  appKey: process.env.TWITTER_APP_KEY,
  appSecret: process.env.TWITTER_APP_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_SECRET,
});

// Ethereum provider
const provider = new ethers.JsonRpcProvider(process.env.ARBITRUM_RPC_URL);

// Inline ABIs (insert actual ABI arrays from each contract)
const stakingVaultAbi = [/* ... SREVStakingVault ABI ... */];
const investorVaultAbi = [/* ... InvestorVault ABI ... */];
const rewardDistributorAbi = [/* ... TimeBasedRewardDistributor ABI ... */];
const yieldVaultAbi = [/* ... YieldVault ABI ... */];

// Contract addresses
const stakingVault = new ethers.Contract(process.env.SREV_VAULT_ADDRESS, stakingVaultAbi, provider);
const investorVault = new ethers.Contract(process.env.INVESTOR_VAULT_ADDRESS, investorVaultAbi, provider);
const rewardDistributor = new ethers.Contract(process.env.REWARD_DISTRIBUTOR_ADDRESS, rewardDistributorAbi, provider);
const yieldVault = new ethers.Contract(process.env.YIELD_VAULT_ADDRESS, yieldVaultAbi, provider);

// RSS setup
const parser = new Parser();

async function fetchRwaHeadline() {
  try {
    const feed = await parser.parseURL('https://rwa.xyz/feed.xml');
    const items = feed.items.filter(i => i.title.toLowerCase().includes('rwa') || i.title.toLowerCase().includes('token'));
    if (!items.length) return null;
    const headline = items[Math.floor(Math.random() * items.length)];
    return `RWA news: ${headline.title} (${headline.link})`;
  } catch (err) {
    console.error("Failed to fetch RWA news:", err);
    return null;
  }
}

async function fetchStats() {
  try {
    const [totalStaked, vaultTotals, rewardPool, feesAccumulated] = await Promise.all([
      stakingVault.totalSupply(),
      investorVault.getVaultTotals(),
      rewardDistributor.viewRewardPoolBalance(),
      yieldVault.getVaultBalance()
    ]);

    return {
      buybackTotal: `$${parseFloat(process.env.MANUAL_BUYBACK_TOTAL).toFixed(2)}`,
      stakedSRV: `${ethers.formatUnits(totalStaked, 18)} SRV staked`,
      vaultUSDC: `$${ethers.formatUnits(vaultTotals.totalUSDC, 6)} in Investor Vault`,
      rewardPoolUSDC: `$${ethers.formatUnits(rewardPool, 6)} in rewards`,
      rwaFeesUSDC: `$${ethers.formatUnits(feesAccumulated, 6)} in Yield Vault`,
      raw: {
        buybacks: parseFloat(process.env.MANUAL_BUYBACK_TOTAL),
        vault: parseFloat(ethers.formatUnits(vaultTotals.totalUSDC, 6)),
        rwa: parseFloat(ethers.formatUnits(feesAccumulated, 6))
      }
    };
  } catch (e) {
    console.error("Error fetching contract data:", e);
    return null;
  }
}

async function generateTweet(stats) {
  const messages = [
    `SREV vault earning. ${stats.stakedSRV} earning USDC. Rewards: ${stats.rewardPoolUSDC}.`,
    `Investor layer: ${stats.vaultUSDC} deployed. RWA returns: ${stats.rwaFeesUSDC}.`,
    `SRV buybacks YTD: ${stats.buybackTotal}. Both vaults funded weekly.`,
    `Retail stakers + DAO investors = real yield loop. 🔄`,
    `SREV + RWA layers in sync. Real rewards paid.`,
    `Buyback + vault strategy → ${stats.buybackTotal} recirculated.`
  ];

  if (Math.random() < 0.4) {
    const rwaNews = await fetchRwaHeadline();
    if (rwaNews) return { text: rwaNews, stats };
  }
  const message = messages[Math.floor(Math.random() * messages.length)];
  return { text: message, stats };
}

async function generateChartImage(rawStats) {
  const chartConfig = {
    type: 'bar',
    data: {
      labels: ['Buybacks', 'Vault', 'RWA'],
      datasets: [
        {
          label: 'USD Value',
          backgroundColor: ['#F97316', '#FFEBD6', '#000000'],
          data: [rawStats.buybacks, rawStats.vault, rawStats.rwa]
        }
      ]
    },
    options: {
      plugins: {
        legend: { display: false },
        title: { display: true, text: 'Service Coin Yield Engine' }
      },
      backgroundColor: '#ffffff'
    }
  };

  const chartUrl = `https://quickchart.io/chart?width=500&height=300&c=${encodeURIComponent(JSON.stringify(chartConfig))}`;
  const imagePath = path.resolve(__dirname, 'images/auto_chart.png');
  try {
    const response = await axios.get(chartUrl, { responseType: 'stream' });
    const writer = fs.createWriteStream(imagePath);
    response.data.pipe(writer);
    return new Promise((resolve, reject) => {
      writer.on('finish', () => resolve(imagePath));
      writer.on('error', reject);
    });
  } catch (e) {
    console.error("Chart image generation failed:", e);
    return null;
  }
}

const tweet = async () => {
  const stats = await fetchStats();
  if (!stats) return;
  const { text, stats: rawStats } = await generateTweet(stats);

  let mediaId = null;
  const imagePath = await generateChartImage(rawStats.raw);
  if (imagePath) {
    mediaId = await client.v1.uploadMedia(imagePath);
  }

  try {
    if (mediaId) {
      await client.v2.tweet({ text, media: { media_ids: [mediaId] } });
    } else {
      await client.v2.tweet(text);
    }
    console.log("Tweeted:", text);
  } catch (e) {
    console.error("Intern error:", e);
  }
};

cron.schedule('0 */8 * * *', () => {
  tweet();
});

tweet();
