# Splitsies

Trip expense splitter with Discord bot integration.

## Setup

```bash
# 1. Clone / unzip into a folder, then:
cd splitsies

# 2. Create a virtual environment
python3 -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Copy the env file and set a secret key
cp .env.example .env
# Edit .env and set SECRET_KEY to any random string

# 5. Run
python app.py
```

Open http://localhost:5000 in your browser.

## Project structure

```
splitsies/
├── app.py              # Flask app — all routes and models
├── requirements.txt
├── .env.example
├── templates/
│   └── index.html      # Single-page Jinja2 template
└── static/
    ├── css/style.css
    └── js/app.js
```

## Discord bot setup

1. Go to https://discord.com/developers/applications
2. New Application → Bot → Reset Token → copy it
3. Enable **Message Content Intent** under Privileged Intents
4. Invite the bot to your server with **Send Messages** permission
5. In Discord: Settings → Advanced → enable Developer Mode
6. Right-click your channel → Copy Channel ID
7. Paste both into the Discord tab in Splitsies and hit send

## Data

Expenses and people are stored in `splitsies.db` (SQLite) in the project root.
Delete it to start fresh.