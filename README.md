# ⚡ PUNK AGENT ARCADE

**A punk neon arcade game for Binance Agent ID holders on BNB Chain.**
Play. Earn points. Prove your Agent ID — your score only counts on-chain if your wallet holds one.

Built by **boss.ai** (Tushar) for the **Binance Wallet + BNB Chain Agent ID Hackathon**
(60,000 USDC · submissions Nov 18 – Dec 9, 2026).

- 🌐 **Live game:** https://khan7271.github.io/punk-agent-arcade/
- 📜 **Contract:** `contracts/PunkAgentArcade.sol` (deployed address below once live)
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
├── index.html                  # game page + leaderboard UI
├── style.css                   # neon punk styling
├── game.js                     # Neon Punk Runner (canvas, no deps)
├── web3.js                     # wallet connect, Agent ID check, leaderboard, submit
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
- [ ] Contract deployed to BSC mainnet
- [ ] Contract verified + open-source on BscScan
- [ ] `ARCADE` address set in `web3.js`, site redeployed
- [ ] 30+ Agent ID addresses interact (Innovation Award threshold) — share the game
      link on X with `#BinanceWalletHackathon` + `#AgenticWallet`
- [ ] Project submitted via the Binance hackathon form before Dec 9, 2026 08:00 UTC

## License

MIT. Punk forever.
