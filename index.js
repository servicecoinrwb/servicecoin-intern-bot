// Intern Bot for Service Coin DAO – Tweets ecosystem stats, live RWA news, and auto-generated charts with dual-layer yield awareness

const { TwitterApi } = require('twitter-api-v2');
const cron = require('node-cron');
const { ethers } = require('ethers');
const Parser = require('rss-parser');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const client = new TwitterApi({
  appKey: process.env.TWITTER_APP_KEY,
  appSecret: process.env.TWITTER_APP_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_SECRET,
});

const provider = new ethers.JsonRpcProvider(process.env.ARBITRUM_RPC_URL, {
  name: 'arbitrum',
  chainId: 42161,
});

const stakingVaultAbi = require('./abis/SREVStakingVault.json');
const investorVaultAbi = require('./abis/InvestorVault.json');
const rewardDistributorAbi = require('./abis/TimeBasedRewardDistributor.json');
const yieldVaultAbi = require('./abis/YieldVault.json');
const srvTokenAbi = require('./abis/SRVToken.json');
const srevTokenAbi = require('./abis/SREVToken.json');

const stakingVault = new ethers.Contract(process.env.SREV_VAULT_ADDRESS, stakingVaultAbi, provider);
const investorVault = new ethers.Contract(process.env.INVESTOR_VAULT_ADDRESS, investorVaultAbi, provider);
const rewardDistributor = new ethers.Contract(process.env.REWARD_DISTRIBUTOR_ADDRESS, rewardDistributorAbi, provider);
const yieldVault = new ethers.Contract(process.env.YIELD_VAULT_ADDRESS, yieldVaultAbi, provider);
const srvToken = new ethers.Contract(process.env.SRV_TOKEN_ADDRESS, srvTokenAbi, provider);
const srevToken = new ethers.Contract(process.env.SREV_TOKEN_ADDRESS, srevTokenAbi, provider);

const parser = new Parser();

async function fetchRwaHeadline() {
  try {
    const feed = await parser.parseURL('https://rwa.xyz/feed.xml');
    const items = feed.items.filter(i =>
      i.title.toLowerCase().includes('rwa') || i.title.toLowerCase().includes('token')
    );
    if (!items.length) return null;
    const headline = items[Math.floor(Math.random() * items.length)];
    return `RWA news: ${headline.title} (${headline.link})`;
  } catch (err) {
    console.error("Failed to fetch RWA news:", err.message);
    return null;
  }
}

async function fetchStats() {
  try {
    const [vaultTotals, rewardPool, feesAccumulated, srevTotal] = await Promise.all([
      investorVault.getVaultTotals(),
      rewardDistributor.viewRewardPoolBalance(),
      yieldVault.getVaultBalance(),
      srevToken.totalSupply()
    ]);

    return {
      buybackTotal: `$${parseFloat(process.env.MANUAL_BUYBACK_TOTAL || 0).toFixed(2)}`,
      srevSupply: `${ethers.formatUnits(srevTotal, 18)} SREV in circulation`,
      vaultUSDC: `$${ethers.formatUnits(vaultTotals.totalUSDC, 6)} in Investor Vault`,
      rewardPoolUSDC: `$${ethers.formatUnits(rewardPool, 6)} in SREV rewards`,
      rwaFeesUSDC: `$${ethers.formatUnits(feesAccumulated, 6)} in Yield Vault`,
      raw: {
        buybacks: parseFloat(process.env.MANUAL_BUYBACK_TOTAL || 0),
        vault: parseFloat(ethers.formatUnits(vaultTotals.totalUSDC, 6)),
        rwa: parseFloat(ethers.formatUnits(feesAccumulated, 6))
      }
    };
  } catch (e) {
    console.error("Error fetching contract data:", e.message);
    return null;
  }
}

async function generateTweet(stats) {
  const messages = [
    `SREV supply: ${stats.srevSupply}\n${stats.rewardPoolUSDC} in USDC rewards`,
    `Investor vault now holds ${stats.vaultUSDC}. RWA system streaming ${stats.rwaFeesUSDC}.`,
    `SRV buybacks: ${stats.buybackTotal}. Vaults funded. Yield flowing.`,
    `Service Coin: staking + real world business = ${stats.rewardPoolUSDC} in rewards.`
  ];

  if (Math.random() < 0.3) {
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

  const chartUrl = `https://quickchart.io/chart?width=500&height=300&c=${encodeURIComponent(
    JSON.stringify(chartConfig)
  )}`;
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
    console.error("Chart image generation failed:", e.message);
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
    try {
      mediaId = await client.v1.uploadMedia(imagePath);
    } catch (err) {
      console.error("Failed to upload chart image:", err.message);
    }
  }

  try {
    if (mediaId) {
      await client.v2.tweet({ text, media: { media_ids: [mediaId] } });
    } else {
      await client.v2.tweet(text);
    }
    console.log("✅ Tweeted:", text);
  } catch (e) {
    console.error("❌ Tweet failed:", e.message);
  }
};

cron.schedule('0 */8 * * *', () => {
  console.log("🔁 Running scheduled tweet...");
  tweet();
});

tweet();
console.log("✅ Intern bot started and cron is scheduled.");

