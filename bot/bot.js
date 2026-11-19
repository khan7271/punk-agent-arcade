"use strict";
/* =====================================================================
   PUNK AGENT ARCADE — Telegram bot (grammy, long polling, no webhook).
   Commands: /start /play /leaderboard /points /help
   Reads the on-chain scoreboard straight from BSC with plain JSON-RPC —
   no indexer, no database. The bot never holds keys or spends anything.
   Run:  TELEGRAM_BOT_TOKEN=... node bot.js
   ===================================================================== */

const { Bot, InlineKeyboard } = require("grammy");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) {
  console.error("[bot] TELEGRAM_BOT_TOKEN is not set. Get one from @BotFather (/newbot) " +
    "and set it as an env var (or in Railway variables). Exiting.");
  process.exit(1);
}

const GAME_URL = process.env.GAME_URL || "https://khan7271.github.io/punk-agent-arcade/";
const ARCADE = "0x4668bfdf7e2b6911aaa7f3947ac613c6a4368066"; // PunkAgentArcade (BSC)
const REGISTRY = "0x60b9262456de011f7d15a54cdd8c48baaa8b022f"; // Agent ID registry (ERC-721)
const BSCSCAN = "https://bscscan.com/address/" + ARCADE;
const RPCS = ["https://bsc-dataseed.bnbchain.org", "https://bsc.publicnode.com"];

const SEL = {
  balanceOf: "0x70a08231",       // balanceOf(address)
  bestScore: "0xdc0c695f",       // bestScore(address)
  totalPlayers: "0xf60cdcf6",    // totalPlayers()
  players: "0xf71d96cb",         // players(uint256)
  totalSubmissions: "0xa3954016" // totalSubmissions()
};

// ---- BSC RPC helpers (plain fetch, tries each endpoint in turn) --------
async function rpc(method, params) {
  let lastErr = null;
  for (const url of RPCS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
      });
      const j = await res.json();
      if (j.error) throw new Error(j.error.message || "RPC error");
      return j.result;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("all BSC RPC endpoints failed");
}
const padAddress = (addr) => "000000000000000000000000" + addr.toLowerCase().replace(/^0x/, "");
const padUint = (n) => ("00000000000000000000000000000000000000000000000000000000" + BigInt(n).toString(16)).slice(-64);
const ethCall = (to, data) => rpc("eth_call", [{ to, data }, "latest"]);
const parseUint = (hex) => (!hex || hex === "0x" ? 0 : Number(BigInt(hex)));
const shortAddr = (a) => a.slice(0, 6) + "…" + a.slice(-4);
const isAddress = (s) => /^0x[0-9a-fA-F]{40}$/.test(s || "");

// ---- scoreboard reads ---------------------------------------------------
async function getLeaderboard(limit = 10) {
  const total = parseUint(await ethCall(ARCADE, SEL.totalPlayers));
  if (total === 0) return { total: 0, rows: [], subs: 0 };
  const playerHexes = await Promise.all(
    Array.from({ length: total }, (_, i) => ethCall(ARCADE, SEL.players + padUint(i)))
  );
  const players = playerHexes.map((h) => "0x" + h.slice(-40));
  const rows = await Promise.all(players.map(async (p) => ({
    player: p,
    best: parseUint(await ethCall(ARCADE, SEL.bestScore + padAddress(p)))
  })));
  rows.sort((a, b) => b.best - a.best);
  let subs = 0;
  try { subs = parseUint(await ethCall(ARCADE, SEL.totalSubmissions)); } catch (e) { /* optional */ }
  return { total, rows: rows.slice(0, limit), subs };
}

function formatLeaderboard(board) {
  if (board.total === 0) {
    return "🏆 <b>LEADERBOARD — empty so far!</b>\n\nNo scores on-chain yet. " +
      "Be the first Agent ID holder to play and submit one.\n\n" +
      "Contract: <a href=\"" + BSCSCAN + "\">BscScan ↗</a>";
  }
  const medals = ["🥇", "🥈", "🥉"];
  const lines = board.rows.map((r, i) =>
    (medals[i] || (i + 1) + ".") + " <code>" + shortAddr(r.player) + "</code> — <b>" +
    r.best.toLocaleString() + "</b>");
  return "🏆 <b>LEADERBOARD — best score per Agent ID holder</b>\n\n" +
    lines.join("\n") + "\n\n" +
    board.total + " player(s) · " + board.subs.toLocaleString() + " total submission(s).\n" +
    "Contract: <a href=\"" + BSCSCAN + "\">BscScan ↗</a>";
}

async function pointsText(addr) {
  const [best, subs, bal] = await Promise.all([
    ethCall(ARCADE, SEL.bestScore + padAddress(addr)).then(parseUint),
    ethCall(ARCADE, SEL.totalSubmissions).then(parseUint).catch(() => 0),
    ethCall(REGISTRY, SEL.balanceOf + padAddress(addr)).then(parseUint)
  ]);
  const held = bal > 0;
  return "⚡ <b>POINTS — <code>" + shortAddr(addr) + "</code></b>\n\n" +
    "Best score: <b>" + best.toLocaleString() + "</b>\n" +
    "Agent ID: " + (held ? "HELD ✓" : "NOT HELD ✗") + "\n" +
    "Total submissions (all players): " + subs.toLocaleString() + "\n\n" +
    (held
      ? "Your scores count on-chain. Play and beat your best!"
      : "This wallet holds no Agent ID — claim one free in the Binance app " +
        "(Wallet → Agent ID banner) to submit scores on-chain.");
}

// ---- bot ----------------------------------------------------------------
const bot = new Bot(TOKEN);

function playKeyboard() {
  return new InlineKeyboard()
    .webApp("🎮 Play Game", GAME_URL)
    .row()
    .text("🏆 Leaderboard", "leaderboard");
}

const WELCOME =
  "⚡ <b>Welcome to PUNK AGENT ARCADE!</b> ⚡\n\n" +
  "A punk neon runner for <b>Binance Agent ID holders</b> on BNB Chain. " +
  "Run, dodge, grab bolts — and your score only counts on-chain if your " +
  "wallet holds an Agent ID.\n\n" +
  "🎮 <b>Play</b> the game right here in Telegram (Mini App).\n" +
  "🏆 <b>Leaderboard</b> — best score per Agent ID holder, read live from BSC.\n" +
  "⚡ <b>Points</b> — /points &lt;your wallet address&gt;.\n\n" +
  "Free to play. Submitting a score costs gas only. No token sale, no pay-to-win.\n" +
  "Built by boss.ai for the Binance Agent ID Hackathon.";

bot.command("start", async (ctx) => {
  await ctx.reply(WELCOME, { parse_mode: "HTML", reply_markup: playKeyboard() });
});

bot.command("play", async (ctx) => {
  await ctx.reply("🎮 <b>NEON PUNK RUNNER</b>\n\nTap below to play in the Telegram Mini App. " +
    "Connect your wallet in the game to authorise — only Agent ID holders can submit scores on-chain.",
    { parse_mode: "HTML", reply_markup: playKeyboard() });
});

bot.command("leaderboard", async (ctx) => {
  await ctx.reply("Reading the scoreboard from BSC…");
  try {
    const board = await getLeaderboard(10);
    await ctx.reply(formatLeaderboard(board), { parse_mode: "HTML", reply_markup: playKeyboard() });
  } catch (e) {
    await ctx.reply("Leaderboard failed to load: " + e.message + ". Try again in a moment.");
  }
});

bot.command("points", async (ctx) => {
  const arg = (ctx.match || "").trim().split(/\s+/)[0];
  if (!arg) {
    await ctx.reply("Send your wallet address like this:\n<code>/points 0x3530ca4536e05641AE6f0545fd2EdEC2A4F86F16</code>",
      { parse_mode: "HTML" });
    return;
  }
  if (!isAddress(arg)) {
    await ctx.reply("That doesn't look like a wallet address. It should start with 0x and be 42 characters long.");
    return;
  }
  try {
    await ctx.reply(await pointsText(arg), { parse_mode: "HTML" });
  } catch (e) {
    await ctx.reply("Couldn't read your points: " + e.message + ". Try again in a moment.");
  }
});

bot.command("help", async (ctx) => {
  await ctx.reply("⚡ <b>PUNK AGENT ARCADE — commands</b>\n\n" +
    "/play — open the game (Mini App)\n" +
    "/leaderboard — top 10 on-chain scores\n" +
    "/points &lt;wallet address&gt; — your best score + Agent ID status\n" +
    "/start — welcome + Play button\n" +
    "/help — this list\n\n" +
    "Game: " + GAME_URL,
    { parse_mode: "HTML", reply_markup: playKeyboard() });
});

// Bare wallet address in chat = points lookup.
bot.hears(/^0x[0-9a-fA-F]{40}$/, async (ctx) => {
  try {
    await ctx.reply(await pointsText(ctx.message.text.trim()), { parse_mode: "HTML" });
  } catch (e) {
    await ctx.reply("Couldn't read those points: " + e.message);
  }
});

bot.callbackQuery("leaderboard", async (ctx) => {
  await ctx.answerCallbackQuery("Loading leaderboard…");
  try {
    const board = await getLeaderboard(10);
    await ctx.editMessageText(formatLeaderboard(board), { parse_mode: "HTML", reply_markup: playKeyboard() });
  } catch (e) {
    await ctx.reply("Leaderboard failed to load: " + e.message);
  }
});

bot.catch((err) => {
  console.error("[bot] error while handling update", err.ctx?.update?.update_id, err.error);
});

bot.start({
  onStart: (info) => console.log("[bot] Punk Agent Arcade bot running as @" + info.username + " (polling)"),
});
