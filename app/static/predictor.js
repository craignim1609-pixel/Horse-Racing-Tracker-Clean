/* Race Predictor page.  All text is inserted with textContent, never innerHTML,
   so anything typed into a field can't inject markup into the page. */
(function () {
    const API = "/api/predictor";
    const $ = (id) => document.getElementById(id);

    let races = [];          // races for the selected day
    let currentRaceId = null;
    let msgTimer = null;

    /* ---------- small helpers ---------- */
    function el(tag, props, ...kids) {
        const node = document.createElement(tag);
        Object.entries(props || {}).forEach(([k, v]) => {
            if (k === "class") node.className = v;
            else if (k === "text") node.textContent = v;
            else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
            else node.setAttribute(k, v);
        });
        kids.forEach((kid) => kid != null && node.append(kid));
        return node;
    }

    function localToday() {
        const d = new Date();
        const p = (n) => String(n).padStart(2, "0");
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    }

    function showMsg(text, isError) {
        const box = $("predMsg");
        box.textContent = text;
        box.className = "pred-msg" + (isError ? " pred-msg-error" : "");
        clearTimeout(msgTimer);
        msgTimer = setTimeout(() => box.classList.add("hidden"), 5000);
    }

    async function api(method, path, body) {
        const res = await fetch(API + path, {
            method,
            headers: body ? { "Content-Type": "application/json" } : {},
            body: body ? JSON.stringify(body) : undefined,
        });
        let data = null;
        try { data = await res.json(); } catch (e) { /* no body */ }
        if (!res.ok) {
            let msg = "Something went wrong";
            if (data && typeof data.detail === "string") msg = data.detail;
            else if (data && Array.isArray(data.detail) && data.detail[0]) {
                const field = (data.detail[0].loc || []).slice(-1)[0];
                msg = (field ? field + ": " : "") + data.detail[0].msg;
            }
            throw new Error(msg);
        }
        return data;
    }

    const pct = (rec) => `${rec.wins}/${rec.runs} (${Math.round(rec.strike_rate * 100)}%)`;

    /* ---------- day / course / race pickers ---------- */
    async function loadDay(keepRaceId) {
        const date = $("predDate").value;
        races = await api("GET", `/races?date=${encodeURIComponent(date)}`);

        const courseSel = $("predCourse");
        const previousCourse = courseSel.value;
        courseSel.replaceChildren();

        const courses = [...new Set(races.map((r) => r.course))];
        courses.forEach((c) => courseSel.append(el("option", { value: c, text: c })));

        let wanted = previousCourse;
        if (keepRaceId) {
            const r = races.find((x) => x.id === keepRaceId);
            if (r) wanted = r.course;
        }
        if (courses.includes(wanted)) courseSel.value = wanted;

        fillRaceSelect(keepRaceId);
    }

    function fillRaceSelect(preferId) {
        const raceSel = $("predRace");
        raceSel.replaceChildren();
        const course = $("predCourse").value;
        const list = races.filter((r) => r.course === course);

        list.forEach((r) => {
            const label = `${r.race_time}${r.name ? " - " + r.name : ""} (${r.runner_count} runner${r.runner_count === 1 ? "" : "s"})`;
            raceSel.append(el("option", { value: String(r.id), text: label }));
        });

        const empty = list.length === 0;
        $("raceEmpty").classList.toggle("hidden", !empty);
        $("racePanel").classList.toggle("hidden", empty);
        raceSel.disabled = empty;

        if (empty) { currentRaceId = null; return; }

        const pick = list.find((r) => r.id === preferId) || list[0];
        raceSel.value = String(pick.id);
        loadRace(pick.id);
    }

    /* ---------- race view ---------- */
    async function loadRace(id) {
        currentRaceId = id;
        try {
            renderRace(await api("GET", `/races/${id}`));
        } catch (e) { showMsg(e.message, true); }
    }

    function renderRace(race) {
        $("raceTitle").textContent = `${race.course} ${race.race_time}`;
        $("raceSub").textContent = [race.name, race.distance].filter(Boolean).join(" · ");
        $("minRuns").textContent = race.combo_min_runs;
        $("minRate").textContent = Math.round(race.combo_min_strike_rate * 100);

        // summary line
        const n = race.runners.length;
        let summary = `${n} runner${n === 1 ? "" : "s"}`;
        if (race.priced_runners < n) summary += ` · ${race.priced_runners} priced`;
        const underround = race.overround !== null && race.overround < 0;
        if (race.overround !== null && !underround) summary += ` · bookmaker margin ${race.overround}%`;
        const priced = race.runners.filter((r) => r.chance !== null);
        const fav = priced.length ? priced.reduce((a, b) => (b.chance > a.chance ? b : a)) : null;
        if (fav) summary += ` · favourite: ${fav.horse_name} (${fav.chance}%)`;
        const sumBox = $("raceSummary");
        sumBox.replaceChildren(el("span", { text: summary }));
        if (n > 0 && race.priced_runners < n) {
            sumBox.append(el("span", { class: "pred-warn", text: " Enter odds for every runner for accurate chances." }));
        } else if (underround) {
            sumBox.append(el("span", { class: "pred-warn", text: " The odds add up to under 100%, so a runner is probably missing - the chances below are inflated." }));
        }
        if (n > 0) {
            sumBox.append(el("div", { class: "pred-small pred-block", text: "Chances are relative to the runners entered, so add the whole field for the full picture." }));
        }

        // rows
        const body = $("runnerRows");
        body.replaceChildren();
        if (n === 0) {
            body.append(el("tr", {}, el("td", { colspan: "10", class: "pred-empty-row", text: "No runners yet - add the first one below." })));
        }
        race.runners.forEach((r) => body.append(runnerRow(r, fav && fav.id === r.id)));
    }

    function editable(runner, field, extraClass, placeholder) {
        const input = el("input", {
            class: "pred-cell-input " + (extraClass || ""),
            value: runner[field] || "",
            placeholder: placeholder || "",
            "aria-label": field,
        });
        input.addEventListener("change", async () => {
            try {
                renderRace(await api("PATCH", `/runners/${runner.id}`, { [field]: input.value }));
                refreshDayCounts();
            } catch (e) {
                showMsg(e.message, true);
                input.value = runner[field] || "";
            }
        });
        return input;
    }

    function recordCell(rec) {
        return el("td", { class: "pred-num", text: rec ? pct(rec) : "-" });
    }

    function runnerRow(r, isFav) {
        const tr = el("tr", { class: isFav ? "pred-fav" : "" });
        tr.append(el("td", { class: "pred-horse", text: r.horse_name }));
        tr.append(el("td", {}, editable(r, "form", "pred-w-form")));
        tr.append(el("td", {}, editable(r, "jockey", "pred-w-name")));
        tr.append(el("td", {}, editable(r, "trainer", "pred-w-name")));
        tr.append(el("td", {}, editable(r, "sky_odds", "pred-w-odds", "5/2")));
        tr.append(el("td", { class: "pred-num pred-chance", text: r.chance === null ? "-" : r.chance + "%" }));
        tr.append(recordCell(r.jockey_record));
        tr.append(recordCell(r.trainer_record));

        const combo = el("td", { class: "pred-combo" });
        if (r.combo_record) {
            combo.append(el("span", { text: pct(r.combo_record) }));
            if (r.formidable_combo) {
                combo.append(el("span", { class: "pred-badge", text: "Formidable", title: "Strong record together over a meaningful number of runs" }));
            } else if (r.combo_record.runs < $("minRuns").textContent * 1) {
                combo.append(el("span", { class: "pred-small", text: " small sample" }));
            }
        } else {
            combo.textContent = "-";
        }
        tr.append(combo);

        const del = el("button", { type: "button", class: "pred-x", title: "Remove runner", "aria-label": "Remove " + r.horse_name, text: "✕" });
        del.addEventListener("click", async () => {
            if (!confirm(`Remove ${r.horse_name}?`)) return;
            try {
                renderRace(await api("DELETE", `/runners/${r.id}`));
                refreshDayCounts();
            } catch (e) { showMsg(e.message, true); }
        });
        tr.append(el("td", {}, del));
        return tr;
    }

    // keep the "(N runners)" labels in the race dropdown current
    async function refreshDayCounts() {
        const keep = currentRaceId;
        races = await api("GET", `/races?date=${encodeURIComponent($("predDate").value)}`);
        const course = $("predCourse").value;
        const raceSel = $("predRace");
        races.filter((r) => r.course === course).forEach((r) => {
            const opt = [...raceSel.options].find((o) => o.value === String(r.id));
            if (opt) opt.textContent = `${r.race_time}${r.name ? " - " + r.name : ""} (${r.runner_count} runner${r.runner_count === 1 ? "" : "s"})`;
        });
        raceSel.value = String(keep);
    }

    /* ---------- add race / add runner ---------- */
    $("addRaceForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        try {
            const res = await api("POST", "/races", {
                race_date: $("predDate").value,
                course: $("newCourse").value,
                race_time: $("newTime").value,
                name: $("newName").value,
                distance: $("newDistance").value,
            });
            $("newTime").value = ""; $("newName").value = ""; $("newDistance").value = "";
            await loadDay(res.id);
            showMsg("Race added. Now add the runners below.");
        } catch (err) { showMsg(err.message, true); }
    });

    $("addRunnerForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!currentRaceId) return;
        try {
            renderRace(await api("POST", `/races/${currentRaceId}/runners`, {
                horse_name: $("rHorse").value,
                form: $("rForm").value,
                jockey: $("rJockey").value,
                trainer: $("rTrainer").value,
                sky_odds: $("rOdds").value,
            }));
            ["rHorse", "rForm", "rJockey", "rTrainer", "rOdds"].forEach((id) => ($(id).value = ""));
            $("rHorse").focus();
            refreshDayCounts();
        } catch (err) { showMsg(err.message, true); }
    });

    $("deleteRaceBtn").addEventListener("click", async () => {
        if (!currentRaceId || !confirm("Delete this race and all its runners?")) return;
        try {
            await api("DELETE", `/races/${currentRaceId}`);
            await loadDay();
        } catch (err) { showMsg(err.message, true); }
    });

    /* ---------- pickers ---------- */
    $("predDate").addEventListener("change", () => loadDay().catch((e) => showMsg(e.message, true)));
    $("predCourse").addEventListener("change", () => fillRaceSelect());
    $("predRace").addEventListener("change", (e) => loadRace(Number(e.target.value)));

    /* ---------- jockey / trainer records ---------- */
    function syncStatFields() {
        const kind = $("sKind").value;
        $("sJockeyWrap").classList.toggle("hidden", kind === "trainer");
        $("sTrainerWrap").classList.toggle("hidden", kind === "jockey");
    }
    $("sKind").addEventListener("change", syncStatFields);

    async function loadStats() {
        const rows = await api("GET", "/stats");
        const body = $("statRows");
        body.replaceChildren();
        if (!rows.length) {
            body.append(el("tr", {}, el("td", { colspan: "7", class: "pred-empty-row", text: "No records saved yet." })));
            return;
        }
        const label = { jockey: "Jockey", trainer: "Trainer", combo: "Jockey + trainer" };
        rows.forEach((s) => {
            const del = el("button", { type: "button", class: "pred-x", title: "Delete record", "aria-label": "Delete record", text: "✕" });
            del.addEventListener("click", async () => {
                if (!confirm("Delete this record?")) return;
                try { await api("DELETE", `/stats/${s.id}`); await loadStats(); if (currentRaceId) loadRace(currentRaceId); }
                catch (err) { showMsg(err.message, true); }
            });
            body.append(el("tr", {},
                el("td", { text: label[s.kind] }),
                el("td", { text: s.jockey || "-" }),
                el("td", { text: s.trainer || "-" }),
                el("td", { class: "pred-num", text: String(s.runs) }),
                el("td", { class: "pred-num", text: String(s.wins) }),
                el("td", { class: "pred-num", text: Math.round(s.strike_rate * 100) + "%" }),
                el("td", {}, del)
            ));
        });
    }

    $("statForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        try {
            await api("POST", "/stats", {
                kind: $("sKind").value,
                jockey: $("sJockey").value,
                trainer: $("sTrainer").value,
                runs: Number($("sRuns").value),
                wins: Number($("sWins").value),
            });
            ["sJockey", "sTrainer", "sRuns", "sWins"].forEach((id) => ($(id).value = ""));
            await loadStats();
            if (currentRaceId) loadRace(currentRaceId);
            showMsg("Record saved.");
        } catch (err) { showMsg(err.message, true); }
    });

    /* ---------- start ---------- */
    async function init() {
        $("predDate").value = localToday();
        syncStatFields();
        try {
            const courses = await api("GET", "/courses");
            const list = $("courseList");
            courses.forEach((c) => list.append(el("option", { value: c })));
            await loadDay();
            await loadStats();
        } catch (e) { showMsg(e.message, true); }
    }
    init();
})();
