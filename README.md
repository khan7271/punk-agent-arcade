# ⚡ PUNK AGENT ARCADE

**A punk neon arcade game for Binance Agent ID holders on BNB Chain.**
Play. Earn points. Prove your Agent ID — your score only counts on-chain if your wallet holds one.

Built by **boss.ai** (Tushar) for the **Binance Wallet + BNB Chain Agent ID Hackathon**
(60,000 USDC · submissions Nov 18 – Dec 9, 2026).

- 🌐 **Live game:** https://khan7271.github.io/punk-agent-arcade/
- 📜 **Contract:** `contracts/PunkAgentArcade.sol` — deployed on BSC at
  `0x4668bfdf7e2b6911aaa7f3947ac613c6a4368066`
  (deploy tx `0x6ea499a6329b8afe89bbc0c45384b3b1ea4c1dd6ba96f4c7a170bb270794c3a2`, block 134426184)
- 🤖 **Telegram bot:** `bot/` (grammy) — play in Telegram, `/leaderboard`, `/points`
- 📣 **Announcement:** https://www.binance.com/en/support/announcement/detail/95f5dbe0ea674a48a739b59e046648bf

## How it works

**Neon Punk Runner** — an endless runner. Your punk agent sprints through a neon city:
jump the spikes, dodge the barriers, grab the bolts (+50 points each). Speed rises the
longer you survive. Keyboard (SPACE / ↑ / W), mouse click, or touch to jump — double jump
works in mid-air. No wallet needed to practice.

**The Agent ID twist:** when a run ends you can submit your score on-chain with
`submitScore(uint256)`. The contract checks the caller against the Binance Agent ID
registry (ERC-721, `0x60b9262456de011f7d15a54cdd8c48baaa8b022f`) and reverts for anyone
who doesn't hold an Agent ID. Best score per wallet is stored on-chain, and the site's
leaderboard reads it live from BSC.

**Levels:** the run levels up every 250 points or every ~20 seconds survived —
whichever comes first. Each level raises speed and obstacle density, adds new
obstacles (tall walls from level 2, hover drones from level 3 — stay low, don't jump
into them), flashes a LEVEL UP banner and pays +100 bonus points. Best level reached
is kept in localStorage and shown on the game-over screen.

**Hard tasks (missions):** five missions pay +200 bonus points each when completed
mid-run, with a banner and a haptic buzz in Telegram:
Bolt Hoarder (10 bolts in one run), Survivor (60 seconds), High Roller (score 500),
Untouchable (dodge 15 obstacles in a row), Air Show (5 double-jumps in one run).
Completed tasks persist in localStorage and show with a ✅ checkmark on the start
and game-over screens. Tasks only change the score — the on-chain `submitScore`
flow is unchanged.

- Free to play. No token sale. No mint price. Submitting a score costs gas only.
- The leaderboard is keyed by wallet address and shows each player's best score.

## Agent ID integration (the real thing, not a badge)

| Check | Where | Verified how |
|---|---|---|
| Player holds an Agent ID | `PunkAgentArcade.submitScore` → `agentIdRegistry.balanceOf(msg.sender) > 0` | Live `eth_call` on BSC before deployment: `balanceOf(boss.ai)` returned `1` |
| Same check in the browser | `web3.js` → `balanceOf` on the registry before enabling submit | Shows HELD ✓ / NOT HELD ✗ with a clear "claim a free Agent ID" message |
| Leaderboard data | `totalPlayers()` → `players(i)` → `bestScore(addr)` + `ScoreSubmitted` events | Plain `eth_call`s to a public BSC RPC, no indexer |

The registry contract is **not** ERC721Enumerable — `tokenOfOwnerByIndex` reverts on it —
so the contract uses `balanceOf` only, which is the correct, minimal check. Names are
not faked: the leaderboard shows wallet addresses (the registry exposes no public
name-resolution view we could verify), and the site never claims a `.ai` name it
didn't verify.

## Project layout

```
punk-agent-arcade/
├── index.html                  # game page + leaderboard UI (+ Telegram Mini App)
├── style.css                   # neon punk styling
├── game.js                     # Neon Punk Runner (canvas, no deps) — levels + tasks
├── web3.js                     # wallet connect, Agent ID check, leaderboard, submit
│                               # (+ Telegram theme/haptics, WalletConnect fallback)
├── bot/
│   ├── bot.js                  # Telegram bot (grammy): /start /play /leaderboard /points /help
│   ├── package.json            # grammy ^1.46.0
│   └── .env.example            # TELEGRAM_BOT_TOKEN (never commit a real token)
├── Dockerfile                  # bot image (node:20-alpine, polling)
├── railway.json                # Railway deploy config
├── contracts/
│   └── PunkAgentArcade.sol     # scoreboard; Agent ID-gated submitScore
├── script/
│   └── Deploy.s.sol            # Foundry deploy script
├── foundry.toml
└── README.md
```

### Contract — `PunkAgentArcade`

- `constructor(address _agentIdRegistry)` — registry is immutable.
- `submitScore(uint256 score)` — requires Agent ID (`balanceOf > 0`) and `score > 0`;
  records first-time players, keeps the caller's best, emits
  `ScoreSubmitted(address player, uint256 score, uint256 best)`.
- Views: `bestScore(address)`, `players(uint256)`, `isPlayer(address)`,
  `totalPlayers()`, `totalSubmissions()`, `hasAgentId(address)`, `agentIdRegistry()`.

## Telegram Bot + Mini App

Play the game inside Telegram, check the leaderboard and your points without
leaving the chat. The bot is polling-only (no webhook, no domain needed).

**Bot commands**

| Command | What it does |
|---|---|
| `/start` | Welcome + ▶ Play Game button (opens the Mini App) |
| `/play` | Same Play button |
| `/leaderboard` | Top 10 on-chain scores, read live from BSC |
| `/points <wallet address>` | Your best score + Agent ID status (or just paste a bare `0x…` address) |
| `/help` | Command list |

**Setup — the user does these steps (the bot cannot be created by an agent)**

1. **Create the bot in BotFather** (Telegram, talk to [@BotFather](https://t.me/BotFather)):
   - `/newbot` → pick a name (e.g. `Punk Agent Arcade`) and a username (must end in `bot`, e.g. `punkagentarcade_bot`)
   - Copy the token BotFather gives you. **Never share it or commit it.**
2. **Point the bot at the game (Mini App URL):** in BotFather, `/mybots` → your bot →
   Bot Settings → Menu Button → set the URL to
   `https://khan7271.github.io/punk-agent-arcade/` (or use `/setmenubutton`).
   The bot's ▶ Play button also opens the same URL via an inline `web_app` button.
3. **Deploy the bot (Railway, free tier):**
   - Push this repo to GitHub (already done) → [railway.app](https://railway.app) → New Project →
     Deploy from GitHub repo → pick `khan7271/punk-agent-arcade`.
   - Railway auto-detects `Dockerfile` + `railway.json` at the repo root.
   - In the service → Variables, set `TELEGRAM_BOT_TOKEN` to the BotFather token.
     (Optional: `GAME_URL` to override the Mini App URL.)
   - Deploy. The bot starts polling — no domain or webhook needed.
   - Local test instead: `cd bot && npm install && TELEGRAM_BOT_TOKEN=... npm start`.
4. **WalletConnect (optional, for connecting inside Telegram):** the Telegram
   WebView has no injected wallet, so the game offers a WalletConnect path
   (deep-link button + copyable link — **no QR code is shown**, per the
   hackathon rule against web-based QR-code login for Agentic Wallet) when
   `window.ethereum` is absent. It needs a free
   Project ID from [cloud.walletconnect.com](https://cloud.walletconnect.com)
   — paste it as `WC_PROJECT_ID` in `web3.js` and redeploy the site. Until
   then the game shows how to get one, and still plays fully without a wallet.

**Mini App behaviour:** when opened inside Telegram the page calls `tg.ready()`
+ `tg.expand()`, applies Telegram's theme colours, and fires haptics on bolt
pickups (light), level-ups / task completions (medium/success) and game over
(heavy). Desktop behaviour is unchanged.

**⚠️ Unverified — needs a live test with the user's Binance app:** whether the
Binance Agentic Wallet itself accepts a WalletConnect session (tap "Open in
Binance App" and approve). The game never claims a direct Binance Agentic Wallet
SDK connection — the UI labels it honestly as WalletConnect. If the Binance app
does not support WalletConnect, players can still play in Telegram for fun and
submit scores from a desktop/mobile Web3 browser with an injected wallet.

## Run it locally

No build step — it is plain HTML/CSS/JS. Any static server works:

```bash
python3 -m http.server 8080
# open http://localhost:8080
```

## Deploy to BSC mainnet (for the parent / deployer)

Prerequisites: Foundry installed, a funded deployer key, a BscScan API key.

```bash
# 1. Install Foundry + deps (once)
curl -L https://foundry.paradigm.xyz | bash
foundryup
forge install foundry-rs/forge-std

# 2. Check the contract compiles + run a local dry-run
forge build

# 3. Deploy + verify on BscScan in one command
export PRIVATE_KEY=0x...        # deployer key — never commit this
export BSCSCAN_API_KEY=...      # from bscscan.com
forge script script/Deploy.s.sol \
  --rpc-url https://bsc-dataseed.bnbchain.org \
  --broadcast --verify --etherscan-api-key $BSCSCAN_API_KEY
```

Or verify afterwards, if the deploy was done without `--verify`:

```bash
forge verify-contract <DEPLOYED_ADDRESS> contracts/PunkAgentArcade.sol:PunkAgentArcade \
  --chain 56 --etherscan-api-key $BSCSCAN_API_KEY \
  --constructor-args $(cast abi-encode "constructor(address)" 0x60b9262456de011f7d15a54cdd8c48baaa8b022f)
```

**After deploy — 2 minutes of wiring, do not skip:**
1. Copy the deployed address into `web3.js` (`ARCADE = "0x..."`).
2. Commit + push — GitHub Pages redeploys automatically.
3. Play one run with an Agent ID wallet, submit a score, and confirm it appears on the leaderboard.
4. Submit to the hackathon with: project name **Punk Agent Arcade**, website
   `https://khan7271.github.io/punk-agent-arcade/`, contract address, and this
   explanation: *"Scores can only be submitted by wallets holding a Binance Agent ID;
   the contract enforces it with a live balanceOf check against the Agent ID registry
   (0x60b9…22f). The leaderboard is read on-chain from the same contract."*

Estimated deploy cost: one small contract creation on BSC — gas only, a few cents
at normal gas prices. Playing and submitting scores is gas-only too.

## Hackathon submission checklist

- [x] Game live and playable (GitHub Pages)
- [x] Contract written, compiles, Agent ID check verified against the live registry
- [x] Contract deployed to BSC mainnet (`0x4668bfdf7e2b6911aaa7f3947ac613c6a4368066`, block 134426184)
- [x] End-to-end test: boss.ai submitted score 100 on-chain (tx `0xdff32f8eeb8592b064bb85681eb9ab2d5e80be34c7feb10dd74ad67ae8d5e9c3`, block 134426283)
- [x] `ARCADE` address set in `web3.js`, site redeployed
- [x] Levels + hard tasks added; Telegram bot + Mini App built
- [ ] Contract verified + open-source on BscScan — **BLOCKED 2026-11-19 ~09:00 Dhaka:**
      the web form is filled but Cloudflare Turnstile fails in the cloud browser
      (error 600010). Needs the user to pass Turnstile in the live browser tab
      and click "Verify and Publish", or a free BscScan API key for API verification.
- [ ] Telegram bot live (needs the user's BotFather token + Railway deploy — see above)
- [ ] WalletConnect live test with the Binance app (needs `WC_PROJECT_ID` + a real scan)
- [ ] 30+ Agent ID addresses interact (Innovation Award threshold) — share the game
      link on X with `#BinanceWalletHackathon` + `#AgenticWallet`
- [ ] Project submitted via the Binance hackathon form before Dec 9, 2026 08:00 UTC

## License

MIT. Punk forever.
