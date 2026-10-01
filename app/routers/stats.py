# ============================================================
# IMPORTS
# ============================================================
from fastapi import APIRouter, Depends, Request, Response
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func
from datetime import datetime
from io import BytesIO

from app.database import get_db
from app import models


# ============================================================
# ROUTER SETUP
# ============================================================
router = APIRouter(prefix="/stats", tags=["Stats"])
templates = Jinja2Templates(directory="app/templates")


# ============================================================
# STATS PAGE (HTML)
# ============================================================
@router.get("")
def stats_home(request: Request):
    return templates.TemplateResponse("stats.html", {
        "request": request,
        "active": "stats"
    })


# ============================================================
# MONTHLY STATS
# ============================================================
@router.get("/month/{month}")
def monthly_stats(month: int, year: int, db: Session = Depends(get_db)):
    players = db.query(models.Player).all()
    results = []

    for p in players:
        picks = db.query(models.Pick).filter(
            models.Pick.player_id == p.id
        ).all()

        wins = sum(1 for x in picks if x.status == "Win")
        places = sum(1 for x in picks if x.status == "Place")
        loses = sum(1 for x in picks if x.status == "Lose")
        nr = sum(1 for x in picks if x.status == "NR")

        results.append({
            "player": p.name,
            "wins": wins,
            "places": places,
            "loses": loses,
            "nr": nr
        })

    return results


# ============================================================
# PLAYER DETAILS
# ============================================================
@router.get("/player/{name}")
def player_details(name: str, db: Session = Depends(get_db)):
    player = db.query(models.Player).filter_by(name=name).first()
    if not player:
        return {"error": "Player not found"}

    picks = db.query(models.Pick).filter_by(player_id=player.id).all()

    wins = sum(1 for p in picks if p.status == "Win")
    places = sum(1 for p in picks if p.status == "Place")
    loses = sum(1 for p in picks if p.status == "Lose")
    nr = sum(1 for p in picks if p.status == "NR")

    total = wins + places + loses
    win_rate = wins / total if total > 0 else 0

    biggest = None
    for p in picks:
        if p.status == "Win":
            try:
                frac = p.odds_fraction
                if "/" in frac:
                    a, b = frac.split("/")
                    dec = (float(a) / float(b)) + 1
                else:
                    dec = float(frac)

                if biggest is None or dec > biggest["decimal"]:
                    biggest = {
                        "horse_name": p.horse_name,
                        "odds_fraction": p.odds_fraction,
                        "decimal": dec
                    }
            except:
                continue

    recent = [p.status[0].upper() for p in picks[-5:]]

    return {
        "player": player.name,
        "wins": wins,
        "places": places,
        "loses": loses,
        "nr": nr,
        "win_rate": win_rate,
        "biggest_winner": biggest,
        "recent_form": recent
    }


# ============================================================
# ACCA PERFORMANCE CENTER
# ============================================================
@router.get("/acca")
def acca_stats(db: Session = Depends(get_db)):
    q = db.query(models.AccaHistory)

    total_accas = q.count()
    wins = q.filter(models.AccaHistory.status == "win").count()
    places = q.filter(models.AccaHistory.status == "place").count()
    loses = q.filter(models.AccaHistory.status == "lose").count()

    total_profit = db.query(
        func.coalesce(func.sum(models.AccaHistory.total_return), 0.0)
    ).scalar()

    biggest_return = db.query(
        func.coalesce(func.max(models.AccaHistory.total_return), 0.0)
    ).scalar()

    recent = (
        q.order_by(models.AccaHistory.created_at.desc())
         .limit(5)
         .all()
    )

    recent_payload = [
        {
            "status": r.status,
            "total_return": float(r.total_return or 0),
            "combined_decimal_odds": float(r.combined_decimal_odds or 0),
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in recent
    ]

    return {
        "total_accas": total_accas,
        "wins": wins,
        "places": places,
        "loses": loses,
        "total_profit": float(total_profit or 0),
        "biggest_return": float(biggest_return or 0),
        "recent": recent_payload,
        "player_contribution": [],
    }


# ============================================================
# DASHBOARD (used by stats.html)
# ============================================================
@router.get("/dashboard")
def stats_dashboard(db: Session = Depends(get_db)):
    players = db.query(models.Player).all()

    player_stats = {
        p.name: {"wins": 0, "places": 0, "loses": 0, "nr": 0}
        for p in players
    }

    history = db.query(models.AccaHistory).all()

    for h in history:
        for pick in h.picks_json:
            name = pick.get("player")
            result = pick.get("result")

            if name not in player_stats:
                continue

            if result == "Win":
                player_stats[name]["wins"] += 1
            elif result == "Place":
                player_stats[name]["places"] += 1
            elif result == "Lose":
                player_stats[name]["loses"] += 1
            elif result == "NR":
                player_stats[name]["nr"] += 1

    player_stats_list = [
        {"player": name, **stats}
        for name, stats in player_stats.items()
    ]

    history_rows = (
        db.query(models.AccaHistory)
        .order_by(models.AccaHistory.created_at.desc())
        .all()
    )

    grouped = {}

    for h in history_rows:
        if not h.created_at:
            continue

        date_key = h.created_at.strftime("%A, %d %B %Y")

        if date_key not in grouped:
            grouped[date_key] = []

        grouped[date_key].append({
            "status": h.status,
            "combined_decimal_odds": float(h.combined_decimal_odds or 0),
            "total_return": float(h.total_return or 0),
            "created_at": h.created_at.isoformat(),
            "picks": h.picks_json,
        })

    return {
        "players": player_stats_list,
        "accas": grouped
    }


# ============================================================
# COMPLETED RACE DAYS
# ============================================================
@router.get("/racedays")
def get_completed_racedays(db: Session = Depends(get_db)):
    racedays = (
        db.query(models.CompletedRaceDay)
        .options(joinedload(models.CompletedRaceDay.bets))
        .order_by(models.CompletedRaceDay.date.desc())
        .all()
    )

    result = []

    for rd in racedays:
        result.append({
            "id": rd.id,
            "date": rd.date,
            "total_stake": rd.total_stake,
            "total_return": rd.total_return,
            "profit": rd.profit,
            "bets": [
                {
                    "player_id": b.player_id,
                    "player_name": b.player_name,
                    "course": b.course,
                    "race_time": b.race_time,
                    "horse_name": b.horse_name,
                    "horse_number": b.horse_number,
                    "odds_fraction": b.odds_fraction,
                    "result": b.result,
                    "stake": b.stake,
                    "winnings": b.winnings
                }
                for b in rd.bets
            ]
        })

    return result


# ============================================================
# RACE DAY PLAYER PERFORMANCE
# ============================================================
@router.get("/raceday/players")
def raceday_player_stats(db: Session = Depends(get_db)):
    players = db.query(models.Player).all()
    racedays = db.query(models.CompletedRaceDay).options(
        joinedload(models.CompletedRaceDay.bets)
    ).all()

    stats = {
        p.name: {"wins": 0, "places": 0, "loses": 0, "nr": 0, "profit": 0}
        for p in players
    }

    for rd in racedays:
        for b in rd.bets:
            name = b.player_name
            if name not in stats:
                continue

            if b.result == "Win":
                stats[name]["wins"] += 1
            elif b.result == "Place":
                stats[name]["places"] += 1
            elif b.result == "Lose":
                stats[name]["loses"] += 1
            elif b.result == "NR":
                stats[name]["nr"] += 1

            stats[name]["profit"] += (b.winnings - b.stake)

    return [
        {"player": name, **values}
        for name, values in stats.items()
    ]
# ============================================================
# EXPORT HELPERS
# ============================================================
def get_raceday_data(db: Session):
    racedays = (
        db.query(models.CompletedRaceDay)
        .options(joinedload(models.CompletedRaceDay.bets))
        .order_by(models.CompletedRaceDay.date.desc())
        .all()
    )

    players = db.query(models.Player).all()

    player_stats = {
        p.name: {"wins": 0, "places": 0, "loses": 0, "nr": 0, "profit": 0}
        for p in players
    }

    for rd in racedays:
        for b in rd.bets:
            name = b.player_name
            if name not in player_stats:
                continue

            if b.result == "Win":
                player_stats[name]["wins"] += 1
            elif b.result == "Place":
                player_stats[name]["places"] += 1
            elif b.result == "Lose":
                player_stats[name]["loses"] += 1
            elif b.result == "NR":
                player_stats[name]["nr"] += 1

            player_stats[name]["profit"] += (b.winnings - b.stake)

    return racedays, player_stats


def get_acca_data(db: Session):
    accas = (
        db.query(models.AccaHistory)
        .order_by(models.AccaHistory.created_at.desc())
        .all()
    )

    players = db.query(models.Player).all()

    player_stats = {
        p.name: {"wins": 0, "places": 0, "loses": 0, "nr": 0}
        for p in players
    }

    for a in accas:
        for pick in a.picks_json or []:
            name = pick.get("player")
            result = pick.get("result")

            if name not in player_stats:
                continue

            if result == "Win":
                player_stats[name]["wins"] += 1
            elif result == "Place":
                player_stats[name]["places"] += 1
            elif result == "Lose":
                player_stats[name]["loses"] += 1
            elif result == "NR":
                player_stats[name]["nr"] += 1

    return accas, player_stats


def get_summary_data(db: Session):
    players = db.query(models.Player).all()
    picks = db.query(models.Pick).all()

    player_stats = {
        p.name: {"wins": 0, "places": 0, "loses": 0, "nr": 0}
        for p in players
    }

    for p in picks:
        player = db.query(models.Player).filter(models.Player.id == p.player_id).first()
        if not player:
            continue

        name = player.name

        if p.status == "Win":
            player_stats[name]["wins"] += 1
        elif p.status == "Place":
            player_stats[name]["places"] += 1
        elif p.status == "Lose":
            player_stats[name]["loses"] += 1
        elif p.status == "NR":
            player_stats[name]["nr"] += 1

    return player_stats


# ============================================================
# RACE DAY EXPORT — EXCEL (PREMIUM BOOKMAKER STYLE)
# ============================================================
@router.get("/export/raceday/excel")
def export_raceday_excel(db: Session = Depends(get_db)):
    import xlsxwriter

    racedays, player_stats = get_raceday_data(db)

    RACING_GREEN = "#004225"
    GOLD = "#D4AF37"
    CREAM = "#FAF7F0"

    output = BytesIO()
    workbook = xlsxwriter.Workbook(output, {"in_memory": True})

    # Sheet 1 — Race Day Summary
    ws = workbook.add_worksheet("Race Day Summary")
    headers = ["Date", "Stake", "Return", "Profit"]

    header_fmt = workbook.add_format({
        "bold": True,
        "font_color": GOLD,
        "bg_color": RACING_GREEN,
        "border": 1,
        "border_color": GOLD,
        "align": "center",
        "valign": "vcenter"
    })

    body_fmt = workbook.add_format({
        "border": 1,
        "border_color": "#CCCCCC",
        "bg_color": CREAM
    })

    for col, h in enumerate(headers):
        ws.write(0, col, h, header_fmt)

    for r, rd in enumerate(racedays, start=1):
        ws.write(r, 0, rd.date.strftime("%Y-%m-%d"), body_fmt)
        ws.write(r, 1, float(rd.total_stake), body_fmt)
        ws.write(r, 2, float(rd.total_return), body_fmt)
        ws.write(r, 3, float(rd.profit), body_fmt)

    for col in range(len(headers)):
        ws.set_column(col, col, max(12, len(headers[col]) + 2))

    ws.autofilter(0, 0, len(racedays), len(headers) - 1)

    # Sheet 2 — Player Performance
    ws2 = workbook.add_worksheet("Player Performance")
    headers2 = ["Player", "Wins", "Places", "Loses", "NR", "Profit"]

    for col, h in enumerate(headers2):
        ws2.write(0, col, h, header_fmt)

    for r, (name, stats) in enumerate(player_stats.items(), start=1):
        ws2.write(r, 0, name, body_fmt)
        ws2.write(r, 1, stats["wins"], body_fmt)
        ws2.write(r, 2, stats["places"], body_fmt)
        ws2.write(r, 3, stats["loses"], body_fmt)
        ws2.write(r, 4, stats["nr"], body_fmt)
        ws2.write(r, 5, float(stats["profit"]), body_fmt)

    for col in range(len(headers2)):
        ws2.set_column(col, col, max(12, len(headers2[col]) + 2))

    ws2.autofilter(0, 0, len(player_stats), len(headers2) - 1)

    workbook.close()
    output.seek(0)

    return Response(
        content=output.read(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=raceday_summary.xlsx"}
    )


# ============================================================
# RACE DAY EXPORT — PDF (PREMIUM BOOKMAKER STYLE, T2 SPACING)
# ============================================================
@router.get("/export/raceday/pdf")
def export_raceday_pdf(db: Session = Depends(get_db)):
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas
    from reportlab.lib import colors
    from reportlab.lib.units import mm

    racedays, player_stats = get_raceday_data(db)

    stream = BytesIO()
    c = canvas.Canvas(stream, pagesize=A4)
    width, height = A4

    # GLOBAL SPACING CONSTANTS (T2 — Tight Premium)
    ROW_GAP = 6 * mm
    SECTION_GAP = 10 * mm
    PAGE_MARGIN_TOP = 15 * mm
    PAGE_MARGIN_BOTTOM = 15 * mm

    # TILE INTERNAL PADDING (Option B — Medium)
    INNER_PADDING = 2 * mm
    TITLE_BAR_HEIGHT = 10 * mm

    RACING_GREEN = colors.HexColor("#004225")
    GOLD = colors.HexColor("#D4AF37")
    CREAM = colors.HexColor("#FAF7F0")

    def header(title):
        c.setFillColor(RACING_GREEN)
        c.rect(0, height - 20*mm, width, 20*mm, fill=1, stroke=0)
        c.setFillColor(GOLD)
        c.setFont("Helvetica-Bold", 16)
        c.drawCentredString(width / 2, height - 8*mm, title)

    def draw_tile(x, y, w, h, title_text=None):
        radius = 6
        c.setFillColor(CREAM)
        c.setStrokeColor(GOLD)
        c.roundRect(x, y, w, h, radius, stroke=1, fill=1)

        if title_text:
            c.setFillColor(RACING_GREEN)
            c.roundRect(x, y + h - TITLE_BAR_HEIGHT, w, TITLE_BAR_HEIGHT,
                        radius, stroke=0, fill=1)
            c.setFillColor(GOLD)
            c.setFont("Helvetica-Bold", 11)
            c.drawString(
                x + INNER_PADDING,
                y + h - TITLE_BAR_HEIGHT + (TITLE_BAR_HEIGHT / 3),
                title_text
            )

    # Start page
    header("Race Day Report")
    y = height - PAGE_MARGIN_TOP - 15*mm

    # ============================================================
    # SUMMARY TILES (3‑column grid, safe vertical flow)
    # ============================================================
    tile_w = (width - 40*mm) / 3
    tile_h = 20 * mm
    x_start = 15 * mm

    total_stake = sum(float(rd.total_stake) for rd in racedays)
    total_return = sum(float(rd.total_return) for rd in racedays)
    total_profit = sum(float(rd.profit) for rd in racedays)
    total_bets = sum(len(rd.bets) for rd in racedays)

    summary_items = [
        ("Total Bets", total_bets),
        ("Total Stake", f"£{total_stake:.2f}"),
        ("Total Return", f"£{total_return:.2f}"),
        ("Total Profit", f"£{total_profit:.2f}"),
    ]

    last_y_tile = None

    for i, (label, value) in enumerate(summary_items):
        col = i % 3
        row = i // 3

        x = x_start + col * (tile_w + ROW_GAP)
        y_tile = y - row * (tile_h + ROW_GAP)
        last_y_tile = y_tile

        draw_tile(x, y_tile, tile_w, tile_h, label)

        c.setFillColor(colors.black)
        c.setFont("Helvetica-Bold", 12)
        c.drawString(x + INNER_PADDING, y_tile + INNER_PADDING, str(value))

    # Move below summary section
    y = last_y_tile - SECTION_GAP

    # ============================================================
    # PLAYER TILES (bulletproof 2‑column layout)
    # ============================================================
    tile_w_p = (width - 25*mm) / 2
    tile_h_p = 25 * mm

    players_list = [
        {
            "name": name,
            "wins": stats["wins"],
            "places": stats["places"],
            "loses": stats["loses"],
            "nr": stats["nr"],
            "profit": stats["profit"],
        }
        for name, stats in player_stats.items()
    ]

    current_y = y
    row_buffer = []

    def flush_row():
        nonlocal current_y, row_buffer

        if not row_buffer:
            return

        # Page break BEFORE drawing the row
        if current_y - tile_h_p < PAGE_MARGIN_BOTTOM:
            c.showPage()
            header("Race Day Report")
            current_y = height - PAGE_MARGIN_TOP

        for col, p in enumerate(row_buffer):
            x = x_start + col * (tile_w_p + ROW_GAP)
            y_tile = current_y

            draw_tile(x, y_tile, tile_w_p, tile_h_p, p["name"])

            c.setFillColor(colors.black)
            c.setFont("Helvetica", 10)

            body_y = y_tile + tile_h_p - TITLE_BAR_HEIGHT - INNER_PADDING - 2

            c.drawString(
                x + INNER_PADDING,
                body_y,
                f"W {p['wins']} | P {p['places']} | L {p['loses']} | NR {p['nr']}"
            )

            c.drawString(
                x + INNER_PADDING,
                body_y - 18,
                f"Profit £{p['profit']:.2f}"
            )

        current_y -= (tile_h_p + ROW_GAP)
        row_buffer = []

    for p in players_list:
        row_buffer.append(p)
        if len(row_buffer) == 2:
            flush_row()

    flush_row()

    # Finalise
    c.showPage()
    c.save()
    stream.seek(0)

    return Response(
        content=stream.read(),
        media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=raceday_report.pdf"}
    )


# ============================================================
# ACCA EXPORT — PDF (PREMIUM BOOKMAKER STYLE, T2 SPACING)
# ============================================================
@router.get("/export/acca/pdf")
def export_acca_pdf(db: Session = Depends(get_db)):
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas
    from reportlab.lib import colors
    from reportlab.lib.units import mm

    accas, player_stats = get_acca_data(db)

    stream = BytesIO()
    c = canvas.Canvas(stream, pagesize=A4)
    width, height = A4

    # GLOBAL SPACING CONSTANTS (T2 — Tight Premium)
    ROW_GAP = 6 * mm
    SECTION_GAP = 10 * mm
    PAGE_MARGIN_TOP = 20 * mm
    PAGE_MARGIN_BOTTOM = 20 * mm

    # TILE INTERNAL PADDING (Option B — Medium)
    INNER_PADDING = 4 * mm
    TITLE_BAR_HEIGHT = 12 * mm

    # COLOURS
    RACING_GREEN = colors.HexColor("#004225")
    GOLD = colors.HexColor("#D4AF37")
    CREAM = colors.HexColor("#FAF7F0")
    PALE_GREEN = colors.HexColor("#E6F4EA")
    PALE_RED = colors.HexColor("#FDE7E9")
    PALE_BLUE = colors.HexColor("#E5F0FF")
    PALE_GREY = colors.HexColor("#F2F2F2")

    # HEADER BAR
    def header(title):
        c.setFillColor(RACING_GREEN)
        c.rect(0, height - 20*mm, width, 20*mm, fill=1, stroke=0)
        c.setFillColor(GOLD)
        c.setFont("Helvetica-Bold", 16)
        c.drawCentredString(width / 2, height - 8*mm, title)

    # PARENT TILE
    def parent_tile(x, y, w, h, title):
        radius = 8
        c.setFillColor(CREAM)
        c.setStrokeColor(GOLD)
        c.roundRect(x, y, w, h, radius, stroke=1, fill=1)

        c.setFillColor(RACING_GREEN)
        c.roundRect(x, y + h - TITLE_BAR_HEIGHT, w, TITLE_BAR_HEIGHT, radius, stroke=0, fill=1)

        c.setFillColor(GOLD)
        c.setFont("Helvetica-Bold", 12)
        c.drawString(x + INNER_PADDING, y + h - TITLE_BAR_HEIGHT + (TITLE_BAR_HEIGHT / 3), title)

    # MINI TILE
    def mini_tile(x, y, w, h, pick):
        result = pick.get("result", "Pending")

        if result == "Win":
            bg = PALE_GREEN
            rc = colors.green
        elif result == "Lose":
            bg = PALE_RED
            rc = colors.HexColor("#B00020")
        elif result == "Place":
            bg = PALE_BLUE
            rc = colors.HexColor("#0047AB")
        elif result == "NR":
            bg = PALE_GREY
            rc = colors.grey
        else:
            bg = colors.white
            rc = colors.black

        radius = 6
        c.setFillColor(bg)
        c.setStrokeColor(GOLD)
        c.roundRect(x, y, w, h, radius, stroke=1, fill=1)

        text_y = y + h - INNER_PADDING - 12

        c.setFillColor(colors.black)
        c.setFont("Helvetica-Bold", 10)
        c.drawString(x + INNER_PADDING, text_y,
                     f"{pick.get('player')} — {pick.get('course')} — {pick.get('race_time')}")

        text_y -= 14
        c.setFont("Helvetica", 10)
        c.drawString(x + INNER_PADDING, text_y,
                     f"Horse: {pick.get('horse_name')} (#{pick.get('horse_number')})")

        text_y -= 14
        c.drawString(x + INNER_PADDING, text_y,
                     f"Odds: {pick.get('odds_fraction')}")

        text_y -= 14
        c.setFillColor(rc)
        c.drawString(x + INNER_PADDING, text_y, f"Result: {result}")

    # START PAGE
    header("ACCA Report")
    y = height - PAGE_MARGIN_TOP - 20*mm

    # SUMMARY TILES
    TILE_W = (width - 60) / 3
    TILE_H = 30
    TILE_RADIUS = 6

    total_accas = len(accas)
    wins = sum(1 for a in accas if a.status == "win")
    places = sum(1 for a in accas if a.status == "place")
    loses = sum(1 for a in accas if a.status == "lose")
    total_stake = sum((a.stake or 0) for a in accas)
    total_return = sum((a.total_return or 0) for a in accas)
    total_profit = total_return - total_stake
    biggest_return = max(((a.total_return or 0) for a in accas), default=0)

    summary_items = [
        ("Total Accas", total_accas),
        ("Wins", wins),
        ("Places", places),
        ("Loses", loses),
        ("Total Stake", f"£{total_stake:g}"),
        ("Total Return", f"£{total_return:g}"),
        ("Profit", f"£{total_profit:g}"),
        ("Biggest Return", f"£{biggest_return:g}"),
    ]

    x_start = 40

    for i, (label, value) in enumerate(summary_items):
        col = i % 3
        row = i // 3
        x = x_start + col * (TILE_W + ROW_GAP)
        y_tile = y - row * (TILE_H + ROW_GAP)

        c.setFillColor(CREAM)
        c.setStrokeColor(GOLD)
        c.roundRect(x, y_tile, TILE_W, TILE_H, TILE_RADIUS, stroke=1, fill=1)

        c.setFillColor(RACING_GREEN)
        c.roundRect(x, y_tile + TILE_H - TITLE_BAR_HEIGHT, TILE_W, TITLE_BAR_HEIGHT,
                    TILE_RADIUS, stroke=0, fill=1)

        c.setFillColor(GOLD)
        c.setFont("Helvetica-Bold", 9)
        c.drawString(x + INNER_PADDING, y_tile + TILE_H - 9, label)

        c.setFillColor(colors.black)
        c.setFont("Helvetica-Bold", 11)
        c.drawString(x + INNER_PADDING, y_tile + INNER_PADDING, str(value))

    y = y_tile - SECTION_GAP

    # ACCA BREAKDOWN
    PARENT_W = width * 0.80
    PARENT_X = (width - PARENT_W) / 2
    MINI_W = (PARENT_W - 30) / 2
    MINI_H = 80

    for acca in accas:
        picks = acca.picks_json or []
        rows = (len(picks) + 1) // 2
        parent_h = 120 + rows * (MINI_H + ROW_GAP)

        if y - parent_h < PAGE_MARGIN_BOTTOM:
            c.showPage()
            header("ACCA Report")
            y = height - PAGE_MARGIN_TOP

        parent_y = y - parent_h

        parent_tile(
            PARENT_X,
            parent_y,
            PARENT_W,
            parent_h,
            f"ACCA #{acca.id} — {acca.created_at.strftime('%Y-%m-%d') if acca.created_at else '-'} — {acca.status.upper()}"
        )

        ty = parent_y + parent_h - TITLE_BAR_HEIGHT - INNER_PADDING - 12

        c.setFillColor(colors.black)
        c.setFont("Helvetica", 10)
        c.drawString(PARENT_X + INNER_PADDING, ty,
                     f"Combined Odds: {acca.combined_decimal_odds:g}")
        ty -= 14
        c.drawString(PARENT_X + INNER_PADDING, ty,
                     f"Stake: £{(acca.stake or 0):g}")
        ty -= 14
        c.drawString(PARENT_X + INNER_PADDING, ty,
                     f"Return: £{(acca.total_return or 0):g}")
        ty -= 20

        for i, pick in enumerate(picks):
            col = i % 2
            row = i // 2
            mx = PARENT_X + INNER_PADDING + col * (MINI_W + ROW_GAP)
            my = ty - row * (MINI_H + ROW_GAP)
            mini_tile(mx, my, MINI_W, MINI_H, pick)

        y = parent_y - SECTION_GAP

    c.showPage()
    c.save()
    stream.seek(0)

    return Response(
        content=stream.read(),
        media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=acca_report.pdf"}
    )


# ============================================================
# ACCA EXPORT — EXCEL (PREMIUM BOOKMAKER STYLE)
# ============================================================
@router.get("/export/acca/excel")
def export_acca_excel(db: Session = Depends(get_db)):
    import xlsxwriter

    accas, player_stats = get_acca_data(db)

    RACING_GREEN = "#004225"
    GOLD = "#D4AF37"
    CREAM = "#FAF7F0"

    output = BytesIO()
    workbook = xlsxwriter.Workbook(output, {"in_memory": True})

    # SHEET 1 — ACCA SUMMARY
    ws = workbook.add_worksheet("Acca Summary")
    headers = [
        "ID", "Created At", "Status",
        "Stake", "Return", "Profit", "Combined Decimal Odds"
    ]

    header_fmt = workbook.add_format({
        "bold": True,
        "font_color": GOLD,
        "bg_color": RACING_GREEN,
        "border": 1,
        "border_color": GOLD,
        "align": "center",
        "valign": "vcenter"
    })

    body_fmt = workbook.add_format({
        "border": 1,
        "border_color": "#CCCCCC",
        "bg_color": CREAM
    })

    for col, h in enumerate(headers):
        ws.write(0, col, h, header_fmt)

    for r, a in enumerate(accas, start=1):
        profit = (a.total_return or 0) - (a.stake or 0)

        ws.write(r, 0, a.id, body_fmt)
        ws.write(r, 1, a.created_at.strftime("%Y-%m-%d") if a.created_at else "", body_fmt)
        ws.write(r, 2, a.status, body_fmt)
        ws.write(r, 3, float(a.stake or 0), body_fmt)
        ws.write(r, 4, float(a.total_return or 0), body_fmt)
        ws.write(r, 5, float(profit), body_fmt)
        ws.write(r, 6, float(a.combined_decimal_odds or 0), body_fmt)

    for col in range(len(headers)):
        ws.set_column(col, col, max(14, len(headers[col]) + 2))

    ws.autofilter(0, 0, len(accas), len(headers) - 1)

    # SHEET 2 — PLAYER PERFORMANCE
    ws2 = workbook.add_worksheet("Player Performance")
    headers2 = ["Player", "Wins", "Places", "Loses", "NR"]

    for col, h in enumerate(headers2):
        ws2.write(0, col, h, header_fmt)

    for r, (name, stats) in enumerate(player_stats.items(), start=1):
        ws2.write(r, 0, name, body_fmt)
        ws2.write(r, 1, stats["wins"], body_fmt)
        ws2.write(r, 2, stats["places"], body_fmt)
        ws2.write(r, 3, stats["loses"], body_fmt)
        ws2.write(r, 4, stats["nr"], body_fmt)

    for col in range(len(headers2)):
        ws2.set_column(col, col, max(12, len(headers2[col]) + 2))

    ws2.autofilter(0, 0, len(player_stats), len(headers2) - 1)

    workbook.close()
    output.seek(0)

    return Response(
        content=output.read(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=acca_summary.xlsx"}
    )
# ============================================================
# SUMMARY EXPORT — EXCEL (PREMIUM BOOKMAKER STYLE)
# ============================================================
@router.get("/export/summary/excel")
def export_summary_excel(db: Session = Depends(get_db)):
    import xlsxwriter

    player_stats = get_summary_data(db)

    RACING_GREEN = "#004225"
    GOLD = "#D4AF37"
    CREAM = "#FAF7F0"

    output = BytesIO()
    workbook = xlsxwriter.Workbook(output, {"in_memory": True})

    ws = workbook.add_worksheet("Overall Summary")
    headers = ["Player", "Wins", "Places", "Loses", "NR"]

    header_fmt = workbook.add_format({
        "bold": True,
        "font_color": GOLD,
        "bg_color": RACING_GREEN,
        "border": 1,
        "border_color": GOLD,
        "align": "center",
        "valign": "vcenter"
    })

    body_fmt = workbook.add_format({
        "border": 1,
        "border_color": "#CCCCCC",
        "bg_color": CREAM
    })

    for col, h in enumerate(headers):
        ws.write(0, col, h, header_fmt)

    for r, (name, stats) in enumerate(player_stats.items(), start=1):
        ws.write(r, 0, name, body_fmt)
        ws.write(r, 1, stats["wins"], body_fmt)
        ws.write(r, 2, stats["places"], body_fmt)
        ws.write(r, 3, stats["loses"], body_fmt)
        ws.write(r, 4, stats["nr"], body_fmt)

    for col in range(len(headers)):
        ws.set_column(col, col, max(12, len(headers[col]) + 2))

    ws.autofilter(0, 0, len(player_stats), len(headers) - 1)

    workbook.close()
    output.seek(0)

    return Response(
        content=output.read(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=performance_summary.xlsx"}
    )


# ============================================================
# SUMMARY EXPORT — PDF (PREMIUM TILES, 2 COLUMNS — T2 SPACING)
# ============================================================
@router.get("/export/summary/pdf")
def export_summary_pdf(db: Session = Depends(get_db)):
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas
    from reportlab.lib import colors
    from reportlab.lib.units import mm

    player_stats = get_summary_data(db)

    stream = BytesIO()
    c = canvas.Canvas(stream, pagesize=A4)
    width, height = A4

    # GLOBAL SPACING CONSTANTS (T2 — Tight Premium)
    ROW_GAP = 6 * mm
    SECTION_GAP = 10 * mm
    PAGE_MARGIN_TOP = 20 * mm
    PAGE_MARGIN_BOTTOM = 20 * mm

    # TILE INTERNAL PADDING (Option B — Medium)
    INNER_PADDING = 4 * mm
    TITLE_BAR_HEIGHT = 12 * mm

    # COLOURS
    RACING_GREEN = colors.HexColor("#004225")
    GOLD = colors.HexColor("#D4AF37")
    CREAM = colors.HexColor("#FAF7F0")

    # HEADER BAR
    def header(title):
        c.setFillColor(RACING_GREEN)
        c.rect(0, height - 20*mm, width, 20*mm, fill=1, stroke=0)
        c.setFillColor(GOLD)
        c.setFont("Helvetica-Bold", 16)
        c.drawCentredString(width / 2, height - 8*mm, title)

    # TILE DRAWING FUNCTION
    def draw_tile(x, y, w, h, title_text):
        radius = 6

        c.setFillColor(CREAM)
        c.setStrokeColor(GOLD)
        c.roundRect(x, y, w, h, radius, stroke=1, fill=1)

        c.setFillColor(RACING_GREEN)
        c.roundRect(x, y + h - TITLE_BAR_HEIGHT, w, TITLE_BAR_HEIGHT,
                    radius, stroke=0, fill=1)

        c.setFillColor(GOLD)
        c.setFont("Helvetica-Bold", 11)
        c.drawString(
            x + INNER_PADDING,
            y + h - TITLE_BAR_HEIGHT + (TITLE_BAR_HEIGHT / 3),
            title_text
        )

    # START PAGE
    header("Overall Summary Report")
    y = height - PAGE_MARGIN_TOP - 20*mm

    tile_w = (width - 40*mm) / 2
    tile_h = 24 * mm
    x_start = 15 * mm

    players_list = [
        {
            "name": name,
            "wins": stats["wins"],
            "places": stats["places"],
            "loses": stats["loses"],
            "nr": stats["nr"],
        }
        for name, stats in player_stats.items()
    ]

    # PLAYER TILES (2‑COLUMN GRID)
    for i, p in enumerate(players_list):
        col = i % 2
        row = i // 2

        x = x_start + col * (tile_w + ROW_GAP)
        y_tile = y - row * (tile_h + ROW_GAP)

        if y_tile < PAGE_MARGIN_BOTTOM:
            c.showPage()
            header("Overall Summary Report")
            y = height - PAGE_MARGIN_TOP
            row = 0
            y_tile = y

        draw_tile(x, y_tile, tile_w, tile_h, p["name"])

        c.setFillColor(colors.black)
        c.setFont("Helvetica", 10)

        body_y = y_tile + tile_h - TITLE_BAR_HEIGHT - INNER_PADDING - 2

        c.drawString(
            x + INNER_PADDING,
            body_y,
            f"W {p['wins']} | P {p['places']} | L {p['loses']} | NR {p['nr']}"
        )

        if col == 1:
            y = y_tile - ROW_GAP

    c.showPage()
    c.save()
    stream.seek(0)

    return Response(
        content=stream.read(),
        media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=performance_summary.pdf"}
    )
