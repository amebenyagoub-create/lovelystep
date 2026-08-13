#!/usr/bin/env python3
"""Create and verify a long-lived Meta Page token without printing secrets.

By default this script is read-only with respect to Railway and the local
filesystem. It exchanges the supplied short-lived user token, derives the
long-lived Page token, and verifies the Page permissions and tasks.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request


GRAPH_VERSION = "v26.0"
GRAPH_BASE = f"https://graph.facebook.com/{GRAPH_VERSION}"
REQUIRED_ENV = (
    "META_APP_ID",
    "META_APP_SECRET",
    "META_SHORT_USER_ACCESS_TOKEN",
    "META_PAGE_ID",
)
REQUIRED_SCOPES = {
    "pages_manage_posts",
    "pages_read_engagement",
    "pages_show_list",
}
REQUIRED_TASKS = {"CREATE_CONTENT", "MANAGE", "MODERATE"}


class SafeError(RuntimeError):
    """An error message that is safe to show without credentials."""


def graph_request(
    path: str,
    *,
    access_token: str | None = None,
    params: dict[str, str] | None = None,
) -> dict:
    query = dict(params or {})
    if access_token:
        query["access_token"] = access_token
    url = f"{GRAPH_BASE}/{path.lstrip('/')}?{urllib.parse.urlencode(query)}"

    try:
        with urllib.request.urlopen(url, timeout=30) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        try:
            payload = json.loads(exc.read().decode("utf-8"))
            error = payload.get("error", {})
            message = error.get("message", f"HTTP {exc.code}")
            code = error.get("code")
            suffix = f" (code {code})" if code is not None else ""
            raise SafeError(f"{message}{suffix}") from None
        except (json.JSONDecodeError, UnicodeDecodeError):
            raise SafeError(f"Meta a repondu HTTP {exc.code}") from None
    except urllib.error.URLError as exc:
        raise SafeError(f"Connexion a Meta impossible: {exc.reason}") from None
    except TimeoutError:
        raise SafeError("La requete Meta a expire") from None

    if not isinstance(payload, dict):
        raise SafeError("Reponse Meta inattendue")
    if "error" in payload:
        error = payload["error"]
        raise SafeError(str(error.get("message", "Erreur Meta")))
    return payload


def require_environment() -> dict[str, str]:
    values = {name: os.environ.get(name, "").strip() for name in REQUIRED_ENV}
    missing = [name for name, value in values.items() if not value]
    if missing:
        raise SafeError("Variables manquantes: " + ", ".join(missing))
    return values


def run() -> None:
    print("[0/5] Verification des variables locales")
    env = require_environment()

    print("[1/5] Echange contre un token utilisateur longue duree")
    exchange = graph_request(
        "oauth/access_token",
        params={
            "grant_type": "fb_exchange_token",
            "client_id": env["META_APP_ID"],
            "client_secret": env["META_APP_SECRET"],
            "fb_exchange_token": env["META_SHORT_USER_ACCESS_TOKEN"],
        },
    )
    long_user_token = str(exchange.get("access_token", ""))
    if not long_user_token:
        raise SafeError("Meta n'a pas retourne de token utilisateur longue duree")

    print("[2/5] Verification des autorisations accordees")
    permissions = graph_request("me/permissions", access_token=long_user_token)
    granted = {
        item.get("permission")
        for item in permissions.get("data", [])
        if item.get("status") == "granted"
    }
    missing_scopes = sorted(REQUIRED_SCOPES - granted)
    if missing_scopes:
        raise SafeError("Autorisations manquantes: " + ", ".join(missing_scopes))

    print("[3/5] Generation du token longue duree de la Page")
    accounts = graph_request(
        "me/accounts",
        access_token=long_user_token,
        params={"fields": "id,name,access_token,tasks"},
    )
    page = next(
        (
            item
            for item in accounts.get("data", [])
            if str(item.get("id", "")) == env["META_PAGE_ID"]
        ),
        None,
    )
    if page is None:
        raise SafeError("La Page configuree n'apparait pas dans /me/accounts")
    page_token = str(page.get("access_token", ""))
    if not page_token:
        raise SafeError("Meta n'a pas retourne de token pour cette Page")

    print("[4/5] Verification des taches de la Page")
    tasks = set(page.get("tasks") or [])
    missing_tasks = sorted(REQUIRED_TASKS - tasks)
    if missing_tasks:
        raise SafeError("Taches Page manquantes: " + ", ".join(missing_tasks))

    print("[5/5] Test de lecture avec le nouveau token de Page")
    page_info = graph_request(
        env["META_PAGE_ID"],
        access_token=page_token,
        params={"fields": "id,name"},
    )
    if str(page_info.get("id", "")) != env["META_PAGE_ID"]:
        raise SafeError("Le token obtenu ne correspond pas a la Page configuree")

    print("Etapes 1 a 5 reussies.")
    if "--copy-page-token" in sys.argv[1:]:
        try:
            subprocess.run(
                ["clip.exe"],
                input=page_token,
                text=True,
                check=True,
                capture_output=True,
            )
        except (OSError, subprocess.CalledProcessError):
            raise SafeError("Impossible de copier le token dans le presse-papiers") from None
        print("Token de Page durable copie dans le presse-papiers.")
    else:
        print("Aucun secret affiche, aucun fichier modifie, Railway non modifie.")


if __name__ == "__main__":
    try:
        run()
    except SafeError as exc:
        print(f"ECHEC: {exc}", file=sys.stderr)
        sys.exit(1)
