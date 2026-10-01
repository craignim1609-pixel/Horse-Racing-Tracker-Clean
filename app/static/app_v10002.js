
/* ============================================================
   GLOBALS + HELPERS
   ============================================================ */

const API = "";   // same origin as the page

let PLAYER_MAP = {};


/* Render a single race card */
function renderRaceCard(bet) {
    const status = bet.result || "Pending";

    const badgeClass = {
        "Pending": "pending",
        "Win": "win",
        "Place": "place",
        "Lose": "lose",
        "NR": "nr"
    }[status] || "pending";

    // --- NEW: Correct E/W stake display ---
    const stakeLabel = bet.each_way
        ? `£${bet.amount_bet.toFixed(2)} E/W`
        : `£${bet.amount_bet.toFixed(2)}`;

    const stakeLarge = bet.total_stake
        ? `£${bet.total_stake.toFixed(2)}`
        : `£${bet.amount_bet.toFixed(2)}`;
    // --------------------------------------

    return `
    <div class="race-bet-card acca-card acca-card-${badgeClass}">

        <div class="acca-header">
            <div>
                <div class="acca-date">${bet.course}</div>
                <div class="acca-sub">${bet.race_time}</div>
            </div>

            <div class="acca-returns">
                <p class="returns-label">Stake</p>
                <p class="returns-value">${stakeLabel}</p>
                <p class="returns-total">${stakeLarge}</p>
                <span class="acca-status-badge acca-badge-${badgeClass}">${status}</span>
            </div>
        </div>

        <div class="acca-picks-grid">
            <div class="pick-tile">

                <div class="pick-header">
                    <span class="pick-player">${PLAYER_MAP[bet.player_id] || "Player"}</span>
                    <span class="pick-badge ${badgeClass}">${status}</span>
                </div>

                <div class="pick-course">${bet.course}</div>
                <div class="pick-horse">(${bet.horse_number}) ${bet.horse_name}</div>
                <div class="pick-odds">@ ${bet.odds_fraction}</div>

            </div>
        </div>

        <div class="pick-status-buttons">
            <button class="pick-status-btn" onclick="updateRaceResult(${bet.id}, 'Win')">WIN</button>
            <button class="pick-status-btn" onclick="updateRaceResult(${bet.id}, 'Place')">PLACE</button>
            <button class="pick-status-btn" onclick="updateRaceResult(${bet.id}, 'Lose')">LOSE</button>
            <button class="pick-status-btn" onclick="updateRaceResult(${bet.id}, 'NR')">NR</button>
            <button class="pick-status-btn delete" onclick="deleteRaceBet(${bet.id})">DELETE</button>
        </div>

    </div>
    `;
}


/* ============================================================
   RACE DAY — FORM SETUP
   ============================================================ */

async function setupRaceForm() {
    const form = document.getElementById("raceForm");
    const resultBox = document.getElementById("raceResult");
    const playerSelect = document.getElementById("playerSelect");

    const res = await fetch(`${API}/players/`);
    const players = await res.json();

    playerSelect.innerHTML = '<option value="">Select Player</option>';
    players.forEach(p => {
        PLAYER_MAP[p.id] = p.name;
        playerSelect.innerHTML += `<option value="${p.id}">${p.name}</option>`;
    });

    form.onsubmit = async (e) => {
        e.preventDefault();

        const body = Object.fromEntries(new FormData(form).entries());
        body.each_way = document.getElementById("eachWay").checked;

        const submitRes = await fetch(`${API}/api/raceday/`, {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify(body)
        });

        let message = "Bet saved successfully!";

        try {
            const data = await submitRes.json();
            const playerName = PLAYER_MAP[data.player_id] || "Player";
            message = `${playerName}'s bet has been added!`;
        } catch {}

        // Refresh Race Day immediately
        loadRaceStats();

        resultBox.style.display = "block";
        resultBox.innerText = message;

        form.reset();
    };
}


/* ============================================================
   RACE DAY — UPDATE RESULT
   ============================================================ */

async function updateRaceResult(id, result) {
    if (!id) {
        console.error("updateRaceResult called with undefined ID");
        return;
    }

    await fetch(`${API}/api/raceday/${id}/result`, {
        method: "PATCH",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ result })
    });

    loadRaceStats();
}


/* ============================================================
   RACE DAY — LOAD STATS + CARDS (WITH NEW GROUP SUMMARY TILE)
   ============================================================ */

async function loadRaceStats() {

    // 1. Ensure PLAYER_MAP is populated
    if (Object.keys(PLAYER_MAP).length === 0) {
        const res = await fetch(`${API}/players/`);
        const players = await res.json();
        players.forEach(p => PLAYER_MAP[p.id] = p.name);
    }

    // 2. Fetch all bets
    const listRes = await fetch(`${API}/api/raceday/`);
    const bets = await listRes.json();

    const list = document.getElementById("raceList");

    // 3. Group bets by player
    const playerGroups = {};
    bets.forEach(b => {
        const playerName = PLAYER_MAP[b.player_id] || "Unknown";
        if (!playerGroups[playerName]) playerGroups[playerName] = [];
        playerGroups[playerName].push(b);
    });

    // 4. Render grouped Race Day list
    list.innerHTML = `
        <div class="player-bets-wrapper">
            ${Object.keys(playerGroups).map(player => `
                <div class="player-bet-block">

                    <h2 class="player-bet-header collapsible-header" data-player="${player}">
                        <span class="chevron">▼</span> ${player}
                    </h2>

                    <div class="player-bet-inner">
                        ${playerGroups[player]
                            .sort((a, b) => a.race_time.localeCompare(b.race_time))
                            .map(b => renderRaceCard(b))
                            .join("")}
                    </div>

                </div>
            `).join("")}
        </div>
    `;

    // 4B. Enable collapsible sections
    document.querySelectorAll(".collapsible-header").forEach(header => {
        header.addEventListener("click", () => {
            const block = header.closest(".player-bet-block");
            block.classList.toggle("collapsed");
        });
    });

    // 5. Fetch group stats
    const statsRes = await fetch(`${API}/api/raceday/stats`);
    const stats = await statsRes.json();

    // 6. Calculate summary values
    const totalBets = bets.length;
    const wins = bets.filter(b => b.result === "Win").length;
    const places = bets.filter(b => b.result === "Place").length;
    const losses = bets.filter(b => b.result === "Lose").length;
    const nr = bets.filter(b => b.result === "NR").length;

    const stake = stats.group.total_stake;
    const returns = stats.group.total_return;
    const profit = stats.group.profit;

    const strikeRate = totalBets ? ((wins / totalBets) * 100).toFixed(1) : 0;
    const roi = stake > 0 ? ((profit / stake) * 100).toFixed(1) : 0;

    const highestReturn = Math.max(...bets.map(b => b.return_amount || 0));

    const topPlayerObj = stats.players.reduce((best, p) =>
        p.profit > best.profit ? p : best,
        { profit: -Infinity, player: { name: "—" } }
    );

    // 7. Inject values into Group Summary tiles
    document.getElementById("gsWins").textContent = wins;
    document.getElementById("gsPlaces").textContent = places;
    document.getElementById("gsLosses").textContent = losses;
    document.getElementById("gsNR").textContent = nr;

    document.getElementById("gsStake").textContent = "£" + stake.toFixed(2);
    document.getElementById("gsReturns").textContent = "£" + returns.toFixed(2);
    document.getElementById("gsProfit").textContent = "£" + profit.toFixed(2);
    document.getElementById("gsROI").textContent = roi + "%";

    const profitBox = document.getElementById("gsProfitBox");
    profitBox.style.borderColor =
        profit > 0 ? "#00c853" :
        profit < 0 ? "#ff4a4a" :
        "rgba(247,198,0,0.25)";

    document.getElementById("gsTotalBets").textContent = totalBets;
    document.getElementById("gsStrikeRate").textContent = strikeRate + "%";
    document.getElementById("gsHighestReturn").textContent = "£" + highestReturn.toFixed(2);
    document.getElementById("gsTopPlayer").textContent = topPlayerObj.player.name;


}


/* ============================================================
   RACE DAY — COMPLETE DAY BUTTON (SAFE WRAPPER)
   ============================================================ */

const completeDayBtn = document.getElementById("completeDayBtn");
if (completeDayBtn) {
    completeDayBtn.onclick = async () => {

        if (!confirm("Are you sure you want to complete the day?")) {
            return;
        }

        const res = await fetch(`${API}/api/raceday/complete`, {
            method: "POST"
        });

        const data = await res.json();

        // NEW JSON SHAPE — FIXED
        const stake = data.summary.total_stake;
        const returns = data.summary.total_return;
        const profit = data.summary.profit;

        alert(
            `Race Day Completed!\n\n` +
            `Total Stake: £${stake.toFixed(2)}\n` +
            `Total Return: £${returns.toFixed(2)}\n` +
            `Profit: £${profit.toFixed(2)}`
        );

        window.location.href = "/stats";
    };
}


/* ============================================================
   COMPLETED ACCAS — PREMIUM BOOKMAKER LAYOUT
   ============================================================ */
function renderAccaHistory(grouped) {
    const container = document.getElementById("accaHistoryContainer");
    if (!container) return;

    container.innerHTML = "";

    const dates = Object.keys(grouped);
    if (!dates.length) {
        container.innerHTML = `<p>No completed accumulators yet.</p>`;
        return;
    }

    dates.forEach(date => {
        const accas = grouped[date];

        container.innerHTML += `
            <h3 class="font-serif text-muted" style="margin-top:1.5rem;">${date}</h3>
        `;

        accas.forEach(a => {
            const statusClass =
                a.status === "win" ? "acca-card-win" :
                a.status === "place" ? "acca-card-place" :
                "acca-card-lose";

            const badgeClass =
                a.status === "win" ? "acca-badge-win" :
                a.status === "place" ? "acca-badge-place" :
                "acca-badge-lose";

            const oddsFraction = (a.combined_decimal_odds != null)
                ? `${(a.combined_decimal_odds - 1).toFixed(2)}/1`
                : "—";

            const picks = a.picks || [];

            container.innerHTML += `
                <div class="acca-card ${statusClass}">
                    <div class="acca-header">
                        <div>
                            <div class="acca-date">
                                ${new Date(a.created_at).toLocaleDateString("en-GB", {
                                    weekday: "long",
                                    year: "numeric",
                                    month: "long",
                                    day: "numeric"
                                })}
                            </div>

                            <div class="acca-sub">
                                Stake: £${(a.stake ?? 5).toFixed(2)} (E/W) • 
                                Odds: ${oddsFraction}
                            </div>
                        </div>

                        <div class="acca-returns">
                            <p class="returns-label">Returns</p>
                            <p class="returns-value ${a.status}">
                                £${(a.total_return ?? 0).toFixed(2)}
                            </p>

                            <span class="acca-status-badge ${badgeClass}">
                                ${a.status === "win" ? "WINNER" :
                                  a.status === "lose" ? "BUSTED" :
                                  a.status.toUpperCase()}
                            </span>
                        </div>
                    </div>

                    <div class="acca-picks-grid">
                        ${picks.map(p => `
                            <div class="pick-tile">
                                <div class="pick-header">
                                    <span class="pick-player">${p.player}</span>
                                    <span class="pick-badge ${p.result.toLowerCase()}">${p.result}</span>
                                </div>

                                <div class="pick-course">${p.course}</div>

                                <div class="pick-horse">
                                    ${p.horse_number ? `(${p.horse_number}) ` : ""}${p.horse_name}
                                </div>

                                <div class="pick-odds">@${p.odds_fraction}</div>
                            </div>
                        `).join("")}
                    </div>
                </div>
            `;
        });
    });
}


/* ============================================================
   STATS PAGE — LOAD LAST 5 COMPLETED ACCAS
   ============================================================ */
async function loadStatsPageHistory() {
    try {
        const container = document.getElementById("accaHistoryContainer");
        if (!container) return;

        const res = await fetch(`${API}/accumulator/history`);
        let data = await res.json();

        data.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        data = data.slice(0, 5);

        const grouped = {};
        data.forEach(h => {
            const date = new Date(h.created_at).toLocaleDateString();
            if (!grouped[date]) grouped[date] = [];
            grouped[date].push(h);
        });

        renderAccaHistory(grouped);

    } catch (err) {
        console.error("Failed to load stats history", err);
    }
}


/* ============================================================
   MONTHLY OVERVIEW (TOP BOX)
   ============================================================ */
async function loadMonthlyOverview() {
    const month = Number(document.getElementById("statsMonth").value);
    const year = Number(document.getElementById("statsYear").value);

    const res = await fetch(`${API}/accumulator/history`);
    const accas = await res.json();

    let total = 0;
    let wins = 0;
    let places = 0;
    let losses = 0;
    let profit = 0;

    accas.forEach(a => {
        const d = new Date(a.created_at);
        if (d.getMonth() + 1 !== month || d.getFullYear() !== year) return;

        total++;

        if (a.status === "win") wins++;
        if (a.status === "place") places++;
        if (a.status === "lose") losses++;

        const stake = Number(a.stake || 0);
        const returns = Number(a.total_return || 0);
        profit += (returns - stake);
    });

    const strikeRate = total > 0 ? ((wins / total) * 100).toFixed(1) : "0.0";

    document.getElementById("monthlyOverview").innerHTML = `
        <div>
            <div class="stat-label">Total Accas</div>
            <div class="stat-value">${total}</div>
        </div>

        <div>
            <div class="stat-label">Wins</div>
            <div class="stat-value">${wins}</div>
        </div>

        <div>
            <div class="stat-label">Places</div>
            <div class="stat-value">${places}</div>
        </div>

        <div>
            <div class="stat-label">Losses</div>
            <div class="stat-value">${losses}</div>
        </div>

        <div>
            <div class="stat-label">Strike Rate</div>
            <div class="stat-value">${strikeRate}%</div>
        </div>

        <div>
            <div class="stat-label">Profit</div>
            <div class="stat-value">£${profit.toFixed(2)}</div>
        </div>
    `;
}

/* ============================================================
   COMPLETED RACE DAYS (NEW)
   ============================================================ */
async function loadCompletedRaceDays() {
    const container = document.getElementById("completedRaceDays");
    if (!container) return;

    const res = await fetch(`${API}/stats/racedays`);
    const days = await res.json();

    if (!days.length) {
        container.innerHTML = "<p>No completed Race Days yet.</p>";
        return;
    }

    container.innerHTML = days.map(day => {

        // Group bets by player
        const grouped = {};
        day.bets.forEach(b => {
            if (!grouped[b.player_name]) grouped[b.player_name] = [];
            grouped[b.player_name].push(b);
        });

        return `
            <div class="completed-day">
                <h3>Race Day — ${new Date(day.date).toLocaleDateString()}</h3>
                <p><strong>Total Stake:</strong> £${day.total_stake.toFixed(2)}</p>
                <p><strong>Total Return:</strong> £${day.total_return.toFixed(2)}</p>
                <p><strong>Profit:</strong> £${day.profit.toFixed(2)}</p>

                <details>
                    <summary>View Bets</summary>

                    <div class="player-bets-outer">
                        ${Object.keys(grouped).map(player => `
                            <div class="player-bet-group">

                                <div class="player-bet-header">${player}</div>

                                <div class="completed-bets-grid">
                                    ${grouped[player].map(b => `
                                        <div class="completed-bet-tile ${b.result.toLowerCase()}">

                                            <div class="bet-header">
                                                <span class="bet-result ${b.result.toLowerCase()}">${b.result}</span>
                                            </div>

                                            <div class="bet-horse">
                                                ${b.horse_number ? `(${b.horse_number}) ` : ""}${b.horse_name}
                                            </div>

                                            <div class="bet-course">${b.course} — ${b.race_time}</div>

                                            <div class="bet-odds">@${b.odds_fraction}</div>

                                            <div class="bet-money">
                                                Stake: £${b.stake.toFixed(2)}<br>
                                                Winnings: £${b.winnings.toFixed(2)}
                                            </div>

                                        </div>
                                    `).join("")}
                                </div>

                            </div>
                        `).join("")}
                    </div>

                </details>
            </div>
        `;
    }).join("");
}


/* ============================================================
   STATS PAGE — PLAYER PERFORMANCE TILES (NEW PREMIUM LAYOUT)
   ============================================================ */

async function loadPlayerStats() {
    const container = document.getElementById("playerStatsContainer");
    if (!container) return;

    const month = Number(document.getElementById("statsMonth").value);
    const year = Number(document.getElementById("statsYear").value);

    // Static player list
    const PLAYERS = ["Craig", "Donald", "Miller", "Nick", "Josh"];

    // Initialise stats
    const stats = {};
    PLAYERS.forEach(p => {
        stats[p] = {
            monthWins: 0,
            wins: 0,
            places: 0,
            losses: 0,
            nr: 0
        };
    });

    // Fetch completed accas
    const res = await fetch(`${API}/accumulator/history`);
    const accas = await res.json();

    accas.forEach(a => {
        const d = new Date(a.created_at);
        const aMonth = d.getMonth() + 1;
        const aYear = d.getFullYear();

        a.picks.forEach(p => {
            if (!stats[p.player]) return;

            const result = p.result.toLowerCase();

            // Lifetime totals
            if (result === "win") stats[p.player].wins++;
            if (result === "place") stats[p.player].places++;
            if (result === "lose") stats[p.player].losses++;
            if (result === "nr") stats[p.player].nr++;

            // Month wins
            if (aMonth === month && aYear === year && result === "win") {
                stats[p.player].monthWins++;
            }
        });
    });

    // Render tiles using the new premium layout
    container.innerHTML = PLAYERS.map(p => {
        const s = stats[p];

        return `
            <div class="player-tile">

                <div class="player-header">
                    <h3>${p}</h3>
                    <p class="month-wins">Month Wins: ${s.monthWins}</p>
                </div>

                <div class="stats-grid">
                    <div class="stat-box wins">
                        <span class="stat-label">WINS</span>
                        <span class="stat-value">${s.wins}</span>
                    </div>

                    <div class="stat-box places">
                        <span class="stat-label">PLACES</span>
                        <span class="stat-value">${s.places}</span>
                    </div>

                    <div class="stat-box losses">
                        <span class="stat-label">LOSSES</span>
                        <span class="stat-value">${s.losses}</span>
                    </div>

                    <div class="stat-box nr">
                        <span class="stat-label">NR</span>
                        <span class="stat-value">${s.nr}</span>
                    </div>
                </div>

            </div>
        `;
    }).join("");
}

/* ============================================================
   NEW — RACE DAY SUMMARY LOADER
   Ensures summary tiles load even when Race Day is opened directly
   ============================================================ */

async function loadRaceDaySummary() {
    try {
        // Fetch completed race days (latest first)
        const res = await fetch(`${API}/stats/racedays`);
        const days = await res.json();

        if (!days.length) {
            console.warn("No completed race days found");
            return;
        }

        // Latest completed Race Day
        const today = days[0];

        // Update Stats Page summary tiles
        document.getElementById("rsStake").textContent =
            "£" + today.total_stake.toFixed(2);

        document.getElementById("rsReturn").textContent =
            "£" + today.total_return.toFixed(2);

        document.getElementById("rsProfit").textContent =
            "£" + Number(today.profit).toFixed(2)

        // -------------------------------
        // Compute Top Player From Bets
        // -------------------------------
        let playerProfits = {};

        today.bets.forEach(b => {
            if (!playerProfits[b.player_name]) {
                playerProfits[b.player_name] = 0;
            }
            playerProfits[b.player_name] += b.winnings - b.stake;
        });

        // Determine top player
        let topPlayer = "—";
        let bestProfit = -Infinity;

        for (const player in playerProfits) {
            if (playerProfits[player] > bestProfit) {
                bestProfit = playerProfits[player];
                topPlayer = player;
            }
        }

        document.getElementById("rsTopPlayer").textContent = topPlayer;

    } catch (err) {
        console.error("Failed to load Race Day summary", err);
    }
}


/* ============================================================
   RACE DAY PLAYER PERFORMANCE (NEW)
   ============================================================ */

async function loadRaceDayPlayerStats() {
    const container = document.getElementById("raceDayPlayerStatsContainer");
    if (!container) return;

    const res = await fetch(`${API}/stats/raceday/players`);
    const players = await res.json();

    renderRaceDayPlayerTiles(players);
}


/* ============================================================
   RACE DAY PLAYER TILES — NEW PREMIUM LAYOUT
   ============================================================ */
function renderRaceDayPlayerTiles(players) {
    const container = document.getElementById("raceDayPlayerStatsContainer");
    container.innerHTML = "";

    players.forEach(p => {
        const tile = document.createElement("div");
        tile.className = "player-tile";

        tile.innerHTML = `
            <div class="player-header">
                <h3>${p.player}</h3>
                <p class="month-wins">Today's Wins: ${p.wins}</p>
            </div>

            <div class="stats-grid">
                <div class="stat-box wins">
                    <span class="stat-label">WINS</span>
                    <span class="stat-value">${p.wins}</span>
                </div>

                <div class="stat-box places">
                    <span class="stat-label">PLACES</span>
                    <span class="stat-value">${p.places}</span>
                </div>

                <div class="stat-box losses">
                    <span class="stat-label">LOSSES</span>
                    <span class="stat-value">${p.loses}</span>
                </div>

                <div class="stat-box nr">
                    <span class="stat-label">NR</span>
                    <span class="stat-value">${p.nr}</span>
                </div>

                <div class="stat-box profit">
                    <span class="stat-label">PROFIT</span>
                    <span class="stat-value">${Number(p.profit).toFixed(2)}</span>

                </div>
            </div>
        `;

        container.appendChild(tile);
    });
}


/* ============================================================
   RACE DAY — DELETE BET
   ============================================================ */

async function deleteRaceBet(id) {
    if (!confirm("Delete this bet?")) return;

    await fetch(`${API}/api/raceday/${id}`, {
        method: "DELETE"
    });

    loadRaceStats();
}


/* ============================================================
   ACCUMULATOR PAGE — CLEAN VERSION
   ============================================================ */

/* ------------------------------------------------------------
   LOAD ACCA HERO (Top summary box)
------------------------------------------------------------ */
async function loadAccaHero() {
    try {
        const oddsEl = document.getElementById("accaOdds");
        const returnsEl = document.getElementById("accaReturns");
        const statusEl = document.getElementById("accaStatus");

        if (!oddsEl || !returnsEl || !statusEl) return;

        const res = await fetch(`${API}/accumulator/`);
        const data = await res.json();

        if (data.status === "no picks" || data.status === "all non runners") {
            oddsEl.textContent = "0.00/1";
            returnsEl.textContent = "£0.00";
            statusEl.textContent = "No Picks";
            statusEl.className = "acca-hero-status acca-status-empty";
            updateAliveBanner(null);
            return;
        }

        if (data.win_acca_odds > 0) {
            oddsEl.textContent = `${(data.win_acca_odds - 1).toFixed(2)}/1`;
        } else if (data.place_acca_odds > 0) {
            oddsEl.textContent = `${(data.place_acca_odds - 1).toFixed(2)}/1 (Place)`;
        } else {
            oddsEl.textContent = "0.00/1";
        }

        const ew = Number(data.ew_250_potential_return) || 0;
        returnsEl.textContent = `£${ew.toFixed(2)}`;

        const status = data.status.toLowerCase();
        statusEl.textContent = status.charAt(0).toUpperCase() + status.slice(1);
        statusEl.className = "acca-hero-status";

        if (status === "live") statusEl.classList.add("acca-status-live");
        else if (status === "win") statusEl.classList.add("acca-status-won");
        else if (status === "place") statusEl.classList.add("acca-status-place");
        else if (status === "lose") statusEl.classList.add("acca-status-busted");
        else statusEl.classList.add("acca-status-empty");

        updateAliveBanner(status);

    } catch (err) {
        console.error("Failed to load acca hero", err);
    }
}


/* ------------------------------------------------------------
   ALIVE BANNER
------------------------------------------------------------ */
function updateAliveBanner(status) {
    const banner = document.getElementById("accaAliveBanner");
    if (!banner) return;

    banner.style.display = (status === "live" || status === "place") ? "block" : "none";
}


/* ------------------------------------------------------------
   LOAD PICKS (Current acca picks)
------------------------------------------------------------ */
async function loadAccaPicks() {
    const container = document.getElementById("accaPicks");
    if (!container) return;

    try {
        const res = await fetch(`${API}/picks/current`);
        const picks = await res.json();

        container.innerHTML = "";

        if (!picks.length) {
            container.innerHTML = "<p>No picks yet.</p>";
            return;
        }

        picks.forEach(p => {
            container.innerHTML += `
    <div class="acca-pick-tile">

        <!-- HEADER: Player + Delete -->
        <div class="pick-header">
            <span class="pick-player">${p.player.name}</span>
            <button class="pick-delete-btn" onclick="deleteAccaPick(${p.id})">✕</button>
        </div>

        <!-- HORSE INFO -->
        <div class="pick-horse-block">
            <div class="pick-horse-line">
                ${p.horse_number ? `<span class="pick-horse-number">(${p.horse_number})</span>` : ""}
                <span class="pick-horse-name">${p.horse_name}</span>
            </div>
            <div class="pick-odds">@${p.odds_fraction}</div>
        </div>

        <!-- COURSE + TIME -->
        <div class="pick-meta">
            ${p.course} • ${p.race_time}
        </div>

        <!-- STATUS BUTTONS -->
        <div class="pick-status-buttons">
            ${["Pending", "Win", "Place", "Lose", "NR"].map(s => `
                <button 
                    class="pick-status-btn ${p.status === s ? 'active' : ''} status-${s.toLowerCase()}"
                    onclick="updateAccaStatus(${p.id}, '${s}')"
                >
                    ${s}
                </button>
            `).join("")}
        </div>

    </div>
`;
        });

    } catch (err) {
        console.error("Failed to load acca picks", err);
    }
}


/* ------------------------------------------------------------
   LOAD STANDINGS
------------------------------------------------------------ */
async function loadAccaStandings() {
    const container = document.getElementById("accaStandings");
    if (!container) return;

    try {
        const res = await fetch(`${API}/accumulator/standings`);
        const standings = await res.json();

        container.innerHTML = "";

        if (!standings.length) {
            container.innerHTML = "<p>No standings available.</p>";
            return;
        }

        standings.forEach(s => {
            container.innerHTML += `
                <div class="acca-standing-item">
                    <span class="acca-standing-player">${s.player}</span>
                    <span class="acca-standing-status">${s.status}</span>
                </div>
            `;
        });

    } catch (err) {
        console.error("Failed to load acca standings", err);
    }
}


/* ------------------------------------------------------------
   UPDATE PICK STATUS
------------------------------------------------------------ */
async function updateAccaStatus(id, status) {
    try {
        await fetch(`${API}/accumulator/${id}/status`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status })
        });

        loadAccaPicks();
        loadAccaHero();
        loadAccaStandings();

    } catch (err) {
        console.error("Failed to update acca status", err);
    }
}


/* ------------------------------------------------------------
   DELETE PICK
------------------------------------------------------------ */
async function deleteAccaPick(id) {
    if (!confirm("Delete this pick?")) return;

    try {
        await fetch(`${API}/accumulator/${id}`, { method: "DELETE" });

        loadAccaPicks();
        loadAccaHero();
        loadAccaStandings();

    } catch (err) {
        console.error("Failed to delete pick", err);
    }
}


/* ------------------------------------------------------------
   COMPLETE ACCA
------------------------------------------------------------ */
const completeBtn = document.getElementById("completeAccaBtn");
if (completeBtn) {
    completeBtn.onclick = async () => {
        if (!confirm("Mark this acca as complete and archive it?")) return;

        const res = await fetch(`${API}/accumulator/complete`, {
            method: "POST"
        });

        if (!res.ok) {
            alert("Could not complete acca.");
            return;
        }

        loadAccaHero();
        loadAccaPicks();
        loadAccaStandings();
    };
}


/* ------------------------------------------------------------
   RESET ACCA
------------------------------------------------------------ */
const resetBtn = document.getElementById("resetAccaBtn");
if (resetBtn) {
    resetBtn.onclick = async () => {
        if (!confirm("Reset the entire acca?")) return;

        await fetch(`${API}/accumulator/reset-all`, {
            method: "DELETE"
        });

        loadAccaHero();
        loadAccaPicks();
        loadAccaStandings();
    };
}
