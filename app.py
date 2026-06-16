from flask import Flask, render_template, request, jsonify, redirect, url_for
from flask_sqlalchemy import SQLAlchemy
from dotenv import load_dotenv
import os
import requests as http_requests
from datetime import datetime

load_dotenv()

app = Flask(__name__)
app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///splitsies.db"
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.secret_key = os.getenv("SECRET_KEY", "splitsies-dev-key")

db = SQLAlchemy(app)

# ── Models ────────────────────────────────────────────────────────────────────

class Person(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False, unique=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

class Expense(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    description = db.Column(db.String(200), nullable=False)
    amount = db.Column(db.Float, nullable=False)
    payer = db.Column(db.String(100), nullable=False)
    split_mode = db.Column(db.String(20), nullable=False, default="equal")
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    shares = db.relationship("Share", backref="expense", cascade="all, delete-orphan")

class Share(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    expense_id = db.Column(db.Integer, db.ForeignKey("expense.id"), nullable=False)
    person = db.Column(db.String(100), nullable=False)
    amount = db.Column(db.Float, nullable=False)

# ── Helpers ───────────────────────────────────────────────────────────────────

def compute_balances():
    people = [p.name for p in Person.query.all()]
    bal = {p: 0.0 for p in people}
    for expense in Expense.query.all():
        if expense.payer in bal:
            bal[expense.payer] += expense.amount
        for share in expense.shares:
            if share.person in bal:
                bal[share.person] -= share.amount
    return bal

def compute_settlements(bal):
    creditors = [(p, b) for p, b in bal.items() if b > 0.005]
    debtors = [(p, -b) for p, b in bal.items() if b < -0.005]
    creditors.sort(key=lambda x: -x[1])
    debtors.sort(key=lambda x: -x[1])
    settlements = []
    ci, di = 0, 0
    cred = list(creditors)
    debt = list(debtors)
    while ci < len(cred) and di < len(debt):
        cp, ca = cred[ci]
        dp, da = debt[di]
        amt = min(ca, da)
        settlements.append({"from": dp, "to": cp, "amount": round(amt, 2)})
        cred[ci] = (cp, ca - amt)
        debt[di] = (dp, da - amt)
        if cred[ci][1] < 0.005:
            ci += 1
        if debt[di][1] < 0.005:
            di += 1
    return settlements


def get_trip_summary():
    people = Person.query.order_by(Person.created_at).all()
    expenses = Expense.query.order_by(Expense.created_at.desc()).all()
    total = sum(e.amount for e in expenses)
    balances = compute_balances() if people and expenses else {}
    settlements = compute_settlements(dict(balances)) if balances else []
    return {
        "people": people,
        "expenses": expenses,
        "total": round(total, 2),
        "expense_count": len(expenses),
        "people_count": len(people),
        "balances": {k: round(v, 2) for k, v in balances.items()},
        "settlements": settlements,
    }


def format_summary_message(summary):
    bal = summary["balances"]
    settlements = summary["settlements"]
    total = summary["total"]
    expense_count = summary["expense_count"]

    lines = [
        "💸 **Splitsies — Trip Summary**",
        f"Total spent: **${total:.2f}** across {expense_count} expense(s)",
        "",
        "**Final balances:**",
    ]
    for person, b in bal.items():
        if b > 0.005:
            lines.append(f"• {person} gets back **${b:.2f}**")
        elif b < -0.005:
            lines.append(f"• {person} owes **${abs(b):.2f}**")
        else:
            lines.append(f"• {person} is settled up ✓")

    if settlements:
        lines += ["", "**Who pays whom:**"]
        for s in settlements:
            lines.append(f"• {s['from']} → {s['to']}: **${s['amount']:.2f}**")

    return "\n".join(lines)


@app.template_filter("friendly_date")
def friendly_date(dt):
    if not dt:
        return ""
    return f"{dt.strftime('%b')} {dt.day}"

# ── Routes ────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    summary = get_trip_summary()
    return render_template(
        "index.html",
        people=summary["people"],
        expenses=summary["expenses"],
        total=summary["total"],
        balances=summary["balances"],
        settlements=summary["settlements"],
        discord_token=os.getenv("DISCORD_BOT_TOKEN", ""),
        discord_channel=os.getenv("DISCORD_CHANNEL_ID", ""),
    )


@app.route("/api/summary")
def api_summary():
    summary = get_trip_summary()
    return jsonify(
        {
            "total": summary["total"],
            "expense_count": summary["expense_count"],
            "people_count": summary["people_count"],
            "balances": summary["balances"],
            "settlements": summary["settlements"],
            "people": [{"id": p.id, "name": p.name} for p in summary["people"]],
        }
    )

# People
@app.route("/people/add", methods=["POST"])
def add_person():
    name = request.form.get("name", "").strip()
    if not name:
        return jsonify({"error": "Name is required"}), 400
    if Person.query.filter_by(name=name).first():
        return jsonify({"error": f'"{name}" is already on the trip'}), 400
    person = Person(name=name)
    db.session.add(person)
    db.session.commit()
    return jsonify({"ok": True, "id": person.id, "name": name})

@app.route("/people/delete/<int:person_id>", methods=["POST"])
def delete_person(person_id):
    person = Person.query.get_or_404(person_id)
    db.session.delete(person)
    db.session.commit()
    return jsonify({"ok": True})

# Expenses
@app.route("/expenses/add", methods=["POST"])
def add_expense():
    data = request.get_json()
    description = (data.get("description") or "").strip()
    amount = data.get("amount")
    payer = (data.get("payer") or "").strip()
    split_mode = data.get("split_mode", "equal")
    shares_data = data.get("shares", {})

    if not description or not amount or not payer:
        return jsonify({"error": "Description, amount, and payer are required"}), 400

    try:
        amount = float(amount)
        if amount <= 0:
            raise ValueError
    except (TypeError, ValueError):
        return jsonify({"error": "Amount must be a positive number"}), 400

    if not shares_data:
        return jsonify({"error": "At least one person must be involved"}), 400

    if split_mode == "custom":
        total_shares = sum(float(v) for v in shares_data.values())
        if abs(total_shares - amount) > 0.02:
            return jsonify({"error": f"Custom amounts total ${total_shares:.2f} but expense is ${amount:.2f}"}), 400

    expense = Expense(
        description=description,
        amount=amount,
        payer=payer,
        split_mode=split_mode,
    )
    db.session.add(expense)
    db.session.flush()

    if split_mode == "equal":
        each = amount / len(shares_data)
        for person in shares_data:
            db.session.add(Share(expense_id=expense.id, person=person, amount=round(each, 4)))
    else:
        for person, share_amt in shares_data.items():
            db.session.add(Share(expense_id=expense.id, person=person, amount=float(share_amt)))

    db.session.commit()
    return jsonify({"ok": True, "id": expense.id})

@app.route("/expenses/delete/<int:expense_id>", methods=["POST"])
def delete_expense(expense_id):
    expense = Expense.query.get_or_404(expense_id)
    db.session.delete(expense)
    db.session.commit()
    return jsonify({"ok": True})

# Discord
@app.route("/discord/send", methods=["POST"])
def discord_send():
    data = request.get_json() or {}
    token = (data.get("token") or os.getenv("DISCORD_BOT_TOKEN") or "").strip()
    channel_id = (data.get("channel_id") or os.getenv("DISCORD_CHANNEL_ID") or "").strip()

    if not token or not channel_id:
        return jsonify({"error": "Bot token and channel ID are required"}), 400

    summary = get_trip_summary()
    if not summary["expense_count"]:
        return jsonify({"error": "No expenses to send yet"}), 400

    message = format_summary_message(summary)

    try:
        resp = http_requests.post(
            f"https://discord.com/api/v10/channels/{channel_id}/messages",
            headers={
                "Authorization": f"Bot {token}",
                "Content-Type": "application/json",
            },
            json={"content": message},
            timeout=10,
        )
        if resp.ok:
            return jsonify({"ok": True})
        else:
            err = resp.json()
            return jsonify({"error": err.get("message", f"Discord error {resp.status_code}")}), 400
    except Exception as e:
        return jsonify({"error": f"Network error: {str(e)}"}), 500

# ── Init ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    with app.app_context():
        db.create_all()
    app.run(debug=True)