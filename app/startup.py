from app.database import SessionLocal
from app import models

def seed_players():
    db = SessionLocal()

    default_players = ["Craig", "Donald", "Miller", "Nick", "Josh"]

    for name in default_players:
        exists = db.query(models.Player).filter(models.Player.name == name).first()
        if not exists:
            db.add(models.Player(name=name))

    db.commit()
    db.close()
