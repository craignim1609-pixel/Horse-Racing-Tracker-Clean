from fastapi import FastAPI, Request, Depends
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from sqlalchemy.orm import Session

from app.database import Base, engine, get_db
from app import models

# Routers
from app.routers import picks, accumulator, raceday, players, stats
from app.routers.players import seed_players



app = FastAPI()

# -----------------------------------------
# DATABASE INITIALISATION
# -----------------------------------------
Base.metadata.create_all(bind=engine)


# -----------------------------------------
# STARTUP: SEED DEFAULT PLAYERS
# -----------------------------------------
@app.on_event("startup")
def startup_event():
    seed_players()


# -----------------------------------------
# API ROUTERS
# -----------------------------------------
app.include_router(picks.router)
app.include_router(accumulator.router)
app.include_router(raceday.router)
app.include_router(players.router)
app.include_router(stats.router)


# -----------------------------------------
# STATIC FILES + TEMPLATE ENGINE
# -----------------------------------------
app.mount("/static", StaticFiles(directory="app/static"), name="static")
templates = Jinja2Templates(directory="app/templates")


# -----------------------------------------
# PAGE ROUTES (WITH ACTIVE PAGE HIGHLIGHT)
# -----------------------------------------

# HOME PAGE
@app.get("/", response_class=HTMLResponse)
def home_page(request: Request):
    return templates.TemplateResponse("index.html", {
        "request": request,
        "active": "home"
    })


# RACE DAY PAGE
@app.get("/raceday", response_class=HTMLResponse)
def raceday_page(request: Request):
    return templates.TemplateResponse("raceday.html", {
        "request": request,
        "active": "raceday"
    })


# CURRENT PICKS PAGE
@app.get("/current-picks", response_class=HTMLResponse)
def current_picks_page(request: Request):
    return templates.TemplateResponse("current-picks.html", {
        "request": request,
        "active": "currentpicks"
    })


# ADD PICK PAGE  ⭐ FIXED — NOW LOADS PLAYERS
@app.get("/add-pick", response_class=HTMLResponse)
def add_pick_page(request: Request, db: Session = Depends(get_db)):
    players = db.query(models.Player).all()
    return templates.TemplateResponse("add-pick.html", {
        "request": request,
        "players": players,
        "active": "newpick"
    })


@app.get("/acca", response_class=HTMLResponse)
def acca_page(request: Request):
    added = request.query_params.get("added")
    return templates.TemplateResponse("acca.html", {
        "request": request,
        "active": "accumulator",
        "added": added
    })

