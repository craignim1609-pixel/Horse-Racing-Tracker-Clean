console.log("APP.JS VERSION: 10001");
console.log("History containers:", document.querySelectorAll("#accaHistory").length);

/* ============================================================
   GLOBALS + HELPERS
   ============================================================ */

const API = "https://horse-racing-tracker-production.up.railway.app";

let FILTERED_BETS = [];
let PLAYER_MAP = {};
let ALL_BETS = [];
let FILTER_MODE = "all"; // "all" or "today"

/* Icons for results */
function getIcons() {
    return {
        "Win": "🟢",
        "Place": "🔵",
        "Lose": "🔴",
        "NR": "⚪",
        "Pending": "⏳"
    };
}

/* Group bets by course → time */
function groupBets(bets) {
    const grouped = {};
    bets.forEach(b => {
        if (!grouped[b.course]) grouped[b.course] = {};
        if (!grouped[b.course][b.race_time]) grouped[b.course][b.race_time] = [];
        grouped[b.course][b.race_time].push(b);
    });
    return grouped;
}

function fractionalToDecimal(frac) {
    if (!frac) return 1.0;

    // If user enters decimal already (e.g. "3.5")
    if (!frac.includes("/")) {
        const d = parseFloat(frac);
        return isNaN(d) ? 1.0 : d;
    }

    // Fractional odds: A/B → decimal = (A/B) + 1
    const [a, b] = frac.split("/").map(Number);
    if (!a || !b) return 1.0;

    return (a / b) + 1;
}

function placeOdds(decimalOdds) {
    // fractional odds = decimal - 1
    const frac = decimalOdds - 1;
    return (frac / 4) + 1;
}

function calculateAccaOdds(bets) {
    const active = bets.filter(b => b.result !== "Lose");

    if (!active.length) return 1.0;

    return active.reduce((acc, b) => {
        const dec = fractionalToDecimal(b.odds_fraction);
        return acc * dec;
    }, 1);
}

function ewReturns(accaDecimal) {
    const place = placeOdds(accaDecimal);
    return (2.5 * accaDecimal) + (2.5 * place);
}

function calculateWinnings(bet) {
    const dec = fractionalToDecimal(bet.odds_fraction);
    const stake = parseFloat(bet.amount_bet || 0);

    if (bet.result === "Win") {
        return stake * dec;
    }

    if (bet.result === "Place") {
        return stake * placeOdds(dec);
    }

    if (bet.result === "NR") {
        return stake; // stake returned
    }

    return 0;
}

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
   HOME PAGE
   ============================================================ */

async function loadPodium() {
    const month = new Date().getMonth() + 1;
    const year = new Date().getFullYear();

    const res = await fetch(`${API}/stats/month/${month}?year=${year}`);
    const stats = await res.json();

    const sorted = stats.sort((a, b) => b.wins - a.wins);

    document.getElementById("firstPlayer").innerText = sorted[0]?.player || "-";
    document.getElementById("secondPlayer").innerText = sorted[1]?.player || "-";
    document.getElementById("thirdPlayer").innerText = sorted[2]?.player || "-";
}

async function loadAccumulator() {
    const res = await fetch(`${API}/accumulator/`);
    const data = await res.json();
    document.getElementById("accumulator").innerHTML = JSON.stringify(data, null, 2);
}


/* ============================================================
   ADD PICK
   ============================================================ */

function setupAddPickForm() {
    const form = document.getElementById("pickForm");
    const resultBox = document.getElementById("resultBox");

    form.onsubmit = async (e) => {
        e.preventDefault();

        const body = Object.fromEntries(new FormData(form).entries());

        // Validate odds format
        if (!/^\d+\/\d+$/.test(body.odds_fraction)) {
            resultBox.style.display = "block";
            resultBox.style.background = "#5a0000";
            resultBox.innerText = "Odds must be in fraction format (e.g. 5/2).";
            return;
        }

        const res = await fetch(`${API}/picks/`, {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify(body)
        });

        if (!res.ok) {
            const errorText = await res.text();
            resultBox.style.display = "block";
            resultBox.style.background = "#5a0000";
            resultBox.innerText = errorText;
            return;
        }

        // Success
        resultBox.style.display = "block";
        resultBox.style.background = "#0f2a0f";
        resultBox.innerText = "Pick added successfully!";

        form.reset();
    };
}

async function loadPlayersForAddPick() {
    const dropdown = document.getElementById("playerSelect");

    const res = await fetch(`${API}/players/`);
    const players = await res.json();

    dropdown.innerHTML = '<option value="">Select Player</option>';

    players.forEach(p => {
        dropdown.innerHTML += `<option value="${p.id}">${p.name}</option>`;
    });
}


/* ============================================================
   CURRENT PICKS
   ============================================================ */

async function loadCurrentPicks() {
    const res = await fetch(`${API}/accumulator/`);
    const data = await res.json();
    const picks = data.picks;

    const container = document.getElementById("currentPicks");

    if (!picks.length) {
        container.innerHTML = "<p>No active picks right now.</p>";
        return;
    }

    container.innerHTML = picks.map(p => `
        <div class="pick-card">
            <div class="pick-header">${p.horse_name} <span style="color:white;">(${p.odds_fraction})</span></div>

            <div class="pick-meta">
                Player: ${p.player.name}<br>
                Course: ${p.course}<br>
                Time: ${p.race_time}<br>
                Horse No: ${p.horse_number}
            </div>

            <div class="result-buttons">
                <button type="button" onclick="updateResult(${p.id}, 'Win')">Win</button>
                <button type="button" onclick="updateResult(${p.id}, 'Place')">Place</button>
                <button type="button" onclick="updateResult(${p.id}, 'Lose')">Lose</button>
                <button type="button" onclick="updateResult(${p.id}, 'NR')">NR</button>
            </div>
        </div>
    `).join("");
}

async function updateResult(id, result) {
    await fetch(`${API}/accumulator/${id}/status`, {
        method: "PATCH",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ status: result })
    });

    loadCurrentPicks();
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
    ALL_BETS = await listRes.json();
    const bets = [...ALL_BETS];

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

    // 8. Apply filters if active
    if (FILTERED_BETS && FILTERED_BETS.length > 0) {
        renderFilteredBets();
    }

    // 9. Load recent activity
    loadRecentActivity();
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
   STATS PAGE
   ============================================================ */


/* ============================================================
   DASHBOARD LOADER (month + year)
   ============================================================ */
async function loadStatsDashboard(month, year) {
    try {
        const res = await fetch(`${API}/stats/dashboard?month=${month}&year=${year}`);
        if (!res.ok) {
            console.error("Failed to load stats dashboard", res.status);
            return;
        }

        const data = await res.json();
        renderPlayerTiles(data.players || []);
    } catch (err) {
        console.error("Error loading stats dashboard", err);
    }
}


/* ============================================================
   PLAYER TILES — NEW PREMIUM LAYOUT
   ============================================================ */
function renderPlayerTiles(players) {
    const container = document.getElementById("playerStatsContainer");
    container.innerHTML = "";

    players.forEach(p => {
        const tile = document.createElement("div");
        tile.className = "player-tile";

        tile.innerHTML = `
            <div class="player-header">
                <h3>${p.player}</h3>
                <p class="month-wins">Month Wins: ${p.monthWins}</p>
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

            const picks = a.picks_json || [];

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
                                    ${p.horse_number ? `(${p.horse_number}) ` : ""}${p.horse}
                                </div>

                                <div class="pick-odds">@${p.odds}</div>
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

// ============================
// EXPORT MODAL LOGIC (SAFE)
// ============================
const modal = document.getElementById("exportModal");
const openBtn = document.getElementById("openExportModal");
const closeBtn = document.getElementById("closeExportModal");

if (modal && openBtn && closeBtn) {

    openBtn.addEventListener("click", () => {
        modal.classList.remove("hidden");
    });

    closeBtn.addEventListener("click", () => {
        modal.classList.add("hidden");
    });

    // Close modal when clicking outside content
    modal.addEventListener("click", (e) => {
        if (e.target === modal) {
            modal.classList.add("hidden");
        }
    });
}

// ============================
// EXPORT HANDLERS
// ============================
document.querySelectorAll(".export-option").forEach(btn => {
    btn.addEventListener("click", async () => {
        const type = btn.dataset.type;

        const endpoints = {
            "raceday-excel": "/stats/export/raceday/excel",
            "raceday-pdf": "/stats/export/raceday/pdf",
            "acca-excel": "/stats/export/acca/excel",
            "acca-pdf": "/stats/export/acca/pdf",
            "summary-excel": "/stats/export/summary/excel",
            "summary-pdf": "/stats/export/summary/pdf",
        };

        const url = endpoints[type];
        const response = await fetch(url);
        const blob = await response.blob();

        const downloadUrl = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = downloadUrl;
        a.download = url.split("/").pop() + (type.includes("pdf") ? ".pdf" : ".xlsx");
        a.click();
        window.URL.revokeObjectURL(downloadUrl);
    });
});


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
   PLAYER DETAILS (unchanged)
   ============================================================ */
function setupPlayerDetailsForm() {
    const form = document.getElementById("playerForm");
    const profile = document.getElementById("playerProfile");

    form.onsubmit = async (e) => {
        e.preventDefault();

        const name = new FormData(form).get("name");

        const res = await fetch(`${API}/stats/player/${name}`);
        const data = await res.json();

        const profitColor =
            data.profit > 0 ? "#0f7a0f" :
            data.profit < 0 ? "#7a0f0f" :
            "#555";

        const formBadges = data.recent_form.map(r => {
            const cls =
                r === "W" ? "form-win" :
                r === "P" ? "form-place" :
                r === "L" ? "form-lose" :
                "form-nr";
            return `<span class="${cls}">${r}</span>`;
        }).join("");

        profile.innerHTML = `
            <div class="profile-header">${data.player}</div>

            <div class="profile-section" style="border-left: 6px solid ${profitColor}">
                <h3>Overall Performance</h3>
                Wins: ${data.wins}<br>
                Places: ${data.places}<br>
                Loses: ${data.loses}<br>
                NR: ${data.nr}<br>
                Win Rate: ${(data.win_rate * 100).toFixed(1)}%
            </div>

            <div class="profile-section">
                <h3>Biggest Priced Winner</h3>
                ${data.biggest_winner ? `
                    ${data.biggest_winner.horse_name} (${data.biggest_winner.odds_fraction})
                ` : "No wins yet."}
            </div>

            <div class="profile-section">
                <h3>Recent Form</h3>
                <div class="recent-form">${formBadges}</div>
            </div>
        `;
    };
}


/* ============================================================
   STATS PAGE — GROUP PERFORMANCE SUMMARY
   ============================================================ */

async function loadGroupSummary() {
    const box = document.getElementById("groupSummary");
    if (!box) return;

    const month = Number(document.getElementById("statsMonth").value);
    const year = Number(document.getElementById("statsYear").value);

    const res = await fetch(`${API}/accumulator/history`);
    const accas = await res.json();

    let totalAccas = 0;
    let wins = 0;
    let places = 0;
    let losses = 0;
    let totalStake = 0;
    let totalReturn = 0;

    accas.forEach(a => {
        const d = new Date(a.created_at);
        const aMonth = d.getMonth() + 1;
        const aYear = d.getFullYear();

        if (aMonth !== month || aYear !== year) return;

        totalAccas++;
        totalStake += a.stake ?? 0;
        totalReturn += a.total_return ?? 0;

        if (a.status === "win") wins++;
        if (a.status === "place") places++;
        if (a.status === "lose") losses++;
    });

    const profit = totalReturn - totalStake;
    const strikeRate = totalAccas ? ((wins / totalAccas) * 100).toFixed(1) : 0;

    box.innerHTML = `
        <div class="summary-tile">
            <div class="label">Total Accas</div>
            <div class="value">${totalAccas}</div>
        </div>

        <div class="summary-tile">
            <div class="label">Wins</div>
            <div class="value" style="color:#0a4">${wins}</div>
        </div>

        <div class="summary-tile">
            <div class="label">Places</div>
            <div class="value" style="color:#06c">${places}</div>
        </div>

        <div class="summary-tile">
            <div class="label">Losses</div>
            <div class="value" style="color:#900">${losses}</div>
        </div>

        <div class="summary-tile">
            <div class="label">Strike Rate</div>
            <div class="value">${strikeRate}%</div>
        </div>

        <div class="summary-tile">
            <div class="label">Profit</div>
            <div class="value" style="color:${profit >= 0 ? '#0a4' : '#900'}">
                £${profit.toFixed(2)}
            </div>
        </div>
    `;
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
   NEW — FULL STATS PAGE LOADER
   Ensures ALL Stats Page sections load together
   ============================================================ */

async function loadFullStatsPage() {
    try {
        // Monthly Overview
        if (document.getElementById("monthlyOverview")) {
            await loadMonthlyOverview();
        }

        // Group Summary
        if (document.getElementById("groupSummary")) {
            await loadGroupSummary();
        }

        // Player Stats (Acca)
        if (document.getElementById("playerStatsContainer")) {
            await loadPlayerStats();
        }

        // Completed Acca History
        if (document.getElementById("accaHistoryContainer")) {
            await loadStatsPageHistory();
        }

        // Today's Race Day Summary (NEW)
        if (document.getElementById("raceDaySummary")) {
            await loadRaceDaySummary();
        }

        // Race Day Player Performance (NEW)
        if (document.getElementById("raceDayPlayerStatsContainer")) {
            await loadRaceDayPlayerStats();
        }

        // Completed Race Days (NEW)
        if (document.getElementById("completedRaceDays")) {
            await loadCompletedRaceDays();
        }

    } catch (err) {
        console.error("Failed to load full stats page", err);
    }
}

/* ============================================================
   RECENT ACTIVITY
   ============================================================ */

async function loadRecentActivity() {
    const box = document.getElementById("recentActivity");
    if (!box) return; // Prevent crash if container doesn't exist

    const res = await fetch(`${API}/api/raceday/recent`);
    const items = await res.json();

    if (!items.length) {
        box.innerHTML = "No race day bets recorded yet.";
        return;
    }

    const icons = getIcons();

    box.innerHTML = items.map(a => {
        const stake = parseFloat(a.amount_bet || 0);
        const winnings = calculateWinnings(a);
        const profit = winnings - stake;

        return `
            <div class="activity-card-modern">

                <div class="activity-left">
                    <div class="stake-box">
                        <span class="stake-label">Stake</span>
                        <span class="stake-value">£${stake.toFixed(2)}</span>
                    </div>
                </div>

                <div class="activity-middle">
                    <div class="horse-line">
                        ${a.horse_number ? `<span class="horse-number">(${a.horse_number})</span>` : ""}
                        <span class="horse-name">${a.horse_name}</span>
                        <span class="horse-odds">@${a.odds_fraction}</span>
                    </div>

                    <div class="meta-line">
                        <span class="meta-player">${PLAYER_MAP[a.player_id] || "Unknown"}</span>
                        <span>${a.course}</span>
                        <span>${a.race_time}</span>
                    </div>
                </div>

                <div class="activity-right">
                    <div class="winnings-label">Winnings</div>
                    <div class="winnings-value ${profit > 0 ? "profit-pos" : profit < 0 ? "profit-neg" : ""}">
                        £${winnings.toFixed(2)}
                    </div>
                </div>

            </div>
        `;
    }).join("");
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
   FILTER BAR — TODAY ONLY / ALL BETS
   ============================================================ */

function filterToday() {
    FILTER_MODE = "today";

    document.querySelectorAll(".filter-btn").forEach(btn => btn.classList.remove("active"));
    document.querySelector(".filter-btn:nth-child(1)").classList.add("active");

    renderFilteredBets();
}

function filterAll() {
    FILTER_MODE = "all";

    document.querySelectorAll(".filter-btn").forEach(btn => btn.classList.remove("active"));
    document.querySelector(".filter-btn:nth-child(2)").classList.add("active");

    renderFilteredBets();
}


/* ============================================================
   RENDER FILTERED BETS (PLAYER-GROUPED)
   ============================================================ */

function renderFilteredBets() {
    const list = document.getElementById("raceList");

    // If no filters active → reload full Race Day
    if (!FILTERED_BETS || FILTERED_BETS.length === 0) {
        loadRaceStats();
        return;
    }

    // Group filtered bets by player
    const playerGroups = {};
    FILTERED_BETS.forEach(b => {
        const playerName = PLAYER_MAP[b.player_id] || "Unknown";
        if (!playerGroups[playerName]) playerGroups[playerName] = [];
        playerGroups[playerName].push(b);
    });

    // Build the player-grouped layout
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

    // Enable collapsible behaviour
    document.querySelectorAll(".collapsible-header").forEach(header => {
        header.addEventListener("click", () => {
            const block = header.closest(".player-bet-block");
            block.classList.toggle("collapsed");
        });
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


/* ------------------------------------------------------------
   PAGE INIT
------------------------------------------------------------ */
document.addEventListener("DOMContentLoaded", () => {
    if (document.getElementById("accaOdds")) {
        loadAccaHero();
        loadAccaPicks();
        loadAccaStandings();
    }

    if (document.getElementById("accaHistoryContainer")) {
        loadStatsPageHistory();
    }
});
