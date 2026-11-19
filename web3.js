"use strict";
/* =====================================================================
   PUNK AGENT ARCADE — wallet, Agent ID check, leaderboard, score submit.
   No libraries: plain fetch() JSON-RPC to a public BSC endpoint, and
   window.ethereum for the wallet. Everything fails soft with a message.
   ===================================================================== */
(function () {
  var BSC_CHAIN_ID_HEX = "0x38"; // 56
  var RPC_URL = "https://bsc-dataseed.bnbchain.org";
  var REGISTRY = "0x60b9262456de011f7d15a54cdd8c48baaa8b022f"; // Agent ID (ERC-721)
  // TODO (parent): paste the deployed PunkAgentArcade address here after
  // mainnet deploy, then redeploy the site. Until then the leaderboard
  // shows "not deployed yet" and score submit is disabled.
  var ARCADE = "0x4668bfdf7e2b6911aaa7f3947ac613c6a4368066";
  var BSCSCAN = "https://bscscan.com";

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

  // ---- RPC helpers ----------------------------------------------------
  function rpc(method, params) {
    return fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: method, params: params })
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j.error) throw new Error(j.error.message || "RPC error");
      return j.result;
    });
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

  function connectWallet() {
    if (!window.ethereum) {
      setStatus("<strong>No wallet found.</strong> Install MetaMask or open this page in the " +
        "Binance Wallet / a Web3 browser, then connect.", "unknown");
      return;
    }
    connectBtn.disabled = true;
    connectBtn.textContent = "Connecting…";
    window.ethereum.request({ method: "eth_requestAccounts" }).then(function (accounts) {
      if (!accounts || !accounts.length) throw new Error("no account returned");
      account = accounts[0];
      connectBtn.textContent = shortAddr(account);
      return window.ethereum.request({ method: "eth_chainId" });
    }).then(function (chainId) {
      if (chainId !== BSC_CHAIN_ID_HEX) {
        return window.ethereum.request({
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
    txStatus.textContent = "";
    if (!window.ethereum) { txStatus.textContent = "No wallet — connect one first."; return; }
    if (!account) { txStatus.textContent = "Connect your wallet first."; return; }
    if (!isHolder) { txStatus.textContent = "This wallet holds no Agent ID — the contract will reject the submit."; return; }
    if (!isDeployed()) { txStatus.textContent = "Contract not deployed yet — nothing to submit to. Play again after deploy."; return; }
    if (!score || score <= 0) { txStatus.textContent = "Score is 0 — play a run first."; return; }

    submitBtn.disabled = true;
    txStatus.textContent = "Sending submitScore(" + score + ") — confirm in your wallet (gas only)…";
    var data = SEL.submitScore + padUint(score);
    window.ethereum.request({
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

  if (window.ethereum && window.ethereum.request) {
    window.ethereum.request({ method: "eth_accounts" }).then(function (accounts) {
      if (accounts && accounts.length) {
        account = accounts[0];
        connectBtn.textContent = shortAddr(account);
        checkAgentId(account).then(function () { if (isDeployed()) refreshMyBest(); });
      }
    }).catch(function () { /* silent: user just isn't connected */ });
    window.ethereum.on("accountsChanged", function (accounts) {
      account = accounts && accounts.length ? accounts[0] : null;
      connectBtn.textContent = account ? shortAddr(account) : "Connect Wallet";
      if (account) checkAgentId(account); else { isHolder = false; setBadge("unknown", "AGENT ID: NOT CHECKED"); }
    });
  }

  updateContractUI();
  loadLeaderboard();
})();
