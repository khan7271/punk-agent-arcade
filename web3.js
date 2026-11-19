"use strict";
/* =====================================================================
   PUNK AGENT ARCADE — wallet, Agent ID check, leaderboard, score submit.
   No libraries: plain fetch() JSON-RPC to a public BSC endpoint, and
   window.ethereum for the wallet. Everything fails soft with a message.
   Inside Telegram (Mini App) there is no injected wallet, so we offer a
   WalletConnect path instead (needs a free project ID — see below).
   No QR code is ever shown: the hackathon rules ban web-based QR-code
   login for Agentic Wallet, so WalletConnect connects via a deep-link
   button ("Open in Binance App") only — never a scannable code.
   ===================================================================== */
(function () {
  var BSC_CHAIN_ID_HEX = "0x38"; // 56
  var RPC_URL = "https://bsc-dataseed.bnbchain.org";
  var REGISTRY = "0x60b9262456de011f7d15a54cdd8c48baaa8b022f"; // Agent ID (ERC-721)
  var ARCADE = "0x4668bfdf7e2b6911aaa7f3947ac613c6a4368066";
  var BSCSCAN = "https://bscscan.com";

  // ---- WalletConnect (only used when there is no injected wallet) ------
  // Free project ID from https://cloud.walletconnect.com — paste it here.
  // Until it is set, the WalletConnect button explains how to get one.
  // NOTE (unverified): whether the Binance Agentic Wallet app accepts a
  // WalletConnect session has NOT been tested live yet — see README.
  var WC_PROJECT_ID = "";
  var WC_PROVIDER_URL = "https://unpkg.com/@walletconnect/ethereum-provider@2.21.0/dist/umd/index.min.js";

  // ---- Telegram Mini App ------------------------------------------------
  // tg.ready()/expand() + theme colours when opened inside Telegram.
  // On desktop this block is a no-op (window.Telegram is undefined).
  var tg = (window.Telegram && window.Telegram.WebApp) ? window.Telegram.WebApp : null;
  if (tg) {
    try {
      tg.ready();
      tg.expand();
      var tp = tg.themeParams || {};
      var root = document.documentElement;
      if (tp.bg_color) root.style.setProperty("--bg", tp.bg_color);
      if (tp.text_color) root.style.setProperty("--text", tp.text_color);
      if (tp.secondary_bg_color) root.style.setProperty("--panel", tp.secondary_bg_color);
      if (tp.hint_color) root.style.setProperty("--muted", tp.hint_color);
      if (tp.button_color) root.style.setProperty("--cyan", tp.button_color);
      if (tg.setHeaderColor) tg.setHeaderColor(tp.bg_color || "#0a0a12");
      if (tg.setBackgroundColor) tg.setBackgroundColor(tp.bg_color || "#0a0a12");
    } catch (e) { /* Telegram theming is optional */ }
  }

  // Function selectors (from `cast sig`, verified against the compiled ABI)
  var SEL = {
    balanceOf: "0x70a08231",       // balanceOf(address)
    hasAgentId: "0x4eab3ef2",      // hasAgentId(address)
    submitScore: "0xaff0b297",     // submitScore(uint256)
    bestScore: "0xdc0c695f",       // bestScore(address)
    totalPlayers: "0xf60cdcf6",    // totalPlayers()
    players: "0xf71d96cb",         // players(uint256)
    totalSubmissions: "0xa3954016" // totalSubmissions()
  };

  var account = null;
  var isHolder = false;
  var wcProvider = null;
  var activeProvider = null; // window.ethereum OR the WalletConnect provider

  // ---- DOM ------------------------------------------------------------
  function el(id) { return document.getElementById(id); }
  var connectBtn = el("connectBtn");
  var agentBadge = el("agentBadge");
  var agentStatus = el("agentStatus");
  var contractAddrEl = el("contractAddr");
  var contractLinkEl = el("contractLink");
  var boardStatus = el("leaderboardStatus");
  var boardBody = el("leaderboardBody");
  var boardMeta = el("boardMeta");
  var submitBtn = el("submitScoreBtn");
  var txStatus = el("txStatus");
  var wcPanel = el("wcPanel");
  var wcOpenBtn = el("wcOpenBtn");
  var wcUriEl = el("wcUri");
  var wcCopyBtn = el("wcCopyBtn");
  var wcDisconnectBtn = el("wcDisconnectBtn");
  var wcStatusEl = el("wcStatus");

  // ---- RPC helpers ----------------------------------------------------
  // Two public BSC endpoints — if the first is unreachable, try the second.
  var RPC_URLS = ["https://bsc-dataseed.bnbchain.org", "https://bsc.publicnode.com"];
  function rpc(method, params) {
    var attempt = 0;
    function tryNext() {
      return fetch(RPC_URLS[attempt], {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: method, params: params })
      }).then(function (r) { return r.json(); }).then(function (j) {
        if (j.error) throw new Error(j.error.message || "RPC error");
        return j.result;
      }).catch(function (err) {
        attempt++;
        if (attempt < RPC_URLS.length) return tryNext();
        throw err;
      });
    }
    return tryNext();
  }
  function padAddress(addr) { return "000000000000000000000000" + addr.toLowerCase().replace(/^0x/, ""); }
  function padUint(n) {
    var h = BigInt(n).toString(16);
    return ("00000000000000000000000000000000000000000000000000000000" + h).slice(-64);
  }
  function ethCall(to, data) { return rpc("eth_call", [{ to: to, data: data }, "latest"]); }
  function parseUint(hex) {
    if (!hex || hex === "0x") return 0;
    try { return Number(BigInt(hex)); } catch (e) { return 0; }
  }
  function shortAddr(a) { return a.slice(0, 6) + "…" + a.slice(-4); }
  function isDeployed() { return ARCADE !== "0x0000000000000000000000000000000000000000"; }

  // ---- Agent ID UI ------------------------------------------------------
  function setBadge(mode, text) {
    agentBadge.className = "badge badge-" + mode;
    agentBadge.textContent = text;
  }
  function setStatus(html, mode) {
    agentStatus.className = "status-box status-" + mode;
    agentStatus.innerHTML = html;
  }

  function checkAgentId(addr) {
    return ethCall(REGISTRY, SEL.balanceOf + padAddress(addr)).then(function (res) {
      var bal = parseUint(res);
      isHolder = bal > 0;
      if (isHolder) {
        setBadge("ok", "AGENT ID: HELD ✓");
        setStatus("<strong>Agent ID confirmed on-chain.</strong> Wallet <code>" + shortAddr(addr) +
          "</code> holds a Binance Agent ID. You can play and submit scores on-chain. Good luck, punk!",
          "ok");
      } else {
        setBadge("no", "AGENT ID: NOT HELD ✗");
        setStatus("<strong>No Agent ID found for this wallet.</strong> On-chain score submits need a " +
          "Binance Agent ID — claim one free in the Binance app (Wallet → Agent ID banner), then " +
          "reconnect. You can still play the game for fun right now; the score just won't go on-chain.",
          "no");
      }
      return isHolder;
    }).catch(function (err) {
      setBadge("unknown", "AGENT ID: CHECK FAILED");
      setStatus("<strong>Agent ID check failed:</strong> " + err.message +
        ". Check your connection and press Connect again.", "unknown");
      return false;
    });
  }

  function onAccountsChanged(accounts) {
    account = accounts && accounts.length ? accounts[0] : null;
    connectBtn.textContent = account ? shortAddr(account) : "Connect Wallet";
    if (account) checkAgentId(account);
    else { isHolder = false; setBadge("unknown", "AGENT ID: NOT CHECKED"); }
  }

  function connectWallet() {
    if (window.ethereum) {
      // Desktop / Web3 browser: injected wallet (MetaMask, Binance Wallet…)
      activeProvider = window.ethereum;
      connectBtn.disabled = true;
      connectBtn.textContent = "Connecting…";
      activeProvider.request({ method: "eth_requestAccounts" }).then(function (accounts) {
        if (!accounts || !accounts.length) throw new Error("no account returned");
        account = accounts[0];
        connectBtn.textContent = shortAddr(account);
        return activeProvider.request({ method: "eth_chainId" });
      }).then(function (chainId) {
        if (chainId !== BSC_CHAIN_ID_HEX) {
          return activeProvider.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: BSC_CHAIN_ID_HEX }]
          }).catch(function () {
            setStatus("<strong>Wrong chain.</strong> Please switch your wallet to BNB Chain (id 56) " +
              "and press Connect again.", "unknown");
            throw new Error("wrong chain");
          });
        }
      }).then(function () {
        return checkAgentId(account);
      }).then(function () {
        if (isDeployed()) refreshMyBest();
      }).catch(function (err) {
        if (err && err.message !== "wrong chain") {
          setStatus("<strong>Connect failed:</strong> " + err.message, "unknown");
        }
      }).finally(function () {
        connectBtn.disabled = false;
        if (!account) connectBtn.textContent = "Connect Wallet";
      });
    } else {
      // No injected wallet (e.g. Telegram WebView): WalletConnect path.
      setStatus("<strong>No browser wallet here.</strong> Opening WalletConnect — tap 'Open in " +
        "Binance App' to connect and authorise.", "unknown");
      connectWalletConnect();
    }
  }

  // ---- WalletConnect (Telegram / mobile, no injected provider) --------
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error("failed to load " + src)); };
      document.head.appendChild(s);
    });
  }
  function showWcPanel(uri) {
    if (!wcPanel) return;
    wcPanel.classList.remove("hidden");
    if (uri) {
      wcUriEl.textContent = uri;
      if (wcOpenBtn) wcOpenBtn.href = uri;
      wcStatusEl.textContent = "Tap 'Open in Binance App' and approve the connection in your wallet.";
    }
  }
  function disconnectWalletConnect() {
    var p = wcProvider;
    wcProvider = null;
    if (activeProvider === p) activeProvider = null;
    if (p) { try { p.disconnect(); } catch (e) { /* ignore */ } }
    account = null;
    isHolder = false;
    connectBtn.textContent = "Connect Wallet";
    setBadge("unknown", "AGENT ID: NOT CHECKED");
    if (wcPanel) wcPanel.classList.add("hidden");
  }
  function connectWalletConnect() {
    if (!WC_PROJECT_ID) {
      setStatus("<strong>WalletConnect is not configured yet.</strong> It needs a free Project ID " +
        "from <a href=\"https://cloud.walletconnect.com\" target=\"_blank\" rel=\"noopener\">cloud.walletconnect.com</a> " +
        "— paste it as WC_PROJECT_ID in web3.js (takes ~2 minutes, free). " +
        "On desktop, install MetaMask or open this page in a Web3 browser instead.", "unknown");
      return;
    }
    if (wcStatusEl) wcStatusEl.textContent = "Opening WalletConnect…";
    showWcPanel(null);
    var ready = window.EthereumProvider ? Promise.resolve() : loadScript(WC_PROVIDER_URL);
    ready.then(function () {
      return window.EthereumProvider.init({
        projectId: WC_PROJECT_ID,
        chains: [56],
        showQrModal: false,
        rpcMap: { 56: RPC_URL }
      });
    }).then(function (provider) {
      wcProvider = provider;
      provider.on("display_uri", function (uri) { showWcPanel(uri); });
      provider.on("accountsChanged", onAccountsChanged);
      provider.on("disconnect", disconnectWalletConnect);
      return provider.connect();
    }).then(function () {
      var accounts = (wcProvider && wcProvider.accounts) || [];
      if (!accounts.length) throw new Error("no account returned");
      activeProvider = wcProvider;
      account = accounts[0];
      connectBtn.textContent = shortAddr(account);
      if (wcStatusEl) wcStatusEl.textContent = "Connected via WalletConnect: " + shortAddr(account);
      return checkAgentId(account);
    }).then(function () {
      if (isDeployed()) refreshMyBest();
    }).catch(function (err) {
      if (wcStatusEl) wcStatusEl.textContent = "WalletConnect failed: " + (err && err.message ? err.message : err);
    });
  }

  // ---- leaderboard ------------------------------------------------------
  function updateContractUI() {
    if (!isDeployed()) {
      contractAddrEl.textContent = "not deployed yet — set after mainnet deploy";
      contractLinkEl.classList.add("hidden");
      boardStatus.textContent = "The arcade contract is not deployed yet. The game is fully " +
        "playable right now, and the leaderboard will go live here the moment the contract " +
        "is deployed and its address is set in web3.js.";
      boardBody.innerHTML = "";
      boardMeta.textContent = "";
      return;
    }
    contractAddrEl.textContent = ARCADE;
    contractLinkEl.href = BSCSCAN + "/address/" + ARCADE;
    contractLinkEl.classList.remove("hidden");
  }

  function loadLeaderboard() {
    if (!isDeployed()) { updateContractUI(); return; }
    boardStatus.textContent = "Reading the scoreboard from BSC…";
    boardBody.innerHTML = "";
    var total = 0;
    ethCall(ARCADE, SEL.totalPlayers).then(function (res) {
      total = parseUint(res);
      if (total === 0) {
        boardStatus.textContent = "No scores on-chain yet. Be the first Agent ID holder to submit one!";
        return [];
      }
      var calls = [];
      for (var i = 0; i < total; i++) {
        calls.push(ethCall(ARCADE, SEL.players + padUint(i)));
      }
      return Promise.all(calls);
    }).then(function (playerHexes) {
      if (!playerHexes || !playerHexes.length) return [];
      var players = playerHexes.map(function (h) { return "0x" + h.slice(-40); });
      return Promise.all(players.map(function (p) {
        return ethCall(ARCADE, SEL.bestScore + padAddress(p)).then(function (s) {
          return { player: p, best: parseUint(s) };
        });
      }));
    }).then(function (rows) {
      if (!rows || !rows.length) return;
      rows.sort(function (a, b) { return b.best - a.best; });
      var top = rows.slice(0, 10);
      boardBody.innerHTML = top.map(function (r, i) {
        var medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : String(i + 1);
        return "<tr><td class=\"rank-" + (i + 1) + "\">" + medal + "</td><td><code>" +
          shortAddr(r.player) + "</code></td><td>" + r.best.toLocaleString() + "</td></tr>";
      }).join("");
      boardStatus.textContent = "Live from BSC — best score per player.";
      return ethCall(ARCADE, SEL.totalSubmissions).then(function (s) {
        boardMeta.textContent = total + " player(s) · " + parseUint(s).toLocaleString() + " total submission(s).";
      }).catch(function () { /* meta is optional */ });
    }).catch(function (err) {
      boardStatus.textContent = "Leaderboard failed to load: " + err.message + ". Try ↻ Refresh.";
    });
  }

  function refreshMyBest() {
    if (!account || !isDeployed()) return;
    ethCall(ARCADE, SEL.bestScore + padAddress(account)).then(function (s) {
      var b = parseUint(s);
      if (b > 0) boardMeta.textContent = "Your on-chain best: " + b.toLocaleString() + ".";
    }).catch(function () { /* optional */ });
  }

  // ---- score submit -------------------------------------------------------
  function submitScore() {
    var score = (window.PunkGame && window.PunkGame.lastScore) || 0;
    var prov = activeProvider || window.ethereum;
    txStatus.textContent = "";
    if (!prov) { txStatus.textContent = "No wallet — connect one first."; return; }
    if (!account) { txStatus.textContent = "Connect your wallet first."; return; }
    if (!isHolder) { txStatus.textContent = "This wallet holds no Agent ID — the contract will reject the submit."; return; }
    if (!isDeployed()) { txStatus.textContent = "Contract not deployed yet — nothing to submit to. Play again after deploy."; return; }
    if (!score || score <= 0) { txStatus.textContent = "Score is 0 — play a run first."; return; }

    submitBtn.disabled = true;
    txStatus.textContent = "Sending submitScore(" + score + ") — confirm in your wallet (gas only)…";
    var data = SEL.submitScore + padUint(score);
    prov.request({
      method: "eth_sendTransaction",
      params: [{ from: account, to: ARCADE, value: "0x0", data: data }]
    }).then(function (hash) {
      txStatus.innerHTML = "Submitted! Tx <a href=\"" + BSCSCAN + "/tx/" + hash +
        "\" target=\"_blank\" rel=\"noopener\">" + shortAddr(hash) + " ↗</a> — waiting for confirmation…";
      var tries = 0;
      var timer = setInterval(function () {
        tries++;
        rpc("eth_getTransactionReceipt", [hash]).then(function (rc) {
          if (rc && rc.status) {
            clearInterval(timer);
            var ok = (rc.status === "0x1");
            txStatus.textContent = ok
              ? "Confirmed in block " + parseInt(rc.blockNumber, 16) + "! Your best score is now on-chain. 🏆"
              : "Transaction failed on-chain (status 0). Check BscScan for the reason.";
            loadLeaderboard();
          } else if (tries > 40) {
            clearInterval(timer);
            txStatus.textContent = "Still pending after ~2 min — check BscScan for the tx status.";
          }
        }).catch(function () { /* keep polling */ });
      }, 3000);
    }).catch(function (err) {
      txStatus.textContent = "Submit failed: " + (err && err.message ? err.message : err);
    }).finally(function () {
      submitBtn.disabled = false;
    });
  }

  // ---- wire up ------------------------------------------------------------
  connectBtn.addEventListener("click", connectWallet);
  el("refreshBoardBtn").addEventListener("click", loadLeaderboard);
  submitBtn.addEventListener("click", submitScore);
  if (wcCopyBtn) wcCopyBtn.addEventListener("click", function () {
    var uri = wcUriEl.textContent;
    if (!uri) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(uri).then(function () {
        wcStatusEl.textContent = "Connection link copied — paste it in your wallet app to connect.";
      }).catch(function () { wcStatusEl.textContent = "Copy failed — long-press the link text to copy it manually."; });
    } else {
      wcStatusEl.textContent = "Copy not supported here — long-press the link text to copy it manually.";
    }
  });
  if (wcDisconnectBtn) wcDisconnectBtn.addEventListener("click", disconnectWalletConnect);

  if (window.ethereum && window.ethereum.request) {
    activeProvider = window.ethereum;
    window.ethereum.request({ method: "eth_accounts" }).then(function (accounts) {
      if (accounts && accounts.length) {
        account = accounts[0];
        connectBtn.textContent = shortAddr(account);
        checkAgentId(account).then(function () { if (isDeployed()) refreshMyBest(); });
      }
    }).catch(function () { /* silent: user just isn't connected */ });
    window.ethereum.on("accountsChanged", onAccountsChanged);
  }

  updateContractUI();
  loadLeaderboard();
})();
